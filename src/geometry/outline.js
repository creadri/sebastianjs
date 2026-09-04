// Replace SVG <text> with the glyph outlines it stands for.
//
// The last thing a rendered diagram asks of its renderer is a font. `<text
// font-family="Open Sans">` only draws if the renderer can find Open Sans, and
// nothing is embedded in the SVG — a rasterizer without it substitutes a face
// with different metrics and the glyphs stop fitting the boxes they were
// measured into.
//
// Outlines remove the question. Every run becomes a <path>, drawn from the very
// font file fontkit measured it with, so the file renders identically anywhere
// and needs no font at all. The cost is size, and text that can no longer be
// selected or searched — which is why this is the tier above `portable` rather
// than part of it.
//
// Unlike inline.js and markers.js this pass REPLACES: text drawn twice, once as
// glyphs and once as text, is text drawn twice.
import { FONT_REGISTRY, getFontDetails, collapseWhitespace } from './bbox.js';
import { alphabeticBaselineAt } from './text.js';
import { resolveLength } from './units.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

/** Copied from a run's own element onto the path it becomes. */
const RUN_PAINT = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity',
];

/**
 * The paint that reaches a glyph by inheritance, and so has to be restated on
 * it. `opacity` is deliberately absent: it is not inherited, it is already on
 * the group, and applying it again per glyph would square it.
 */
const INHERITED_PAINT = RUN_PAINT.filter((property) => property !== 'opacity');

/** Attributes that described the text, and mean nothing on a group of paths. */
const TEXT_OWN = new Set([
  'x', 'y', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust',
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch',
  'letter-spacing', 'word-spacing', 'text-anchor', 'dominant-baseline',
  'alignment-baseline', 'baseline-shift', 'xml:space', 'white-space',
]);

/**
 * Convert every <text> under `root` into <path> outlines.
 *
 * Run it after inline.js: a rule like `.label text { fill: #333 }` selects on
 * the element name, so it stops matching the moment the <text> becomes a <g>.
 * Once the cascade is on the element, replacing it keeps its paint.
 *
 * @param {Element} root  an <svg> element
 * @returns {{converted: number, skipped: number, glyphs: number}}
 */
export function outlineText(root) {
  const stats = { converted: 0, skipped: 0, glyphs: 0 };

  for (const text of textElements(root)) {
    const runs = layOut(text);
    if (!runs) {
      // Something in this element is not modelled here; leaving it as <text>
      // renders it wrong nowhere, where guessing would render it wrong here.
      stats.skipped++;
      continue;
    }
    if (!runs.length) {
      text.remove();
      continue;
    }

    const group = draw(text, runs);
    text.parentNode.replaceChild(group, text);
    stats.converted++;
    stats.glyphs += runs.reduce((n, run) => n + run.glyphs.length, 0);
  }

  return stats;
}

/** Outermost <text> elements; a nested one is laid out as part of its parent. */
function textElements(root) {
  const found = [];
  const walk = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== 1 || child.namespaceURI !== SVG_NS) continue;
      if (child.localName === 'text') found.push(child);
      else walk(child);
    }
  };
  walk(root);
  return found;
}

/**
 * Place every glyph of a text element.
 *
 * @returns {Array<{glyphs: Array, el: Element}>|null} null when the element
 *          uses something this does not model, and must be left alone.
 */
function layOut(text) {
  const registry = text.ownerDocument?.[FONT_REGISTRY];
  if (!registry) return null;

  // xml:space="preserve" is what flatten.js writes, precisely because the text
  // it emits was measured with its spaces intact.
  const preserve = preservesSpace(text);
  const collapsed = preserve ? null : collapseWhitespace(text);

  const runs = [];
  const pen = { x: 0, y: 0 };
  // A chunk is a stretch of text sharing one anchor: an absolute x starts a new
  // one. text-anchor shifts the whole chunk once, so the shift is only known
  // when the chunk ends.
  let chunk = null;
  const chunks = [];

  const openChunk = (anchor) => {
    chunk = { anchor, start: pen.x, glyphs: [] };
    chunks.push(chunk);
  };
  // The first chunk takes the text element's own anchor. mermaid centres plenty
  // of runs that carry no x at all — a gantt axis label is
  // `<text y="3" dy="1em" style="text-anchor: middle">` — and defaulting to
  // `start` slid every one of those by half its width.
  openChunk(getFontDetails(text).textAnchor);

  let failed = false;

  const visit = (node) => {
    if (failed) return;

    if (node.nodeType === 1) {
      const details = getFontDetails(node);
      const fontSize = parseFloat(details.fontSize) || 16;

      const x = single(node, 'x', fontSize);
      const y = single(node, 'y', fontSize);
      const dx = single(node, 'dx', fontSize);
      const dy = single(node, 'dy', fontSize);
      // A per-glyph position list, or a rotation, would place characters
      // individually. mermaid emits neither.
      if (x === false || y === false || dx === false || dy === false || node.getAttribute('rotate')) {
        failed = true;
        return;
      }

      if (x !== null) {
        pen.x = x;
        openChunk(details.textAnchor);
      }
      if (y !== null) pen.y = y;
      if (dx !== null) pen.x += dx;
      if (dy !== null) pen.y += dy;

      for (const child of Array.from(node.childNodes)) visit(child);
      return;
    }

    if (node.nodeType !== 3) return;
    const data = preserve ? node.data : collapsed.get(node) ?? '';
    if (!data) return;

    const details = getFontDetails(node);
    const font = registry.resolve(details.fontFamily, details.fontWeight, details.fontStyle);
    if (!font) {
      failed = true;
      return;
    }

    const fontSize = parseFloat(details.fontSize) || 16;
    const scale = fontSize / font.unitsPerEm;
    const spacing = parseFloat(details.letterSpacing) || 0;
    const baseline = alphabeticBaselineAt(pen.y, font, fontSize, details.dominantBaseline);

    const placed = [];
    for (const glyph of font.layout(data).glyphs) {
      placed.push({ glyph, x: pen.x, y: baseline, scale });
      pen.x += glyph.advanceWidth * scale + spacing;
    }
    // letter-spacing sits between glyphs, not after the last one.
    if (placed.length) pen.x -= spacing;

    if (placed.length) {
      chunk.glyphs.push(...placed);
      runs.push({ glyphs: placed, el: node.parentNode });
    }
  };

  visit(text);
  if (failed) return null;

  // Now that each chunk's width is known, shift it to its anchor.
  for (const entry of chunks) {
    if (!entry.glyphs.length) continue;
    const last = entry.glyphs[entry.glyphs.length - 1];
    const width = last.x + last.glyph.advanceWidth * last.scale - entry.start;
    const shift =
      entry.anchor === 'middle' ? -width / 2 : entry.anchor === 'end' ? -width : 0;
    if (shift) for (const placed of entry.glyphs) placed.x += shift;
  }

  return runs;
}

/** The <g> of <path>s that replaces the text element. */
function draw(text, runs) {
  const document = text.ownerDocument;
  const group = document.createElementNS(SVG_NS, 'g');

  for (const attribute of Array.from(text.attributes)) {
    if (TEXT_OWN.has(attribute.name)) continue;
    group.setAttribute(attribute.name, attribute.value);
  }

  for (const run of runs) {
    const d = run.glyphs
      .map(({ glyph, x, y, scale }) => glyph.path.transform(scale, 0, 0, -scale, x, y).toSVG())
      .filter(Boolean)
      .join('');
    // A run of only spaces draws nothing but still advanced the pen.
    if (!d) continue;

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    paint(path, run.el !== text ? run.el : null, text);
    group.appendChild(path);
  }

  return group;
}

/**
 * State a glyph's paint on the glyph itself.
 *
 * Leaving it to be inherited from the group looks right and is not: a <path>
 * with no fill of its own is not merely uncoloured, it is claimable. mermaid's
 * stylesheet carries `.node rect, ..., .node path { fill: <node fill>; stroke:
 * <node border> }` for the shapes a node is built from, and a rule that matches
 * an element beats any value that element would otherwise inherit. Every
 * outlined label inside a node was therefore painted the colour of the box
 * behind it and outlined in its border colour.
 *
 * Stating it inline puts it out of reach — an inline style outranks any rule
 * that is not !important — while the presentation attributes keep SVG Tiny
 * renderers, which ignore `style` entirely, drawing the same thing.
 */
function paint(path, runEl, text) {
  const stated = (el, property) =>
    el?.style?.getPropertyValue?.(property) || el?.getAttribute?.(property) || null;

  const declarations = [];
  const set = (property, value) => {
    path.setAttribute(property, value);
    declarations.push(`${property}:${value}`);
  };

  // The run's own paint, which its <tspan> carried and a <path> would not
  // inherit once the tspan is gone, falling back to what the <text> resolved to.
  for (const property of RUN_PAINT) {
    const own = stated(runEl, property);
    const value = own ?? (INHERITED_PAINT.includes(property) ? stated(text, property) : null);
    if (value) set(property, value);
  }
  // SVG's own initial values, stated so that an element-name rule cannot step in
  // and supply different ones.
  if (!path.hasAttribute('fill')) set('fill', '#000');
  if (!path.hasAttribute('stroke')) set('stroke', 'none');

  path.setAttribute('style', declarations.join(';'));
}

function preservesSpace(el) {
  for (let node = el; node && node.nodeType === 1; node = node.parentNode) {
    const value =
      node.getAttributeNS?.(XML_NS, 'space') || node.getAttribute?.('xml:space');
    if (value) return value === 'preserve';
  }
  return false;
}

/**
 * One resolved length from an attribute: null when absent, false when it holds
 * a list, which would position glyphs one at a time.
 */
function single(node, name, fontSize) {
  const raw = node.getAttribute(name);
  if (!raw) return null;
  const parts = raw.trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length !== 1) return false;
  const value = resolveLength(parts[0], fontSize);
  return Number.isFinite(value) ? value : false;
}
