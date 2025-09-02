#!/usr/bin/env node
// Fetch Mermaid demos and extract <pre class="mermaid"> blocks into samples/mermaid-demos

import { mkdtemp, rm, mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, extname, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { JSDOM } from 'jsdom';

const REPO = 'https://github.com/mermaid-js/mermaid.git';

async function exec(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}`));
    });
    p.on('error', reject);
  });
}

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

async function main() {
  const tmp = await mkdtemp(join(tmpdir(), 'mermaid-demos-'));
  const repoDir = tmp;
  await exec('git', ['clone', '--depth', '1', REPO, repoDir]);
  const demosDir = join(repoDir, 'demos');

  const samplesRoot = resolve('samples/mermaid-demos');
  await rm(samplesRoot, { recursive: true, force: true }).catch(() => {});
  await mkdir(samplesRoot, { recursive: true });

  const manifest = [];
  for await (const file of walk(demosDir)) {
    if (extname(file).toLowerCase() !== '.html') continue;
    const html = await readFile(file, 'utf8');
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const blocks = doc.querySelectorAll('pre.mermaid, pre.language-mermaid');
    if (!blocks.length) continue;

    const rel = relative(demosDir, file).replace(/\\/g, '/');
    const base = rel.replace(/\.html$/i, '');
    let count = 0;
    for (const pre of blocks) {
      const content = (pre.textContent || '').trim();
      if (!content) continue;
      count++;
      const outDir = join(samplesRoot, dirname(base));
      await mkdir(outDir, { recursive: true });
      const outFile = join(outDir, `${base.split('/').pop()}__${count}.mmd`);
      await writeFile(outFile, content, 'utf8');
      manifest.push({ source: rel, index: count, file: outFile });
    }
  }

  await writeFile(join(samplesRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.error(`Extracted ${manifest.length} mermaid samples to ${samplesRoot}`);
}

main().catch((err) => {
  console.error('Failed:', err?.stack || err);
  process.exit(1);
});
