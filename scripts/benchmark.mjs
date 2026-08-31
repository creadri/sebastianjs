#!/usr/bin/env node
// Benchmark SebastianJS render performance against mermaid-cli (mmdc) over sample .mmd files
// Updates README.md between BENCHMARK_START / BENCHMARK_END markers with a Mermaid graph.

import { readdir, readFile, writeFile, stat, unlink, access } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { render, dispose } from '../src/index.js';
import { spawnMmdc } from './mmdc-wrapper.mjs';

const SAMPLES_DIR = 'samples/mermaid-demos';
const README = 'README.md';
// mermaid-cli is a devDependency, not a global. Probing `mmdc` on PATH silently
// dropped it from every benchmark run, leaving the README comparing nothing.
const MMDC_BIN = join('node_modules', '.bin', 'mmdc');
const PER_SAMPLE_TIMEOUT_MS = parseInt(process.env.BENCHMARK_TIMEOUT_MS || '30000', 10);

// Both renderers get the same mermaid config, so this measures speed rather than
// two different rendering modes.
const MERMAID_CONFIG = {
  startOnLoad: false,
  securityLevel: 'loose',
  fontFamily: 'Open Sans',
  themeVariables: { fontFamily: 'Open Sans' },
};

async function listSamples(dir) {
  const out = [];
  async function walk(d) {
    const ents = await readdir(d, { withFileTypes: true });
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p); else if (extname(p) === '.mmd' && !p.endsWith('manifest.json')) out.push(p);
    }
  }
  await walk(dir);
  return out.sort();
}

// --- Diagram-type detection & filtering (like deviation-suite) ---
const DEFAULT_ALLOWED = [
  'graph',
  'flowchart',
  'sequenceDiagram',
  'classDiagram',
  'erDiagram',
  'gantt',
  'pie',
  'journey',
  'stateDiagram', // includes stateDiagram-v2
  'gitGraph',
  'quadrantChart',
];

function getFirstKeyword(def) {
  const lines = def.split(/\r?\n/);
  let inFrontmatter = false;
  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const trimmed = (raw || '').trim();
    if (idx === 0 && trimmed === '---') { inFrontmatter = true; continue; }
    if (inFrontmatter) { if (trimmed === '---') inFrontmatter = false; continue; }
    if (!trimmed) continue;
    if (trimmed.startsWith('%%')) continue; // mermaid comment
    const m = trimmed.match(/^([A-Za-z][A-Za-z-]*)\b/);
    if (m) return m[1];
  }
  return '';
}

function detectDiagramType(def) {
  const kw = getFirstKeyword(def);
  if (kw === 'stateDiagram-v2') return 'stateDiagram';
  if (kw) return kw;
  // Heuristic: any non-comment line starting with graph|flowchart
  const lines = def.split(/\r?\n/);
  let inFrontmatter = false;
  for (let idx = 0; idx < lines.length; idx++) {
    const line = (lines[idx] || '').trim();
    if (idx === 0 && line === '---') { inFrontmatter = true; continue; }
    if (inFrontmatter) { if (line === '---') inFrontmatter = false; continue; }
    if (!line || line.startsWith('%%')) continue;
    if (/^(graph|flowchart)\s/i.test(line)) return line.split(/\s+/)[0];
  }
  return '';
}

function parseArgs(argv) {
  const out = { allow: null, deny: null, onlyStable: false, verbose: false, list: false, max: Infinity };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--allow' || a === '--types') {
      const val = argv[++i] || '';
      const list = val.split(',').map(s => s.trim()).filter(Boolean);
      out.allow = list.length ? list : null;
    } else if (a === '--deny') {
      const val = argv[++i] || '';
      const list = val.split(',').map(s => s.trim()).filter(Boolean);
      out.deny = list.length ? list : null;
    } else if (a === '--only-stable') {
      out.onlyStable = true;
    } else if (a === '-v' || a === '--verbose') {
      out.verbose = true;
    } else if (a === '--max') {
      const n = parseInt(argv[++i], 10);
      if (Number.isFinite(n) && n > 0) out.max = n;
    } else if (a === '--list-types' || a === '--list') {
      out.list = true;
    }
  }
  return out;
}

function hrtimeMs() { return Number(process.hrtime.bigint() / 1000000n); }

async function timeAsync(fn, timeoutMs = PER_SAMPLE_TIMEOUT_MS) {
  const start = hrtimeMs();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return { ms: hrtimeMs() - start, ok: true };
  } catch (e) {
    return { ms: hrtimeMs() - start, ok: false, error: e };
  }
}

function hasMmdc() {
  return existsSync(MMDC_BIN);
}

// findChromeExecutable imported from wrapper

async function writeTempPptrConfig() {
  const cfgPath = join(process.env.TMPDIR || '/tmp', `seb-pptr-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  const cfg = { args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--no-zygote', '--disable-dev-shm-usage'] };
  await writeFile(cfgPath, JSON.stringify(cfg), 'utf8');
  return cfgPath;
}

async function benchmarkSebastian(file) {
  const def = await readFile(file, 'utf8');
  return timeAsync(() => render(def, { width: 800, height: 600, mermaidConfig: MERMAID_CONFIG }));
}

async function benchmarkMmdc(file, cfgPath) {
  return timeAsync(async () => {
    const tmpOut = join(
      process.env.TMPDIR || '/tmp',
      `seb-bench-${process.pid}-${Math.random().toString(36).slice(2)}.svg`
    );
    try {
      await spawnMmdc(['-i', file, '-o', tmpOut, '-c', cfgPath], { stdio: 'ignore' });
    } finally {
      try { await unlink(tmpOut); } catch {}
    }
  });
}

function summarize(name, results) {
  // Only successful renders are timed. Averaging in failures — a timeout counts
  // as its full 30s budget — made a renderer look slower the more often it broke.
  const ok = results.filter((r) => r.ok);
  const times = ok.map((r) => r.ms);
  const total = times.reduce((a, ms) => a + ms, 0);
  return {
    name,
    count: results.length,
    ok: ok.length,
    total,
    avg: times.length ? total / times.length : 0,
    min: times.length ? Math.min(...times) : 0,
    max: times.length ? Math.max(...times) : 0,
  };
}

function formatNumber(n) { return n.toFixed(2); }

function buildChart(seb, mmdc) {
  const title = 'Average Render Time (ms)';
  const se = formatNumber(seb.avg);
  const mm = mmdc ? formatNumber(mmdc.avg) : '0';
  // Verified to render with this project's own renderer.
  if (!mmdc) return `xychart-beta\n  title "${title}"\n  x-axis [sebastianjs]\n  bar [${se}]`;
  return `xychart-beta\n  title "${title}"\n  x-axis [sebastianjs, mermaid-cli]\n  bar [${se}, ${mm}]`;
}

function buildTable(seb, mmdc) {
  const headers = ['Metric', 'sebastianjs', 'mermaid-cli'];
  const rows = [
    ['Samples', seb.count, mmdc ? mmdc.count : '—'],
    ['Successful', seb.ok, mmdc ? mmdc.ok : '—'],
    ['Avg ms', formatNumber(seb.avg), mmdc ? formatNumber(mmdc.avg) : '—'],
    ['Total ms', formatNumber(seb.total), mmdc ? formatNumber(mmdc.total) : '—'],
    ['Min ms', formatNumber(seb.min), mmdc ? formatNumber(mmdc.min) : '—'],
    ['Max ms', formatNumber(seb.max), mmdc ? formatNumber(mmdc.max) : '—'],
  ];
  const toRow = r => `| ${r.join(' | ')} |`;
  return [toRow(headers), toRow(headers.map(()=>'---')), ...rows.map(toRow)].join('\n');
}

async function updateReadme(seb, mmdc, meta = {}) {
  const md = await readFile(README, 'utf8');
  const startMarker = '<!-- BENCHMARK_START -->';
  const endMarker = '<!-- BENCHMARK_END -->';

  const speedup =
    mmdc && seb.avg > 0 ? `\n\nSebastianJS is **${(mmdc.avg / seb.avg).toFixed(0)}x faster** per diagram.` : '';

  const missing = mmdc
    ? ''
    : `\n**Note:** mermaid-cli not found at \`node_modules/.bin/mmdc\`; its results are omitted.\n`;

  const failed = [];
  if (seb.count - seb.ok > 0) failed.push(`sebastianjs failed on ${seb.count - seb.ok}`);
  if (mmdc && mmdc.count - mmdc.ok > 0) failed.push(`mermaid-cli failed on ${mmdc.count - mmdc.ok}`);
  const failures = failed.length ? `\n\nNot every sample renders in either tool: ${failed.join(', ')}. Only successful renders are timed.` : '';

  const section = [
    '## Benchmark',
    '',
    `_Last updated: ${new Date().toISOString()}_ · Node ${process.version}`,
    '',
    `Rendering ${seb.count} sample diagrams from \`${SAMPLES_DIR}\`, both renderers on the`,
    'same mermaid config (Open Sans, default HTML labels). Regenerate with `npm run benchmark`.',
    '',
    'The comparison is library-versus-CLI, which is what you would actually choose',
    'between: SebastianJS renders in-process, while mermaid-cli starts Node and a',
    'headless Chromium for each invocation. That process startup is most of the gap.',
    missing,
    failures,
    speedup,
    '',
    '### Summary',
    '',
    buildTable(seb, mmdc),
    '',
    '### Average render time',
    '',
    '```mermaid',
    buildChart(seb, mmdc),
    '```',
    '',
  ].join('\n');
  let next;
  if (md.includes(startMarker) && md.includes(endMarker)) {
  next = md.replace(new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`), `${startMarker}\n${section}\n${endMarker}`);
  } else {
    next = md.trimEnd() + `\n\n${startMarker}\n${section}\n${endMarker}\n`;
  }
  await writeFile(README, next, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // Build allow/deny lists
  let allowList = Array.isArray(args.allow) ? args.allow : null; // null = no filtering
  if (args.onlyStable) allowList = DEFAULT_ALLOWED;
  const denyList = Array.isArray(args.deny) ? args.deny : null;

  const samples = await listSamples(SAMPLES_DIR);
  if (!samples.length) throw new Error('No samples found. Run npm run fetch:samples first.');

  // Optional: just list diagram types distribution
  if (args.list) {
    const counts = new Map();
    for (const f of samples) {
      let def = '';
      try { def = await readFile(f, 'utf8'); } catch { continue; }
      const t = detectDiagramType(def) || 'unknown';
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    console.log('Diagram types:', Object.fromEntries([...counts.entries()].sort()));
    return;
  }

  // Warm up so the first sample does not absorb mermaid's module-load cost.
  await render('graph TD; warmup --> ok;').catch(() => {});

  const sebResults = [];
  const mmdcAvailable = hasMmdc();
  const cfgPath = join(
    process.env.TMPDIR || '/tmp',
    `seb-bench-cfg-${process.pid}.json`
  );
  await writeFile(cfgPath, JSON.stringify(MERMAID_CONFIG), 'utf8');
  const mmdcResults = [];
  const failures = [];
  const timeouts = [];
  const perFile = [];

  for (const file of samples) {
    // Read definition once if filtering is requested
    let defForType = null;
    if (allowList) {
      try { defForType = await readFile(file, 'utf8'); }
      catch { continue; }
      const dtype = detectDiagramType(defForType) || '';
      if (!allowList.includes(dtype)) {
        // Skip non-allowed diagram types
        continue;
      }
      if (denyList && denyList.includes(dtype)) continue;
      if (args.verbose) console.log(`[bench] ${dtype}: ${file}`);
    }
    if (sebResults.length >= args.max) break;
    const seb = await benchmarkSebastian(file); sebResults.push(seb);
    if (!seb.ok) {
      failures.push({ tool: 'sebastianjs', file, error: seb.error?.message || String(seb.error) });
      if (seb.error?.message === 'timeout') timeouts.push({ tool: 'sebastianjs', file });
    }
    if (mmdcAvailable) {
      const mm = await benchmarkMmdc(file, cfgPath); mmdcResults.push(mm);
      if (!mm.ok) {
        failures.push({ tool: 'mmdc', file, error: mm.error?.message || String(mm.error) });
        if (mm.error?.message === 'timeout') timeouts.push({ tool: 'mmdc', file });
      }
    }
    perFile.push({ file, seb, mmdc: mmdcResults[mmdcResults.length - 1] });
  }

  try { await unlink(cfgPath); } catch {}

  const sebSummary = summarize('sebastianjs', sebResults);
  const mmdcSummary = mmdcAvailable ? summarize('mermaid-cli', mmdcResults) : null;
  await updateReadme(sebSummary, mmdcSummary);
  const baseMsg = allowList ? `Benchmark complete (filtered types: ${allowList.join(',')})` : 'Benchmark complete';
  console.log(baseMsg, sebSummary, mmdcSummary || '(mermaid-cli missing)');
  if (failures.length) console.warn('Failures:', failures.slice(0, 10));
  if (timeouts.length) console.warn('Timeouts:', timeouts.slice(0, 10));
}


main()
  .then(async () => {
    // render() keeps one jsdom window for the process; close it so node exits on
    // its own rather than being forced out with process.exit.
    await dispose();
  })
  .catch(async (e) => {
    console.error('Benchmark failed:', e);
    await dispose().catch(() => {});
    process.exit(1);
  });
