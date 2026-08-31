// SVG bounding-box computation, adapted from svgdom's bboxUtils (MIT, see
// vendor/LICENSE) with three changes:
//
//   1. text measurement goes through ./text.js, so font-weight and font-style
//      are honoured and the Blink vertical-metrics rule is applied;
//   2. childNodes is read generically, because jsdom's NodeList — unlike
//      svgdom's plain array — has no .reduce;
//   3. the font registry is looked up per-document rather than from a module
//      global, so two windows can use different fonts without racing.
import * as pathUtils from './vendor/pathUtils.js';
import * as regex from './vendor/regex.js';
import { Box, NoBox } from './vendor/Box.js';
import { NodeIterator } from './vendor/NodeIterator.js';
import { NodeFilter } from './vendor/NodeFilter.js';
import { textBBox } from './text.js';
import { parseWeight, parseItalic } from './fonts.js';
import { cssStyleFor } from './css.js';
import { resolveLength } from './units.js';

/** Where the adapter stashes the FontRegistry on each Document. */
export const FONT_REGISTRY = Symbol.for('sebastianjs.fontRegistry');

const childrenOf = (node) => Array.prototype.slice.call(node.childNodes);

/**
 * Elements that are never painted where they sit. getBBox on one directly is
 * still meaningful, so these are filtered when walking a container's children
 * rather than removed from the shape switch.
 */
const NON_RENDERED = new Set([
  'defs', 'marker', 'symbol', 'clipPath', 'mask', 'pattern', 'filter',
  'linearGradient', 'radialGradient', 'title', 'desc', 'metadata', 'style', 'script',
]);

const registryFor = (node) => {
  const doc = node.ownerDocument || node;
  return doc?.[FONT_REGISTRY] ?? null;
};

/**
 * SVG 1.1: a zero (or negative) value for rect width/height, circle r, or
 * ellipse rx/ry "disables rendering of the element". Unrendered elements are
 * excluded from a container's bbox, so Chrome ignores them — and mermaid relies
 * on that, inserting an empty <rect> as the first child of every label group
 * (labelHelper's `labelEl.insert("rect", ":first-child")`). Counting those
 * pinned every diagram's bbox to the origin and inflated the viewBox.
 */
const isRendered = (node) => {
  const num = (name) => parseFloat(node.getAttribute(name));
  switch (node.nodeName) {
    case 'rect':
    case 'image':
    case 'pattern':
    case 'foreignObject':
      return num('width') > 0 && num('height') > 0;
    case 'circle':
      return num('r') > 0;
    case 'ellipse': {
      const rx = num('rx');
      const ry = num('ry');
      // An omitted radius is auto-derived from the other in SVG 2.
      return (rx > 0 || (Number.isNaN(rx) && ry > 0)) && (ry > 0 || (Number.isNaN(ry) && rx > 0));
    }
    case 'path':
    case 'glyph':
    case 'missing-glyph':
      return !!node.getAttribute('d');
    default:
      return true;
  }
};

const applyTransformation = (segments, node, applyTransformations) => {
  if (node.matrixify && applyTransformations) {
    return segments.transform(node.matrixify());
  }
  return segments;
};

export const getSegments = (node, applyTransformations, rbox = false) => {
  const segments = getPathSegments(node, rbox);
  return applyTransformation(segments, node, applyTransformations);
};

const getPathSegments = (node, rbox) => {
  if (node.nodeType !== 1) return new pathUtils.PathSegmentArray();
  if (!isRendered(node)) return new pathUtils.PathSegmentArray();

  // jsdom preserves SVG tag casing on nodeName, so 'foreignObject' matches.
  switch (node.nodeName) {
    case 'rect':
    case 'image':
    case 'pattern':
    case 'mask':
    case 'foreignObject':
      return pathUtils.getPathSegments(pathUtils.pathFrom.rect(node));
    case 'svg':
    case 'symbol':
      if (rbox) {
        return pathUtils.getPathSegments(pathUtils.pathFrom.rect(node));
      }
    // FALL THROUGH: a container's bbox comes from its content, not its
    // width/height attributes.
    // eslint-disable-next-line no-fallthrough
    case 'g':
    case 'clipPath':
    case 'a':
    case 'marker':
      return childrenOf(node).reduce((segments, child) => {
        if (!child.matrixify) return segments;
        // <marker>, <defs>, <symbol> etc. are only drawn where referenced, so
        // they never contribute to an ancestor's bbox. Chrome excludes them;
        // mermaid emits its arrowhead markers as direct children of the root
        // <g>, which otherwise pins every diagram's bbox to the origin.
        if (NON_RENDERED.has(child.nodeName)) return segments;
        return segments.merge(
          getSegments(child, true).transform(child.generateViewBoxMatrix())
        );
      }, new pathUtils.PathSegmentArray());
    case 'circle':
      return pathUtils.getPathSegments(pathUtils.pathFrom.circle(node));
    case 'ellipse':
      return pathUtils.getPathSegments(pathUtils.pathFrom.ellipse(node));
    case 'line':
      return pathUtils.getPathSegments(pathUtils.pathFrom.line(node));
    case 'polyline':
    case 'polygon':
      return pathUtils.getPathSegments(pathUtils.pathFrom.polyline(node));
    case 'path':
    case 'glyph':
    case 'missing-glyph':
      return pathUtils.getPathSegments(node.getAttribute('d'));
    case 'use': {
      const ref = node.getAttribute('href') || node.getAttribute('xlink:href');
      if (!ref) return new pathUtils.PathSegmentArray();
      const refNode = node.getRootNode().querySelector(ref);
      if (!refNode) return new pathUtils.PathSegmentArray();
      return getSegments(refNode).transform(node.generateViewBoxMatrix());
    }
    case 'tspan':
    case 'text':
    case 'altGlyph': {
      const box = getTextBBox(node);
      if (box instanceof NoBox) return new pathUtils.PathSegmentArray();
      return pathUtils.getPathSegments(pathUtils.pathFrom.box(box));
    }
    default:
      return new pathUtils.PathSegmentArray();
  }
};

const union = (boxes) => boxes.reduce((last, curr) => last.merge(curr), new NoBox());

/**
 * text-anchor applies to a whole text chunk, not to each run inside it. Runs are
 * therefore laid out as if anchored at the start and the chunk is shifted once,
 * using the full width of the outermost text element — measuring per-run made
 * multi-tspan labels (mermaid splits long labels across tspans) come out both
 * mis-centred and too narrow.
 */
const getTextBBox = (node) => {
  const textRoot = findTextRoot(node);
  const rootBoxes = getTextBBoxes(textRoot, textRoot).filter(isNotEmptyBox);
  const rootUnion = union(rootBoxes);

  const anchor = getFontDetails(textRoot).textAnchor;
  let shift = 0;
  if (anchor === 'middle') shift = -rootUnion.width / 2;
  else if (anchor === 'end') shift = -rootUnion.width;

  const boxes =
    node === textRoot ? rootBoxes : getTextBBoxes(node, textRoot).filter(isNotEmptyBox);
  const box = union(boxes);
  if (!shift || box instanceof NoBox) return box;
  return new Box(box.x + shift, box.y, box.width, box.height);
};

const findTextRoot = (node) => {
  while (node.parentNode) {
    if (
      (node.nodeName === 'text' && node.parentNode.nodeName === 'text') ||
      ((node.nodeName === 'tspan' || node.nodeName === 'textPath') &&
        ['tspan', 'text', 'textPath'].includes(node.parentNode.nodeName))
    ) {
      node = node.parentNode;
    } else {
      break;
    }
  }
  return node;
};

// A run's position depends on every preceding sibling run, so we walk from the
// outermost text element and stop once we reach the node we were asked about.
const getTextBBoxes = function (
  target,
  textRoot = target,
  pos = { x: 0, y: 0 },
  dx = [0],
  dy = [0],
  boxes = []
) {
  const iter = new NodeIterator(
    textRoot,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    (node) => (node.nodeName === 'title' ? NodeFilter.FILTER_IGNORE : NodeFilter.FILTER_ACCEPT)
  );

  for (const node of iter) {
    if (node === target && node !== textRoot) {
      return getTextBBoxes(node, node, pos, dx, dy);
    }
    getPositionDetailsFor(node, pos, dx, dy, boxes);
  }

  return boxes;
};

const isNotEmptyBox = (box) =>
  box.x !== 0 || box.y !== 0 || box.width !== 0 || box.height !== 0;

// Mutates pos/dx/dy/boxes in place as it walks the run.
const getPositionDetailsFor = (node, pos, dx, dy, boxes) => {
  if (node.nodeType === node.ELEMENT_NODE) {
    const fontSize = parseFloat(getFontDetails(node).fontSize) || 16;
    const length = (value) => resolveLength(value, fontSize);

    const x = length(node.getAttribute('x'));
    const y = length(node.getAttribute('y'));
    pos.x = isNaN(x) ? pos.x : x;
    pos.y = isNaN(y) ? pos.y : y;

    const dx0 = (node.getAttribute('dx') || '')
      .split(regex.delimiter)
      .filter((num) => num !== '')
      .map(length);
    const dy0 = (node.getAttribute('dy') || '')
      .split(regex.delimiter)
      .filter((num) => num !== '')
      .map(length);

    dx.splice(0, dx0.length, ...dx0);
    dy.splice(0, dy0.length, ...dy0);
    return;
  }

  const data = node.data;
  // Anchoring is applied once per chunk in getTextBBox, not per run.
  const details = { ...getFontDetails(node), textAnchor: 'start' };
  const registry = registryFor(node);
  if (!registry) return;

  let j = 0;
  const jl = data.length;

  // Multiple dx/dy values shift individual glyphs.
  // https://svgwg.org/svg2-draft/text.html#TextElementDXAttribute
  if (dy.length || dx.length) {
    for (; j < jl; j++) {
      pos.x += dx.shift() || 0;
      pos.y += dy.shift() || 0;
      boxes.push(textBBox(data.substr(j, 1), pos.x, pos.y, details, registry));
      if (!dy.length && !dx.length) break;
    }
  }

  boxes.push(textBBox(data.substr(j), pos.x, pos.y, details, registry));
  pos.x += boxes[boxes.length - 1].width;
};

const TEXT_CONTENT_ELEMENTS = ['text', 'tspan', 'tref', 'textPath', 'altGlyph', 'g'];

/**
 * Walk up the text-content ancestors collecting inherited font properties.
 * Inline `style` wins over the presentation attribute, matching CSS precedence.
 */
export const getFontDetails = (node) => {
  if (node.nodeType === node.TEXT_NODE) node = node.parentNode;

  let fontSize = null;
  let fontFamily = null;
  let fontWeight = null;
  let fontStyle = null;
  let textAnchor = null;
  let dominantBaseline = null;
  let letterSpacing = null;

  do {
    const inline = node.style || {};
    const css = cssStyleFor(node);
    // SVG precedence: presentation attribute < stylesheet < inline style,
    // with !important beating inline.
    const pick = (property, inlineValue, attribute) => {
      const rule = css?.get(property);
      if (rule?.important) return rule.value;
      return inlineValue || rule?.value || node.getAttribute(attribute);
    };

    fontSize ||= pick('font-size', inline.fontSize, 'font-size');
    fontFamily ||= pick('font-family', inline.fontFamily, 'font-family');
    fontWeight ||= pick('font-weight', inline.fontWeight, 'font-weight');
    fontStyle ||= pick('font-style', inline.fontStyle, 'font-style');
    textAnchor ||= pick('text-anchor', inline.textAnchor, 'text-anchor');
    dominantBaseline ||= pick('dominant-baseline', inline.dominantBaseline, 'dominant-baseline');
    letterSpacing ||= pick('letter-spacing', inline.letterSpacing, 'letter-spacing');
    // font-* / letter-spacing / text-anchor are inherited properties, so they
    // resolve against every ancestor — mermaid puts font-size and font-family on
    // the root <svg> rule, well above the nearest text-content element.
    // dominant-baseline is not inherited, so it stops at the text run.
    if (!TEXT_CONTENT_ELEMENTS.includes(node.nodeName)) dominantBaseline ||= 'stop';
  } while ((node = node.parentNode) && node.nodeType === node.ELEMENT_NODE);

  if (dominantBaseline === 'stop') dominantBaseline = null;

  return {
    fontFamily,
    fontSize,
    fontWeight: parseWeight(fontWeight),
    fontStyle: parseItalic(fontStyle),
    letterSpacing,
    textAnchor: textAnchor || 'start',
    dominantBaseline: dominantBaseline || 'alphabetical',
  };
};
