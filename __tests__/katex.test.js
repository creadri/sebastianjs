import { render, dispose, defaultFontRegistry } from '../src/index.js';
import { createDefaultRegistry } from '../src/geometry/fonts.js';
import * as fontkit from 'fontkit';

afterAll(async () => { await dispose(); });

const MATH = 'graph LR\n  A["$$x^2+y^2=z^2$$"] --> B["plain"]\n';

/** The text of every run in a formula, in the order it was placed. */
const textOf = (svg) =>
  [...svg.matchAll(/<g class="katex"[^>]*>([\s\S]*?)<\/g>/g)].flatMap((group) =>
    [...group[1].matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => m[1])
  );

describe('KaTeX math labels', () => {
  // jsdom has no window.MathMLElement, so mermaid's own support check fails and
  // it replaces every formula with this sentence unless forceLegacyMathML is on.
  it('renders the formula rather than mermaid\'s unsupported-environment notice', async () => {
    const svg = await render(MATH);
    expect(svg).not.toContain('MathML is unsupported');
    expect(svg).toContain('katex');
  });

  // KaTeX emits the formula twice under htmlAndMathml: a <math> copy for screen
  // readers, hidden by katex.css, and the visual one. Measuring both sized the
  // label for two formulas and drew "x2+y2=z2x2+y2=z2".
  it('draws each formula once, not once per KaTeX output mode', async () => {
    const svg = await render(MATH, { portable: true });
    expect(textOf(svg).join('')).toBe('x2+y2=z2');
  });

  // Without katex.css the formula is measured in the diagram's body font at the
  // body size, which is neither the right family nor the right size.
  it('measures the formula in the bundled KaTeX faces', async () => {
    const svg = await render(MATH, { portable: true });
    const group = svg.match(/<g class="katex"[^>]*>[\s\S]*?<\/g>/)[0];
    expect(group).toContain('KaTeX_Math');
    expect(group).toContain('KaTeX_Main');
    // .katex sets font-size: 1.21em, so 16px of body text is 19.36px of math.
    expect(group).toContain('19.36px');
  });

  // The whole point of reading KaTeX's box tree rather than its glyph order:
  // an exponent belongs above the baseline and smaller, not beside its base.
  it('raises and shrinks a superscript instead of setting it on the baseline', async () => {
    const svg = await render(MATH, { portable: true });
    const runs = [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => ({
      text: m[1],
      y: Number(m[0].match(/y="([^"]+)"/)[1]),
      size: Number(m[0].match(/font-size="([\d.]+)px"/)[1]),
    }));
    const base = runs.find((r) => r.text === 'x');
    const exponent = runs.find((r) => r.text === '2');
    expect(exponent.y).toBeLessThan(base.y);
    expect(exponent.size).toBeCloseTo(base.size * 0.7, 3);
  });

  // A fraction is a stack with a rule between its rows, and the rule is drawn
  // geometry rather than a glyph.
  it('draws a fraction as two stacked rows separated by a bar', async () => {
    const svg = await render('graph LR\n  A["$$\\frac{a}{b}$$"]\n', { portable: true });
    const runs = [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => ({
      text: m[1],
      y: Number(m[0].match(/y="([^"]+)"/)[1]),
    }));
    const numerator = runs.find((r) => r.text === 'a');
    const denominator = runs.find((r) => r.text === 'b');
    expect(numerator.y).toBeLessThan(denominator.y);

    // A <path>, not a <rect>: `.node rect` would repaint it as the node's fill.
    const bar = svg.match(/<path[^>]*d="M[^"]*"[^>]*>/g).filter((p) => p.includes('fill:'));
    expect(bar.length).toBeGreaterThan(0);
  });

  // Rows of a stack are aligned by an inherited text-align: a denominator is
  // centred under its numerator, but a superscript stays against the left.
  it('centres the rows of a fraction and left-aligns a superscript', async () => {
    const svg = await render('graph LR\n  A["$$\\frac{a+b}{c}$$"]\n', { portable: true });
    const runs = [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => ({
      text: m[1],
      x: Number(m[0].match(/x="([^"]+)"/)[1]),
    }));
    const bar = svg.match(/<path[^>]*d="M([\d.-]+),[\d.-]+h([\d.-]+)/);
    const barLeft = Number(bar[1]);
    const barRight = barLeft + Number(bar[2]);

    // The denominator is a single glyph under a three-glyph numerator, so
    // centring is the whole difference between right and visibly wrong.
    const denominator = runs.find((r) => r.text === 'c');
    const slack = (barRight - barLeft) - 1;
    expect(denominator.x).toBeGreaterThan(barLeft + slack * 0.25);
    expect(denominator.x).toBeLessThan(barRight - slack * 0.25);
  });

  // resvg resolves one font per <text>, so a formula sharing a single element
  // across KaTeX_Math letters and KaTeX_Main operators rasterizes in one
  // substituted face. Each run has to stand alone.
  it('gives every run its own <text> so a mixed-font formula rasterizes', async () => {
    const svg = await render(MATH, { portable: true });
    const group = svg.match(/<g class="katex"[^>]*>[\s\S]*?<\/g>/)[0];
    expect(group).not.toContain('<tspan');
    const families = [...group.matchAll(/<text\b[^>]*>/g)].map(
      (m) => m[0].match(/font-family="([^"]+)"/)?.[1]
    );
    expect(families.length).toBeGreaterThan(1);
    expect(families.every((f) => f && !f.includes(','))).toBe(false);
    for (const family of families) expect(family).toBeTruthy();
  });

  it('resolves every KaTeX family the stylesheet names', async () => {
    const registry = createDefaultRegistry();
    for (const [family, weight, italic, expected] of [
      ['KaTeX_Main', 400, false, 'KaTeX_Main-Regular'],
      ['KaTeX_Main', 700, false, 'KaTeX_Main-Bold'],
      ['KaTeX_Math', 400, true, 'KaTeX_Math-Italic'],
      ['KaTeX_Size2', 400, false, 'KaTeX_Size2-Regular'],
      ['KaTeX_AMS', 400, false, 'KaTeX_AMS-Regular'],
    ]) {
      expect(registry.resolve(family, weight, italic)?.postscriptName).toBe(expected);
    }
  });

  // KaTeX ships every TTF flagged Regular/upright/non-bold, which a browser
  // never consults because @font-face states the style. A rasterizer has only
  // these bits, so scripts/vendor-katex-css.mjs rewrites them on vendoring.
  it('ships KaTeX faces whose style bits match their filenames', async () => {
    const registry = await defaultFontRegistry();
    const files = registry.fontFiles().filter((f) => f.includes('KaTeX'));
    expect(files.length).toBe(20);
    for (const file of files) {
      const style = file.replace(/\.ttf$/i, '').split('-').pop();
      const flags = fontkit.openSync(file)['OS/2'].fsSelection;
      expect({ file, italic: flags.italic, bold: flags.bold }).toEqual({
        file,
        italic: /italic/i.test(style),
        bold: /bold/i.test(style),
      });
    }
  });
});
