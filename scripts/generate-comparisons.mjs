#!/usr/bin/env node
// Generate comparison markdown files between SebastianJS and Mermaid default renderer.
// For each group of .mmd files in samples/* (grouped by filename prefix before first '_' or '__'),
// create a {group}.md under demos/ mirroring the samples/ subfolders.
// Each markdown shows our SVG and the Mermaid code (browser can render it).

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = join(__dirname, '..');
const SAMPLES_DIR = join(ROOT, 'samples');
const DEMOS_DIR = join(ROOT, 'demos');

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
  // split on first single or double underscore
  const m = base.split(/_{1,2}/, 2);
  const group = m[0] || base;
  const rest = base.slice(group.length);
  let index = 0;
  const numMatch = rest.match(/_{1,2}(\d+)/);
  if (numMatch) index = parseInt(numMatch[1], 10);
  return { group, index };
}

async function main() {
  const groups = new Map(); // key: dir+'::'+group -> { dir, group, items: [{file, index, def}] }
  let count = 0;
  for await (const file of walk(SAMPLES_DIR)) {
    const dir = file.substring(0, file.lastIndexOf('/'));
    const { group, index } = getGroupKey(file);
    const key = `${dir}::${group}`;
    const def = await readFile(file, 'utf8');
    if (!groups.has(key)) groups.set(key, { dir, group, items: [] });
    groups.get(key).items.push({ file, index, def });
    count++;
  }

  if (count === 0) {
    console.error('No .mmd files found under samples/.');
    process.exit(1);
  }

  let written = 0;
  for (const { dir, group, items } of groups.values()) {
    // sort by numeric index, then file name
    items.sort((a, b) => (a.index - b.index) || a.file.localeCompare(b.file));

    let md = `# ${group}\n\n`;

    for (const it of items) {
      const titleIndex = (Number.isFinite(it.index) && it.index > 0) ? it.index : (items.indexOf(it) + 1);
      md += `## Example ${titleIndex}\n\n**SebastianJS (SVG):**\n\n`;
      try {
        md += await render(it.def, { normalizeViewBox: true, viewBoxMargin: 4 });
      } catch (e) {
        md += `> Render failed: ${String(e)}`;
      }
      md += `\n\n**Mermaid Code (Browser Rendered):**\n\n\`\`\`mermaid\n${it.def}\n\`\`\`\n\n`;
    }

    const relDir = relative(SAMPLES_DIR, dir);
    const outDir = join(DEMOS_DIR, relDir);
    await mkdir(outDir, { recursive: true });
    const outPath = join(outDir, `${group}.md`);
    await writeFile(outPath, md, 'utf8');
    written++;
  }

  console.log(`Comparison generation complete: scanned ${count} .mmd files, wrote ${written} markdown files.`);
}

main().catch(err => {
  console.error('Generation failed:', err?.stack || err?.message || String(err));
  process.exit(1);
});
