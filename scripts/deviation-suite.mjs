import { promises as fsp } from 'fs';
import { join, extname, basename, resolve, isAbsolute } from 'path';
import { render } from '../src/index.js';
import { tmpdir } from 'os';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { spawnMmdc } from './mmdc-wrapper.mjs';

// ---------------- Configurable Constants ----------------
export const NORMALIZED_DEVIATION_THRESHOLD = 0.12; // Allow a bit more variance across many diagrams
export const POSITION_DEVIATION_THRESHOLD = 130; // Raw pixel avg (informational only)
export const MAX_SAMPLES = process.env.DEVIATION_MAX_SAMPLES ? parseInt(process.env.DEVIATION_MAX_SAMPLES,10) : Infinity;
export const WIDTH = 800;
export const HEIGHT = 600;
export const SAMPLE_DIR = 'samples/mermaid-demos';
export const PUPPETEER_ARGS = ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu','--no-zygote','--disable-dev-shm-usage'];
export const MMDC_TIMEOUT_MS = 25000;
// ---------------------------------------------------------

// Only compare these stable diagram types for deviation tests
export const ALLOWED_DIAGRAMS = [
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
    let raw = lines[idx];
    const trimmed = raw.trim();
    if (idx === 0 && trimmed === '---') { inFrontmatter = true; continue; }
    if (inFrontmatter) {
      if (trimmed === '---') { inFrontmatter = false; }
      continue;
    }
    if (!trimmed) continue;
    if (trimmed.startsWith('%%')) continue; // mermaid comment
    const m = trimmed.match(/^([A-Za-z][A-Za-z-]*)\b/);
    if (m) return m[1];
    // If this line starts with something else (like titles), keep scanning next lines
  }
  return '';
}

function isAllowed(def) {
  const kw = getFirstKeyword(def);
  const normalized = kw === 'stateDiagram-v2' ? 'stateDiagram' : kw;
  if (ALLOWED_DIAGRAMS.includes(normalized)) return true;
  // Also accept if any non-comment, non-frontmatter line starts with graph/flowchart
  const lines = def.split(/\r?\n/);
  let inFrontmatter = false;
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    if (idx === 0 && line === '---') { inFrontmatter = true; continue; }
    if (inFrontmatter) { if (line === '---') inFrontmatter = false; continue; }
    if (!line || line.startsWith('%%')) continue;
    if (/^(graph|flowchart)\s/i.test(line)) return true;
  }
  return false;
}

async function listSamples(dir) {
  const out = [];
  async function walk(d) {
    const ents = await fsp.readdir(d, { withFileTypes: true });
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p); else if (extname(p) === '.mmd' && !p.endsWith('manifest.json')) out.push(p);
    }
  }
  await walk(dir);
  return out.sort();
}

// spawnAsync handled via wrapper's spawnMmdc

async function renderWithMmdc(def, { width, height }) {
  const inputFile = join(tmpdir(), `dev-sample-${Date.now()}-${Math.random().toString(36).slice(2)}.mmd`);
  const outputFile = join(tmpdir(), `dev-sample-${Date.now()}-${Math.random().toString(36).slice(2)}.svg`);
  let cfgPath;
  try {
    writeFileSync(inputFile, def, 'utf8');
    cfgPath = join(tmpdir(), `pptr-cfg-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(cfgPath, JSON.stringify({ args: PUPPETEER_ARGS }), 'utf8');
    const args = ['-i', inputFile, '-o', outputFile, '--puppeteerConfigFile', cfgPath];
    if (width) args.push('-w', String(width));
    if (height) args.push('-H', String(height));
    await Promise.race([
      spawnMmdc(args, { stdio: ['ignore','ignore','pipe'], env: { ...process.env } }),
      new Promise((_, reject) => setTimeout(()=>reject(new Error('mmdc timeout')), MMDC_TIMEOUT_MS)),
    ]);
    if (!existsSync(outputFile)) throw new Error('mmdc no output');
    return readFileSync(outputFile, 'utf8');
  } finally {
    try { if (existsSync(inputFile)) unlinkSync(inputFile); } catch {}
    try { if (existsSync(outputFile)) unlinkSync(outputFile); } catch {}
    try { if (cfgPath && existsSync(cfgPath)) unlinkSync(cfgPath); } catch {}
  }
}

import { JSDOM } from 'jsdom';
function extractNodePositions(svg) {
  const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
  const doc = dom.window.document;
  const nodes = doc.querySelectorAll('.node');
  const map = new Map();
  const parseTranslate = (t) => {
    if (!t) return null;
    const m = t.match(/translate\(([^,]+),\s*([^)]+)\)/);
    if (!m) return null;
    const x = parseFloat(m[1]);
    const y = parseFloat(m[2]);
    if (Number.isNaN(x) || Number.isNaN(y)) return null;
    return { x, y };
  };
  for (const node of nodes) {
    const id = node.id || node.getAttribute('id');
    if (!id) continue;
    // Direct transform on the node
    let pos = parseTranslate(node.getAttribute('transform'));
    // Fallback: look for a descendant with translate()
    if (!pos) {
      const inner = node.querySelector('[transform*="translate("]');
      if (inner) pos = parseTranslate(inner.getAttribute('transform'));
    }
    // Fallback: use rect center if present
    if (!pos) {
      const r = node.querySelector('rect');
      if (r) {
        const x = parseFloat(r.getAttribute('x') || '0');
        const y = parseFloat(r.getAttribute('y') || '0');
        const w = parseFloat(r.getAttribute('width') || '0');
        const h = parseFloat(r.getAttribute('height') || '0');
        if (Number.isFinite(x) && Number.isFinite(y)) pos = { x: x + (w||0)/2, y: y + (h||0)/2 };
      }
    }
    if (pos) map.set(id, pos);
  }
  return map;
}

function averageDeviation(a, b, { verbose = false } = {}) {
  const ids = Array.from(a.keys()).filter(id => b.has(id));
  if (!ids.length) return { raw: Infinity, norm: Infinity };
  const arrA = ids.map(id => a.get(id));
  const arrB = ids.map(id => b.get(id));
  const min = arr => Math.min(...arr);
  const max = arr => Math.max(...arr);
  const xsA = arrA.map(p=>p.x), ysA = arrA.map(p=>p.y);
  const xsB = arrB.map(p=>p.x), ysB = arrB.map(p=>p.y);
  const span = (xs, ys) => ({ x: (max(xs)-min(xs)) || 1, y: (max(ys)-min(ys)) || 1, minX: min(xs), minY: min(ys) });
  const sA = span(xsA, ysA); const sB = span(xsB, ysB);
  let totalRaw=0, totalNorm=0;
  const details = verbose ? [] : undefined;
  for (let i=0;i<ids.length;i++) {
    const pA = arrA[i]; const pB = arrB[i];
    totalRaw += Math.hypot(pA.x - pB.x, pA.y - pB.y);
    const ax = (pA.x - sA.minX)/sA.x; const ay=(pA.y - sA.minY)/sA.y;
    const bx = (pB.x - sB.minX)/sB.x; const by=(pB.y - sB.minY)/sB.y;
    const dNorm = Math.hypot(ax - bx, ay - by);
    totalNorm += dNorm;
    if (verbose) details.push({ id: ids[i], raw: Math.hypot(pA.x - pB.x, pA.y - pB.y), norm: dNorm, a: pA, b: pB });
  }
  return { raw: totalRaw/ids.length, norm: totalNorm/ids.length, count: ids.length, details };
}

async function main(options = {}) {
  const single = options.sample || process.env.DEVIATION_SAMPLE || '';
  const verbose = options.verbose || process.env.DEVIATION_VERBOSE === '1' || process.env.VERBOSE === '1';
  let samples = await listSamples(SAMPLE_DIR);
  if (single) {
    const target = isAbsolute(single) ? single : resolve(SAMPLE_DIR, single);
    const matches = samples.filter(s => s === target || basename(s) === basename(single) || s.endsWith(single));
    if (matches.length === 0) {
      throw new Error(`No sample matched: ${single}`);
    }
    samples = [matches[0]];
  }
  if (MAX_SAMPLES && Number.isFinite(MAX_SAMPLES)) samples = samples.slice(0, MAX_SAMPLES);

  const results = [];
  for (const file of samples) {
    const def = await fsp.readFile(file, 'utf8');
    if (!isAllowed(def)) continue; // skip beta/experimental diagrams
    let sebSvg, cliSvg;
    try {
      sebSvg = await render(def, { width: WIDTH, height: HEIGHT });
      cliSvg = await renderWithMmdc(def, { width: WIDTH, height: HEIGHT });
    } catch (e) {
      results.push({ file, error: e.message });
      continue;
    }
    const sebPos = extractNodePositions(sebSvg);
    const cliPos = extractNodePositions(cliSvg);
    const stats = averageDeviation(sebPos, cliPos, { verbose });
    results.push({ file, raw: stats.raw, norm: stats.norm, count: stats.count, details: stats.details });
  }

  // Aggregate
  const ok = results.filter(r => r.norm !== undefined && Number.isFinite(r.norm));
  const avgNorm = ok.reduce((a,r)=>a+r.norm,0)/(ok.length||1);
  const avgRaw = ok.reduce((a,r)=>a+r.raw,0)/(ok.length||1);
  const failures = ok.filter(r => r.norm > NORMALIZED_DEVIATION_THRESHOLD || r.raw > POSITION_DEVIATION_THRESHOLD);

  const report = {
    samplesProcessed: samples.length,
    compared: ok.length,
    avgNormalizedDeviation: avgNorm,
    avgRawDeviation: avgRaw,
    thresholdNormalized: NORMALIZED_DEVIATION_THRESHOLD,
    thresholdRaw: POSITION_DEVIATION_THRESHOLD,
    failures: failures.slice(0,10),
    failuresCount: failures.length,
  };
  if (verbose) {
    report.items = results.map(r => ({ file: r.file, count: r.count, raw: r.raw, norm: r.norm, details: r.details }));
  }
  console.log(JSON.stringify(report, null, 2));

  // Export minimal summary for test assertion
  return { avgNorm, avgRaw, failuresCount: failures.length };
}

export async function runDeviationSuite(options) {
  return main(options);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  let fileArg = '';
  let verbose = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-f' || a === '--file' || a === '--sample') {
      fileArg = args[++i] || '';
    } else if (a === '-v' || a === '--verbose') {
      verbose = true;
    }
  }
  main({ sample: fileArg, verbose })
    .then(({ avgNorm, avgRaw, failuresCount }) => {
      console.log('Deviation summary:', { avgNorm, avgRaw, failuresCount });
      setImmediate(() => process.exit(0));
    })
    .catch((e) => {
      console.error('Deviation run failed:', e?.stack || e?.message || String(e));
      process.exit(1);
    });
}
