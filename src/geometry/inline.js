// Resolve the diagram's stylesheet into SVG presentation attributes.
//
// Mermaid puts essentially all of its paint in a <style> block and addresses it
// by class: a node rect is emitted as `<rect class="basic label-container">`
// with no fill and no stroke of its own. Browsers and Inkscape resolve that
// cascade; renderers built on SVG Tiny -- QtSvg, and so Okular -- do not
// implement stylesheets at all, and fall back to the SVG initial values. The
// whole diagram comes out as black boxes with no strokes.
//
// So every rule that a renderer must understand is written onto the element it
// applies to, where it needs no cascade to be found.
//
// This pass only ever ADDS. The <style> block stays exactly as it was, so a
// renderer that already understood it keeps rendering from it -- CSS wins over
// a presentation attribute, which is precisely the priority that makes this
// safe. Nothing that works today can regress; renderers that saw nothing now
// have something to draw.
import { cssPresentationFor } from './css.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Write the resolved cascade onto every SVG element under `root`.
 *
 * @param {Element} root  an <svg> element, in a document whose <style> the
 *                        cascade can be read from.
 * @returns {{elements: number, properties: number}}
 */
export function inlineStyles(root) {
  const stats = { elements: 0, properties: 0 };

  for (const el of svgElements(root)) {
    const declarations = cssPresentationFor(el);
    if (!declarations) continue;

    let written = 0;
    for (const [property, declaration] of declarations) {
      if (applyDeclaration(el, property, declaration)) written++;
    }
    if (written) {
      stats.elements++;
      stats.properties += written;
    }
  }

  return stats;
}

/**
 * Elements in the SVG namespace only. HTML inside a <foreignObject> is styled
 * by the same sheet but has no presentation attributes to write to, and a label
 * that survived as HTML is one a browser is going to render anyway.
 */
function svgElements(root) {
  const found = [];
  const walk = (node) => {
    if (node.namespaceURI !== SVG_NS) return;
    found.push(node);
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 1) walk(child);
    }
  };
  walk(root);
  return found;
}

/**
 * Write one resolved declaration, respecting the priority the cascade already
 * decided: an inline style beats a rule, so a property the element states for
 * itself is left alone. The exception is `!important`, which beats the inline
 * style — and would then lose to a presentation attribute, so it has to be
 * written back into the inline style to keep the order it won.
 *
 * A presentation attribute already on the element loses to any rule, so a rule
 * that matched is free to overwrite it.
 */
function applyDeclaration(el, property, declaration) {
  const inline = el.style?.getPropertyValue?.(property);
  if (inline) {
    if (!declaration.important) return false;
    el.style.setProperty(property, declaration.value, 'important');
    return true;
  }
  const value = asAttributeValue(declaration.value);
  if (el.getAttribute(property) === value) return false;
  el.setAttribute(property, value);
  return true;
}

/**
 * A CSS length carries a unit; an SVG Tiny attribute length is a bare number,
 * and a renderer that rejects `stroke-width="2px"` falls back to 1 rather than
 * to 2. Since px is 1:1 with a user unit, dropping the suffix costs nothing and
 * is understood everywhere.
 */
const PX_LENGTH = /^(-?(?:\d+\.?\d*|\.\d+))px$/;

function asAttributeValue(value) {
  const match = PX_LENGTH.exec(value.trim());
  return match ? match[1] : value;
}
