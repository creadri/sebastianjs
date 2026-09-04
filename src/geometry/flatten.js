// Rewrite mermaid's <foreignObject> HTML labels as SVG <text>.
//
// HTML labels are mermaid's default and render correctly in a browser, but
// librsvg and resvg do not implement <foreignObject> at all and Inkscape only
// partly does, so every label vanishes in a non-browser rasterizer. The usual
// escape hatch — mermaid's own htmlLabels:false — avoids the problem by
// measuring and drawing a different label, which moves every node and shows
// markdown, entities and raw HTML literally.
//
// This does not re-measure anything. html.js already lays the label out to
// decide how big the node is, and layoutLines() hands back the runs that
// produced each line. Turning those lines into <tspan>s changes only the leaf:
// the diagram keeps the geometry it was laid out with, and <b>/<i>, entities
// and markdown emphasis survive as real styled text.
//
// A replaced element in a label — an <img>, or an inline <svg> — becomes an
// <image> or a cloned <svg> beside the text, placed from the box's offset along
// its line and its CSS vertical-align. Only boxes with no SVG equivalent at all
// (<canvas>, <video>, <iframe>) keep their <foreignObject>, and are reported in
// `skipped`.
import { htmlLayout, inheritedProperty, declaredProperty } from './html.js';
import { blinkVerticalMetrics } from './calibrate.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Replaced elements with no SVG equivalent to emit. */
const UNSUPPORTED = new Set(['canvas', 'video', 'iframe', 'object', 'embed']);

/**
 * Replace every <foreignObject> label under `root` with equivalent SVG <text>.
 *
 * @param {Element} root  an <svg> element, in a document whose stylesheet is
 *                        reachable — the label's fonts and colours come from
 *                        the diagram's own <style>.
 * @returns {{converted: number, skipped: number, emptied: number}}
 */
export function flattenForeignObjects(root) {
  const stats = { converted: 0, skipped: 0, emptied: 0 };

  for (const fo of foreignObjects(root)) {
    const host = elementChild(fo);
    if (!host) {
      fo.remove();
      stats.emptied++;
      continue;
    }
    if (hasUnsupportedContent(host)) {
      stats.skipped++;
      continue;
    }

    const layout = htmlLayout(host);
    // A box whose size never resolved — an image that failed to load, say —
    // would draw as nothing. Leaving the whole label as HTML at least keeps it
    // rendering in a browser, which dropping it would not.
    if (layout && !boxesAreDrawable(layout)) {
      stats.skipped++;
      continue;
    }

    const drawn = layout ? buildLabel(fo, host, layout) : [];
    if (!drawn.length) {
      // An empty label — mermaid emits one per unlabelled edge. Dropping it is
      // what the browser draws anyway.
      fo.remove();
      stats.emptied++;
      continue;
    }

    // The HTML background-color that painted the plate behind an edge label has
    // no equivalent on <text>, so it becomes a rect of its own.
    for (const plate of buildPlates(fo, host)) fo.parentNode.insertBefore(plate, fo);

    for (const node of drawn) fo.parentNode.insertBefore(node, fo);
    fo.remove();
    stats.converted++;
  }

  return stats;
}

/** Depth-first collection, so a label is only visited once. */
function foreignObjects(root) {
  const found = [];
  const walk = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== 1) continue;
      if (child.namespaceURI === SVG_NS && child.localName === 'foreignObject') {
        found.push(child);
        continue; // its contents are HTML; nothing nested to convert
      }
      walk(child);
    }
  };
  walk(root);
  return found;
}

const elementChild = (el) =>
  Array.from(el.childNodes).find((n) => n.nodeType === 1) || null;

/** True when every replaced box in the layout has something to draw. */
function boxesAreDrawable(layout) {
  for (const block of layout.blocks) {
    for (const line of block.lines) {
      for (const run of line.runs) {
        if (run.type !== 'box') continue;
        const box = run.item;
        // A formula draws from its own laid-out items, not from `el`.
        if (box.katex) continue;
        if (!box.el || !(box.width > 0) || !(box.height > 0)) return false;
        if (box.el.localName !== 'svg' && !box.el.getAttribute('src')) return false;
      }
    }
  }
  return true;
}

function hasUnsupportedContent(host) {
  if (UNSUPPORTED.has(host.localName)) return true;
  for (const el of host.getElementsByTagName('*')) {
    if (UNSUPPORTED.has(el.localName)) return true;
  }
  return false;
}

function buildLabel(fo, host, layout) {
  const document = fo.ownerDocument;

  const boxX = numberAttribute(fo, 'x', 0);
  const boxY = numberAttribute(fo, 'y', 0);
  // Needed by the formula boxes as well as the label's own <text>, which is
  // built further down.
  const fill = colourOf(host);
  const boxWidth = numberAttribute(fo, 'width', layout.width);
  const boxHeight = numberAttribute(fo, 'height', layout.height);

  // text-align is the only alignment mermaid uses, and it is always on the
  // wrapping div. A line of pure text is anchored rather than offset by its own
  // width, so the rasterizer's shaping — which can differ from ours by a
  // fraction of a pixel — spreads either side of centre instead of accumulating
  // on one edge. `fraction` is how much of a line's width sits left of that
  // anchor, which is what turns a run's offset into an absolute x.
  const align = (inheritedProperty(host, 'text-align') || 'start').toLowerCase();
  let anchor = 'start';
  let fraction = 0;
  if (align === 'center') {
    anchor = 'middle';
    fraction = 0.5;
  } else if (align === 'right' || align === 'end') {
    anchor = 'end';
    fraction = 1;
  }
  const anchorX = boxX + boxWidth * fraction;

  // The box and the layout agree whenever the same measurement produced both,
  // which is the normal case; centring absorbs the drift when they do not.
  let lineTop = boxY + (boxHeight - layout.height) / 2;

  const base = layout.blocks.find((block) => block.font)?.font ?? null;
  const text = document.createElementNS(SVG_NS, 'text');
  const boxes = [];

  for (const block of layout.blocks) {
    const strut = block.font ?? base;
    for (const line of block.lines) {
      const top = lineTop;
      const baseline = top + baselineWithin(block, line, strut);
      const lineLeft = anchorX - line.width * fraction;
      lineTop += block.boxHeight;

      for (const segment of segmentsOf(line)) {
        if (segment.type === 'box') {
          boxes.push(
            ...buildBox(document, segment.run, lineLeft, top, baseline, block, strut, fill)
          );
          continue;
        }
        const tspan = document.createElementNS(SVG_NS, 'tspan');
        for (const run of segment.runs) tspan.appendChild(runNode(document, run, base));
        if (!tspan.childNodes.length) continue;
        // A line broken up by a box cannot be anchored as one chunk: its pieces
        // have to keep the offsets the boxes were placed against, so each is
        // pinned at its own left edge instead.
        if (segment.pinned) {
          tspan.setAttribute('x', round(lineLeft + segment.x));
          tspan.setAttribute('style', 'text-anchor:start');
        } else {
          tspan.setAttribute('x', round(anchorX));
        }
        tspan.setAttribute('y', round(baseline));
        text.appendChild(tspan);
      }
    }
  }

  const drawn = [];
  if (text.childNodes.length) {
    const className = labelClass(host);
    if (className) text.setAttribute('class', className);
    // An absolute x on a <tspan> starts a new text chunk, so text-anchor applies
    // to each line on its own and the nested run spans stay inside that chunk.
    //
    // Inline rather than as a presentation attribute: the anchor is half of the
    // position the layout computed, and mermaid's own `.node .label text` rule
    // sets text-anchor too. They agree today, but a stylesheet that disagreed
    // would silently shift every line of the label off its measured centre.
    text.setAttribute('style', `text-anchor:${anchor}`);
    applyFont(text, base, null);
    // Colour, by contrast, stays a presentation attribute so that themeCSS can
    // still recolour labels the way it does for mermaid's own <text> path.
    if (fill) text.setAttribute('fill', fill);
    // Spaces at a run boundary are inside a <tspan> edge, where SVG's default
    // whitespace handling would drop them: "Label <b>bold</b>" would come out as
    // "Labelbold". The runs carry exactly the text their widths were measured
    // from, so preserving them verbatim is also what keeps drawing and layout in
    // agreement.
    text.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    drawn.push(text);
  }

  // Boxes first, so text overlapping one is never hidden behind it.
  return [...boxes, ...drawn];
}

/**
 * Split a line into runs of text and the boxes between them. A line with no box
 * on it is a single segment and stays anchored; anything else has to be pinned.
 */
function segmentsOf(line) {
  const pinned = line.runs.some((run) => run.type === 'box');
  const segments = [];
  let current = null;

  for (const run of line.runs) {
    if (run.type === 'box') {
      current = null;
      segments.push({ type: 'box', run });
      continue;
    }
    if (!current) {
      current = { type: 'text', runs: [], x: run.x, pinned };
      segments.push(current);
    }
    current.runs.push(run);
  }
  return segments;
}

/**
 * Where the baseline sits inside a line box, measured from its top.
 *
 * With only text on the line this is CSS half-leading: the content area
 * (ascent + descent) is centred in the line box and the baseline sits an ascent
 * below its top. Open Sans at 16px with line-height 1.5 gives
 * (24 - 22) / 2 + 17 = 18, which is where Chrome puts it.
 *
 * A replaced box pushes the baseline down when it needs more room above the
 * baseline than the strut does: an 80px image on a 24px strut has to start at
 * the top of the line box, not 18px into it.
 */
function baselineWithin(block, line, font) {
  let baseline = strutBaseline(block.lineHeight, font);

  for (const run of line.runs) {
    if (run.type !== 'box') continue;
    const above = aboveBaseline(run.item, font);
    if (above > baseline) baseline = above;
  }
  return baseline;
}

function strutBaseline(lineHeight, font) {
  const face = font?.registry?.resolve(font.fontFamily, font.fontWeight, font.fontStyle);
  // No metrics to place it with: sit on the bottom of the line box, which is
  // wrong by the descent but keeps the text inside its own box.
  if (!face) return lineHeight;
  const { ascent, descent } = blinkVerticalMetrics(face, font.fontSize);
  return (lineHeight - (ascent + descent)) / 2 + ascent;
}

/**
 * How far a box's top edge sits above the baseline, given its vertical-align.
 * `top` and `bottom` align with the line box instead and are handled by the
 * caller, so they ask for no room above the baseline at all.
 */
function aboveBaseline(box, font) {
  const { keyword, raise } = box.verticalAlign ?? { keyword: 'baseline', raise: 0 };
  const face = font?.registry?.resolve(font.fontFamily, font.fontWeight, font.fontStyle);
  const metrics = face ? blinkVerticalMetrics(face, font.fontSize) : null;

  switch (keyword) {
    // A length raises the box's bottom edge above the baseline by that much, so
    // mermaid's `vertical-align: -0.125em` lowers an icon by 2px at 16px.
    case 'length':
      return box.height + raise;
    case 'text-top':
      return metrics ? metrics.ascent : box.height;
    case 'text-bottom':
      return metrics ? box.height - metrics.descent : box.height;
    case 'middle':
      // The box's midpoint meets the baseline plus half an x-height.
      return face
        ? box.height / 2 + (face.xHeight / face.unitsPerEm) * font.fontSize / 2
        : box.height / 2;
    case 'top':
    case 'bottom':
      return 0;
    // `baseline`, plus `sub`/`super` and percentages, which would need the
    // font's own subscript metrics or the line-height to resolve. They sit on
    // the baseline, which is where `baseline` itself puts them.
    default:
      return box.height;
  }
}

/**
 * The <image> — or, for an inline <svg>, a clone of it — that stands in for a
 * replaced box. Its offset along the line came out of the layout together with
 * the text around it, so the two stay locked whatever the rasterizer shapes.
 */
function buildBox(document, run, lineLeft, lineTop, baseline, block, font, fill) {
  const box = run.item;
  const el = box.el;
  if (!box.katex && (!el || !(box.width > 0) || !(box.height > 0))) return [];

  const keyword = box.verticalAlign?.keyword ?? 'baseline';
  let y;
  if (keyword === 'top') y = lineTop;
  else if (keyword === 'bottom') y = lineTop + block.boxHeight - box.height;
  else y = baseline - aboveBaseline(box, font);

  // A formula is a box to the line breaker but a set of independently placed
  // glyphs and rules to the renderer. `y` is its top edge, so its own baseline
  // is its height below that.
  if (box.katex) {
    const top = y + box.katex.marginTop;
    return buildKatex(document, box.katex, lineLeft + run.x, top + box.katex.height, fill);
  }

  let node;
  if (el.localName === 'svg') {
    node = el.cloneNode(true);
  } else {
    const href = el.getAttribute('src');
    if (!href) return [];
    node = document.createElementNS(SVG_NS, 'image');
    node.setAttribute('href', href);
    // librsvg and older resvg builds only look at the SVG 1.1 spelling.
    node.setAttributeNS(XLINK_NS, 'xlink:href', href);
  }

  node.setAttribute('x', round(lineLeft + run.x));
  node.setAttribute('y', round(y));
  node.setAttribute('width', round(box.width));
  node.setAttribute('height', round(box.height));
  return [node];
}

/**
 * Draw a laid-out formula at (`x`, `baseline`), as one <g class="katex">.
 *
 * Every run becomes its own <text> rather than a <tspan> inside a shared one.
 * The positions are absolute already, so there is nothing for a shared chunk to
 * buy — and it would cost: resvg resolves a single font per <text> element, so
 * one <text> mixing a KaTeX_Math letter with a KaTeX_Main operator falls back to
 * a substituted face for the whole formula.
 *
 * The class is not decoration. mermaid's own stylesheet carries
 * `.node .katex path`, written for the <svg> shapes KaTeX embeds, and without a
 * `.katex` ancestor those paths are claimed by `.node path` instead and painted
 * in the node's fill — a radical drawn in the node's own background colour.
 */
function buildKatex(document, math, x, baseline, fill) {
  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('class', 'katex');
  const paint = fill || '#000';

  for (const item of math.items) {
    if (item.type === 'text') {
      const node = document.createElementNS(SVG_NS, 'text');
      node.textContent = item.text;
      node.setAttribute('x', round(x + item.x));
      node.setAttribute('y', round(baseline + item.y));
      node.setAttribute('style', 'text-anchor:start');
      applyFont(node, item.font, null);
      if (fill) node.setAttribute('fill', fill);
      node.setAttributeNS(XML_NS, 'xml:space', 'preserve');
      group.appendChild(node);
      continue;
    }

    if (item.type === 'rule') {
      if (!(item.width > 0)) continue;
      // A <path>, not a <rect>: mermaid paints `.node rect` in the node's fill
      // and there is no `.katex rect` to outrank it, so a fraction bar drawn as
      // a rectangle comes out the colour of the box behind it.
      const left = x + item.x;
      const top = baseline + item.y;
      // A bar is a fraction of a pixel at label sizes, and a rasterizer that
      // rounds one down drops the fraction line entirely.
      const thickness = Math.max(item.height, 0.5);
      const node = document.createElementNS(SVG_NS, 'path');
      node.setAttribute(
        'd',
        `M${round(left)},${round(top)}h${round(item.width)}v${round(thickness)}h${round(-item.width)}z`
      );
      paintShape(node, paint);
      group.appendChild(node);
      continue;
    }

    if (item.type === 'image' && item.el) {
      const node = item.el.cloneNode(true);
      node.setAttribute('x', round(x + item.x));
      node.setAttribute('y', round(baseline + item.y));
      node.setAttribute('width', round(item.width));
      node.setAttribute('height', round(item.height));
      // Narrow the viewBox to the box's own aspect ratio so an ordinary "meet"
      // fit shows exactly what `slice` would, and the nested viewport crops the
      // rest. See layoutEmbeddedSvg().
      if (item.viewBox && item.height > 0) {
        const [minX, minY, , vbHeight] = item.viewBox;
        const visible = Math.min(vbHeight * (item.width / item.height), item.viewBox[2]);
        node.setAttribute('viewBox', [minX, minY, visible, vbHeight].map(round).join(' '));
        node.setAttribute('preserveAspectRatio', 'xMinYMin meet');
      }
      // The glyph shapes inside carry no paint of their own and would be left
      // to whichever rule reaches them.
      for (const shape of node.getElementsByTagName('path')) paintShape(shape, paint);
      group.appendChild(node);
    }
  }

  return group.childNodes.length ? [group] : [];
}

/**
 * Paint a shape so that neither the cascade nor the inlineStyles pass can
 * repaint it: an inline style outranks any rule that matches, and applyDeclaration
 * leaves an element alone once its inline style states the property. The
 * presentation attributes are for SVG Tiny renderers, which ignore `style`.
 */
function paintShape(el, fill) {
  el.setAttribute('style', `fill:${fill};stroke:none`);
  el.setAttribute('fill', fill);
  el.setAttribute('stroke', 'none');
}

/**
 * One run of text, carrying only the properties that differ from <text>. A run
 * that differs in nothing needs no <tspan> at all and becomes bare character
 * data, which is the common case: most labels are a single unstyled run.
 */
function runNode(document, run, base) {
  const tspan = document.createElementNS(SVG_NS, 'tspan');
  applyFont(tspan, run.font, base);
  const fill = run.el ? colourOf(run.el) : null;
  const inherited = run.el?.parentNode ? colourOf(run.el.parentNode) : null;
  if (fill && fill !== inherited) tspan.setAttribute('fill', fill);
  if (!tspan.attributes.length) return document.createTextNode(run.text);
  tspan.textContent = run.text;
  return tspan;
}

/** Write font properties onto `el`, skipping any that `base` already states. */
function applyFont(el, font, base) {
  if (!font) return;
  if (font.fontFamily && font.fontFamily !== base?.fontFamily) {
    el.setAttribute('font-family', font.fontFamily);
  }
  if (font.fontSize && font.fontSize !== base?.fontSize) {
    el.setAttribute('font-size', `${round(font.fontSize)}px`);
  }
  const weight = font.fontWeight ?? 400;
  if (weight !== (base ? base.fontWeight ?? 400 : 400)) {
    el.setAttribute('font-weight', String(weight));
  }
  const italic = !!font.fontStyle;
  if (italic !== !!base?.fontStyle) {
    el.setAttribute('font-style', italic ? 'italic' : 'normal');
  }
  const spacing = parseFloat(font.letterSpacing);
  if (Number.isFinite(spacing) && spacing !== 0) {
    el.setAttribute('letter-spacing', round(spacing));
  }
}

/**
 * The rects that stand in for the label's HTML backgrounds — mermaid paints edge
 * labels on a plate so they stay readable over the edge they sit on, using two
 * stacked boxes (`.labelBkg` at alpha 0.5 under `.edgeLabel` at 0.8). One rect
 * per painting box, in tree order, composites the same way the browser does.
 *
 * Each box is drawn at the label's full extent: every one of them is either the
 * table-cell itself or a block filling it, so they share its geometry.
 *
 * The colour is written inline because mermaid's own `.edgeLabel rect` rule
 * would otherwise repaint the rect at opacity 0.5 on top of its own alpha; the
 * browser draws an HTML background at full strength.
 */
function buildPlates(fo, host) {
  const width = numberAttribute(fo, 'width', 0);
  const height = numberAttribute(fo, 'height', 0);
  if (!(width > 0) || !(height > 0)) return [];

  const x = round(numberAttribute(fo, 'x', 0));
  const y = round(numberAttribute(fo, 'y', 0));

  return backgroundsOf(host).map((background) => {
    const rect = fo.ownerDocument.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', round(width));
    rect.setAttribute('height', round(height));
    rect.setAttribute('style', `fill:${background};opacity:1;stroke:none`);
    return rect;
  });
}

const TRANSPARENT = /^(transparent|none|rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*0*\.?0+\s*\))$/i;

/** background-color does not inherit, so look at the label's own boxes. */
function backgroundsOf(host) {
  const found = [];
  for (const el of [host, ...host.getElementsByTagName('*')]) {
    const value = declaredProperty(el, 'background-color')?.trim();
    if (value && !TRANSPARENT.test(value)) found.push(value);
  }
  return found;
}

const colourOf = (el) => inheritedProperty(el, 'color');

/** mermaid's label span carries the class the diagram stylesheet targets. */
function labelClass(host) {
  const spans = host.getElementsByTagName('span');
  for (const span of spans) {
    const className = span.getAttribute('class');
    if (className) return className;
  }
  return host.getAttribute('class') || null;
}

function numberAttribute(el, name, fallback) {
  const value = parseFloat(el.getAttribute(name));
  return Number.isFinite(value) ? value : fallback;
}

/** Four decimals is finer than any rasterizer resolves, and keeps output small. */
const round = (value) => String(Math.round(value * 10000) / 10000);
