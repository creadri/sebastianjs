// Grafts svgdom's geometry engine onto a jsdom window.
//
// jsdom gives us a real HTML document (body, innerHTML, <style>, getComputedStyle,
// a DOM DOMPurify can sanitize) but implements no layout, so every SVG measurement
// API is missing. svgdom has the layout maths but only a token HTML side — mermaid
// cannot even boot on it (it calls d3.select('body') and document.createElement('style')).
// Installing one onto the other gets both halves.
import { SVGMatrix } from './vendor/SVGMatrix.js';
import * as pathUtils from './vendor/pathUtils.js';
import * as regex from './vendor/regex.js';
import { getSegments, getFontDetails, FONT_REGISTRY } from './bbox.js';
import { textAdvance } from './text.js';
import { createDefaultRegistry, parseWeight, parseItalic } from './fonts.js';
import { htmlBoundingRect, VIEWPORT } from './html.js';
import { installImageLoading, IMAGE_OPTIONS } from './images.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const arrayToMatrix = (a) => ({ a: a[0], b: a[1], c: a[2], d: a[3], e: a[4], f: a[5] });

const VIEWPORT_ELEMENTS = ['marker', 'symbol', 'pattern', 'svg', 'view'];
const CTM_BOUNDARY = ['svg', 'symbol', 'image', 'pattern', 'marker'];

const isSvgElement = (node) => node?.namespaceURI === SVG_NS;

/**
 * Install geometry on a jsdom window. Idempotent per window.
 * @param {import('jsdom').DOMWindow} window
 * @param {{ fontRegistry?: import('./fonts.js').FontRegistry,
 *           imageOptions?: object,
 *           viewport?: {width: number, height: number} }} options
 */
export function installGeometry(window, { fontRegistry, imageOptions, viewport } = {}) {
  const registry = fontRegistry ?? createDefaultRegistry();
  window.document[FONT_REGISTRY] = registry;
  window.document[IMAGE_OPTIONS] = imageOptions ?? {};
  // Live object: sebDOM mutates it when a render asks for a different viewport.
  window.document[VIEWPORT] = viewport ?? { width: 0, height: 0 };

  // Without this, an <img> in a label wedges the render: mermaid awaits a load
  // event that jsdom never fires. See images.js.
  installImageLoading(window);

  installComputedInitialValues(window);
  installCanvasMeasurement(window);

  if (window.SVGElement.prototype.getBBox) return registry;

  const proto = window.SVGElement.prototype;

  const define = (name, value) =>
    Object.defineProperty(proto, name, { value, configurable: true, writable: true });

  // --- transforms -----------------------------------------------------------

  define('matrixify', function matrixify() {
    return (this.getAttribute('transform') || '')
      .trim()
      .split(regex.transforms)
      .slice(0, -1)
      .map((str) => {
        const kv = str.trim().split('(');
        return [
          kv[0].trim(),
          kv[1].split(regex.delimiter).map((n) => parseFloat(n.trim())),
        ];
      })
      .reduce((matrix, transform) => {
        if (transform[0] === 'matrix') return matrix.multiply(arrayToMatrix(transform[1]));
        return matrix[transform[0]].apply(matrix, transform[1]);
      }, new SVGMatrix());
  });

  define('generateViewBoxMatrix', function generateViewBoxMatrix() {
    if (!VIEWPORT_ELEMENTS.includes(this.nodeName)) return new SVGMatrix();

    let view = (this.getAttribute('viewBox') || '')
      .split(regex.delimiter)
      .map(parseFloat)
      .filter((el) => !isNaN(el));
    const width = parseFloat(this.getAttribute('width')) || 0;
    const height = parseFloat(this.getAttribute('height')) || 0;
    const x = parseFloat(this.getAttribute('x')) || 0;
    const y = parseFloat(this.getAttribute('y')) || 0;

    if (!width || !height) return new SVGMatrix().translate(x, y);
    if (view.length !== 4) view = [0, 0, width, height];

    return new SVGMatrix()
      .translate(x, y)
      .scale(width / view[2], height / view[3])
      .translate(-view[0], -view[1]);
  });

  define('getInnerMatrix', function getInnerMatrix() {
    const m = this.matrixify();
    if (CTM_BOUNDARY.includes(this.nodeName)) {
      return this.generateViewBoxMatrix().multiply(m);
    }
    return m;
  });

  define('getCTM', function getCTM() {
    let m = this.matrixify();
    let node = this;
    while ((node = node.parentNode)) {
      if (CTM_BOUNDARY.includes(node.nodeName)) break;
      if (!isSvgElement(node)) return this.getScreenCTM();
      m = m.multiply(node.matrixify());
    }
    return node ? node.generateViewBoxMatrix().multiply(m) : m;
  });

  define('getScreenCTM', function getScreenCTM() {
    // Follows Chrome in folding the viewBox into the screen CTM.
    // ref: https://bugzilla.mozilla.org/show_bug.cgi?id=1344537
    const m = this.getInnerMatrix();
    if (isSvgElement(this.parentNode)) {
      return this.parentNode.getScreenCTM().multiply(m);
    }
    return m;
  });

  // --- boxes ----------------------------------------------------------------

  define('getBBox', function getBBox() {
    return getSegments(this).bbox();
  });

  define('getBoundingClientRect', function getBoundingClientRect() {
    // Only our own transform plus the parents' screen CTM — an element's own
    // viewBox does not affect its client rect.
    let m = this.matrixify();
    if (this.parentNode && typeof this.parentNode.getScreenCTM === 'function') {
      m = this.parentNode.getScreenCTM().multiply(m);
    }
    return getSegments(this, false, true).transform(m).bbox();
  });

  // --- text -----------------------------------------------------------------

  const textContent = (el) => el.textContent || '';

  define('getComputedTextLength', function getComputedTextLength() {
    const registryForNode = this.ownerDocument[FONT_REGISTRY];
    return textAdvance(textContent(this), getFontDetails(this), registryForNode);
  });

  define('getNumberOfChars', function getNumberOfChars() {
    return Array.from(textContent(this)).length;
  });

  define('getSubStringLength', function getSubStringLength(charnum, nchars) {
    const chars = Array.from(textContent(this)).slice(charnum, charnum + nchars).join('');
    const registryForNode = this.ownerDocument[FONT_REGISTRY];
    return textAdvance(chars, getFontDetails(this), registryForNode);
  });

  // --- paths ----------------------------------------------------------------

  define('getTotalLength', function getTotalLength() {
    return pathUtils.length(this.getAttribute('d'));
  });

  define('getPointAtLength', function getPointAtLength(len) {
    return pathUtils.pointAtLength(this.getAttribute('d'), len);
  });

  // --- misc SVG plumbing mermaid/d3 touch -----------------------------------

  define('createSVGPoint', function createSVGPoint() {
    return { x: 0, y: 0, matrixTransform(m) {
      return { x: m.a * this.x + m.c * this.y + m.e, y: m.b * this.x + m.d * this.y + m.f };
    } };
  });

  define('createSVGMatrix', function createSVGMatrix() {
    return new SVGMatrix();
  });

  // HTML elements: jsdom implements no layout, so mermaid's foreignObject labels
  // all measure as zero without this. See html.js for the model.
  const defineHtml = (name, value) =>
    Object.defineProperty(window.HTMLElement.prototype, name, {
      value,
      configurable: true,
      writable: true,
    });

  defineHtml('getBoundingClientRect', function getBoundingClientRect() {
    return htmlBoundingRect(this);
  });

  Object.defineProperties(window.HTMLElement.prototype, {
    offsetWidth: { get() { return htmlBoundingRect(this).width; }, configurable: true },
    offsetHeight: { get() { return htmlBoundingRect(this).height; }, configurable: true },
  });

  return registry;
}

// Box-model lengths whose CSS initial value is 0. A browser reports "0px" for
// these on any element that does not set them; jsdom's getComputedStyle returns
// "" for every property outside its small UA stylesheet.
const ZERO_LENGTH_INITIAL =
  /^(?:(?:padding|margin)-(?:top|right|bottom|left)|border-(?:top|right|bottom|left)-width)$/;

// Only the instance is ever patched, so the prototype still holds jsdom's own
// implementation to defer to.
function computedPropertyValue(property) {
  const value = Object.getPrototypeOf(this).getPropertyValue.call(this, property);
  return value === '' && ZERO_LENGTH_INITIAL.test(property) ? '0px' : value;
}

/**
 * Make getComputedStyle report the CSS initial value for the box-model lengths
 * jsdom leaves empty.
 *
 * Consumers subtract these from a measured size, so "" is not a harmless blank:
 * cytoscape sizes a mindmap's layout container with
 * `clientWidth - parseFloat(padding-left) - parseFloat(padding-right)`, which
 * became NaN, made the layout's bounding box come back undefined, and threw
 * "Cannot read properties of undefined (reading 'h')" before a single mindmap
 * node was placed.
 *
 * Only `getPropertyValue` on the object getComputedStyle returns is patched,
 * which is what every consumer here calls. An inline `style` declaration must
 * keep answering "" for a property it does not set — that is how a browser
 * distinguishes a declared 0 from no declaration at all, and html.js reads it
 * that way.
 */
function installComputedInitialValues(window) {
  const native = window.getComputedStyle;
  if (native.patched) return;

  const patched = function getComputedStyle(...args) {
    const style = native.apply(window, args);
    if (style && style.getPropertyValue !== computedPropertyValue) {
      Object.defineProperty(style, 'getPropertyValue', {
        value: computedPropertyValue,
        configurable: true,
        writable: true,
      });
    }
    return style;
  };
  patched.patched = true;
  window.getComputedStyle = patched;
}

// The 2D-context surface cytoscape actually touches. Measured by handing it a
// recording stub: it reads backingStorePixelRatio, sets `font`, and calls
// measureText. Nothing is ever painted, because mermaid uses cytoscape purely
// as a layout engine -- it removes the container before the layout runs and
// only reads node positions back out.
const CSS_FONT = /^\s*(?:(italic|oblique)\s+)?(?:(normal|bold|[1-9]00)\s+)?([\d.]+(?:px|pt|em|rem)?)(?:\s*\/\s*[^\s]+)?\s+(.+)$/i;

/**
 * Give jsdom's <canvas> enough of a 2D context for cytoscape to construct its
 * renderer.
 *
 * jsdom implements getContext() only when the optional `canvas` peer is
 * installed, and throws "Not implemented" otherwise. cytoscape treats a null
 * context as fatal ("Could not create canvas of type 2d"), which took out both
 * diagram types that lay out through it -- mindmap and architecture -- on any
 * machine where the native module was missing. Depending on it would mean
 * reintroducing the cairo/pango toolchain this package deliberately dropped.
 *
 * measureText is answered from the same font metrics as the rest of the
 * geometry engine rather than stubbed at 0. Mermaid overrides layoutDimensions
 * on the nodes it lays out, so cytoscape's own measurements do not currently
 * reach the output -- but a plausible width costs little and keeps a wrong
 * number from quietly becoming load-bearing later.
 */
function installCanvasMeasurement(window) {
  const proto = window.HTMLCanvasElement?.prototype;
  if (!proto || proto.getContext?.sebastianjs) return;

  const context = {
    // Read by cytoscape to work out the device pixel ratio.
    backingStorePixelRatio: 1,
    font: '10px sans-serif',
    measureText(text) {
      const match = CSS_FONT.exec(this.font || '');
      const registry = window.document[FONT_REGISTRY];
      if (!match || !registry) return { width: 0 };
      const [, style, weight, size, family] = match;
      return {
        width: textAdvance(String(text ?? ''), {
          fontFamily: family,
          fontSize: size,
          fontWeight: parseWeight(weight),
          fontStyle: parseItalic(style),
        }, registry),
      };
    },
  };

  // A drawing call is a bug rather than something to emulate, but throwing
  // would break a render over pixels nobody reads, so they are absorbed.
  const noop = () => undefined;
  const getContext = function getContext(type) {
    return type === '2d' ? new Proxy(context, {
      get: (target, prop) => (prop in target ? target[prop] : noop),
    }) : null;
  };
  getContext.sebastianjs = true;
  Object.defineProperty(proto, 'getContext', {
    value: getContext, configurable: true, writable: true,
  });
}
