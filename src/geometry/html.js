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
import { naturalSizeOf } from './images.js';

const DEFAULT_FONT_SIZE = 16;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The page viewport, published on the document by sebDOM. See flowWidth(). */
export const VIEWPORT = Symbol.for('sebastianjs.viewport');

/** The UA stylesheet's body margin, which Chrome applies and jsdom does not. */
const BODY_MARGIN = 8;

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

/**
 * The value of an inherited property for an element, resolved through the same
 * cascade measurement uses. Exported for flatten.js, which needs text-align and
 * colour from the very rules that shaped the lines.
 */
export function inheritedProperty(el, property) {
  return inherited(el, property);
}

/** As above, but without walking ancestors — for properties that do not inherit. */
export function declaredProperty(el, property) {
  return declared(el, property);
}

const isBlock = (el) => {
  const display = declared(el, 'display');
  if (display) return display === 'block' || display.startsWith('table') || display === 'list-item';
  return BLOCK_TAGS.has(tagOf(el));
};

/**
 * True when a box takes its width from its containing block rather than from
 * its own contents. Everything mermaid measures inside a <foreignObject> is a
 * table-cell or an inline box and shrink-to-fits; a plain <div> on the page
 * does not.
 */
function fillsContainingBlock(el) {
  const display = declared(el, 'display');
  if (display) {
    if (display !== 'block' && display !== 'flow-root' && display !== 'list-item') return false;
  } else if (!BLOCK_TAGS.has(tagOf(el))) {
    return false;
  }
  const position = declared(el, 'position');
  if (position === 'absolute' || position === 'fixed') return false;
  const float = declared(el, 'float');
  if (float && float !== 'none') return false;
  return true;
}

/**
 * Width of a block-level element laid out in the page's own flow, or null when
 * the element is not in it — inside a <foreignObject>, out of flow, or not
 * block-level — in which case the caller shrink-to-fits as before.
 *
 * Only mermaid's gantt renderer reads a page-flow width: it takes the chart's
 * total width from `elem.parentElement.offsetWidth`. Shrink-to-fitting that
 * div gave 0, and gantt's guard only catches `undefined`, so every x
 * coordinate came out negative (the time scale's range was [0, -150]).
 *
 * Only margins are modelled, because the only one that exists here is the
 * body's: Chrome reports 784 for a bare div in an 800px viewport.
 */
function flowWidth(el) {
  const document = el.ownerDocument;
  const viewport = document?.[VIEWPORT];
  const body = document?.body;
  if (!viewport || !body) return null;

  const ancestors = [];
  let node = el;
  while (node && node.nodeType === 1 && node !== body) {
    // A <foreignObject> ancestor means this is label HTML, not page flow.
    if (node.namespaceURI === SVG_NS) return null;
    if (!fillsContainingBlock(node)) return null;
    ancestors.push(node);
    node = node.parentNode;
  }
  // Detached, or hanging off <head>: nothing to resolve against.
  if (node !== body) return null;

  let width = viewport.width - 2 * margin(body, BODY_MARGIN);
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const box = ancestors[i];
    const explicit = resolveLength(declared(box, 'width'), fontFor(box, null).fontSize);
    width = Number.isFinite(explicit) ? explicit : width - 2 * margin(box, 0);
  }
  return Math.max(width, 0);
}

/** A box's horizontal margin, assumed symmetric. */
function margin(el, fallback) {
  const value = resolveLength(
    declared(el, 'margin-left') ?? declared(el, 'margin'),
    fontFor(el, null).fontSize
  );
  return Number.isFinite(value) ? value : fallback;
}

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
        if (text) {
          // white-space is inherited and a descendant may override the
          // container: mermaid's class-diagram notes set the div to
          // break-spaces but the inner span to `nowrap !important`, so a
          // container-level decision wraps text Chrome keeps on one line.
          const ws = inherited(child.parentNode, 'white-space') || 'normal';
          current.push({
            type: 'text',
            text,
            nowrap: ws === 'nowrap' || ws === 'pre',
            font: fontFor(child, registry),
            // Kept so flatten.js can resolve the run's colour when it rewrites
            // this label as <text>; measurement never reads it.
            el: child.parentNode,
          });
        }
        continue;
      }
      if (child.nodeType !== 1) continue;

      const tag = tagOf(child);
      if (tag === 'br') {
        current.push({ type: 'break' });
        continue;
      }
      if (tag === 'img' || tag === 'svg') {
        const size = replacedSize(child);
        // `el` and `verticalAlign` are for flatten.js only; neither changes a
        // measured width or height.
        current.push({ type: 'box', el: child, verticalAlign: verticalAlignOf(child), ...size });
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
 * Size of a replaced element (<img>, inline <svg>).
 *
 * mermaid sizes label images itself: an image-only label gets min-width and
 * max-width of fontSize * 5, and an image beside text gets width:100%. A
 * percentage cannot be resolved against a shrink-to-fit cell, so the intrinsic
 * size is used for that case.
 */
function replacedSize(el) {
  const fontSize = fontFor(el, null).fontSize;
  const natural = naturalSizeOf(el) || { width: 0, height: 0 };

  const explicit = (property) => resolveLength(declared(el, property), fontSize);

  let width = explicit('width');
  let height = explicit('height');

  // min-width/max-width pin the image when mermaid has decided its size.
  const minWidth = explicit('min-width');
  const maxWidth = explicit('max-width');
  if (!Number.isFinite(width)) {
    if (Number.isFinite(minWidth) && Number.isFinite(maxWidth) && minWidth === maxWidth) {
      width = minWidth;
    } else {
      width = natural.width;
    }
  }
  if (Number.isFinite(minWidth)) width = Math.max(width, minWidth);
  if (Number.isFinite(maxWidth)) width = Math.min(width, maxWidth);

  if (!Number.isFinite(height)) {
    // Preserve the aspect ratio when only the width is constrained.
    height = natural.width > 0 ? (natural.height * width) / natural.width : natural.height;
  }

  return {
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0,
  };
}

/**
 * Where a replaced box sits relative to the line's baseline.
 *
 * Only the length form is resolvable here — the keywords need the strut's font
 * metrics and the line box's height, which belong to whoever lays the line out,
 * so they are passed through by name. mermaid emits exactly one of these, the
 * `vertical-align: -0.125em` on its `.label-icon` rule.
 *
 * @returns {{keyword: string, raise: number}} `raise` is how far the box's
 *          bottom edge sits above the baseline, in px, for the length form.
 */
function verticalAlignOf(el) {
  const declaration = declared(el, 'vertical-align');
  if (!declaration) return { keyword: 'baseline', raise: 0 };

  const value = declaration.trim().toLowerCase();
  const length = resolveLength(value, fontFor(el, null).fontSize);
  if (Number.isFinite(length)) return { keyword: 'length', raise: length };
  return { keyword: value, raise: 0 };
}

// Characters after which CSS allows a line break even without a space. This is a
// pragmatic subset of UAX #14, not the full algorithm: Chrome breaks
// "[DBServer\\SharedDbInstance].[SupportDb]" — which contains no spaces at all —
// across three lines, and breaks "Server:Service 1" after the colon. Splitting on
// whitespace alone under-breaks and makes labels measure too short.
// Only the classes UAX #14 actually offers a break after: hyphens (HY),
// slash (SY) and close punctuation (CL). Notably NOT ':' or '.', which are
// infix separators — treating them as breakable splits "Server:Service" and
// makes labels measure narrower than Chrome.
const BREAK_AFTER = /[-\u2010\u2013\u2014/\])}]/;
// UAX #14 LB13: never break BEFORE these, so an offered break is withdrawn when
// one follows. Without this, "[DBServer\\SharedDbInstance].[SupportDb]" breaks
// after the ']' and measures one period (4.2px) narrower than Chrome.
const NO_BREAK_BEFORE = /[.,;:!?)\]}\/]/;
// A break is offered before an opening bracket, which is how Chrome splits
// "[DBServer\\SharedDbInstance].[SupportDb]" after the period.
const OPEN_BRACKET = /[[({]/;
// CJK ideographs and kana break between almost any pair.
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/;

/**
 * Split a run into atomic chunks plus the break opportunity that follows each.
 * @returns {Array<{text: string, isSpace: boolean, breakAfter: boolean}>}
 */
function tokenize(text) {
  const chunks = [];
  let current = '';

  const push = (breakAfter) => {
    if (current) chunks.push({ text: current, isSpace: false, breakAfter });
    current = '';
  };

  for (const [i, ch] of [...text].entries()) {
    if (/\s/.test(ch)) {
      push(true);
      const last = chunks[chunks.length - 1];
      if (last?.isSpace) last.text += ch;
      else chunks.push({ text: ch, isSpace: true, breakAfter: true });
      continue;
    }
    current += ch;
    const next = text[i + 1];
    if (next === undefined || /\s/.test(next)) continue;
    // A break is offered after this character, before an opening bracket, or
    // between two CJK characters — unless the next character is one we may
    // never break before, which withdraws the offer.
    if (NO_BREAK_BEFORE.test(next)) continue;
    if (
      BREAK_AFTER.test(ch) ||
      OPEN_BRACKET.test(next) ||
      (CJK.test(ch) && CJK.test(next))
    ) {
      push(true);
    }
  }
  push(false);
  return chunks;
}

const advance = (text, font) =>
  text ? textAdvance(text, font, font.registry) : 0;

/**
 * Lay a block's items into lines.
 *
 * Each line keeps both its advance width and the runs that produced it, so a
 * caller that wants to re-emit the label as SVG <text> (see flatten.js) gets
 * exactly the text the width was measured from. Runs are merged back per source
 * item, so a wrapped run is one string per line rather than one per chunk and
 * an SVG renderer can shape and kern it as a unit.
 *
 * Each run also carries the x it starts at, measured from the line's left edge.
 * That is tracked in `cursor`, deliberately kept apart from the `lineWidth`
 * arithmetic rather than derived from it: summing the same advances in a
 * different order moves a measured width by an ulp, and every node in the
 * diagram is sized from those widths.
 *
 * @param {Array} items
 * @param {number} available  Infinity when white-space forbids wrapping
 * @returns {{ lines: Array<{width: number, runs: Array}>, minContent: number }}
 */
function layoutLines(items, available) {
  const lines = [];
  let runs = [];
  let lineWidth = 0;
  // Where the next run starts, from the left edge of the line. Only positions
  // replaced boxes and the text around them; never feeds back into a width.
  let cursor = 0;
  // Trailing whitespace does not contribute to a line's width, so it is held
  // back until another chunk arrives on the same line. The text is held with it
  // so the emitted run keeps the spaces that were measured.
  let pendingSpace = 0;
  let pendingText = [];
  // The widest run with no break opportunity inside it. A box can never be
  // narrower than this, even when max-width or an explicit width says otherwise:
  // Chrome reports 227.45 for a 200px-max label whose longest unbreakable run is
  // 227.45, and mermaid sizes the node from that.
  let minContent = 0;
  // A break may only be taken where the previous chunk offered one.
  let breakable = false;

  const addText = (text, item, width) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last?.type === 'text' && last.item === item) last.text += text;
    else runs.push({ type: 'text', text, item, font: item.font, el: item.el, x: cursor });
    cursor += width;
  };

  const flushPending = () => {
    for (const held of pendingText) addText(held.text, held.item, held.width);
    pendingText = [];
    pendingSpace = 0;
  };

  const endLine = () => {
    lines.push({ width: lineWidth, runs });
    runs = [];
    lineWidth = 0;
    cursor = 0;
    pendingSpace = 0;
    pendingText = [];
    breakable = false;
  };

  for (const item of items) {
    if (item.type === 'break') {
      endLine();
      continue;
    }
    if (item.type === 'box') {
      minContent = Math.max(minContent, item.width);
      if (available !== Infinity && lineWidth > 0 && lineWidth + pendingSpace + item.width > available) {
        endLine();
      }
      lineWidth += pendingSpace + item.width;
      flushPending();
      runs.push({ type: 'box', item, x: cursor });
      cursor += item.width;
      breakable = true;
      continue;
    }

    if (available === Infinity || item.nowrap) {
      // No wrapping: measure the whole run at once so kerning is preserved.
      const runWidth = advance(item.text, item.font);
      lineWidth += pendingSpace + runWidth;
      flushPending();
      addText(item.text, item, runWidth);
      breakable = true; // a break may still be taken between runs
      if (item.nowrap) {
        // The entire run is unbreakable, so it sets the min-content width.
        minContent = Math.max(minContent, runWidth);
      } else {
        for (const chunk of tokenize(item.text)) {
          if (!chunk.isSpace) minContent = Math.max(minContent, advance(chunk.text, item.font));
        }
      }
      continue;
    }

    for (const chunk of tokenize(item.text)) {
      const width = advance(chunk.text, item.font);
      if (chunk.isSpace) {
        if (lineWidth > 0) {
          pendingSpace += width;
          pendingText.push({ text: chunk.text, item, width });
        }
        breakable = true;
        continue;
      }
      minContent = Math.max(minContent, width);
      if (breakable && lineWidth > 0 && lineWidth + pendingSpace + width > available) {
        endLine();
        lineWidth = width;
        addText(chunk.text, item, width);
        breakable = chunk.breakAfter;
        continue;
      }
      lineWidth += pendingSpace + width;
      flushPending();
      addText(chunk.text, item, width);
      breakable = chunk.breakAfter;
    }
  }

  endLine();
  return { lines, minContent };
}

/** The line-height that applies to a block's line boxes. */
function lineHeightFor(el, items) {
  const fontSize = items.find((i) => i.type === 'text')?.font.fontSize ?? DEFAULT_FONT_SIZE;
  return resolveLineHeight(inherited(el, 'line-height'), fontSize);
}

/**
 * Lay out an HTML element and return both the box Chrome would report and the
 * line boxes that produced it.
 *
 * `blocks` is one entry per block-level box, each with the line-height that
 * applies to its line boxes, the font that sets their strut, and one entry per
 * line carrying its advance width and its runs. Measurement only needs the
 * width and height; flatten.js needs the rest to re-emit the label as <text>.
 *
 * @returns {{width: number, height: number, blocks: Array}|null} null when no
 *          font registry is available, which is the only way measurement fails.
 */
export function htmlLayout(el) {
  const document = el.ownerDocument;
  const registry = document?.[FONT_REGISTRY] ?? null;
  if (!registry) return null;

  const fontSize = fontFor(el, registry).fontSize;
  const whiteSpace = inherited(el, 'white-space') || 'normal';
  const nowrap = whiteSpace === 'nowrap' || whiteSpace === 'pre';

  const explicitWidth = resolveLength(declared(el, 'width'), fontSize);
  const maxWidth = resolveLength(declared(el, 'max-width'), fontSize);

  // A block in the page's own flow is as wide as its containing block, whatever
  // it contains; only its height comes from its contents.
  const flow = Number.isFinite(explicitWidth) ? null : flowWidth(el);

  // An explicit width wins, then the containing block, then max-width — unless
  // nowrap forbids wrapping at all.
  let available = Infinity;
  if (!nowrap) {
    if (Number.isFinite(explicitWidth)) available = explicitWidth;
    else if (flow !== null) available = flow;
    else if (Number.isFinite(maxWidth)) available = maxWidth;
  }

  const blocks = [];
  let width = 0;
  let height = 0;
  let minContent = 0;

  for (const items of collectBlocks(el, registry)) {
    const { lines, minContent: blockMin } = layoutLines(items, available);
    minContent = Math.max(minContent, blockMin);
    const lineHeight = lineHeightFor(el, items);
    // A replaced element taller than the line box raises it.
    const tallest = items.reduce((max, i) => (i.type === 'box' ? Math.max(max, i.height) : max), 0);
    for (const line of lines) width = Math.max(width, line.width);
    height += lines.length * Math.max(lineHeight, tallest);
    blocks.push({
      lines,
      // The strut's own line-height, and the height each line actually advances
      // by once a replaced box taller than the strut has raised it. Measurement
      // only ever needed the second; placing a baseline needs both.
      lineHeight,
      boxHeight: Math.max(lineHeight, tallest),
      font: items.find((i) => i.type === 'text')?.font ?? null,
    });
  }

  if (Number.isFinite(explicitWidth)) width = explicitWidth;
  else if (flow !== null) width = flow;
  // A table-cell at nowrap still cannot exceed max-width; mermaid detects that
  // clamp (bbox.width === width) and re-measures in wrapping mode.
  else if (Number.isFinite(maxWidth)) width = Math.min(width, maxWidth);
  // Once wrapping, neither max-width nor an explicit width can push a box below
  // its min-content width. At nowrap the clamp stands: Chrome reports exactly
  // max-width there, which is precisely the signal mermaid uses to decide it
  // must re-measure in wrapping mode.
  // A page-flow block is the exception: content too wide to fit overflows it
  // rather than widening it.
  if (!nowrap && flow === null) width = Math.max(width, minContent);

  return { width, height, blocks };
}

/**
 * Measure an HTML element the way Chrome would report getBoundingClientRect().
 * Only width and height are meaningful: we do not lay HTML out on a page, so
 * the origin is always (0, 0). Mermaid only ever reads width/height here.
 */
export function htmlBoundingRect(el) {
  const layout = htmlLayout(el);
  const width = layout?.width ?? 0;
  const height = layout?.height ?? 0;
  return {
    x: 0, y: 0, left: 0, top: 0,
    width, height,
    right: width, bottom: height,
  };
}
