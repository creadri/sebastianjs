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
    p.on('error', async (err) => {
      try { await unlink(tmpOut); } catch {}
      try { await unlink(pptrCfgPath); } catch {}
      reject(err);
    });
    p.on('exit', async (code) => {
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
