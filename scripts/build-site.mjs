#!/usr/bin/env node
// Build a static comparison site under site/ (not committed):
// - Left: SebastianJS-rendered SVGs saved as assets and referenced via <img>
// - Right: Mermaid source rendered client-side via Mermaid CDN

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const SAMPLES_DIR = join(ROOT, 'samples');
const OUT_DIR = join(ROOT, 'site');
const ASSETS_DIR = join(OUT_DIR, 'assets');

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && p.endsWith('.mmd')) yield p;
  }
}

function getGroupKey(filePath) {
  const name = filePath.split('/').pop() || filePath;
  const base = name.replace(/\.mmd$/i, '');
  const m = base.split(/_{1,2}/, 2);
  const group = m[0] || base;
  const rest = base.slice(group.length);
  let index = 0;
  const numMatch = rest.match(/_{1,2}(\d+)/);
  if (numMatch) index = parseInt(numMatch[1], 10);
  return { group, index };
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function htmlDoc(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://cdn.jsdelivr.net"/>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;margin:20px;}
    a{color:#0b5fff;text-decoration:none}
    a:hover{text-decoration:underline}
    table{border-collapse:collapse;width:100%;}
    th,td{border:1px solid #ddd;vertical-align:top;padding:8px;}
    th{background:#f7f7f7;}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    .mermaid{background:#fff}
    img{max-width:100%;height:auto}
    .code{white-space:pre-wrap}
  </style>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <script>mermaid.initialize({ startOnLoad: true, securityLevel: 'loose' });</script>
</head>
<body>
${body}
</body>
</html>`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(ASSETS_DIR, { recursive: true });

  const groups = new Map();
  for await (const file of walk(SAMPLES_DIR)) {
    const dir = file.substring(0, file.lastIndexOf('/'));
    const { group, index } = getGroupKey(file);
    const key = `${dir}::${group}`;
    const def = await readFile(file, 'utf8');
    if (!groups.has(key)) groups.set(key, { dir, group, items: [] });
    groups.get(key).items.push({ file, index, def });
  }

  // Build index
  const indexLinks = [];
  for (const { dir, group, items } of groups.values()) {
    items.sort((a, b) => (a.index - b.index) || a.file.localeCompare(b.file));
    const relDir = relative(SAMPLES_DIR, dir);
    const pageDir = join(OUT_DIR, relDir);
    await mkdir(pageDir, { recursive: true });
    const pagePath = join(pageDir, `${group}.html`);
    indexLinks.push(`<li><a href="${escapeHtml(join(relDir, `${group}.html`)).replace(/\\/g,'/')}">${escapeHtml(relDir)} / ${escapeHtml(group)}</a></li>`);

    let body = `<p><a href="../index.html">← Back to index</a></p>\n<h1>${escapeHtml(group)}</h1>\n`;
    for (const it of items) {
      const n = (Number.isFinite(it.index) && it.index > 0) ? it.index : (items.indexOf(it) + 1);
      body += `  <h2>Example ${n}</h2>\n`;
      // Render SVG and save as asset
      let assetRel = '';
      try {
        const svg = await render(it.def, { normalizeViewBox: true, autoSize: true });
        const assetName = `${group}-${n}.svg`;
        const assetPath = join(ASSETS_DIR, assetName);
        await writeFile(assetPath, svg, 'utf8');
        assetRel = join('..', 'assets', assetName).replace(/\\/g,'/');
        body += `  <div class="grid">\n    <div><strong>SebastianJS (SVG)</strong><br/><a href="${assetRel}" alt="${escapeHtml(group)}">${assetRel}</a></div>\n    <div><strong>Mermaid (code)</strong>\n<pre class="mermaid">${escapeHtml(it.def)}</pre></div>\n  </div>\n`;
      } catch (e) {
        const msg = (e?.message || String(e));
        body += `  <div class="grid">\n    <div><strong>SebastianJS (SVG)</strong><br/><pre class="code">Render failed: ${escapeHtml(msg)}</pre></div>\n    <div><strong>Mermaid (code)</strong>\n<pre class="mermaid">${escapeHtml(it.def)}</pre></div>\n  </div>\n`;
      }
    }
    await writeFile(pagePath, htmlDoc(`${relDir} / ${group}`, body), 'utf8');
  }

  const idx = `<h1>Mermaid comparisons</h1>\n<p>Left: SebastianJS rendered SVG. Right: Mermaid code rendered in the browser.</p>\n<ul>${indexLinks.sort().join('\n')}</ul>`;
  await writeFile(join(OUT_DIR, 'index.html'), htmlDoc('SebastianJS Demos', idx), 'utf8');

  console.log(`Site build complete: ${groups.size} groups -> ${OUT_DIR}`);
}

main()
  .then(() => {
    // Some libraries may leave timers/handles open; force a clean exit once IO is flushed.
    setImmediate(() => process.exit(0));
  })
  .catch((e) => {
    console.error('Site build failed:', e?.stack || e?.message || String(e));
    process.exit(1);
  });
