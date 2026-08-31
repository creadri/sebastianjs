// Regression tests for the geometry engine. The reference numbers come from
// measuring the same strings in real Chromium (see scripts/compare-chrome.mjs);
// each `expect` here corresponds to a defect that produced visibly wrong layouts.
import { sebDOM } from '../src/sebdom.js';

const NS = 'http://www.w3.org/2000/svg';

let document;
beforeAll(async () => {
  ({ document } = await sebDOM({}));
});

const el = (tag, attrs = {}, parent = null, text = null) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text != null) node.textContent = text;
  if (parent) parent.appendChild(node);
  return node;
};

const svgRoot = () => {
  const svg = el('svg');
  document.body.appendChild(svg);
  return svg;
};

describe('text metrics', () => {
  // Chrome getComputedTextLength for Open Sans, measured via puppeteer.
  test.each([
    ['Hello Mermaid World', 12, 119.266],
    ['Order Processing Service', 16, 185.813],
    ['Is it OK?', 16, 59.297],
    ['Ä ö ü — ligature fi', 16, 132.453],
  ])('advance of %p at %ipx matches Chrome', (text, size, expected) => {
    const svg = svgRoot();
    const t = el('text', { 'font-family': 'Open Sans', 'font-size': size }, svg, text);
    expect(t.getComputedTextLength()).toBeCloseTo(expected, 1);
  });

  // Blink scales ascent and descent to px and rounds EACH before summing.
  // Scaling (ascent - descent) as one float instead is ~0.7px short at 12px.
  test.each([
    [12, 17],
    [16, 22],
  ])('bbox height at %ipx is Blink-exact', (size, expected) => {
    const svg = svgRoot();
    const t = el('text', { 'font-family': 'Open Sans', 'font-size': size }, svg, 'Hg');
    expect(t.getBBox().height).toBe(expected);
  });

  test('font-weight and font-style select different faces', () => {
    const svg = svgRoot();
    const attrs = { 'font-family': 'Open Sans', 'font-size': 16 };
    const regular = el('text', attrs, svg, 'Bold Test').getComputedTextLength();
    const bold = el('text', { ...attrs, 'font-weight': 'bold' }, svg, 'Bold Test').getComputedTextLength();
    const italic = el('text', { ...attrs, 'font-style': 'italic' }, svg, 'Bold Test').getComputedTextLength();
    expect(bold).toBeGreaterThan(regular);
    expect(italic).not.toBeCloseTo(regular, 2);
  });
});

describe('bbox aggregation', () => {
  test('never-rendered children are excluded from a container bbox', () => {
    // mermaid emits its arrowhead <marker>s as direct children of the root <g>;
    // counting them pinned every diagram's bbox to the origin.
    const svg = svgRoot();
    const g = el('g', {}, svg);
    const marker = el('marker', {}, g);
    el('rect', { x: 0, y: 0, width: 10, height: 10 }, marker);
    el('rect', { x: 100, y: 100, width: 50, height: 20 }, g);

    const box = g.getBBox();
    expect(box.x).toBe(100);
    expect(box.y).toBe(100);
    expect(box.width).toBe(50);
    expect(box.height).toBe(20);
  });

  test('zero-area shapes do not contribute', () => {
    const svg = svgRoot();
    const g = el('g', {}, svg);
    el('rect', {}, g); // mermaid's empty label-background rect
    el('rect', { x: 40, y: 40, width: 10, height: 10 }, g);
    expect(g.getBBox().x).toBe(40);
  });

  test('a group bbox excludes its own transform but includes children', () => {
    const svg = svgRoot();
    const g = el('g', { transform: 'translate(50,20)' }, svg);
    el('rect', { x: 0, y: 0, width: 100, height: 40 }, g);
    const box = g.getBBox();
    expect(box.x).toBe(0);
    expect(box.width).toBe(100);
    // getBoundingClientRect does apply it.
    expect(g.getBoundingClientRect().x).toBe(50);
  });
});

describe('text layout', () => {
  test('dy in em is resolved against font-size, not read as px', () => {
    // parseFloat('1.1em') === 1.1 collapses every line mermaid emits.
    const svg = svgRoot();
    const text = el('text', { 'font-family': 'Open Sans', 'font-size': 16, y: 0 }, svg);
    el('tspan', { x: 0, dy: '1.1em' }, text, 'Line');
    // baseline = 0 + 1.1*16 = 17.6; ascent at 16px is 17 -> top = 0.6
    expect(text.getBBox().y).toBeCloseTo(0.6, 2);
  });

  test('text-anchor applies once per chunk, not per tspan', () => {
    // Anchoring each run separately made multi-tspan labels mis-centred and
    // too narrow — mermaid splits long labels across tspans.
    const svg = svgRoot();
    const text = el('text', { 'font-family': 'Open Sans', 'font-size': 16, 'text-anchor': 'middle' }, svg);
    el('tspan', {}, text, 'Is it ');
    el('tspan', {}, text, 'OK?');

    const box = text.getBBox();
    expect(box.width).toBeCloseTo(59.297, 0);
    expect(box.x).toBeCloseTo(-box.width / 2, 2);
  });

  test('text-anchor is honoured when it comes from a stylesheet', () => {
    // jsdom's getComputedStyle returns "" for SVG presentation properties and
    // leaves document.styleSheets empty for <style> inside <svg>, so the cascade
    // is resolved by src/geometry/css.js.
    const svg = svgRoot();
    el('style', {}, svg).textContent = '.lbl text { text-anchor: middle; }';
    const g = el('g', { class: 'lbl' }, svg);
    const text = el('text', { 'font-family': 'Open Sans', 'font-size': 16 }, g, 'Start');

    const box = text.getBBox();
    expect(box.width).toBeCloseTo(35.609, 1);
    expect(box.x).toBeCloseTo(-box.width / 2, 2);
  });

  test('font-size is inherited from an ancestor rule', () => {
    // mermaid puts font-size on the root svg rule, above the nearest text element.
    const svg = svgRoot();
    el('style', {}, svg).textContent = '#wrap { font-size: 12px; font-family: Open Sans; }';
    const g = el('g', { id: 'wrap' }, svg);
    const text = el('text', {}, g, 'Hello Mermaid World');
    expect(text.getComputedTextLength()).toBeCloseTo(119.266, 1);
  });
});

describe('paths', () => {
  test('length and point sampling work', () => {
    const svg = svgRoot();
    const p = el('path', { d: 'M0,0 C10,50 90,50 100,0' }, svg);
    expect(p.getTotalLength()).toBeCloseTo(135.812, 1);
    expect(p.getPointAtLength(0).x).toBeCloseTo(0, 3);
    expect(p.getBBox().width).toBeCloseTo(100, 3);
  });
});

describe('html labels (foreignObject)', () => {
  // Reference values measured in Chromium via puppeteer against mermaid's own
  // label markup. See src/geometry/html.js for the model.
  const label = (inner, { wrap = false } = {}) => {
    const style = document.createElement('style');
    style.textContent = '.nodeLabel, .nodeLabel p { font-family: Open Sans; font-size: 16px; margin: 0; }';
    document.body.appendChild(style);
    const host = document.createElement('div');
    host.innerHTML = wrap
      ? `<div style="display: table; white-space: break-spaces; line-height: 1.5; max-width: 200px; text-align: center; width: 200px;"><span class="nodeLabel">${inner}</span></div>`
      : `<div style="display: table-cell; white-space: nowrap; line-height: 1.5; max-width: 200px; text-align: center;"><span class="nodeLabel">${inner}</span></div>`;
    document.body.appendChild(host);
    return host.firstChild.getBoundingClientRect();
  };

  test.each([
    ['<p>A</p>', 10.13],
    ['<p>End</p>', 28.5],
    ['<p>Short</p>', 40.45],
    ['<p>edge label</p>', 76.34],
  ])('width of %p matches Chrome', (inner, expected) => {
    expect(label(inner).width).toBeCloseTo(expected, 1);
  });

  test('UA bold applies to <b> without any stylesheet saying so', () => {
    // mermaid renders markdown emphasis as bare <b>/<i>; if the UA default is
    // missed the run measures as regular and every such label is too narrow.
    const bold = label('<p>Plain <b>bold</b> here</p>').width;
    const plain = label('<p>Plain bold here</p>').width;
    expect(bold).toBeCloseTo(114.09, 1);
    expect(bold).toBeGreaterThan(plain);
  });

  test('line-height 1.5 at 16px is exactly 24px per line', () => {
    expect(label('<p>One</p>').height).toBe(24);
    expect(label('<p>First line<br>Second line</p>').height).toBe(48);
  });

  test('nowrap clamps to max-width so mermaid re-measures', () => {
    // mermaid switches to wrapping mode when the measured width equals the
    // max-width it asked for, so the clamp has to be reported exactly.
    const long = 'This is a deliberately long node label that mermaid should wrap onto several lines';
    expect(label(`<p>${long}</p>`).width).toBe(200);
  });

  test('wrapping mode lays out at the given width', () => {
    const long = 'This is a deliberately long node label that mermaid should wrap onto several lines';
    const r = label(`<p>${long}</p>`, { wrap: true });
    expect(r.width).toBe(200);
    expect(r.height).toBe(96); // Chrome: 4 lines x 24
  });
});
