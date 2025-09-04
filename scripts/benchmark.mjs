#!/usr/bin/env node
// Benchmark SebastianJS render performance against mermaid-cli (mmdc) over sample .mmd files
// Updates README.md between BENCHMARK_START / BENCHMARK_END markers with a Mermaid graph.

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { render } from '../src/index.js';

const SAMPLES_DIR = 'samples/mermaid-demos';
const README = 'README.md';
const MMDC_CMD = 'mmdc'; // Expected mermaid-cli command in PATH

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

function hrtimeMs() { return Number(process.hrtime.bigint() / 1000000n); }

async function timeAsync(fn) {
  const start = hrtimeMs();
  try { await fn(); return { ms: hrtimeMs() - start, ok: true }; }
  catch (e) { return { ms: hrtimeMs() - start, ok: false, error: e }; }
}

async function hasMmdc() {
  return new Promise((resolve) => {
    const p = spawn(MMDC_CMD, ['-h']);
    let done = false;
    p.on('error', () => { if (!done) { done = true; resolve(false); } });
    p.on('exit', () => { if (!done) { done = true; resolve(true); } });
    setTimeout(() => { if (!done) { done = true; try { p.kill(); } catch {} resolve(false); } }, 3000);
  });
}

async function benchmarkSebastian(file) {
  const def = await readFile(file, 'utf8');
  return timeAsync(() => render(def, { normalizeViewBox: true, autoSize: true }));
}

async function benchmarkMmdc(file) {
  // Render to memory by piping stdout (using -o - if supported) – fallback to temp file not implemented here.
  return timeAsync(() => new Promise((resolve, reject) => {
    const args = ['-i', file, '-o', '/dev/null'];
    const p = spawn(MMDC_CMD, args, { stdio: 'ignore' });
    p.on('error', reject);
    p.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`mmdc exited ${code}`)));
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
  if (!mmdc) {
    return `pie title Average Render Time (ms)\n  \"sebastianjs\" : ${formatNumber(seb.avg)}\n  \"mermaid-cli (missing)\" : 0`;
  }
  return `pie title Average Render Time (ms)\n  \"sebastianjs\" : ${formatNumber(seb.avg)}\n  \"mermaid-cli\" : ${formatNumber(mmdc.avg)}`;
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
    next = md.replace(new RegExp(`${startMarker}[\s\S]*?${endMarker}`), `${startMarker}\n${section}\n${endMarker}`);
  } else {
    next = md.trimEnd() + `\n\n${startMarker}\n${section}\n${endMarker}\n`;
  }
  await writeFile(README, next, 'utf8');
}

async function main() {
  const samples = await listSamples(SAMPLES_DIR);
  if (!samples.length) throw new Error('No samples found. Run npm run fetch:samples first.');

  const sebResults = [];
  const mmdcAvailable = await hasMmdc();
  const mmdcResults = [];

  for (const file of samples) {
    const seb = await benchmarkSebastian(file); sebResults.push(seb);
    if (mmdcAvailable) {
      const mm = await benchmarkMmdc(file); mmdcResults.push(mm);
    }
  }

  const sebSummary = summarize('sebastianjs', sebResults);
  const mmdcSummary = mmdcAvailable ? summarize('mermaid-cli', mmdcResults) : null;
  await updateReadme(sebSummary, mmdcSummary);
  console.log('Benchmark complete:', sebSummary, mmdcSummary || '(mermaid-cli missing)');
}


main()
  .then(() => {
    // Some libraries may leave timers/handles open; force a clean exit once IO is flushed.
    setImmediate(() => process.exit(0));
  })
  .catch(e => { console.error('Benchmark failed:', e); process.exit(1); });
