import { JSDOM } from 'jsdom';
import { render, dispose } from '../src/index.js';

afterAll(async () => { await dispose(); });

const { DOMParser } = new JSDOM().window;

/** Parse as XML, which is what a non-browser rasterizer does. */
function parseXml(svg) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const error = doc.getElementsByTagName('parsererror')[0];
  if (error) throw new Error(error.textContent);
  return doc;
}

const texts = (doc) => Array.from(doc.getElementsByTagName('text'));
const lines = (text) => Array.from(text.getElementsByTagName('tspan'))
  .filter((t) => t.hasAttribute('y'));

// Everything that positions the diagram, as opposed to what fills the labels.
const skeleton = (svg) => [
  ...(svg.match(/transform="[^"]*"/g) || []),
  ...(svg.match(/viewBox="[^"]*"/g) || []),
].join('\n');

describe('flattenLabels', () => {
  it('leaves no foreignObject behind', async () => {
    const svg = await render('graph TD; A[Hello]-->B[World];', { flattenLabels: true });
    expect(svg).not.toContain('foreignObject');
    expect(svg).toContain('Hello');
    expect(svg).toContain('World');
  });

  it('emits XML a non-browser parser accepts', async () => {
    // The point of the whole exercise: librsvg and resvg parse strictly, and
    // never see a label that stays inside a <foreignObject>.
    const svg = await render(
      'graph TD; A["a &nbsp; b<br/>second line"]-->B;',
      { flattenLabels: true }
    );
    const doc = parseXml(svg);
    expect(doc.getElementsByTagName('foreignObject')).toHaveLength(0);
    expect(texts(doc).length).toBeGreaterThan(0);
  });

  // The reason to flatten rather than fall back to mermaid's htmlLabels:false,
  // which measures a different label and moves every node in the diagram.
  it('does not move anything in the diagram', async () => {
    const def = 'graph TD; A[A label long enough to wrap onto two lines]-->B{Decision};';
    const html = await render(def);
    const flat = await render(def, { flattenLabels: true });
    expect(skeleton(flat)).toBe(skeleton(html));
  });

  it('puts each line box on its own baseline', async () => {
    const svg = await render('graph TD; A["line one<br/>line two"];', { flattenLabels: true });
    const [label] = texts(parseXml(svg));
    const [first, second] = lines(label);
    // line-height 1.5 at 16px is 24px; Open Sans has a 17px ascent and a 5px
    // descent there, so half-leading puts the baseline at (24 - 22) / 2 + 17.
    expect(Number(first.getAttribute('y'))).toBeCloseTo(18, 4);
    expect(Number(second.getAttribute('y'))).toBeCloseTo(42, 4);
    expect(first.getAttribute('x')).toBe(second.getAttribute('x'));
    expect(first.textContent).toBe('line one');
    expect(second.textContent).toBe('line two');
  });

  it('breaks a wrapped label at the same points it was measured at', async () => {
    const svg = await render(
      'graph TD; A[A quite long node label that has to wrap onto several lines];',
      { flattenLabels: true }
    );
    const [label] = texts(parseXml(svg));
    const rendered = lines(label);
    expect(rendered.length).toBeGreaterThan(1);
    // No line may be wider than the box the diagram was laid out against.
    expect(rendered.map((l) => l.textContent).join(' '))
      .toBe('A quite long node label that has to wrap onto several lines');
  });

  it('keeps markdown emphasis as styled text, not as literal markup', async () => {
    const svg = await render('graph TD; A["plain **bold** and *italic*"];', { flattenLabels: true });
    const [label] = texts(parseXml(svg));
    const runs = Array.from(label.getElementsByTagName('tspan'))
      .filter((t) => !t.hasAttribute('y'));
    expect(runs.find((r) => r.textContent === 'bold')?.getAttribute('font-weight')).toBe('700');
    expect(runs.find((r) => r.textContent === 'italic')?.getAttribute('font-style')).toBe('italic');
    // The spaces between runs sit on a <tspan> boundary, where SVG's default
    // whitespace handling would drop them and give "plainbold anditalic".
    expect(label.textContent).toBe('plain bold and italic');
  });

  it('keeps raw HTML in a label as real markup', async () => {
    // mermaid's own <text> path renders these tags as visible characters.
    const svg = await render('graph TD; A["one <b>two</b>"];', { flattenLabels: true });
    const [label] = texts(parseXml(svg));
    expect(label.textContent).toBe('one two');
    expect(label.textContent).not.toContain('<b>');
  });

  it('paints the plate an edge label sits on', async () => {
    // The HTML background-color has no equivalent on <text>, so without a rect
    // the label would sit directly on the edge it labels.
    const svg = await render('graph TD; A-- Yes -->B;', { flattenLabels: true });
    const doc = parseXml(svg);
    const [edge] = Array.from(doc.getElementsByTagName('g'))
      .filter((g) => g.getAttribute('class') === 'edgeLabel');
    const plates = Array.from(edge.getElementsByTagName('rect'))
      .filter((r) => /fill:/.test(r.getAttribute('style') || ''));
    expect(plates.length).toBeGreaterThan(0);
    expect(Number(plates[0].getAttribute('height'))).toBeGreaterThan(0);
  });

  // A 16x16 PNG, so the intrinsic size is known without touching the network.
  const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAF0lE' +
    'QVR42mP8z8BQz0AEYBxVSF+FAAsJA1H2H5J9AAAAAElFTkSuQmCC';

  const images = (doc) => Array.from(doc.getElementsByTagName('image'));

  it('turns an image label into an <image>', async () => {
    const svg = await render(`graph TD; A["<img src='${PNG}' />"];`, { flattenLabels: true });
    const doc = parseXml(svg);
    expect(doc.getElementsByTagName('foreignObject')).toHaveLength(0);
    const [image] = images(doc);
    // mermaid pins an image-only label to fontSize * 5 and the label box is
    // sized from it, so the image fills the box it was measured into.
    expect(image.getAttribute('href')).toBe(PNG);
    expect(Number(image.getAttribute('width'))).toBe(80);
    expect(Number(image.getAttribute('height'))).toBe(80);
    expect(Number(image.getAttribute('x'))).toBeCloseTo(0, 4);
    expect(Number(image.getAttribute('y'))).toBeCloseTo(0, 4);
  });

  it('sits an image on the baseline of the text beside it', async () => {
    const svg = await render(`graph TD; A["<img src='${PNG}' /> caption"];`, { flattenLabels: true });
    const doc = parseXml(svg);
    const [image] = images(doc);
    const [line] = lines(texts(doc)[0]);
    // Default vertical-align is baseline, so the box's bottom edge meets it:
    // a 16px image on an 18px baseline starts at y = 2.
    expect(Number(image.getAttribute('height'))).toBe(16);
    expect(Number(image.getAttribute('y'))).toBeCloseTo(2, 4);
    expect(Number(line.getAttribute('y'))).toBeCloseTo(18, 4);
    // The text resumes where the image ends, and is pinned rather than anchored
    // so the two cannot drift apart.
    expect(Number(line.getAttribute('x')))
      .toBeCloseTo(Number(image.getAttribute('x')) + 16, 4);
    expect(line.getAttribute('style')).toContain('text-anchor:start');
  });

  it('honours vertical-align on a replaced box', async () => {
    // The form mermaid's own `.label-icon` rule uses. A negative length lowers
    // the box: at 16px, -0.125em is 2px below the baseline.
    const svg = await render(
      `graph TD; A["before <img src='${PNG}' style='vertical-align:-0.125em' /> after"];`,
      { flattenLabels: true }
    );
    const [image] = images(parseXml(svg));
    expect(Number(image.getAttribute('y'))).toBeCloseTo(4, 4);
  });

  it('keeps the HTML label when a box has no size to draw', async () => {
    // An image that cannot be resolved measures 0x0. Emitting nothing for it
    // would silently drop the label; leaving it as HTML at least still renders
    // in a browser.
    const svg = await render(
      'graph TD; A["<img src=\'/nonexistent/missing.png\' /> caption"] --> B[plain];',
      { flattenLabels: true }
    );
    expect(svg).toContain('<foreignObject');
    expect(svg).toContain('<img');
    expect(texts(parseXml(svg)).map((t) => t.textContent)).toContain('plain');
  });

  it('is off by default', async () => {
    const svg = await render('graph TD; A[Hello];');
    expect(svg).toContain('<foreignObject');
  });
});
