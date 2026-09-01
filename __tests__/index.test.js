import { render, dispose } from '../src/index.js';

afterAll(async () => { await dispose(); });

describe('SebastianJS', () => {
  it('should render a basic flowchart', async () => {
    const svg = await render('graph TD; A-->B;');
    expect(svg).toContain('<svg');
    expect(svg).toContain('A');
    expect(svg).toContain('B');
  });

  // mermaid is a module singleton bound to the window it first saw. Creating a
  // fresh jsdom per render left it pointing at a closed window and every render
  // after the first returned ''. Separately, the stylesheet cache was keyed on
  // text length, and mermaid's per-render rules (#sebastianjs-1, -2, ...) are
  // the same length — so render 2 reused rules matching nothing and measured
  // every label unstyled.
  it('produces identical output when the same diagram is rendered repeatedly', async () => {
    const def = 'graph TD; A["First line<br/>Second line"] --> B[Short];';
    const first = await render(def);
    expect(first.length).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) {
      const again = await render(def);
      expect(again).toHaveLength(first.length);
      expect(viewBoxOf(again)).toEqual(viewBoxOf(first));
    }
  });

  it('renders correctly when calls overlap', async () => {
    const a = 'graph TD; A["First line<br/>Second line"] --> B[Short];';
    const b = 'graph TD; X-->Y;';
    const [r1, r2, r3] = await Promise.all([render(a), render(b), render(a)]);
    expect(viewBoxOf(r1)).toEqual(viewBoxOf(r3));
    expect(viewBoxOf(r2)).not.toEqual(viewBoxOf(r1));
    for (const svg of [r1, r2, r3]) expect(svg).toContain('<svg');
  });

  it('applies themes', async () => {
    const plain = await render('graph TD; A-->B;');
    const dark = await render('graph TD; A-->B;', { theme: 'dark' });
    expect(dark).not.toEqual(plain);
  });

  it('keeps multi-line labels intact', async () => {
    const svg = await render('graph TD; A["First line<br/>Second line"] --> B[Short];');
    expect(svg).toContain('First');
    expect(svg).toContain('Second');
  });

  it('renders a mindmap, whose layout runs through cytoscape', async () => {
    // cytoscape sizes its layout container as
    // `clientWidth - parseFloat(computed padding-left) - ...`, and jsdom leaves
    // computed padding empty. The NaN that produced made the layout's bounding
    // box undefined and threw before a single node was placed, so every mindmap
    // failed outright rather than rendering badly.
    const svg = await render('mindmap\n  root\n    child1\n    child2\n');
    expect(svg).toContain('aria-roledescription="mindmap"');
    expect(svg.match(/class="mindmap-node/g)).toHaveLength(4); // root + 2 + the group
  });
});

function viewBoxOf(svg) {
  return (svg.match(/viewBox="([^"]*)"/) || [])[1] ?? null;
}
