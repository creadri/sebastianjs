#!/usr/bin/env node
// Benchmark SebastianJS render performance against mermaid-cli (mmdc) over sample .mmd files
// Updates README.md between BENCHMARK_START / BENCHMARK_END markers with a Mermaid graph.
//
// SebastianJS is timed in each of the forms it can emit, because they do not
// cost the same: tracing text walks every glyph, and PNG rasterizes on top of a
// render. Quoting only the fastest of the three would misprice the other two.

import { readdir, readFile, writeFile, stat, unlink, access } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { render, renderPng, dispose } from '../src/index.js';
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

const RENDER_OPTIONS = { width: 800, height: 600, mermaidConfig: MERMAID_CONFIG };

/**
 * What gets timed, in the order it is reported. `run` receives both the file
 * and its definition, because mermaid-cli reads from disk and the rest do not.
 */
const RUNNERS = [
  {
    key: 'svg',
    axis: 'SVG',
    name: 'sebastianjs SVG',
    note: 'the default output, HTML labels and all',
    run: (file, def) => render(def, RENDER_OPTIONS),
  },
  {
    key: 'traced',
    axis: 'traced',
    name: 'sebastianjs traced',
    note: '`portable` plus `textAsPaths`: no foreignObject, no stylesheet, no font',
    run: (file, def) => render(def, { ...RENDER_OPTIONS, portable: true, textAsPaths: true }),
  },
  {
    key: 'png',
    axis: 'PNG',
    name: 'sebastianjs PNG',
    note: 'a render plus rasterization by resvg',
    run: (file, def) => renderPng(def, RENDER_OPTIONS),
  },
  {
    key: 'mmdc',
    axis: 'mermaid-cli',
    name: 'mermaid-cli',
    note: 'a fresh Node and headless Chromium per invocation',
    needsMmdc: true,
    run: (file, def, { cfgPath }) => runMmdc(file, cfgPath),
  },
];

async function runMmdc(file, cfgPath) {
  const tmpOut = join(
    process.env.TMPDIR || '/tmp',
    `seb-bench-${process.pid}-${Math.random().toString(36).slice(2)}.svg`
  );
  try {
    await spawnMmdc(['-i', file, '-o', tmpOut, '-c', cfgPath], { stdio: 'ignore' });
  } finally {
    try { await unlink(tmpOut); } catch {}
  }
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

function buildChart(series) {
  const title = 'Average Render Time (ms)';
  // Quoted, because an axis label with a hyphen in it is not a bare word.
  const axis = series.map((s) => `"${s.axis}"`).join(', ');
  const bars = series.map((s) => formatNumber(s.avg)).join(', ');
  // Verified to render with this project's own renderer.
  return `xychart-beta\n  title "${title}"\n  x-axis [${axis}]\n  bar [${bars}]`;
}

function buildTable(series) {
  const headers = ['Metric', ...series.map((s) => s.name)];
  const rows = [
    ['Samples', ...series.map((s) => s.count)],
    ['Successful', ...series.map((s) => s.ok)],
    ['Avg ms', ...series.map((s) => formatNumber(s.avg))],
    ['Total ms', ...series.map((s) => formatNumber(s.total))],
    ['Min ms', ...series.map((s) => formatNumber(s.min))],
    ['Max ms', ...series.map((s) => formatNumber(s.max))],
  ];
  const toRow = (r) => `| ${r.join(' | ')} |`;
  return [toRow(headers), toRow(headers.map(() => '---')), ...rows.map(toRow)].join('\n');
}

async function updateReadme(series) {
  const md = await readFile(README, 'utf8');
  const startMarker = '<!-- BENCHMARK_START -->';
  const endMarker = '<!-- BENCHMARK_END -->';

  const base = series.find((s) => s.key === 'svg');
  const mmdc = series.find((s) => s.key === 'mmdc');
  const speedup =
    mmdc && base?.avg > 0
      ? `SebastianJS is **${(mmdc.avg / base.avg).toFixed(0)}x faster** per diagram, ` +
        `and **${(mmdc.avg / series.find((s) => s.key === 'png').avg).toFixed(0)}x** even ` +
        'counting the rasterizer.'
      : '';

  const missing = mmdc
    ? ''
    : '**Note:** mermaid-cli not found at `node_modules/.bin/mmdc`; its results are omitted.';

  // Every SebastianJS form fails on the same unparseable samples, so they are
  // reported once rather than three times over.
  const failed = [];
  const ourFailures = series.filter((s) => s.key !== 'mmdc').map((s) => s.count - s.ok);
  if (ourFailures.some((n) => n > 0)) {
    const same = ourFailures.every((n) => n === ourFailures[0]);
    failed.push(
      same
        ? `SebastianJS failed on ${ourFailures[0]} in every form`
        : series.filter((s) => s.key !== 'mmdc').map((s) => `${s.name} failed on ${s.count - s.ok}`).join(', ')
    );
  }
  if (mmdc && mmdc.count - mmdc.ok > 0) failed.push(`mermaid-cli failed on ${mmdc.count - mmdc.ok}`);
  const failures = failed.length
    ? `Not every sample parses: ${failed.join(', ')}. Only successful renders are timed.`
    : '';

  const legend = series.map((s) => `- **${s.name}** — ${s.note}`).join('\n');

  const section = [
    '## Benchmark',
    '',
    `_Last updated: ${new Date().toISOString()}_ · Node ${process.version}`,
    '',
    `Rendering ${base?.count ?? 0} sample diagrams from \`${SAMPLES_DIR}\`, every renderer on`,
    'the same mermaid config (Open Sans, default HTML labels). Regenerate with',
    '`npm run benchmark`.',
    '',
    legend,
    '',
    'The comparison is library-versus-CLI, which is what you would actually choose',
    'between: SebastianJS renders in-process, while mermaid-cli starts Node and a',
    'headless Chromium for each invocation. That process startup is most of the gap.',
    // Each of these is a paragraph or nothing at all; blank ones must not leave
    // a run of empty lines behind them.
    ...[missing, failures, speedup].filter(Boolean).flatMap((text) => ['', text]),
    '',
    '### Summary',
    '',
    buildTable(series),
    '',
    '### Average render time',
    '',
    '```mermaid',
    buildChart(series),
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

  const mmdcAvailable = hasMmdc();
  const runners = RUNNERS.filter((r) => !r.needsMmdc || mmdcAvailable);

  const cfgPath = join(
    process.env.TMPDIR || '/tmp',
    `seb-bench-cfg-${process.pid}.json`
  );
  await writeFile(cfgPath, JSON.stringify(MERMAID_CONFIG), 'utf8');

  const results = new Map(runners.map((r) => [r.key, []]));
  const failures = [];
  const timeouts = [];

  // A full run is minutes long and renders every sample four ways. Without a
  // sign of life there is no way to tell a slow diagram from a wedged one --
  // or, when this run first crashed, where it got to.
  const started = hrtimeMs();
  const progress = (done) => {
    const elapsed = ((hrtimeMs() - started) / 1000).toFixed(0);
    process.stderr.write(`[bench] ${done} samples, ${elapsed}s, rss ${Math.round(process.memoryUsage().rss / 1048576)}MB\n`);
  };

  let fileIndex = -1;
  for (const file of samples) {
    let def;
    try { def = await readFile(file, 'utf8'); }
    catch { continue; }
    fileIndex++;

    if (allowList) {
      const dtype = detectDiagramType(def) || '';
      if (!allowList.includes(dtype)) continue;
      if (denyList && denyList.includes(dtype)) continue;
      if (args.verbose) console.log(`[bench] ${dtype}: ${file}`);
    }
    if (results.get(runners[0].key).length >= args.max) break;

    // Every form renders the same sample back to back, so a slow machine or a
    // noisy neighbour moves all of them together rather than one of them.
    //
    // The order rotates per file because whichever runs first pays for warming
    // that diagram type up. Fixed order had `traced` timing FASTER than the
    // plain SVG it is a superset of -- 49ms against 84ms -- purely because it
    // never went first. Rotating puts each form at the front an equal share of
    // the time, so the cost is spread instead of charged to one of them.
    const order = runners.map((_, i) => runners[(i + fileIndex) % runners.length]);
    for (const runner of order) {
      const result = await timeAsync(() => runner.run(file, def, { cfgPath }));
      results.get(runner.key).push(result);
      if (!result.ok) {
        const error = result.error?.message || String(result.error);
        failures.push({ tool: runner.key, file, error });
        if (result.error?.message === 'timeout') timeouts.push({ tool: runner.key, file });
      }
    }

    const done = results.get(runners[0].key).length;
    if (done % 25 === 0) progress(done);
  }
  progress(results.get(runners[0].key).length);

  try { await unlink(cfgPath); } catch {}

  const series = runners.map((r) => ({ ...r, ...summarize(r.name, results.get(r.key)) }));
  await updateReadme(series);

  const baseMsg = allowList ? `Benchmark complete (filtered types: ${allowList.join(',')})` : 'Benchmark complete';
  console.log(baseMsg);
  for (const s of series) {
    console.log(`  ${s.name.padEnd(20)} avg ${formatNumber(s.avg).padStart(9)}ms  ok ${s.ok}/${s.count}`);
  }
  if (!mmdcAvailable) console.warn('  (mermaid-cli missing)');
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
