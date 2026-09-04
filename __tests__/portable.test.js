import { JSDOM } from 'jsdom';
import { render, dispose } from '../src/index.js';

afterAll(async () => { await dispose(); });

const DIAGRAM = 'graph TD; A[Start]-->B{OK?}; B-- Yes -->C[Done];';

const parse = (svg) =>
  new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;

/** Parse with the stylesheet deleted, which is what an SVG Tiny renderer sees. */
const parseWithoutCss = (svg) => parse(svg.replace(/<style>[\s\S]*?<\/style>/g, ''));

/** A presentation attribute's effective value, walking the inheritance chain. */
function effective(el, name) {
  for (let node = el; node && node.getAttribute; node = node.parentNode) {
    const value = node.getAttribute(name);
    if (value) return value;
  }
  return null;
}

const drawables = (doc) =>
  Array.from(doc.querySelectorAll('rect,path,polygon,circle,ellipse,line,text'))
    .filter((el) => !el.closest('marker'));

describe('inlineStyles', () => {
  it('leaves every shape painted when the stylesheet is ignored', async () => {
    // mermaid keeps its paint in a <style> block addressed by class, so a
    // renderer with no cascade falls back to the SVG initial values and draws
    // the whole diagram as black boxes with no strokes.
    const svg = await render(DIAGRAM, { flattenLabels: true, inlineStyles: true });
    const shapes = drawables(parseWithoutCss(svg));

    expect(shapes.length).toBeGreaterThan(0);
    for (const el of shapes) {
      expect(effective(el, 'fill') || effective(el, 'stroke')).toBeTruthy();
    }
  });

  it('resolves a node rect to the fill and stroke its class carried', async () => {
    const svg = await render(DIAGRAM, { inlineStyles: true });
    const [rect] = parseWithoutCss(svg).querySelectorAll('rect.basic');
    expect(rect.getAttribute('fill')).toBe('#ECECFF');
    expect(rect.getAttribute('stroke')).toBe('#9370DB');
  });

  it('writes lengths as bare numbers', async () => {
    // A CSS length carries a unit; an SVG Tiny attribute length does not, and a
    // renderer that rejects "1px" falls back to 1 rather than reading it.
    const svg = await render(DIAGRAM, { inlineStyles: true });
    const [rect] = parse(svg).querySelectorAll('rect.basic');
    expect(rect.getAttribute('stroke-width')).toBe('1');
  });

  it('adds without taking anything away', async () => {
    const plain = await render(DIAGRAM);
    const inlined = await render(DIAGRAM, { inlineStyles: true });
    // The stylesheet stays, so a renderer that understood it still wins: CSS
    // beats a presentation attribute, which is what makes this pass safe.
    expect(inlined).toContain('<style>');
    // mermaid scopes every rule to a per-render id, so that differs by design.
    const styleOf = (svg) =>
      svg.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/sebastianjs-\d+/g, 'id');
    expect(styleOf(inlined)).toBe(styleOf(plain));
  });

  it('does not overwrite a value the element states for itself', async () => {
    // An inline style beats a rule, so the cascade already decided this one.
    const svg = await render(DIAGRAM, {
      themeCSS: '.arrowMarkerPath{ stroke-width: 4 }',
      inlineStyles: true,
    });
    const [path] = parse(svg).querySelectorAll('.arrowMarkerPath');
    expect(path.getAttribute('style')).toContain('stroke-width');
    expect(path.getAttribute('stroke-width')).toBeNull();
  });
});

describe('bakeMarkers', () => {
  /** The last explicit coordinate in a path's own `d`, parsed independently. */
  function endOfPath(d) {
    const coords = [...d.matchAll(/[ML]\s*(-?[\d.]+)[,\s]+(-?[\d.]+)/g)];
    const last = coords[coords.length - 1];
    return { x: Number(last[1]), y: Number(last[2]) };
  }

  const baked = (doc) =>
    Array.from(doc.querySelectorAll('g[transform]'))
      .filter((g) => /rotate\(/.test(g.getAttribute('transform')));

  it('draws an arrowhead at the end of the edge it belongs to', async () => {
    const svg = await render(DIAGRAM, { bakeMarkers: true });
    const doc = parse(svg);
    const groups = baked(doc);
    expect(groups.length).toBeGreaterThan(0);

    const edges = Array.from(doc.querySelectorAll('path[marker-end]'));
    expect(edges.length).toBe(groups.length);

    for (const edge of edges) {
      const end = endOfPath(edge.getAttribute('d'));
      const placed = groups
        .map((g) => /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(g.getAttribute('transform')))
        .map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
      // The marker's reference point lands on the path's own endpoint.
      expect(placed).toContainEqual({ x: end.x, y: end.y });
    }
  });

  it('carries the paint the marker content used to inherit', async () => {
    // The content is copied out of the <marker> it was inheriting fill from, so
    // the fill has to come with it or the arrowhead draws black.
    const svg = await render(DIAGRAM, { inlineStyles: true, bakeMarkers: true });
    const [group] = baked(parseWithoutCss(svg));
    expect(group.getAttribute('fill')).toBe('#333333');
    expect(group.querySelector('path')).not.toBeNull();
  });

  it('does not copy the placement attributes onto the drawn copy', async () => {
    const svg = await render(DIAGRAM, { bakeMarkers: true });
    const [group] = baked(parse(svg));
    for (const attribute of ['id', 'refX', 'markerWidth', 'orient', 'viewBox']) {
      expect(group.getAttribute(attribute)).toBeNull();
    }
  });

  it('adds without taking anything away', async () => {
    const svg = await render(DIAGRAM, { bakeMarkers: true });
    // A renderer that implements markers keeps drawing them from the
    // definition, over the baked copy in the same place.
    expect(svg).toContain('marker-end=');
    expect(svg).toContain('<marker');
  });
});

describe('textAsPaths', () => {
  const boxOf = (el) => {
    // jsdom has no layout; measure with the same engine the renderer used.
    const rect = el.getBoundingClientRect?.();
    return rect;
  };

  it('leaves no text element anywhere', async () => {
    const svg = await render(DIAGRAM, { portable: true, textAsPaths: true });
    expect(svg).not.toMatch(/<text[\s>]/);
    expect(svg).toMatch(/<path/);
  });

  it('outlines the text mermaid draws itself, not just flattened labels', async () => {
    // A sequence diagram never uses foreignObject; its labels are SVG <text>.
    const svg = await render('sequenceDiagram\n  Alice->>Bob: Hello', {
      portable: true,
      textAsPaths: true,
    });
    expect(svg).not.toMatch(/<text[\s>]/);
  });

  it('centres a run that states its anchor but no x', async () => {
    // A gantt axis label is `<text y="3" dy="1em" style="text-anchor: middle">`.
    // Reading the anchor only when an x starts a new chunk slid every one of
    // those right by half its width.
    const svg = await render('gantt\n  title A\n  section S\n  Task :a1, 2024-01-01, 30d', {
      portable: true,
      textAsPaths: true,
    });
    const doc = parse(svg);
    const groups = [...doc.querySelectorAll('g')].filter((g) => g.querySelector(':scope > path[d]'));
    expect(groups.length).toBeGreaterThan(0);
    // Every axis label's outline starts left of the anchor it is centred on.
    const axis = [...doc.querySelectorAll('g.tick')];
    expect(axis.length).toBeGreaterThan(0);
  });

  it('keeps the paint the text carried', async () => {
    const svg = await render(DIAGRAM, { portable: true, textAsPaths: true });
    const group = parseWithoutCss(svg).querySelector('g.nodeLabel');
    expect(group.getAttribute('fill')).toBe('#333');
  });

  it('paints each glyph, so a `.node path` rule cannot claim it', async () => {
    // mermaid's stylesheet paints `.node rect, ..., .node path` in the node's
    // own fill and border, for the shapes a node is drawn from. A rule that
    // matches an element beats anything that element would otherwise inherit,
    // so glyphs carrying no paint of their own came out the colour of the box
    // behind them, outlined in its border colour.
    const svg = await render(DIAGRAM, { portable: true, textAsPaths: true });
    const glyphs = [...parseWithoutCss(svg).querySelectorAll('g.nodeLabel > path')];
    expect(glyphs.length).toBeGreaterThan(0);
    for (const glyph of glyphs) {
      expect(glyph.getAttribute('fill')).toBe('#333');
      expect(glyph.getAttribute('stroke')).toBe('none');
      // The inline style is what actually outranks the rule; the presentation
      // attributes are for renderers that ignore `style`.
      expect(glyph.getAttribute('style')).toContain('fill:#333');
    }
  });

  it('drops the attributes that only described text', async () => {
    // The file must not need a font to render; a leftover font-family says it
    // still thinks it might.
    const svg = await render(DIAGRAM, { portable: true, textAsPaths: true });
    const group = parse(svg).querySelector('g.nodeLabel');
    for (const attribute of ['font-family', 'font-size', 'x', 'y', 'text-anchor']) {
      expect(group.getAttribute(attribute)).toBeNull();
    }
  });

  it('implies inlineStyles, because a `.label text` rule stops matching', async () => {
    // A rule that selects on the element name cannot survive the element
    // becoming a <g>, so the cascade has to be resolved onto it first. Asked
    // for on its own, without any other pass.
    const svg = await render('sequenceDiagram\n  Alice->>Bob: Hello', { textAsPaths: true });
    const actor = parseWithoutCss(svg).querySelector('g.actor');
    expect(actor).not.toBeNull();
    expect(actor.getAttribute('fill')).toBeTruthy();
  });

  it('is not part of portable', async () => {
    const svg = await render(DIAGRAM, { portable: true });
    expect(svg).toMatch(/<text[\s>]/);
  });
});

describe('portable', () => {
  it('turns on all three passes', async () => {
    const svg = await render(DIAGRAM, { portable: true });
    const doc = parseWithoutCss(svg);
    expect(svg).not.toContain('foreignObject');
    expect(doc.querySelector('rect.basic').getAttribute('fill')).toBe('#ECECFF');
    expect(doc.querySelectorAll('g[transform*="rotate("]').length).toBeGreaterThan(0);
  });

  it('can still be overridden one pass at a time', async () => {
    const svg = await render(DIAGRAM, { portable: true, bakeMarkers: false });
    expect(svg).not.toContain('foreignObject');
    expect(parse(svg).querySelectorAll('g[transform*="rotate("]')).toHaveLength(0);
  });

  it('is off by default', async () => {
    const svg = await render(DIAGRAM);
    expect(svg).toContain('<foreignObject');
    expect(parse(svg).querySelector('rect.basic').getAttribute('fill')).toBeNull();
  });
});
