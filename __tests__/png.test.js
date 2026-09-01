import { render, renderPng, dispose } from '../src/index.js';

afterAll(async () => { await dispose(); });

const DIAGRAM = 'graph TD; A[Start]-->B{Is it OK?}; B-- Yes -->C[Done];';

const isPng = (buffer) =>
  buffer.length > 8 &&
  buffer[0] === 0x89 &&
  buffer.subarray(1, 4).toString('ascii') === 'PNG';

/** The size the diagram sized itself to, read off its own viewBox. */
function viewBoxOf(svg) {
  const [, , width, height] = svg.match(/viewBox="([^"]*)"/)[1].split(/\s+/).map(Number);
  return { width, height };
}

describe('renderPng', () => {
  it('produces a PNG at the size the diagram laid itself out to', async () => {
    const svg = await render(DIAGRAM, { flattenLabels: true });
    const box = viewBoxOf(svg);
    const png = await renderPng(DIAGRAM);

    expect(isPng(png.data)).toBe(true);
    expect(png.width).toBe(Math.round(box.width));
    expect(png.height).toBe(Math.round(box.height));
  });

  it('scales the raster without changing the layout', async () => {
    const box = viewBoxOf(await render(DIAGRAM, { flattenLabels: true }));
    const two = await renderPng(DIAGRAM, { scale: 2 });
    // Rounded from the scaled viewBox, not from the scaled pixel size: this
    // diagram is 129.297 wide, and round(2w) is 259 where 2*round(w) is 258.
    expect(two.width).toBe(Math.round(box.width * 2));
    expect(two.height).toBe(Math.round(box.height * 2));
  });

  it('rejects a scale that is not a positive number', async () => {
    await expect(renderPng(DIAGRAM, { scale: 0 })).rejects.toThrow(/positive number/);
    await expect(renderPng(DIAGRAM, { scale: -1 })).rejects.toThrow(/positive number/);
  });

  it('paints a background when asked, and nothing when not', async () => {
    const transparent = await renderPng(DIAGRAM);
    const white = await renderPng(DIAGRAM, { background: 'white' });
    expect(isPng(white.data)).toBe(true);
    expect(white.width).toBe(transparent.width);
    expect(Buffer.compare(white.data, transparent.data)).not.toBe(0);
  });

  it('flattens labels by default, because resvg has no foreignObject', async () => {
    // Left as HTML the labels would simply not be drawn, and the failure is
    // silent: a diagram of empty boxes.
    const wide = await renderPng('graph TD; A[A label long enough to be wider than the arrow];');
    const narrow = await renderPng('graph TD; A[x];');
    // The label drove the node's width, so it drove the raster's.
    expect(wide.width).toBeGreaterThan(narrow.width * 2);
  });

  it('rasterizes outlined text with no font resolution at all', async () => {
    const outlined = await renderPng(DIAGRAM, { portable: true, textAsPaths: true });
    const withFonts = await renderPng(DIAGRAM);
    expect(isPng(outlined.data)).toBe(true);
    // Same diagram, so the same raster size either way.
    expect(outlined.width).toBe(withFonts.width);
    expect(outlined.height).toBe(withFonts.height);
  });

  it('renders every diagram type it is given', async () => {
    for (const def of [
      'sequenceDiagram\n  Alice->>Bob: Hello',
      'pie title Pets\n  "Dogs" : 386\n  "Cats" : 85',
      'classDiagram\n  class Animal { +int age }',
    ]) {
      const png = await renderPng(def);
      expect(isPng(png.data)).toBe(true);
      expect(png.width).toBeGreaterThan(0);
    }
  });
});
