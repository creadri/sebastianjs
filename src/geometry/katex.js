// Lay out a KaTeX formula from the box tree KaTeX itself produced.
//
// KaTeX does not draw with CSS so much as *serialise a box tree into* CSS: the
// numbers its layout engine computed end up in inline styles, and the classes
// only pick fonts and turn on the positioning mechanism. `<span class="vlist"
// style="height:1.1076em">` holding `<span style="top:-3.677em">` is not a
// styling choice, it is a stack of boxes with their offsets written down.
//
// So this is not a CSS engine and does not need to be one. It reads KaTeX's own
// vocabulary back out and reproduces the arithmetic from buildCommon.makeVList,
// which places every child of a vlist by
//
//   childWrap.style.top = -(pstrutSize + currPos + elem.depth)
//
// where `currPos + elem.depth` is exactly how far that child's baseline sits
// above the vlist's own baseline. Inverting it needs no reasoning about
// inline-tables or `vertical-align: bottom`:
//
//   baselineAbove = -(top + pstrutHeight)
//
// Everything else — inter-atom spacing, italic correction, fraction rules,
// radicals — is an inline `margin-*`, `border-bottom-width` or a literal <svg>
// that KaTeX embedded, and is read straight off the element.
//
// The output is absolute: a list of text runs, rules and images positioned
// against the formula's own baseline, which flatten.js drops into the diagram.
// Each run carries one font, so each becomes its own <text> — which is also
// what keeps resvg from substituting a single face for a whole mixed-font
// formula.
import { textAdvance } from './text.js';
import { cssStyleFor } from './css.js';
import { parseWeight, parseItalic } from './fonts.js';
import { resolveLength, resolveLineHeight } from './units.js';
import { blinkVerticalMetrics } from './calibrate.js';

const DEFAULT_FONT_SIZE = 16;

/** Zero-width scaffolding: present to drive CSS, never drawn. */
const SCAFFOLDING = new Set(['pstrut', 'vlist-s', 'strut', 'katex-mathml']);

/** True for the element that wraps one rendered formula. */
export const isKatexRoot = (el) =>
  el?.nodeType === 1 && el.classList?.contains('katex');

/** Inline style wins over a stylesheet rule, unless the rule is !important. */
function declared(el, property) {
  if (el?.nodeType !== 1) return null;
  const rule = cssStyleFor(el)?.get(property);
  if (rule?.important) return rule.value;
  return el.style?.getPropertyValue?.(property) || rule?.value || null;
}

/**
 * The font in effect on `el`, given its parent's.
 *
 * Resolved downwards rather than by walking ancestors, because KaTeX's sizes
 * compound: `.katex` is 1.21em of the diagram's font and a superscript is
 * 0.7em of *that*. Reading the first font-size an ancestor happens to declare
 * and resolving it against 16px would size every nested script wrongly.
 */
function fontFor(el, parent) {
  const size = declared(el, 'font-size');
  let fontSize = parent.fontSize;
  if (size) {
    const resolved = resolveLength(size, parent.fontSize);
    if (Number.isFinite(resolved)) fontSize = resolved;
  }

  const weight = declared(el, 'font-weight');
  const style = declared(el, 'font-style');
  return {
    registry: parent.registry,
    fontFamily: declared(el, 'font-family') || parent.fontFamily,
    fontSize,
    fontWeight: weight ? parseWeight(weight) : parent.fontWeight,
    fontStyle: style ? parseItalic(style) : parent.fontStyle,
    letterSpacing: null,
  };
}

/** A length declared on `el`, in px, resolved against `el`'s own font size. */
const lengthOf = (el, property, font) =>
  resolveLength(declared(el, property), font.fontSize);

const classesOf = (el) => (el.getAttribute?.('class') || '').split(/\s+/);

/**
 * The inherited text-align at `el`, which is what aligns the rows of a stack.
 * The walk stops at the formula root: the diagram's own centring applies to the
 * label, and is applied to the formula as a whole rather than to its insides.
 */
function textAlign(el) {
  for (let node = el; node?.nodeType === 1; node = node.parentNode) {
    const value = declared(node, 'text-align');
    if (value) return value.trim().toLowerCase();
    if (isKatexRoot(node)) break;
  }
  return 'left';
}

/** A horizontal margin or padding in px, or 0 when it is not stated. */
function edge(el, font, property) {
  const value = lengthOf(el, property, font);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Lay out one `<span class="katex">`.
 *
 * @returns {{width:number, height:number, depth:number, items:Array}|null}
 *          `height` is the extent above the baseline and `depth` below it.
 *          Item `y` is measured from the baseline, positive downwards.
 */
export function katexLayout(root, registry, parentFont = {}) {
  const html = Array.from(root.getElementsByTagName('span')).find((el) =>
    el.classList?.contains('katex-html')
  );
  // `output: "mathml"` would leave nothing to draw. Mermaid never asks for it,
  // but a caller who set mermaid's own math config could.
  if (!html) return null;

  const base = {
    registry,
    fontSize: parentFont.fontSize ?? DEFAULT_FONT_SIZE,
    fontFamily: parentFont.fontFamily ?? null,
    fontWeight: parentFont.fontWeight ?? 400,
    fontStyle: parentFont.fontStyle ?? false,
  };

  const rootFont = { ...fontFor(root, base), el: root };
  const laid = layoutInline(html, fontFor(html, rootFont));

  // KaTeX writes the extent of every `.base` into its strut, as the height and
  // vertical-align of a zero-width box. Those are KaTeX's own numbers, so they
  // are preferred over anything re-derived from the glyphs we placed.
  //
  // Only the top-level bases count. A stack's inner boxes carry struts of their
  // own, at their own smaller font sizes, and they are already accounted for by
  // the offsets that placed them — reading those as if they were the formula's
  // would make every fraction and every limit several pixels too tall.
  let height = 0;
  let depth = 0;
  const htmlFont = fontFor(html, rootFont);
  const lineHeight = resolveLineHeight(declared(root, 'line-height'), htmlFont.fontSize);

  for (const base of Array.from(html.childNodes)) {
    if (base.nodeType !== 1) continue;
    const baseFont = fontFor(base, htmlFont);
    for (const strut of Array.from(base.childNodes)) {
      if (!strut.classList?.contains('strut')) continue;
      const font = fontFor(strut, baseFont);
      const total = lengthOf(strut, 'height', font);
      if (!Number.isFinite(total)) continue;
      const shift = lengthOf(strut, 'vertical-align', font);
      const below = Number.isFinite(shift) ? -shift : 0;

      // A `.base` is an inline-block, so it is as tall as its own line box —
      // and a line box gets the strut of its font and line-height only if
      // something is actually laid out in it. A formula of ordinary symbols has
      // text in the base and so cannot be shorter than 1.2em, but every glyph of
      // a lone \sqrt or \frac sits inside a vlist, whose wrappers are blocks of
      // zero height: nothing reaches the base's inline context, no strut is
      // created, and the box is exactly as tall as KaTeX said.
      const strutBox = hasInlineText(base) ? lineStrut(baseFont, lineHeight) : null;
      height = Math.max(height, strutBox ? Math.max(strutBox.above, total - below) : total - below);
      depth = Math.max(depth, strutBox ? Math.max(strutBox.below, below) : below);
    }
  }
  if (!height && !depth) {
    for (const item of laid.items) {
      height = Math.max(height, -item.y + (item.type === 'text' ? item.font.fontSize * 0.7 : 0));
      depth = Math.max(depth, item.y);
    }
  }

  // `.katex-display` sets `margin: 1em 0`, which at a 16px body font is 32px of
  // the label's height — a third of a one-line node. It is a flex item in the
  // wrapper mermaid emits, so neither margin collapses.
  const display = root.parentNode?.classList?.contains('katex-display')
    ? root.parentNode
    : null;
  // Resolved against the wrapper's own font, not the formula's: `.katex-display`
  // sits outside `.katex`, so its `1em` is a body em (16px), not a maths em
  // (19.36px). Using the latter made every formula 6.7px too tall.
  const { top: marginTop, bottom: marginBottom } = verticalMargin(
    display,
    display ? fontFor(display, base) : base
  );

  return { width: laid.width, height, depth, marginTop, marginBottom, items: laid.items };
}

/**
 * True when text is laid out in `el`'s own inline formatting context.
 *
 * A vlist's children are `display: block; height: 0`, so the glyphs inside one
 * never join the line box of the box that contains it.
 */
function hasInlineText(el) {
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3) {
      if (child.data.replace(/​/g, '').trim()) return true;
      continue;
    }
    if (child.nodeType !== 1) continue;
    if (child.classList?.contains('vlist-t')) continue;
    if (classesOf(child).some((c) => SCAFFOLDING.has(c))) continue;
    if (hasInlineText(child)) return true;
  }
  return false;
}

/** How far a line box's strut reaches above and below the baseline. */
function lineStrut(font, lineHeight) {
  const face = font.registry?.resolve(font.fontFamily, font.fontWeight, font.fontStyle);
  if (!face || !Number.isFinite(lineHeight)) return { above: 0, below: 0 };
  const { ascent, descent } = blinkVerticalMetrics(face, font.fontSize);
  const leading = (lineHeight - (ascent + descent)) / 2;
  return { above: ascent + leading, below: descent + leading };
}

/** Top and bottom margin in px, honouring the `margin` shorthand KaTeX uses. */
function verticalMargin(el, font) {
  if (!el) return { top: 0, bottom: 0 };

  const shorthand = String(declared(el, 'margin') || '').trim().split(/\s+/);
  // `margin: <v> <h>` and `margin: <v>` both put the vertical value first.
  const fromShorthand = shorthand.length ? resolveLength(shorthand[0], font.fontSize) : NaN;
  const fallback = Number.isFinite(fromShorthand) ? fromShorthand : 0;

  const pick = (property) => {
    const value = resolveLength(declared(el, property), font.fontSize);
    return Number.isFinite(value) ? value : fallback;
  };
  return { top: pick('margin-top'), bottom: pick('margin-bottom') };
}

/**
 * Lay a run of inline content out left to right, on one baseline.
 *
 * @returns {{width:number, items:Array}} items positioned against the box's own
 *          origin: x from its left edge, y from its baseline.
 */
function layoutInline(el, font) {
  const items = [];
  let x = 0;

  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3) {
      const text = child.data;
      // KaTeX pads with zero-width spaces to defeat browser quirks; they are
      // not in the maths and several of the fonts have no glyph for them.
      const drawn = text.replace(/​/g, '');
      if (!drawn) continue;
      items.push({ type: 'text', text: drawn, font, x, y: 0 });
      x += textAdvance(drawn, font, font.registry);
      continue;
    }
    if (child.nodeType !== 1) continue;

    const classes = classesOf(child);
    if (classes.some((c) => SCAFFOLDING.has(c))) continue;

    const childFont = fontFor(child, font);

    // Inter-atom spacing, italic correction and the vlist's own nudges are all
    // margins; `.mspace` is nothing but one. Padding matters for exactly one
    // construct, but a load-bearing one: a radicand is indented by
    // `padding-left` to leave room for the sign drawn over it.
    x += edge(child, childFont, 'margin-left') + edge(child, childFont, 'padding-left');

    const placed = layoutBox(child, childFont);
    if (placed) {
      for (const item of placed.items) items.push({ ...item, x: item.x + x });
      x += placed.width;
    }

    x += edge(child, childFont, 'margin-right') + edge(child, childFont, 'padding-right');
  }

  return { width: x, items };
}

/** One inline box: a stack, a rule, an embedded image, or more inline content. */
function layoutBox(el, font) {
  const classes = classesOf(el);

  if (classes.includes('vlist-t')) return layoutVList(el, font);

  // Fraction bars, \overline and \rule are drawn as a border on an empty box.
  const thickness = lengthOf(el, 'border-bottom-width', font);
  if (Number.isFinite(thickness) && thickness > 0) {
    // The width comes from the containing stack, which is only known once its
    // other children are laid out; layoutVList() fills it in.
    return { width: 0, items: [{ type: 'rule', x: 0, y: 0, width: null, height: thickness }] };
  }

  if (el.localName === 'svg') return layoutEmbeddedSvg(el, font);
  // A radical's tail is an oversized <svg> clipped by its wrapper's min-width.
  if (classes.includes('hide-tail')) {
    const svg = Array.from(el.childNodes).find((n) => n.localName === 'svg');
    return svg ? layoutEmbeddedSvg(svg, font, el) : null;
  }

  const placed = layoutInline(el, font);
  // A spacer: an empty box that exists only for the width its class gives it,
  // like the `.nulldelimiter` on each side of a fraction.
  if (!placed.items.length) {
    const width = lengthOf(el, 'width', font);
    if (Number.isFinite(width) && width > placed.width) return { width, items: [] };
  }
  return placed;
}

/**
 * A vertical stack: superscripts and subscripts, fractions, roots, accents.
 *
 * The rows below the first exist only to declare the stack's depth to CSS —
 * the geometry is entirely in the first row's children.
 */
function layoutVList(el, font) {
  const rows = Array.from(el.childNodes).filter((n) =>
    n.classList?.contains('vlist-r')
  );
  const vlist = rows
    .flatMap((row) => Array.from(row.childNodes))
    .find((n) => n.classList?.contains('vlist'));
  if (!vlist) return { width: 0, items: [] };

  const stack = [];
  let width = 0;

  for (const wrap of Array.from(vlist.childNodes)) {
    if (wrap.nodeType !== 1 || wrap.classList?.contains('vlist-s')) continue;

    const wrapFont = fontFor(wrap, font);
    const pstrut = Array.from(wrap.childNodes).find((n) =>
      n.classList?.contains('pstrut')
    );
    // See the header: makeVList writes top = -(pstrutSize + currPos + depth),
    // and currPos + depth is the child's baseline above the vlist's.
    const top = lengthOf(wrap, 'top', wrapFont);
    const strut = pstrut ? lengthOf(pstrut, 'height', fontFor(pstrut, wrapFont)) : 0;
    const above =
      Number.isFinite(top) && Number.isFinite(strut) ? -(top + strut) : 0;

    const placed = layoutInline(wrap, wrapFont);
    // makeVList puts the italic correction of a superscript on the wrapper
    // itself, so it belongs to the stack's width as much as to its offset.
    const marginLeft = edge(wrap, wrapFont, 'margin-left');
    const marginRight = edge(wrap, wrapFont, 'margin-right');

    const row = {
      items: placed.items.map((item) => ({ ...item, x: item.x + marginLeft, y: item.y - above })),
      width: marginLeft + placed.width + marginRight,
      // A fraction bar and a radical are as wide as the stack around them, so
      // neither may be what sets that width.
      stretches: placed.items.length > 0 && placed.items.every((i) => i.width === null),
      align: textAlign(wrap),
    };
    stack.push(row);
    if (!row.stretches) width = Math.max(width, row.width);
  }

  // Each row is a block filling the stack, so its contents sit where its
  // text-align puts them: a numerator is centred over its denominator, a sum's
  // limits over its sigma, but a superscript stays hard against the left.
  const items = [];
  for (const row of stack) {
    // A row that stretches already spans the stack; aligning it inside itself
    // would push the fraction bar off the end of its own fraction.
    const slack = row.stretches ? 0 : Math.max(0, width - row.width);
    const offset = row.align === 'center' ? slack / 2 : row.align === 'right' ? slack : 0;
    for (const item of row.items) {
      if (item.width === null) item.width = Math.max(width, item.minWidth ?? 0);
      items.push(offset ? { ...item, x: item.x + offset } : item);
    }
  }

  return { width, items };
}

/**
 * An <svg> KaTeX embedded — the head of a radical, a stretched brace, an arrow.
 *
 * These are drawn deliberately oversized (a radical's viewBox is 400000 units
 * wide so the bar can stretch over any radicand) and cropped to the wrapper by
 * `overflow: hidden` plus `preserveAspectRatio="xMinYMin slice"`.
 *
 * Rather than lean on `slice`, which a rasterizer has to implement for a nested
 * <svg> to get this right, the visible part is stated outright: narrowing the
 * viewBox to the wrapper's own aspect ratio makes the ordinary "meet" fit and
 * "slice" the same picture, and the nested viewport does the cropping.
 */
function layoutEmbeddedSvg(svg, font, wrapper = null) {
  const box = wrapper ?? svg;
  const boxFont = wrapper ? fontFor(wrapper, font) : font;
  const height = lengthOf(box, 'height', boxFont);
  if (!Number.isFinite(height) || !(height > 0)) return null;

  const source = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const viewBox =
    source.length === 4 && source.every(Number.isFinite) && source[3] > 0 ? source : null;

  // `.hide-tail` is `width: 100%`, so a radical is as wide as the stack it
  // covers and its `min-width` is only a floor. Reporting a width here instead
  // would crop the sign back to its head and lose the bar over the radicand.
  const stretches = wrapper?.classList?.contains('hide-tail');
  const minWidth = lengthOf(box, 'min-width', boxFont);
  const width = stretches ? null : lengthOf(box, 'width', boxFont);
  if (!stretches && !Number.isFinite(width)) return null;

  // An inline-block that hides its overflow sits on the baseline by its bottom
  // edge, so the box hangs entirely above it.
  return {
    width: stretches ? 0 : width,
    items: [
      {
        type: 'image',
        el: svg,
        viewBox,
        x: 0,
        y: -height,
        width,
        minWidth: Number.isFinite(minWidth) ? minWidth : 0,
        height,
      },
    ],
  };
}
