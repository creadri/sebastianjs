#!/usr/bin/env node
// Build the static comparison site under site/ (not committed).
//
// Both sides are rendered at build time, by the same pinned mermaid:
//   left  -- SebastianJS, in process
//   right -- mermaid-cli, in headless Chrome
//
// The site used to ship the mermaid *source* to the browser and let a CDN copy
// of mermaid@10 draw it. That compared our mermaid 11.9.0 output against
// whatever the CDN served, so every difference was really a version
// difference. Rendering both sides here makes the comparison honest, and makes
// the page work with JavaScript disabled.

import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { JSDOM } from 'jsdom';
import { render, dispose } from '../src/index.js';
import { spawnMmdc } from './mmdc-wrapper.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SAMPLES_DIR = join(ROOT, 'samples');
const OUT_DIR = join(ROOT, 'site');
const ASSETS_DIR = join(OUT_DIR, 'assets');

const PUPPETEER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'];
const MMDC_TIMEOUT_MS = 120000;

// Must match src/index.js's defaults, or the two sides measure different fonts
// and every width differs. See .devcontainer/setup.sh for the Chrome side.
const MERMAID_CONFIG = {
  startOnLoad: false,
  securityLevel: 'loose',
  htmlLabels: true,
  flowchart: { htmlLabels: true },
  fontFamily: 'Open Sans',
  themeVariables: { fontFamily: 'Open Sans' },
};

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const MERMAID_VERSION = pkg.dependencies.mermaid;

/* ------------------------------------------------------------------ utils */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && p.endsWith('.mmd')) yield p;
  }
}

/** `flowchart__12.mmd` -> { group: 'flowchart', index: 12 } */
function groupOf(filePath) {
  const base = (filePath.split('/').pop() || filePath).replace(/\.mmd$/i, '');
  const m = base.match(/^(.*?)_{1,2}(\d+)$/);
  return m ? { group: m[1], index: parseInt(m[2], 10) } : { group: base, index: 0 };
}

/* --------------------------------------------------------------- geometry */

/** Node centres keyed by an id stripped of mermaid's per-render prefix. */
function parseNodes(svg) {
  let doc;
  try {
    doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
  } catch {
    return { viewBox: null, nodes: new Map() };
  }
  const root = doc.documentElement;
  if (!root || root.nodeName === 'parsererror') return { viewBox: null, nodes: new Map() };

  const vb = (root.getAttribute('viewBox') || '').split(/\s+/).map(Number);
  const nodes = new Map();
  for (const g of doc.querySelectorAll('g.node')) {
    const m = (g.getAttribute('transform') || '').match(/translate\(\s*([-\d.]+)[ ,]+([-\d.]+)/);
    if (!m) continue;
    const id = (g.getAttribute('id') || '').replace(/^.*?flowchart-/, '').replace(/-\d+$/, '');
    nodes.set(id, { x: +m[1], y: +m[2] });
  }
  return { viewBox: vb.length === 4 && vb.every(Number.isFinite) ? vb : null, nodes };
}

/** Mean absolute node deviation, plus viewBox size delta. Takes parsed input. */
function compare(a, b) {
  let deviation = null;
  const shared = [...a.nodes.keys()].filter((id) => b.nodes.has(id));
  if (shared.length) {
    let sum = 0;
    for (const id of shared) {
      const p = a.nodes.get(id), q = b.nodes.get(id);
      sum += Math.hypot(p.x - q.x, p.y - q.y);
    }
    deviation = sum / shared.length;
  }

  let widthRel = null;
  if (a.viewBox && b.viewBox && b.viewBox[2]) {
    widthRel = Math.abs(a.viewBox[2] - b.viewBox[2]) / b.viewBox[2];
  }
  return { deviation, comparedNodes: shared.length, widthRel };
}

/** A coarse verdict used for the badge. Only ever as good as its inputs. */
function verdict({ ok, theirOk, deviation, widthRel }) {
  if (!ok && !theirOk) return { key: 'both-failed', label: 'invalid demo' };
  if (!ok) return { key: 'failed', label: 'did not render' };
  if (!theirOk) return { key: 'ours-only', label: 'only ours rendered' };
  if (deviation === null && widthRel === null) return { key: 'unmeasured', label: 'not measurable' };
  const dev = deviation ?? 0;
  const rel = widthRel ?? 0;
  if (dev < 0.1 && rel < 0.005) return { key: 'match', label: 'match' };
  if (dev < 2 && rel < 0.03) return { key: 'close', label: 'close' };
  return { key: 'differs', label: 'differs' };
}

/* ----------------------------------------------------------- mermaid-cli */

/**
 * Render a whole group in one Chrome launch by feeding mmdc a markdown file
 * with one fenced block per sample.
 *
 * mmdc aborts the entire batch on the first diagram it cannot parse, so a
 * short batch means something failed: fall back to one invocation per file to
 * find out which. That keeps a single bad demo from blanking a whole group.
 */
async function renderGroupWithMmdc(items, workDir) {
  await mkdir(workDir, { recursive: true });
  const pptrPath = join(workDir, 'pptr.json');
  const cfgPath = join(workDir, 'mermaid.json');
  await writeFile(pptrPath, JSON.stringify({ args: PUPPETEER_ARGS }), 'utf8');
  await writeFile(cfgPath, JSON.stringify(MERMAID_CONFIG), 'utf8');

  const results = new Map();

  const mdPath = join(workDir, 'in.md');
  const outPath = join(workDir, 'out.md');
  await writeFile(mdPath, items.map((it) => '```mermaid\n' + it.def.trim() + '\n```').join('\n\n'), 'utf8');

  try {
    await withTimeout(spawnMmdc(
      ['-i', mdPath, '-o', outPath, '--puppeteerConfigFile', pptrPath, '-c', cfgPath],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    ), MMDC_TIMEOUT_MS);
  } catch { /* partial output is still usable */ }

  let complete = true;
  for (let i = 0; i < items.length; i++) {
    const svgPath = join(workDir, `out-${i + 1}.svg`);
    if (existsSync(svgPath)) results.set(items[i].file, { ok: true, svg: await readFile(svgPath, 'utf8') });
    else complete = false;
  }
  if (complete) return results;

  for (const it of items) {
    if (results.has(it.file)) continue;
    results.set(it.file, await renderOneWithMmdc(it, workDir, pptrPath, cfgPath));
  }
  return results;
}

async function renderOneWithMmdc(item, workDir, pptrPath, cfgPath) {
  const inPath = join(workDir, 'single.mmd');
  const outPath = join(workDir, 'single.svg');
  await rm(outPath, { force: true });
  await writeFile(inPath, item.def, 'utf8');
  try {
    await withTimeout(spawnMmdc(
      ['-i', inPath, '-o', outPath, '--puppeteerConfigFile', pptrPath, '-c', cfgPath],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    ), MMDC_TIMEOUT_MS);
    if (!existsSync(outPath)) return { ok: false, error: 'mermaid-cli produced no output' };
    return { ok: true, svg: await readFile(outPath, 'utf8') };
  } catch (e) {
    return { ok: false, error: firstLine(e) };
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('mermaid-cli timed out')), ms)),
  ]);
}

const firstLine = (e) => String(e?.message || e).split('\n')[0].slice(0, 300);

/* ------------------------------------------------------------------- html */

function page({ title, description, body, depth = 0 }) {
  const up = depth ? '../'.repeat(depth) : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="stylesheet" href="${up}assets/style.css">
</head>
<body>
<header class="site-header">
  <a class="wordmark" href="${up}index.html">Sebastian<span>JS</span></a>
  <nav>
    <a href="${up}index.html">Gallery</a>
    <a href="https://github.com/creadri/sebastianjs">GitHub</a>
    <a href="https://www.npmjs.com/package/sebastianjs">npm</a>
  </nav>
</header>
<main>
${body}
</main>
<footer class="site-footer">
  <p>Both panes rendered at build time with mermaid ${esc(MERMAID_VERSION)} — SebastianJS in process, mermaid-cli in headless Chrome.</p>
  <p class="muted">Generated ${new Date().toISOString().slice(0, 10)} · SebastianJS ${esc(pkg.version)}</p>
</footer>
</body>
</html>`;
}

function svgPane({ label, sub, ok, src, error, widthPct }) {
  if (!ok) {
    return `<div class="pane pane-failed">
        <div class="pane-head"><span class="pane-label">${esc(label)}</span><span class="pane-sub">${esc(sub)}</span></div>
        <div class="pane-body"><p class="failure"><strong>Did not render</strong><span>${esc(error || 'unknown error')}</span></p></div>
      </div>`;
  }
  // Both panes are the same width, so letting each image fill its pane would
  // normalise away any size difference -- the two would look identical even
  // when one is 30% wider. Scale both against the wider of the pair instead,
  // so a width difference is visible rather than merely stated in the metrics.
  const style = widthPct != null && widthPct < 99.5 ? ` style="width:${widthPct.toFixed(1)}%"` : '';
  return `<div class="pane">
        <div class="pane-head"><span class="pane-label">${esc(label)}</span><span class="pane-sub">${esc(sub)}</span></div>
        <div class="pane-body"><img src="${esc(src)}" alt="${esc(label)} rendering" loading="lazy"${style}></div>
      </div>`;
}

function metricsLine({ deviation, comparedNodes, widthRel }) {
  const bits = [];
  if (deviation !== null) bits.push(`<span><b>${deviation.toFixed(3)}px</b> mean node offset over ${comparedNodes} node${comparedNodes === 1 ? '' : 's'}</span>`);
  if (widthRel !== null) bits.push(`<span><b>${(widthRel * 100).toFixed(2)}%</b> width difference</span>`);
  if (!bits.length) bits.push('<span class="muted">No comparable nodes — compare visually</span>');
  return `<div class="metrics">${bits.join('')}</div>`;
}

/* ------------------------------------------------------------------- main */

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(ASSETS_DIR, { recursive: true });

  const groups = new Map();
  for await (const file of walk(SAMPLES_DIR)) {
    const { group, index } = groupOf(file);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ file, index, def: await readFile(file, 'utf8') });
  }
  for (const items of groups.values()) items.sort((a, b) => a.index - b.index || a.file.localeCompare(b.file));

  const workRoot = join(tmpdir(), `sebastianjs-site-${process.pid}`);
  const summary = [];
  const sortedGroups = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));

  for (const [group, items] of sortedGroups) {
    process.stderr.write(`  ${group} (${items.length})\n`);

    const ours = new Map();
    for (const it of items) {
      try {
        ours.set(it.file, { ok: true, svg: await render(it.def, { width: 800, height: 600 }) });
      } catch (e) {
        ours.set(it.file, { ok: false, error: firstLine(e) });
      }
    }

    const theirs = await renderGroupWithMmdc(items, join(workRoot, group));

    const cards = [];
    const counts = { match: 0, close: 0, differs: 0, failed: 0, 'both-failed': 0, 'ours-only': 0, unmeasured: 0 };

    for (const [i, it] of items.entries()) {
      const n = it.index || i + 1;
      const a = ours.get(it.file);
      const b = theirs.get(it.file) || { ok: false, error: 'not rendered' };

      const ga = a.ok ? parseNodes(a.svg) : null;
      const gb = b.ok ? parseNodes(b.svg) : null;

      let metrics = { deviation: null, comparedNodes: 0, widthRel: null };
      if (ga && gb) metrics = compare(ga, gb);

      const wa = ga?.viewBox?.[2] || null;
      const wb = gb?.viewBox?.[2] || null;
      const widest = Math.max(wa || 0, wb || 0) || null;
      const pctOf = (w) => (widest && w ? (w / widest) * 100 : null);

      const v = verdict({ ok: a.ok, theirOk: b.ok, ...metrics });
      counts[v.key] = (counts[v.key] || 0) + 1;

      let oursSrc = '', theirsSrc = '';
      if (a.ok) {
        oursSrc = `assets/${group}-${n}-sebastianjs.svg`;
        await writeFile(join(OUT_DIR, oursSrc), a.svg, 'utf8');
      }
      if (b.ok) {
        theirsSrc = `assets/${group}-${n}-mermaid-cli.svg`;
        await writeFile(join(OUT_DIR, theirsSrc), b.svg, 'utf8');
      }

      cards.push(`<article class="card" id="example-${n}">
  <div class="card-head">
    <h2>Example ${n}</h2>
    <span class="badge badge-${v.key}">${esc(v.label)}</span>
  </div>
  ${a.ok && b.ok ? metricsLine(metrics) : ''}
  <div class="compare">
    ${svgPane({ label: 'SebastianJS', sub: 'no browser', ok: a.ok, src: oursSrc, error: a.error, widthPct: pctOf(wa) })}
    ${svgPane({ label: 'mermaid-cli', sub: 'headless Chrome', ok: b.ok, src: theirsSrc, error: b.error, widthPct: pctOf(wb) })}
  </div>
  <details class="source">
    <summary>Mermaid source</summary>
    <pre><code>${esc(it.def.trim())}</code></pre>
  </details>
</article>`);
    }

    const nav = items.map((it, i) => `<a href="#example-${it.index || i + 1}">${it.index || i + 1}</a>`).join('');
    const body = `<nav class="crumbs"><a href="index.html">Gallery</a> <span>/</span> <strong>${esc(group)}</strong></nav>
<div class="page-head">
  <h1>${esc(group)}</h1>
  <p class="lede">${items.length} sample${items.length === 1 ? '' : 's'} from the mermaid demo corpus, rendered both ways.</p>
  <div class="jump">${nav}</div>
</div>
${cards.join('\n')}`;

    await writeFile(join(OUT_DIR, `${group}.html`), page({
      title: `${group} — SebastianJS`,
      description: `Side-by-side comparison of SebastianJS and mermaid-cli output for ${group} diagrams.`,
      body,
    }), 'utf8');

    summary.push({ group, total: items.length, counts });
  }

  // ---- index -------------------------------------------------------------
  const totals = { samples: 0, match: 0, close: 0, differs: 0, failed: 0, bothFailed: 0 };
  for (const s of summary) {
    totals.samples += s.total;
    totals.match += s.counts.match;
    totals.close += s.counts.close;
    totals.differs += s.counts.differs + s.counts['ours-only'] + s.counts.unmeasured;
    totals.failed += s.counts.failed;
    totals.bothFailed += s.counts['both-failed'];
  }

  const cards = summary.map((s) => {
    const good = s.counts.match + s.counts.close;
    const pct = s.total ? Math.round((good / s.total) * 100) : 0;
    const tone = pct === 100 ? 'match' : pct >= 60 ? 'close' : 'differs';
    return `<a class="type-card" href="${esc(s.group)}.html">
  <span class="type-name">${esc(s.group)}</span>
  <span class="type-meta">${s.total} sample${s.total === 1 ? '' : 's'}</span>
  <span class="bar"><span class="bar-fill bar-${tone}" style="width:${pct}%"></span></span>
  <span class="type-pct">${pct}% match or close</span>
</a>`;
  }).join('\n');

  const body = `<section class="hero">
  <h1>Mermaid, rendered without a browser</h1>
  <p class="lede">SebastianJS renders mermaid diagrams to SVG in plain Node — no headless Chrome, no native build step. Every diagram below is rendered twice and shown side by side, so you can judge the difference yourself.</p>
  <div class="stats">
    <div class="stat"><b>${totals.samples}</b><span>samples</span></div>
    <div class="stat"><b>${totals.match}</b><span>pixel match</span></div>
    <div class="stat"><b>${totals.close}</b><span>close</span></div>
    <div class="stat"><b>${totals.bothFailed}</b><span>invalid demos</span></div>
  </div>
  <p class="note">Both sides run mermaid ${esc(MERMAID_VERSION)}. The reference pane is real mermaid-cli output produced at build time, not a CDN copy of mermaid drawing in your browser — otherwise the comparison would measure a version difference rather than a rendering difference.</p>
</section>
<section>
  <h2 class="section-title">Diagram types</h2>
  <div class="type-grid">
${cards}
  </div>
</section>`;

  await writeFile(join(OUT_DIR, 'index.html'), page({
    title: 'SebastianJS — mermaid without a browser',
    description: 'Side-by-side comparison of SebastianJS and mermaid-cli rendering across the mermaid demo corpus.',
    body,
  }), 'utf8');

  await writeFile(join(ASSETS_DIR, 'style.css'), STYLE, 'utf8');
  await rm(workRoot, { recursive: true, force: true });

  console.log(`Site build complete: ${summary.length} types, ${totals.samples} samples -> ${OUT_DIR}`);
  console.log(`  match ${totals.match} · close ${totals.close} · differs ${totals.differs} · ours failed ${totals.failed} · invalid demos ${totals.bothFailed}`);
}

/* ------------------------------------------------------------------ style */

const STYLE = `:root{
  --bg:#fbfbfd; --surface:#fff; --border:#e4e4e9; --text:#1a1a1f; --muted:#6c6c78;
  --accent:#4338ca; --accent-soft:#eef0ff;
  --match:#0f8a4f; --match-soft:#e6f5ec;
  --close:#a16207; --close-soft:#fdf4e3;
  --differs:#b4451f; --differs-soft:#fdeee8;
  --fail:#8b1a1a; --fail-soft:#fbeaea;
  --radius:10px; --shadow:0 1px 2px rgba(16,16,32,.05),0 4px 16px rgba(16,16,32,.04);
}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){
  --bg:#0f1014; --surface:#17181e; --border:#2a2b33; --text:#e9e9ef; --muted:#9a9aa8;
  --accent:#a5b4fc; --accent-soft:#1e1f3a;
  --match:#4ade80; --match-soft:#12291c;
  --close:#fbbf24; --close-soft:#2a2312;
  --differs:#fb923c; --differs-soft:#2d1c12;
  --fail:#f87171; --fail-soft:#2d1414;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 4px 16px rgba(0,0,0,.3);
}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
  font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif;
  -webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.muted{color:var(--muted)}
main{max-width:1180px;margin:0 auto;padding:0 24px 72px}

.site-header{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;
  gap:24px;padding:14px 24px;background:color-mix(in srgb,var(--bg) 88%,transparent);
  backdrop-filter:blur(10px);border-bottom:1px solid var(--border);margin-bottom:40px}
.wordmark{font-weight:640;letter-spacing:-.02em;font-size:16px;color:var(--text)}
.wordmark span{color:var(--accent)}
.wordmark:hover{text-decoration:none}
.site-header nav{display:flex;gap:20px;font-size:14px}
.site-header nav a{color:var(--muted)}
.site-header nav a:hover{color:var(--text);text-decoration:none}

.hero{padding:24px 0 8px;max-width:760px}
.hero h1{font-size:clamp(30px,4.2vw,42px);line-height:1.15;letter-spacing:-.025em;margin:0 0 16px}
.lede{font-size:17px;color:var(--muted);margin:0 0 28px}
.note{font-size:13.5px;color:var(--muted);border-left:2px solid var(--border);padding-left:14px;margin:28px 0 0}
.stats{display:flex;flex-wrap:wrap;gap:12px}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:14px 20px;min-width:112px;box-shadow:var(--shadow)}
.stat b{display:block;font-size:24px;letter-spacing:-.02em}
.stat span{font-size:12.5px;color:var(--muted)}

.section-title{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);
  margin:56px 0 16px;font-weight:600}
.type-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.type-card{display:flex;flex-direction:column;gap:7px;padding:16px 18px;background:var(--surface);
  border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);
  transition:transform .12s ease,border-color .12s ease}
.type-card:hover{text-decoration:none;transform:translateY(-2px);border-color:var(--accent)}
.type-name{font-weight:600;color:var(--text);letter-spacing:-.01em}
.type-meta,.type-pct{font-size:12.5px;color:var(--muted)}
.bar{display:block;height:5px;border-radius:3px;background:var(--border);overflow:hidden}
.bar-fill{display:block;height:100%;border-radius:3px}
.bar-match{background:var(--match)} .bar-close{background:var(--close)} .bar-differs{background:var(--differs)}

.crumbs{font-size:13px;color:var(--muted);margin-bottom:20px}
.crumbs span{margin:0 6px}
.page-head{margin-bottom:32px}
.page-head h1{font-size:32px;letter-spacing:-.02em;margin:0 0 8px}
.jump{display:flex;flex-wrap:wrap;gap:6px;margin-top:18px}
.jump a{display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:30px;padding:0 8px;
  font-size:12.5px;background:var(--surface);border:1px solid var(--border);border-radius:7px;color:var(--muted)}
.jump a:hover{text-decoration:none;border-color:var(--accent);color:var(--accent)}

.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;
  padding:20px;margin-bottom:22px;box-shadow:var(--shadow);scroll-margin-top:80px}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:12px}
.card-head h2{font-size:16px;margin:0;letter-spacing:-.01em}
.badge{font-size:11.5px;font-weight:600;padding:3px 10px;border-radius:999px;white-space:nowrap}
.badge-match{background:var(--match-soft);color:var(--match)}
.badge-close{background:var(--close-soft);color:var(--close)}
.badge-differs,.badge-ours-only,.badge-unmeasured{background:var(--differs-soft);color:var(--differs)}
.badge-failed{background:var(--fail-soft);color:var(--fail)}
.badge-both-failed{background:var(--border);color:var(--muted)}
.metrics{display:flex;flex-wrap:wrap;gap:18px;font-size:12.5px;color:var(--muted);
  padding-bottom:14px;margin-bottom:4px;border-bottom:1px solid var(--border)}
.metrics b{color:var(--text);font-variant-numeric:tabular-nums}

.compare{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:14px}
@media (max-width:820px){.compare{grid-template-columns:1fr}}
.pane{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
.pane-head{display:flex;align-items:baseline;gap:8px;padding:9px 12px;border-bottom:1px solid var(--border);
  background:color-mix(in srgb,var(--border) 22%,transparent)}
.pane-label{font-size:12.5px;font-weight:600}
.pane-sub{font-size:11.5px;color:var(--muted)}
/* Mermaid's palette assumes a light ground, so the canvas stays white in both
   themes rather than inverting the diagram out from under itself. */
.pane-body{flex:1;display:flex;align-items:center;justify-content:center;padding:18px;
  background:#fff;overflow:auto}
.pane-body img{max-width:100%;height:auto;display:block}
.pane-failed .pane-body{background:var(--fail-soft);background-image:none}
.failure{display:flex;flex-direction:column;gap:6px;text-align:center;margin:0;padding:20px 8px;font-size:12.5px}
.failure strong{color:var(--fail)}
.failure span{color:var(--muted);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;
  word-break:break-word;max-width:46ch}

.source{margin-top:14px;border-top:1px solid var(--border);padding-top:12px}
.source summary{cursor:pointer;font-size:12.5px;color:var(--muted);user-select:none}
.source summary:hover{color:var(--text)}
.source pre{margin:12px 0 0;padding:14px;background:var(--bg);border:1px solid var(--border);
  border-radius:8px;overflow-x:auto;font-size:12.5px;line-height:1.55}
.source code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}

.site-footer{border-top:1px solid var(--border);padding:28px 24px;text-align:center;
  font-size:12.5px;color:var(--muted)}
.site-footer p{margin:0 0 4px}
`;

main()
  .then(async () => { await dispose(); setImmediate(() => process.exit(0)); })
  .catch(async (e) => {
    console.error('Site build failed:', e?.stack || e);
    try { await dispose(); } catch {}
    process.exit(1);
  });
