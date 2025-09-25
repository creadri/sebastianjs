import { promises as fsp } from 'fs';
import { join, extname, basename, resolve, isAbsolute, relative } from 'path';
import { render } from '../src/index.js';
import { tmpdir } from 'os';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { spawnMmdc } from './mmdc-wrapper.mjs';

// ---------------- Configurable Constants ----------------
export const NORMALIZED_DEVIATION_THRESHOLD = 0.12; // Allow a bit more variance across many diagrams
export const POSITION_DEVIATION_THRESHOLD = 10; // Raw pixel avg (informational only)
export const MAX_SAMPLES = process.env.DEVIATION_MAX_SAMPLES ? parseInt(process.env.DEVIATION_MAX_SAMPLES,10) : Infinity;
export const WIDTH = 800;
export const HEIGHT = 600;
export const SAMPLE_DIR = 'samples/mermaid-demos';
export const PUPPETEER_ARGS = ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu','--no-zygote','--disable-dev-shm-usage'];
export const MMDC_TIMEOUT_MS = 25000;
// ---------------------------------------------------------

// Threshold for simplified report mode (pixels/units)
export const SIMPLE_THRESHOLD_DEFAULT = parseFloat(process.env.DEVIATION_SIMPLE_THRESHOLD || '1.0');

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
  let cfgPath; let mermaidCfgPath;
  try {
    writeFileSync(inputFile, def, 'utf8');
    cfgPath = join(tmpdir(), `pptr-cfg-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(cfgPath, JSON.stringify({ args: PUPPETEER_ARGS }), 'utf8');
    // Create a mermaid config to mirror our renderer defaults
    mermaidCfgPath = join(tmpdir(), `mermaid-cfg-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
    const mermaidCfg = {
      startOnLoad: false,
      securityLevel: 'loose',
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      themeVariables: { fontFamily: 'DejaVu Sans, Arial, sans-serif' },
    };
    writeFileSync(mermaidCfgPath, JSON.stringify(mermaidCfg), 'utf8');
    const args = ['-i', inputFile, '-o', outputFile, '--puppeteerConfigFile', cfgPath, '-c', mermaidCfgPath];
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
    try { if (mermaidCfgPath && existsSync(mermaidCfgPath)) unlinkSync(mermaidCfgPath); } catch {}
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

// Extract structural info needed for simplified mismatches (nodes and edges)
function numberListFromPathD(d) {
  if (!d) return [];
  const nums = (d.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/gi) || []).map(Number).filter(n => Number.isFinite(n));
  return nums;
}

function getTranslate(el) {
  const t = el?.getAttribute?.('transform');
  if (!t) return null;
  const m = t.match(/translate\(([^,]+),\s*([^)]+)\)/);
  if (!m) return null;
  const x = parseFloat(m[1]);
  const y = parseFloat(m[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function extractStructure(svg) {
  const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
  const doc = dom.window.document;
  const nodes = new Map();
  const edges = new Map();
  // Nodes: use g.node; fallback IDs by order
  const nodeList = Array.from(doc.querySelectorAll('g.node'));
  nodeList.forEach((g, i) => {
    const id = g.id || g.getAttribute('id') || `node-index-${i}`;
    const tr = getTranslate(g) || getTranslate(g.querySelector('[transform*="translate("]'));
    const rect = g.querySelector('rect');
    const rx = rect ? parseFloat(rect.getAttribute('x') || '0') : NaN;
    const ry = rect ? parseFloat(rect.getAttribute('y') || '0') : NaN;
    const rw = rect ? parseFloat(rect.getAttribute('width') || '0') : NaN;
    const rh = rect ? parseFloat(rect.getAttribute('height') || '0') : NaN;
    nodes.set(id, { translate: tr, rect: { x: rx, y: ry, w: rw, h: rh } });
  });
  // Edges: use g.edgePath -> path d numbers; fallback IDs by order
  const edgeList = Array.from(doc.querySelectorAll('g.edgePath'));
  edgeList.forEach((g, i) => {
    const id = g.id || g.getAttribute('id') || `edge-index-${i}`;
    const path = g.querySelector('path');
    const d = path ? path.getAttribute('d') : '';
    const nums = numberListFromPathD(d);
    edges.set(id, { nums });
  });
  return { nodes, edges };
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
  // Compute simple translation to align B to A (centroid delta)
  const centroid = (pts) => pts.reduce((acc,p)=>({x:acc.x+p.x,y:acc.y+p.y}),{x:0,y:0});
  const ca = centroid(arrA); ca.x/=arrA.length; ca.y/=arrA.length;
  const cb = centroid(arrB); cb.x/=arrB.length; cb.y/=arrB.length;
  const tdx = ca.x - cb.x; const tdy = ca.y - cb.y;
  let totalRawTransCorr = 0;
  for (let i=0;i<ids.length;i++) {
    const pA = arrA[i]; const pB = arrB[i];
    const dx = pA.x - pB.x; const dy = pA.y - pB.y;
    totalRaw += Math.hypot(dx, dy);
    // translation-corrected distance
    const dxt = (pA.x) - (pB.x + tdx); const dyt = (pA.y) - (pB.y + tdy);
    totalRawTransCorr += Math.hypot(dxt, dyt);
    const ax = (pA.x - sA.minX)/sA.x; const ay=(pA.y - sA.minY)/sA.y;
    const bx = (pB.x - sB.minX)/sB.x; const by=(pB.y - sB.minY)/sB.y;
    const dNorm = Math.hypot(ax - bx, ay - by);
    totalNorm += dNorm;
    if (verbose) details.push({ id: ids[i], raw: Math.hypot(dx, dy), rawTransCorr: Math.hypot(dxt, dyt), norm: dNorm, a: pA, b: pB });
  }
  return { raw: totalRaw/ids.length, rawTransCorr: totalRawTransCorr/ids.length, norm: totalNorm/ids.length, count: ids.length, details };
}

// ---- SVG root metrics and deviation helpers ----
function extractRootMetrics(svg) {
  const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
  const root = dom.window.document.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') return {};
  const parseNum = (v) => {
    if (v == null) return NaN;
    const s = String(v).trim();
    if (/%$/.test(s)) return NaN; // avoid treating percentages as absolutes
    const n = parseFloat(s.replace(/px$/i, ''));
    return Number.isFinite(n) ? n : NaN;
  };
  const width = parseNum(root.getAttribute('width'));
  const height = parseNum(root.getAttribute('height'));
  let vb = root.getAttribute('viewBox');
  let vx = NaN, vy = NaN, vw = NaN, vh = NaN;
  if (vb) {
    const p = vb.trim().split(/\s+/).map(Number);
    if (p.length === 4 && p.every(Number.isFinite)) {
      [vx, vy, vw, vh] = p;
    }
  }
  return { width, height, viewBox: { x: vx, y: vy, w: vw, h: vh } };
}

function sizeViewportDeviation(a, b) {
  const out = {};
  const safe = (v) => Number.isFinite(v) ? v : NaN;
  const aw = safe(a?.width), ah = safe(a?.height);
  const bw = safe(b?.width), bh = safe(b?.height);
  out.widthAbs = (Number.isFinite(aw) && Number.isFinite(bw)) ? Math.abs(aw - bw) : NaN;
  out.heightAbs = (Number.isFinite(ah) && Number.isFinite(bh)) ? Math.abs(ah - bh) : NaN;
  out.widthRel = (Number.isFinite(out.widthAbs) && Number.isFinite(bw) && bw > 0) ? out.widthAbs / bw : NaN;
  out.heightRel = (Number.isFinite(out.heightAbs) && Number.isFinite(bh) && bh > 0) ? out.heightAbs / bh : NaN;

  const av = a?.viewBox || {}; const bv = b?.viewBox || {};
  const ax = safe(av.x), ay = safe(av.y), awv = safe(av.w), ahv = safe(av.h);
  const bx = safe(bv.x), by = safe(bv.y), bwv = safe(bv.w), bhv = safe(bv.h);
  out.vbXAbs = (Number.isFinite(ax) && Number.isFinite(bx)) ? Math.abs(ax - bx) : NaN;
  out.vbYAbs = (Number.isFinite(ay) && Number.isFinite(by)) ? Math.abs(ay - by) : NaN;
  out.vbWAbs = (Number.isFinite(awv) && Number.isFinite(bwv)) ? Math.abs(awv - bwv) : NaN;
  out.vbHAbs = (Number.isFinite(ahv) && Number.isFinite(bhv)) ? Math.abs(ahv - bhv) : NaN;
  out.vbWRel = (Number.isFinite(out.vbWAbs) && Number.isFinite(bwv) && bwv > 0) ? out.vbWAbs / bwv : NaN;
  out.vbHRel = (Number.isFinite(out.vbHAbs) && Number.isFinite(bhv) && bhv > 0) ? out.vbHAbs / bhv : NaN;
  return out;
}

function avg(values) {
  const nums = values.filter(v => Number.isFinite(v));
  if (!nums.length) return NaN;
  return nums.reduce((a, v) => a + v, 0) / nums.length;
}

async function main(options = {}) {
  const single = options.sample || process.env.DEVIATION_SAMPLE || '';
  const verbose = options.verbose || process.env.DEVIATION_VERBOSE === '1' || process.env.VERBOSE === '1';
  const simple = !!options.simple;
  const simpleThreshold = Number.isFinite(options.threshold) ? options.threshold : SIMPLE_THRESHOLD_DEFAULT;
  let samples = await listSamples(SAMPLE_DIR);
  if (single) {
    // 1) If the provided path exists (absolute or relative to CWD), use it directly
    const singleResolved = isAbsolute(single) ? single : resolve(process.cwd(), single);
    if (existsSync(singleResolved)) {
      samples = [singleResolved];
    } else {
      // 2) Try relative to the root samples/ folder
      const alt1 = resolve(process.cwd(), 'samples', single);
      const alt2 = resolve(process.cwd(), SAMPLE_DIR, single);
      if (existsSync(alt1)) samples = [alt1];
      else if (existsSync(alt2)) samples = [alt2];
      else {
        // 3) Search by basename across samples/ (broader than SAMPLE_DIR)
        const all = await listSamples('samples');
        const matches = all.filter(s => s.endsWith(single) || basename(s) === basename(single));
        if (matches.length === 0) {
          throw new Error(`No sample matched: ${single}`);
        }
        samples = [matches[0]];
      }
    }
  }
  if (MAX_SAMPLES && Number.isFinite(MAX_SAMPLES)) samples = samples.slice(0, MAX_SAMPLES);

  const results = [];
  const simpleItems = [];
  for (const file of samples) {
    const def = await fsp.readFile(file, 'utf8');
    if (!isAllowed(def)) continue; // skip beta/experimental diagrams
    let sebSvg, cliSvg;
    try {
      sebSvg = await render(def, { width: WIDTH, height: HEIGHT });
      cliSvg = await renderWithMmdc(def, { width: WIDTH, height: HEIGHT });
    } catch (e) {
      results.push({ file, error: e.message });
      if (simple) {
        simpleItems.push({
          file: relative(process.cwd(), file),
          missmatches: [
            {
              type: 'error',
              id: 'render',
              'mermaid-x': null,
              'mermaid-y': null,
              'sebastian-x': null,
              'sebastian-y': null,
              'mermaid-width': null,
              'mermaid-height': null,
              'sebastian-width': null,
              'sebastian-height': null,
              'variation-global': Infinity,
              message: e.message,
            },
          ],
        });
      }
      continue;
    }
    const sebPos = extractNodePositions(sebSvg);
    const cliPos = extractNodePositions(cliSvg);
    const stats = averageDeviation(sebPos, cliPos, { verbose });
    // Root metrics deviations
    const sebRoot = extractRootMetrics(sebSvg);
    const cliRoot = extractRootMetrics(cliSvg);
    const sdev = sizeViewportDeviation(sebRoot, cliRoot);
    if (simple) {
      const mismatches = [];
      const add = (m) => mismatches.push(m);
      const relFile = relative(process.cwd(), file);
      // Viewport mismatches
      const mW = cliRoot?.width; const mH = cliRoot?.height;
      const sW = sebRoot?.width; const sH = sebRoot?.height;
      const vpDiffs = [];
      if (Number.isFinite(mW) && Number.isFinite(sW)) vpDiffs.push(Math.abs(mW - sW));
      if (Number.isFinite(mH) && Number.isFinite(sH)) vpDiffs.push(Math.abs(mH - sH));
      const vpVar = vpDiffs.length ? Math.max(...vpDiffs) : NaN;
      if (Number.isFinite(vpVar) && vpVar > simpleThreshold) {
        add({ type: 'viewport', id: 'root', 'mermaid-x': null, 'mermaid-y': null, 'sebastian-x': null, 'sebastian-y': null, 'mermaid-width': mW ?? null, 'mermaid-height': mH ?? null, 'sebastian-width': sW ?? null, 'sebastian-height': sH ?? null, 'variation-global': vpVar });
      }
      // ViewBox mismatches
      const mv = cliRoot?.viewBox || {}; const sv = sebRoot?.viewBox || {};
      const vbDiffs = [];
      if (Number.isFinite(mv.x) && Number.isFinite(sv.x)) vbDiffs.push(Math.abs(mv.x - sv.x));
      if (Number.isFinite(mv.y) && Number.isFinite(sv.y)) vbDiffs.push(Math.abs(mv.y - sv.y));
      if (Number.isFinite(mv.w) && Number.isFinite(sv.w)) vbDiffs.push(Math.abs(mv.w - sv.w));
      if (Number.isFinite(mv.h) && Number.isFinite(sv.h)) vbDiffs.push(Math.abs(mv.h - sv.h));
      const vbVar = vbDiffs.length ? Math.max(...vbDiffs) : NaN;
      if (Number.isFinite(vbVar) && vbVar > simpleThreshold) {
        add({ type: 'viewbox', id: 'root', 'mermaid-x': mv.x ?? null, 'mermaid-y': mv.y ?? null, 'sebastian-x': sv.x ?? null, 'sebastian-y': sv.y ?? null, 'mermaid-width': mv.w ?? null, 'mermaid-height': mv.h ?? null, 'sebastian-width': sv.w ?? null, 'sebastian-height': sv.h ?? null, 'variation-global': vbVar });
      }
      // Nodes mismatches
      const A = extractStructure(sebSvg); // sebastian
      const B = extractStructure(cliSvg); // mermaid
      const nodeIds = new Set([...A.nodes.keys(), ...B.nodes.keys()]);
      for (const id of nodeIds) {
        const a = A.nodes.get(id);
        const b = B.nodes.get(id);
        if (!a && b) {
          add({ type: 'node', id, 'mermaid-x': b.translate?.x ?? null, 'mermaid-y': b.translate?.y ?? null, 'sebastian-x': null, 'sebastian-y': null, 'mermaid-width': b.rect?.w ?? null, 'mermaid-height': b.rect?.h ?? null, 'sebastian-width': null, 'sebastian-height': null, 'variation-global': Infinity });
          continue;
        }
        if (a && !b) {
          add({ type: 'node', id, 'mermaid-x': null, 'mermaid-y': null, 'sebastian-x': a.translate?.x ?? null, 'sebastian-y': a.translate?.y ?? null, 'mermaid-width': null, 'mermaid-height': null, 'sebastian-width': a.rect?.w ?? null, 'sebastian-height': a.rect?.h ?? null, 'variation-global': Infinity });
          continue;
        }
        if (!a || !b) continue;
        const sx = Number.isFinite(a.translate?.x) ? a.translate.x : (Number.isFinite(a.rect?.x) && Number.isFinite(a.rect?.w) ? a.rect.x + a.rect.w/2 : null);
        const sy = Number.isFinite(a.translate?.y) ? a.translate.y : (Number.isFinite(a.rect?.y) && Number.isFinite(a.rect?.h) ? a.rect.y + a.rect.h/2 : null);
        const mx = Number.isFinite(b.translate?.x) ? b.translate.x : (Number.isFinite(b.rect?.x) && Number.isFinite(b.rect?.w) ? b.rect.x + b.rect.w/2 : null);
        const my = Number.isFinite(b.translate?.y) ? b.translate.y : (Number.isFinite(b.rect?.y) && Number.isFinite(b.rect?.h) ? b.rect.y + b.rect.h/2 : null);
        const sw = Number.isFinite(a.rect?.w) ? a.rect.w : null;
        const sh = Number.isFinite(a.rect?.h) ? a.rect.h : null;
        const mw = Number.isFinite(b.rect?.w) ? b.rect.w : null;
        const mh = Number.isFinite(b.rect?.h) ? b.rect.h : null;
        const diffs = [];
        if (Number.isFinite(mx) && Number.isFinite(sx)) diffs.push(Math.abs(mx - sx));
        if (Number.isFinite(my) && Number.isFinite(sy)) diffs.push(Math.abs(my - sy));
        if (Number.isFinite(mw) && Number.isFinite(sw)) diffs.push(Math.abs(mw - sw));
        if (Number.isFinite(mh) && Number.isFinite(sh)) diffs.push(Math.abs(mh - sh));
        const variation = diffs.length ? Math.max(...diffs) : NaN;
        if (Number.isFinite(variation) && variation > simpleThreshold) {
          add({ type: 'node', id, 'mermaid-x': mx, 'mermaid-y': my, 'sebastian-x': sx, 'sebastian-y': sy, 'mermaid-width': mw, 'mermaid-height': mh, 'sebastian-width': sw, 'sebastian-height': sh, 'variation-global': variation });
        }
      }
      // Edges mismatches
      const edgeIds = new Set([...A.edges.keys(), ...B.edges.keys()]);
      for (const id of edgeIds) {
        const a = A.edges.get(id);
        const b = B.edges.get(id);
        if (!a && b) { add({ type: 'edge', id, 'mermaid-x': null, 'mermaid-y': null, 'sebastian-x': null, 'sebastian-y': null, 'mermaid-width': null, 'mermaid-height': null, 'sebastian-width': null, 'sebastian-height': null, 'variation-global': Infinity }); continue; }
        if (a && !b) { add({ type: 'edge', id, 'mermaid-x': null, 'mermaid-y': null, 'sebastian-x': null, 'sebastian-y': null, 'mermaid-width': null, 'mermaid-height': null, 'sebastian-width': null, 'sebastian-height': null, 'variation-global': Infinity }); continue; }
        if (!a || !b) continue;
        const len = Math.min(a.nums.length, b.nums.length);
        let sumAbs = 0;
        for (let i=0;i<len;i++) sumAbs += Math.abs((a.nums[i] ?? 0) - (b.nums[i] ?? 0));
        const avgAbs = len ? (sumAbs/len) : 0;
        const countDiff = Math.abs((a.nums.length||0) - (b.nums.length||0));
        const variation = Math.max(avgAbs, countDiff);
        if (variation > simpleThreshold) {
          add({ type: 'edge', id, 'mermaid-x': null, 'mermaid-y': null, 'sebastian-x': null, 'sebastian-y': null, 'mermaid-width': null, 'mermaid-height': null, 'sebastian-width': null, 'sebastian-height': null, 'variation-global': variation });
        }
      }
      simpleItems.push({ file: relFile, missmatches: mismatches });
    }
    results.push({ file, raw: stats.raw, rawTransCorr: stats.rawTransCorr, norm: stats.norm, count: stats.count, details: stats.details, sizeDev: sdev });
  }

  // Aggregate
  const ok = results.filter(r => r.norm !== undefined && Number.isFinite(r.norm));
  const avgNorm = ok.reduce((a,r)=>a+r.norm,0)/(ok.length||1);
  const avgRaw = ok.reduce((a,r)=>a+r.raw,0)/(ok.length||1);
  const avgRawTransCorr = ok.reduce((a,r)=>a+(r.rawTransCorr??NaN),0)/(ok.length||1);
  const failures = ok.filter(r => r.norm > NORMALIZED_DEVIATION_THRESHOLD || r.raw > POSITION_DEVIATION_THRESHOLD);

  // Aggregates for size/viewBox deviations
  const widthAbsAvg = avg(ok.map(r => r.sizeDev?.widthAbs));
  const heightAbsAvg = avg(ok.map(r => r.sizeDev?.heightAbs));
  const widthRelAvg = avg(ok.map(r => r.sizeDev?.widthRel));
  const heightRelAvg = avg(ok.map(r => r.sizeDev?.heightRel));
  const vbXAbsAvg = avg(ok.map(r => r.sizeDev?.vbXAbs));
  const vbYAbsAvg = avg(ok.map(r => r.sizeDev?.vbYAbs));
  const vbWAbsAvg = avg(ok.map(r => r.sizeDev?.vbWAbs));
  const vbHAbsAvg = avg(ok.map(r => r.sizeDev?.vbHAbs));
  const vbWRelAvg = avg(ok.map(r => r.sizeDev?.vbWRel));
  const vbHRelAvg = avg(ok.map(r => r.sizeDev?.vbHRel));

  if (simple) {
    const simpleReport = { 'missmath-threshold': simpleThreshold, items: simpleItems };
    console.log(JSON.stringify(simpleReport, null, 2));
    return { itemsCount: simpleItems.length };
  }
  const report = {
    samplesProcessed: samples.length,
    compared: ok.length,
    avgNormalizedDeviation: avgNorm,
    avgRawDeviation: avgRaw,
    avgRawTransCorrDeviation: avgRawTransCorr,
    thresholdNormalized: NORMALIZED_DEVIATION_THRESHOLD,
    thresholdRaw: POSITION_DEVIATION_THRESHOLD,
    avgWidthAbs: widthAbsAvg,
    avgHeightAbs: heightAbsAvg,
    avgWidthRel: widthRelAvg,
    avgHeightRel: heightRelAvg,
    avgViewBoxXAbs: vbXAbsAvg,
    avgViewBoxYAbs: vbYAbsAvg,
    avgViewBoxWAbs: vbWAbsAvg,
    avgViewBoxHAbs: vbHAbsAvg,
    avgViewBoxWRel: vbWRelAvg,
    avgViewBoxHRel: vbHRelAvg,
    failures: failures.slice(0,10),
    failuresCount: failures.length,
  };
  if (verbose) {
    report.items = results.map(r => ({ file: r.file, count: r.count, raw: r.raw, rawTransCorr: r.rawTransCorr, norm: r.norm, sizeDev: r.sizeDev, details: r.details }));
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
  let simple = false;
  let threshold = SIMPLE_THRESHOLD_DEFAULT;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-f' || a === '--file' || a === '--sample') {
      fileArg = args[++i] || '';
    } else if (a === '-v' || a === '--verbose') {
      verbose = true;
    } else if (a === '--simple') {
      simple = true;
    } else if (a === '--threshold') {
      const t = parseFloat(args[++i]);
      if (Number.isFinite(t)) threshold = t;
    }
  }
  main({ sample: fileArg, verbose, simple, threshold })
    .then((summary) => {
      if (!simple) {
        console.log('Deviation summary:', summary);
      }
      setImmediate(() => process.exit(0));
    })
    .catch((e) => {
      console.error('Deviation run failed:', e?.stack || e?.message || String(e));
      process.exit(1);
    });
}
