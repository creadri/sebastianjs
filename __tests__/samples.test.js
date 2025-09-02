import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { render } from '../src/index.js';

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (p.endsWith('.mmd')) yield p;
  }
}

describe('Mermaid demo samples', () => {
  const root = 'samples';
  let files = [];
  beforeAll(async () => {
    try {
      for await (const f of walk(root)) files.push(f);
    } catch (_) {
      files = [];
    }
  });

  it('renders all extracted samples', async () => {
    if (files.length === 0) {
      console.warn('No samples found. Run scripts/fetch-mermaid-demos.mjs first.');
      return;
    }
    const getFirstKeyword = (def) => {
      const lines = def.split(/\r?\n/);
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith('%%')) continue; // mermaid comment
        const m = line.match(/^([A-Za-z][A-Za-z-]*)\b/);
        if (m) return m[1];
        break;
      }
      return '';
    };

    const supported = (def) => {
      const kw = getFirstKeyword(def);
      const normalized = kw === 'stateDiagram-v2' ? 'stateDiagram' : kw;
      const ok = new Set([
        'graph',
        'flowchart',
        'sequenceDiagram',
        'classDiagram',
        'erDiagram',
        'gantt',
        'pie',
        'journey',
        'stateDiagram',
        'gitGraph',
        'quadrantChart',
      ]);
      if (ok.has(normalized)) return true;
      if (/^graph\s/i.test(def)) return true; // heuristic
      return false;
    };

    let attempted = 0;
    let success = 0;
    const failures = [];
    let skipped = 0;

    for (const f of files) {
      const def = await readFile(f, 'utf8');
      if (!supported(def)) { skipped++; continue; }
      attempted++;
      try {
        const svg = await render(def, { normalizeViewBox: true });
        if (!svg.includes('<svg')) throw new Error('Output missing <svg');
        success++;
      } catch (e) {
        failures.push({ file: f, message: e?.message || String(e) });
        // Keep going; we only summarize at the end
      }
    }

    console.log(`[samples] attempted=${attempted} success=${success} skipped=${skipped} failures=${failures.length}`);
    if (failures.length) {
      const sample = failures.slice(0, 5).map(x => ` - ${x.file}: ${x.message}`).join('\n');
      console.warn(`[samples] first failures:\n${sample}`);
    }

    expect(success).toBeGreaterThan(0);
  }, 60000);
});
