#!/usr/bin/env node
// Benchmark SebastianJS render performance against mermaid-cli (mmdc) over sample .mmd files
// Updates README.md between BENCHMARK_START / BENCHMARK_END markers with a Mermaid graph.

import { readdir, readFile, writeFile, stat, unlink, access } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { render } from '../src/index.js';
import { ensurePuppeteerConfigArg } from './mmdc-wrapper.mjs';

const SAMPLES_DIR = 'samples/mermaid-demos';
const README = 'README.md';
const MMDC_CMD = 'mmdc'; // Expected mermaid-cli command in PATH
const PER_SAMPLE_TIMEOUT_MS = parseInt(process.env.BENCHMARK_TIMEOUT_MS || '30000', 10);

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
  const out = { allow: null, deny: null, onlyStable: false, verbose: false, list: false };
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

async function hasMmdc() {
  try {
    const p = spawn(MMDC_CMD, ['--version']);
    return await new Promise(res => { p.on('exit', c => res(c === 0)); p.on('error', () => res(false)); setTimeout(()=>{try{p.kill();}catch{} res(false);}, 2000); });
  } catch { return false; }
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
  return timeAsync(() => render(def, { width: 800, height: 600 }));
}

async function benchmarkMmdc(file) {
  // Render to memory by piping stdout (using -o - if supported) – fallback to temp file not implemented here.
  // mmdc infers output type from the extension; use a temp .svg file and delete it afterwards.
  return timeAsync(() => new Promise(async (resolve, reject) => {
    const tmpOut = join(process.env.TMPDIR || '/tmp', `seb-bench-${process.pid}-${Math.random().toString(36).slice(2)}.svg`);
  const pptrCfgPath = await writeTempPptrConfig();
  let args = ['-i', file, '-o', tmpOut, '--puppeteerConfigFile', pptrCfgPath];
  args = await ensurePuppeteerConfigArg(args);
    const env = { ...process.env };
    const p = spawn(MMDC_CMD, args, { stdio: 'ignore', env });
    let done = false;
    const killer = setTimeout(() => {
      if (done) return;
      try { p.kill('SIGKILL'); } catch {}
    }, PER_SAMPLE_TIMEOUT_MS);
    p.on('error', async (err) => {
      done = true; clearTimeout(killer);
      try { await unlink(tmpOut); } catch {}
      try { await unlink(pptrCfgPath); } catch {}
      reject(err);
    });
    p.on('exit', async (code) => {
      done = true; clearTimeout(killer);
      try { await unlink(tmpOut); } catch {}
      try { await unlink(pptrCfgPath); } catch {}
      if (code === 0) resolve(); else reject(new Error(`mmdc exited ${code}`));
    });
  }));
}

function summarize(name, results) {
  const ok = results.filter(r => r.ok);
  const total = results.reduce((a, r) => a + r.ms, 0);
  const avg = ok.length ? total / results.length : 0;
  const min = ok.length ? Math.min(...results.map(r => r.ms)) : 0;
  const max = ok.length ? Math.max(...results.map(r => r.ms)) : 0;
  return { name, count: results.length, ok: ok.length, total, avg, min, max };
}

function formatNumber(n) { return n.toFixed(2); }

function buildMermaidPie(seb, mmdc) {
  const title = 'Average Render Time (ms)';
  const se = formatNumber(seb.avg);
  const mm = mmdc ? formatNumber(mmdc.avg) : '0';
  // Keep it simple; ranges often cause render issues in various Mermaid versions
  return `xychart\n  title "${title}"\n  x-axis [sebastianjs, mermaid-cli]\n  bar [${se}, ${mm}]`;
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

async function updateReadme(seb, mmdc) {
  const md = await readFile(README, 'utf8');
  const startMarker = '<!-- BENCHMARK_START -->';
  const endMarker = '<!-- BENCHMARK_END -->';
  const section = `## Benchmark\n\n_Last updated: ${new Date().toISOString()}_\n\nRendering all sample diagrams (count: ${seb.count}).\n\n${mmdc ? '' : '**Note:** mermaid-cli (mmdc) not found in PATH; its results are omitted.'}\n\n### Summary Table\n\n${buildTable(seb, mmdc)}\n\n### Mermaid Graph\n\n\n\n\`\`\`mermaid\n${buildMermaidPie(seb, mmdc)}\n\`\`\`\n`;
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

  const sebResults = [];
  const mmdcAvailable = await hasMmdc();
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
    const seb = await benchmarkSebastian(file); sebResults.push(seb);
    if (!seb.ok) {
      failures.push({ tool: 'sebastianjs', file, error: seb.error?.message || String(seb.error) });
      if (seb.error?.message === 'timeout') timeouts.push({ tool: 'sebastianjs', file });
    }
    if (mmdcAvailable) {
      const mm = await benchmarkMmdc(file); mmdcResults.push(mm);
      if (!mm.ok) {
        failures.push({ tool: 'mmdc', file, error: mm.error?.message || String(mm.error) });
        if (mm.error?.message === 'timeout') timeouts.push({ tool: 'mmdc', file });
      }
    }
    perFile.push({ file, seb, mmdc: mmdcResults[mmdcResults.length - 1] });
  }

  const sebSummary = summarize('sebastianjs', sebResults);
  const mmdcSummary = mmdcAvailable ? summarize('mermaid-cli', mmdcResults) : null;
  await updateReadme(sebSummary, mmdcSummary);
  const baseMsg = allowList ? `Benchmark complete (filtered types: ${allowList.join(',')})` : 'Benchmark complete';
  console.log(baseMsg, sebSummary, mmdcSummary || '(mermaid-cli missing)');
  if (failures.length) console.warn('Failures:', failures.slice(0, 10));
  if (timeouts.length) console.warn('Timeouts:', timeouts.slice(0, 10));
}


main()
  .then(() => {
    // Some libraries may leave timers/handles open; force a clean exit once IO is flushed.
    setImmediate(() => process.exit(0));
  })
  .catch(e => { console.error('Benchmark failed:', e); process.exit(1); });
