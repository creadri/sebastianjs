import { render, dispose } from '../src/index.js';
import { spawnMmdc } from '../scripts/mmdc-wrapper.mjs';
import { JSDOM } from 'jsdom';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// A single fast parity check against real Chrome, so an obvious regression fails
// in a normal `npm test` run. The broad sweep lives in samples-deviation.test.js.
//
// This replaces an earlier version that could not do its job:
//   - it probed `mmdc` on PATH, where it is not installed, so it always skipped;
//   - it asserted on a scale-invariant metric (each position set rescaled to its
//     own bounding box), which scores a half-size diagram as a perfect match;
//   - it ran mermaid-cli with default config (htmlLabels: true) against our
//     htmlLabels: false output, comparing two different rendering modes.

const MMDC = resolve('node_modules', '.bin', 'mmdc');
const hasMmdc = existsSync(MMDC);

// Both sides must measure the same thing: same label mode, same font.
// htmlLabels is mermaid's default and now ours, so this is the mode users get.
const MERMAID_CONFIG = {
  startOnLoad: false,
  securityLevel: 'loose',
  htmlLabels: true,
  flowchart: { htmlLabels: true },
  class: { htmlLabels: true },
  fontFamily: 'Open Sans',
  themeVariables: { fontFamily: 'Open Sans' },
};

const DEFINITION = `graph TD
    A[Start] --> B{Is it working?}
    B -->|Yes| C[Great!]
    B -->|No| D[Debug]
    D --> B
    C --> E[End]`;

function parse(svg) {
  const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
  const viewBox = (doc.documentElement.getAttribute('viewBox') || '').split(/\s+/).map(Number);
  const nodes = new Map();
  for (const g of doc.querySelectorAll('g.node')) {
    const m = (g.getAttribute('transform') || '').match(/translate\(\s*([-\d.]+)[ ,]+([-\d.]+)/);
    if (!m) continue;
    // Strip mermaid's per-render id prefix/suffix so ids line up across renderers.
    const id = (g.getAttribute('id') || '').replace(/^flowchart-/, '').replace(/-\d+$/, '');
    nodes.set(id, { x: +m[1], y: +m[2] });
  }
  return { viewBox: viewBox.length === 4 ? viewBox : null, nodes };
}

async function renderWithMermaidCli(definition) {
  const dir = mkdtempSync(join(tmpdir(), 'seb-cmp-'));
  writeFileSync(join(dir, 'in.mmd'), definition, 'utf8');
  writeFileSync(join(dir, 'cfg.json'), JSON.stringify(MERMAID_CONFIG), 'utf8');
  writeFileSync(
    join(dir, 'pptr.json'),
    JSON.stringify({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] }),
    'utf8'
  );
  await spawnMmdc(
    ['-i', join(dir, 'in.mmd'), '-o', join(dir, 'out.svg'),
     '--puppeteerConfigFile', join(dir, 'pptr.json'), '-c', join(dir, 'cfg.json')],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  return readFileSync(join(dir, 'out.svg'), 'utf8');
}

afterAll(async () => { await dispose(); });

describe('SebastianJS vs mermaid-cli', () => {
  (hasMmdc ? it : it.skip)('places nodes where Chrome does', async () => {
    const [ours, chrome] = await Promise.all([
      render(DEFINITION, { mermaidConfig: { securityLevel: 'loose' } }),
      renderWithMermaidCli(DEFINITION),
    ]);

    const a = parse(ours);
    const b = parse(chrome);

    // Guard against a vacuous pass if the id scheme ever changes.
    const shared = [...a.nodes.keys()].filter((id) => b.nodes.has(id));
    expect(shared.length).toBeGreaterThanOrEqual(5);

    // Absolute, unaligned deviation. Typically ~0.05px.
    for (const id of shared) {
      expect(a.nodes.get(id).x).toBeCloseTo(b.nodes.get(id).x, 0);
      expect(a.nodes.get(id).y).toBeCloseTo(b.nodes.get(id).y, 0);
    }

    // Overall size, which the previous scale-invariant metric could not see.
    expect(a.viewBox).not.toBeNull();
    expect(b.viewBox).not.toBeNull();
    expect(a.viewBox[2]).toBeCloseTo(b.viewBox[2], -0.5); // width within ~1px
    expect(a.viewBox[3]).toBeCloseTo(b.viewBox[3], -0.5); // height within ~1px
  }, 60000);
});
