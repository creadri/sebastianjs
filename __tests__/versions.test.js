import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));

const pkg = read('package.json');

// Parity is measured against mermaid-cli's Chrome output, so both sides have to
// run the same mermaid build. These are offline structural checks; the network
// check that the pin still matches mermaid-cli's own lockfile lives in
// `npm run check:mermaid`.
describe('mermaid version parity', () => {
  it('pins mermaid to an exact version', () => {
    // A range here silently puts a different mermaid on our side than the one
    // mmdc renders with. mermaid 11.17 replacing its style construction with
    // `new CSSStyleSheet()` reached users that way, past a green suite.
    expect(pkg.dependencies.mermaid).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('resolves the mermaid version it declares', () => {
    const installed = read('node_modules/mermaid/package.json').version;
    expect(installed).toBe(pkg.dependencies.mermaid);
  });

  it('renders with the same mermaid that mermaid-cli renders with', () => {
    // mermaid-cli must resolve the hoisted copy rather than nesting its own,
    // otherwise the comparison test comes from two different mermaid builds.
    let nested = null;
    try {
      nested = read('node_modules/@mermaid-js/mermaid-cli/node_modules/mermaid/package.json').version;
    } catch { /* hoisted, which is what we want */ }
    expect(nested).toBeNull();
  });

  it('draws its sample corpus from the pinned mermaid tag', () => {
    const manifest = read('samples/mermaid-demos/manifest.json');
    expect(manifest.mermaidVersion).toBe(pkg.dependencies.mermaid);
    expect(manifest.samples.length).toBeGreaterThan(0);
  });

  it('constrains every runtime dependency to a major', () => {
    // Open-ended ">=" ranges let a fresh install float onto an untested major.
    for (const [name, range] of Object.entries(pkg.dependencies)) {
      expect(`${name}@${range}`).toMatch(/@(\^|~)?\d+\.\d+\.\d+$/);
    }
  });
});
