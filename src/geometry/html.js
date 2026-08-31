// Measurement for the HTML that mermaid puts inside <foreignObject> labels.
//
// This is NOT a CSS engine. Mermaid emits one fixed shape, and it is the only
// thing we model:
//
//   <div style="display:table-cell; white-space:nowrap; line-height:1.5;
//               max-width:200px; text-align:center">
//     <span class="nodeLabel"><p>text, <b>bold</b>, <br/> ...</p></span>
//   </div>
//
// Measured in Chrome, every such div reduces to two numbers:
//   width  = the widest line's advance, clamped to max-width
//   height = number of line boxes x line-height
// with padding and margin reset to 0 by mermaid's own stylesheet. line-height
// 1.5 at 16px computes to exactly 24px, and a four-line wrapped label measures
// exactly 200x96.
//
// Mermaid measures twice: once at white-space:nowrap, and if that hits
// max-width it switches the div to display:table/break-spaces with an explicit
// width and measures again. Both paths land here.
import { textAdvance } from './text.js';
import { FONT_REGISTRY } from './bbox.js';
import { cssStyleFor } from './css.js';
import { parseWeight, parseItalic } from './fonts.js';
import { resolveLength, resolveLineHeight } from './units.js';

const DEFAULT_FONT_SIZE = 16;

/** Tags whose UA display is block; anything else here is treated as inline. */
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'div', 'dl', 'dd', 'dt',
  'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
  'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody',
  'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);

/** UA stylesheet defaults that change text metrics. */
const UA_BOLD = new Set(['b', 'strong', 'th']);
const UA_ITALIC = new Set(['i', 'em', 'cite', 'dfn', 'address', 'var']);

const tagOf = (el) => (el.tagName || '').toLowerCase();

/** Inline style wins over a stylesheet rule, unless the rule is !important. */
function declared(el, property) {
  if (el.nodeType !== 1) return null;
  const rule = cssStyleFor(el)?.get(property);
  if (rule?.important) return rule.value;
  const inline = el.style?.getPropertyValue?.(property);
  return inline || rule?.value || el.getAttribute?.(property) || null;
}

/** Walk ancestors for an inherited property. */
function inherited(el, property) {
  let node = el;
  while (node && node.nodeType === 1) {
    const value = declared(node, property);
    if (value) return value;
    node = node.parentNode;
  }
  return null;
}

/**
 * Font properties for a text node, honouring the UA defaults for <b>/<i> —
 * mermaid relies on them for markdown emphasis and never states them in CSS.
 */
function fontFor(node, registry) {
  let el = node.nodeType === 3 ? node.parentNode : node;

  let fontSize = null;
  let fontFamily = null;
  let fontWeight = null;
  let fontStyle = null;
  let letterSpacing = null;

  let cursor = el;
  while (cursor && cursor.nodeType === 1) {
    fontSize ||= declared(cursor, 'font-size');
    fontFamily ||= declared(cursor, 'font-family');
    letterSpacing ||= declared(cursor, 'letter-spacing');

    if (fontWeight == null) {
      const value = declared(cursor, 'font-weight');
      if (value) fontWeight = value;
      else if (UA_BOLD.has(tagOf(cursor))) fontWeight = 'bold';
    }
    if (fontStyle == null) {
      const value = declared(cursor, 'font-style');
      if (value) fontStyle = value;
      else if (UA_ITALIC.has(tagOf(cursor))) fontStyle = 'italic';
    }
    cursor = cursor.parentNode;
  }

  const size = resolveLength(fontSize, DEFAULT_FONT_SIZE);
  return {
    registry,
    fontFamily,
    fontSize: Number.isFinite(size) ? size : DEFAULT_FONT_SIZE,
    fontWeight: parseWeight(fontWeight),
    fontStyle: parseItalic(fontStyle),
    letterSpacing,
  };
}

const isBlock = (el) => {
  const display = declared(el, 'display');
  if (display) return display === 'block' || display.startsWith('table') || display === 'list-item';
  return BLOCK_TAGS.has(tagOf(el));
};

/**
 * Flatten an element's descendants into a list of items per block:
 *   { type: 'text', text, font } | { type: 'break' } | { type: 'box', width, height }
 */
function collectBlocks(root, registry) {
  const blocks = [];
  let current = [];

  const flush = () => {
    if (current.length) blocks.push(current);
    current = [];
  };

  const walk = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        const text = child.data;
        if (text) current.push({ type: 'text', text, font: fontFor(child, registry) });
        continue;
      }
      if (child.nodeType !== 1) continue;

      const tag = tagOf(child);
      if (tag === 'br') {
        current.push({ type: 'break' });
        continue;
      }
      if (tag === 'img' || tag === 'svg') {
        current.push({ type: 'box', ...replacedSize(child) });
        continue;
      }
      if (isBlock(child)) {
        flush();
        walk(child);
        flush();
        continue;
      }
      walk(child);
    }
  };

  walk(root);
  flush();
  return blocks;
}

/**
 * Intrinsic size of a replaced element. Only explicit dimensions are honoured
 * here; deriving them from image data is H3 and lands in this function.
 */
function replacedSize(el) {
  const fontSize = DEFAULT_FONT_SIZE;
  const width =
    resolveLength(declared(el, 'width'), fontSize) ??
    NaN;
  const height = resolveLength(declared(el, 'height'), fontSize);
  return {
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0,
  };
}

/** Split a run into alternating word / whitespace tokens, keeping both. */
function tokenize(text) {
  return text.match(/\s+|[^\s]+/g) || [];
}

const advance = (text, font) =>
  text ? textAdvance(text, font, font.registry) : 0;

/**
 * Lay a block's items into lines.
 * @param {Array} items
 * @param {number} available  Infinity when white-space forbids wrapping
 * @returns {{ widths: number[] }} advance width of each line
 */
function layoutLines(items, available) {
  const widths = [];
  let lineWidth = 0;
  // Trailing whitespace does not contribute to a line's width, so it is held
  // back until another word arrives on the same line.
  let pendingSpace = 0;

  const endLine = () => {
    widths.push(lineWidth);
    lineWidth = 0;
    pendingSpace = 0;
  };

  for (const item of items) {
    if (item.type === 'break') {
      endLine();
      continue;
    }
    if (item.type === 'box') {
      if (available !== Infinity && lineWidth + pendingSpace + item.width > available && lineWidth > 0) {
        endLine();
      }
      lineWidth += pendingSpace + item.width;
      pendingSpace = 0;
      continue;
    }

    if (available === Infinity) {
      // No wrapping: measure the whole run at once so kerning is preserved.
      lineWidth += pendingSpace + advance(item.text, item.font);
      pendingSpace = 0;
      continue;
    }

    for (const token of tokenize(item.text)) {
      const width = advance(token, item.font);
      if (/^\s+$/.test(token)) {
        if (lineWidth > 0) pendingSpace += width;
        continue;
      }
      if (lineWidth > 0 && lineWidth + pendingSpace + width > available) {
        endLine();
        lineWidth = width;
        continue;
      }
      lineWidth += pendingSpace + width;
      pendingSpace = 0;
    }
  }

  endLine();
  return { widths };
}

/** The line-height that applies to a block's line boxes. */
function lineHeightFor(el, items) {
  const fontSize = items.find((i) => i.type === 'text')?.font.fontSize ?? DEFAULT_FONT_SIZE;
  return resolveLineHeight(inherited(el, 'line-height'), fontSize);
}

/**
 * Measure an HTML element the way Chrome would report getBoundingClientRect().
 * Only width and height are meaningful: we do not lay HTML out on a page, so
 * the origin is always (0, 0). Mermaid only ever reads width/height here.
 */
export function htmlBoundingRect(el) {
  const document = el.ownerDocument;
  const registry = document?.[FONT_REGISTRY] ?? null;
  if (!registry) return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };

  const fontSize = fontFor(el, registry).fontSize;
  const whiteSpace = inherited(el, 'white-space') || 'normal';
  const nowrap = whiteSpace === 'nowrap' || whiteSpace === 'pre';

  const explicitWidth = resolveLength(declared(el, 'width'), fontSize);
  const maxWidth = resolveLength(declared(el, 'max-width'), fontSize);

  // An explicit width wins; otherwise wrap at max-width unless nowrap forbids it.
  let available = Infinity;
  if (!nowrap) {
    if (Number.isFinite(explicitWidth)) available = explicitWidth;
    else if (Number.isFinite(maxWidth)) available = maxWidth;
  }

  const blocks = collectBlocks(el, registry);
  let width = 0;
  let height = 0;

  for (const items of blocks) {
    const { widths } = layoutLines(items, available);
    const lineHeight = lineHeightFor(el, items);
    for (const w of widths) width = Math.max(width, w);
    height += widths.length * lineHeight;
  }

  if (Number.isFinite(explicitWidth)) width = explicitWidth;
  // A table-cell at nowrap still cannot exceed max-width; mermaid detects that
  // clamp (bbox.width === width) and re-measures in wrapping mode.
  else if (Number.isFinite(maxWidth)) width = Math.min(width, maxWidth);

  return {
    x: 0, y: 0, left: 0, top: 0,
    width, height,
    right: width, bottom: height,
  };
}
