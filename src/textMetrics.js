// Polyfill SVG measurement APIs used by Mermaid. Try precise canvas-based
// text metrics first; fall back to rough stubs if canvas isn't available.
const ensureProto = (ctor, name, fn) => {
  if (ctor && !ctor.prototype[name]) {
    Object.defineProperty(ctor.prototype, name, { value: fn, configurable: true });
  }
};

/**
 * Installs text metrics using node-canvas for accurate SVG text measurement.
 * @param {Window} win - The JSDOM window object.
 * @param {Object} options - Rendering options including fonts.
 * @returns {Promise<boolean>} - True if installed successfully.
 * @throws {Error} - If canvas is not available.
 */
export async function installTextMetrics(win, options = {}) {
  // Attempt to use node-canvas for realistic text measurement
  try {
    const { createCanvas, registerFont } = await import('canvas');
    // Allow consumers to provide fonts instead of hardcoding system paths.
    // - options.fonts: [{ path, family, weight?, style? }, ...]
    // - Env vars: SEBASTIANJS_FONT_PATH, SEBASTIANJS_FONT_FAMILY, SEBASTIANJS_FONT_WEIGHT, SEBASTIANJS_FONT_STYLE
    const applyUserFonts = () => {
      try {
        const list = Array.isArray(options?.fonts) ? options.fonts : [];
        for (const f of list) {
          if (f?.path && f?.family) {
            registerFont(f.path, { family: f.family, weight: f.weight, style: f.style });
          }
        }
        if (process?.env?.SEBASTIANJS_FONT_PATH && process?.env?.SEBASTIANJS_FONT_FAMILY) {
          registerFont(process.env.SEBASTIANJS_FONT_PATH, {
            family: process.env.SEBASTIANJS_FONT_FAMILY,
            weight: process.env.SEBASTIANJS_FONT_WEIGHT,
            style: process.env.SEBASTIANJS_FONT_STYLE,
          });
        }
        // Try registering DejaVu Sans from common locations in Debian based containers
        try {
          registerFont('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', { family: 'DejaVu Sans' });
        } catch (_) { /* ignore if not present */ }
      } catch (_) { /* ignore registration failures */ }
    };
    applyUserFonts();

    const canvas = createCanvas(1, 1);
    const ctx = canvas.getContext('2d');

    const defaultFontSize = 12;
    const defaultFamily = (options?.themeVariables?.fontFamily)
      || process.env.SEBASTIANJS_DEFAULT_FONT_FAMILY
      || '"trebuchet ms", Verdana, Arial, sans-serif';
    const getFontSize = (el) => {
      const v = el?.getAttribute?.('font-size') || el?.style?.fontSize || defaultFontSize;
      const n = parseFloat(String(v));
      return Number.isFinite(n) ? n : defaultFontSize;
    };
    const getFontWeight = (el) => (el?.getAttribute?.('font-weight') || el?.style?.fontWeight || 'normal');
    const getFontFamily = () => defaultFamily;
    const setCtxFont = (el) => {
      const size = getFontSize(el);
      const weight = getFontWeight(el);
      const family = getFontFamily();
      ctx.font = `${weight} ${size}px ${family}`;
      return size;
    };

    const measureTextWidth = (el, text) => {
      setCtxFont(el);
      const m = ctx.measureText(text || '');
      return m.width || 0;
    };
    const extractLines = (el) => {
      // Prefer mermaid's line tspans when present
      const tspans = el.querySelectorAll ? el.querySelectorAll('tspan.text-outer-tspan') : [];
      if (tspans && tspans.length > 0) {
        return Array.from(tspans, t => (t.textContent || ''));
      }
      // Fallback: split on explicit newlines
      return (el.textContent || '').split('\n');
    };

    const measureTextBlock = (el) => {
      const size = setCtxFont(el);
      const lines = extractLines(el);
      let width = 0;
      for (const ln of lines) width = Math.max(width, ctx.measureText(ln).width || 0);
      // Use a stable 1.2x font-size per line to better match CLI headless Chrome
      const lineH = size * 1.2;
      const height = Math.max(1, lines.length) * lineH;
      return { width, height };
    };

    const getBBoxCanvas = function () {
      const tag = String(this.tagName || '').toLowerCase();
      if (tag === 'text' || tag === 'tspan') {
        const { width, height } = measureTextBlock(this);
        // Slight padding to approximate CLI bounds
        return { x: 0, y: 0, width: width + 5, height: height + 5 };
      }
      // If element has width/height, use those
      const wAttr = parseFloat(this.getAttribute?.('width') || 'NaN');
      const hAttr = parseFloat(this.getAttribute?.('height') || 'NaN');
      if (Number.isFinite(wAttr) && Number.isFinite(hAttr)) {
        return { x: 0, y: 0, width: wAttr, height: hAttr };
      }
      // Otherwise, union of children bboxes (common for <g> labels)
      if (this.children && this.children.length) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const child of this.children) {
          if (typeof child.getBBox === 'function') {
            const b = child.getBBox();
            minX = Math.min(minX, b.x);
            minY = Math.min(minY, b.y);
            maxX = Math.max(maxX, b.x + b.width);
            maxY = Math.max(maxY, b.y + b.height);
          }
        }
        if (isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY)) {
          return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
        }
      }
      return { x: 0, y: 0, width: 0, height: 0 };
    };
    const getComputedTextLengthCanvas = function () {
      return measureTextWidth(this, this.textContent || '');
    };

    ensureProto(win.SVGElement, 'getBBox', getBBoxCanvas);
    ensureProto(win.SVGGraphicsElement, 'getBBox', getBBoxCanvas);
    ensureProto(win.SVGTextContentElement, 'getComputedTextLength', getComputedTextLengthCanvas);
    ensureProto(win.SVGElement, 'getComputedTextLength', getComputedTextLengthCanvas);
    return true;
  } catch (err) {
    // Canvas must be available; surface a clear error
    throw new Error('SebastianJS requires the "canvas" package for accurate text measurement. Install it with npm i canvas.\nOriginal error: ' + (err?.message || String(err)));
  }
}
