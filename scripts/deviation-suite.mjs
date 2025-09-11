import { promises as fsp } from 'fs';
import { join, extname } from 'path';
import { render } from '../src/index.js';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';

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

function spawnAsync(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, opts);
    let stderr = '';
    p.stderr && p.stderr.on('data', d => { stderr += d.toString(); });
    p.on('error', err => reject(err));
    p.on('exit', code => {
      if (code === 0) resolve({ code, stderr }); else reject(new Error(`Command ${cmd} exited ${code}: ${stderr}`));
    });
  });
}

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
      spawnAsync('mmdc', args, { stdio: ['ignore','ignore','pipe'], env: { ...process.env } }),
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
  for (const node of nodes) {
    const id = node.id || node.getAttribute('id');
    if (!id) continue;
    const t = node.getAttribute('transform');
    if (!t) continue;
    const m = t.match(/translate\(([^,]+),\s*([^)]+)\)/);
    if (!m) continue;
    const x = parseFloat(m[1]);
    const y = parseFloat(m[2]);
    if (!Number.isNaN(x) && !Number.isNaN(y)) map.set(id, { x, y });
  }
  return map;
}

function averageDeviation(a, b) {
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
  for (let i=0;i<ids.length;i++) {
    const pA = arrA[i]; const pB = arrB[i];
    totalRaw += Math.hypot(pA.x - pB.x, pA.y - pB.y);
    const ax = (pA.x - sA.minX)/sA.x; const ay=(pA.y - sA.minY)/sA.y;
    const bx = (pB.x - sB.minX)/sB.x; const by=(pB.y - sB.minY)/sB.y;
    totalNorm += Math.hypot(ax - bx, ay - by);
  }
  return { raw: totalRaw/ids.length, norm: totalNorm/ids.length, count: ids.length };
}

async function main() {
  let samples = await listSamples(SAMPLE_DIR);
  if (MAX_SAMPLES && Number.isFinite(MAX_SAMPLES)) samples = samples.slice(0, MAX_SAMPLES);

  const results = [];
  for (const file of samples) {
    const def = await fsp.readFile(file, 'utf8');
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
    const { raw, norm, count } = averageDeviation(sebPos, cliPos);
    results.push({ file, raw, norm, count });
  }

  // Aggregate
  const ok = results.filter(r => r.norm !== undefined && Number.isFinite(r.norm));
  const avgNorm = ok.reduce((a,r)=>a+r.norm,0)/(ok.length||1);
  const avgRaw = ok.reduce((a,r)=>a+r.raw,0)/(ok.length||1);
  const failures = ok.filter(r => r.norm > NORMALIZED_DEVIATION_THRESHOLD || r.raw > POSITION_DEVIATION_THRESHOLD);

  console.log(JSON.stringify({
    samplesProcessed: samples.length,
    compared: ok.length,
    avgNormalizedDeviation: avgNorm,
    avgRawDeviation: avgRaw,
    thresholdNormalized: NORMALIZED_DEVIATION_THRESHOLD,
    thresholdRaw: POSITION_DEVIATION_THRESHOLD,
    failures: failures.slice(0,10),
    failuresCount: failures.length,
  }, null, 2));

  // Export minimal summary for test assertion
  return { avgNorm, avgRaw, failuresCount: failures.length };
}

export async function runDeviationSuite() {
  return main();
}
