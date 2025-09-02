import { JSDOM } from 'jsdom';

export async function render(definition, options = {}) {
  // Create an HTML window/document with jsdom
  const { window } = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const { document } = window;

  // Minimal globals expected by libraries
  global.window = window;
  global.document = document;
  if (typeof global.navigator === 'undefined') {
    Object.defineProperty(global, 'navigator', {
      value: { userAgent: 'node.js' },
      configurable: true,
      writable: false,
      enumerable: false,
    });
  }
  // requestAnimationFrame noop
  global.requestAnimationFrame = global.requestAnimationFrame || (cb => setTimeout(() => cb(Date.now()), 0));
  window.requestAnimationFrame = window.requestAnimationFrame || global.requestAnimationFrame;

  // Polyfill SVG measurement APIs used by Mermaid. Try precise canvas-based
  // text metrics first; fall back to rough stubs if canvas isn't available.
  const ensureProto = (ctor, name, fn) => {
    if (ctor && !ctor.prototype[name]) {
      Object.defineProperty(ctor.prototype, name, { value: fn, configurable: true });
    }
  };

  async function installTextMetrics(win) {
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
        } catch (_) { /* ignore registration failures */ }
      };
      applyUserFonts();

      const canvas = createCanvas(1, 1);
      const ctx = canvas.getContext('2d');

      const defaultFontSize = 16;
      const defaultFamily = (options?.themeVariables?.fontFamily)
        || process.env.SEBASTIANJS_DEFAULT_FONT_FAMILY
        || 'Arial, Helvetica, sans-serif';
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
      const measureTextBlock = (el) => {
        const size = setCtxFont(el);
        const lines = (el.textContent || '').split('\n');
        let width = 0;
        for (const ln of lines) width = Math.max(width, ctx.measureText(ln).width || 0);
        // Approximate height using font metrics if available; fallback to 1.2*size
        const metrics = ctx.measureText('Mg');
        const ascent = metrics.actualBoundingBoxAscent || size * 0.8;
        const descent = metrics.actualBoundingBoxDescent || size * 0.2;
        const lineH = ascent + descent;
        const height = Math.max(1, lines.length) * lineH;
        return { width, height };
      };

      const getBBoxCanvas = function () {
        if (String(this.tagName).toLowerCase() === 'text') {
          const { width, height } = measureTextBlock(this);
          // Add a small padding similar to browsers' tight bboxes
          return { x: 0, y: 0, width: width + 2, height: height + 2 };
        }
        // Fallback minimal bbox for non-text nodes; Mermaid mainly queries text
        const w = parseFloat(this.getAttribute?.('width') || '0');
        const h = parseFloat(this.getAttribute?.('height') || '0');
        return { x: 0, y: 0, width: isFinite(w) ? w : 0, height: isFinite(h) ? h : 0 };
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

  await installTextMetrics(window);

  // Prepare DOMPurify for Mermaid; support both factory and object default export
  async function ensureDomPurify(win) {
    const shim = () => {
      const purify = (html) => html;
      purify.sanitize = (html) => html;
      purify.addHook = () => {};
      purify.removeHook = () => {};
      return purify;
    };
    try {
      const mod = await import('dompurify');
      const dp = mod?.default ?? mod;
      // Patch the module export so downstream imports (e.g., Mermaid) see a sanitize API
      if (typeof dp === 'function') {
        if (typeof dp.sanitize !== 'function') dp.sanitize = (html) => html;
        if (!dp.addHook) dp.addHook = () => {};
        if (!dp.removeHook) dp.removeHook = () => {};
      } else if (dp && typeof dp === 'object') {
        if (typeof dp.sanitize !== 'function') dp.sanitize = (html) => html;
        if (!dp.addHook) dp.addHook = () => {};
        if (!dp.removeHook) dp.removeHook = () => {};
      }

      const inst = typeof dp === 'function' ? dp(win) : dp;
      if (typeof inst === 'function' && typeof inst.sanitize !== 'function') inst.sanitize = (html) => html;
      if (!inst || typeof inst.sanitize !== 'function') return shim();
      if (!inst.addHook) inst.addHook = () => {};
      if (!inst.removeHook) inst.removeHook = () => {};
      return inst;
    } catch (_) {
      return shim();
    }
  }
  window.DOMPurify = await ensureDomPurify(window);

  // Import mermaid only after environment is ready
  const { default: mermaid } = await import('mermaid');

  const initConfig = {
    startOnLoad: false,
    securityLevel: 'loose',
    htmlLabels: false,
    flowchart: { htmlLabels: false },
  };
  if (options && options.theme) initConfig.theme = options.theme;
  if (options && options.themeVariables) initConfig.themeVariables = options.themeVariables;
  if (options && options.themeCSS) initConfig.themeCSS = options.themeCSS;
  mermaid.initialize(initConfig);

  // Use an explicit container inside body
  const container = document.createElement('div');
  document.body.appendChild(container);
  const result = await mermaid.render('graph', definition, container);
  const svg = result?.svg || container.innerHTML || '';

  // Cleanup
  delete global.window;
  delete global.document;

  // Optional: normalize viewBox post-process
  if (options.normalizeViewBox) {
    try {
      return normalizeViewBox(svg, options.viewBoxMargin ?? 4);
    } catch (e) {
      // Fallback to raw svg on failure
    }
  }
  return svg;
}

// Parse SVG and compute a union bbox of visible rect nodes, accounting for simple translate() transforms on ancestor groups.
function normalizeViewBox(svgString, margin = 4) {
  // jsdom can parse XML with image/svg+xml
  const dom = new JSDOM(svgString, { contentType: 'image/svg+xml' });
  const doc = dom.window.document;
  const svg = doc.documentElement;
  if (!svg || svg.tagName.toLowerCase() !== 'svg') return svgString;

  const rects = Array.from(svg.querySelectorAll('rect'));
  if (rects.length === 0) return svgString;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const parseTranslate = (transform) => {
    let x = 0, y = 0;
    if (!transform) return { x, y };
    // handle translate(x,y) or translate(x)
    const m = /translate\(([^)]+)\)/.exec(transform);
    if (m) {
      const parts = m[1].split(/[,\s]+/).map(Number).filter(n => !Number.isNaN(n));
      if (parts.length >= 1) x += parts[0];
      if (parts.length >= 2) y += parts[1];
    }
    return { x, y };
  };

  const getAbsOffset = (el) => {
    let tx = 0, ty = 0;
    let cur = el.parentElement;
    while (cur && cur !== svg) {
      const t = parseTranslate(cur.getAttribute('transform'));
      tx += t.x; ty += t.y;
      cur = cur.parentElement;
    }
    return { x: tx, y: ty };
  };

  for (const r of rects) {
    const x = parseFloat(r.getAttribute('x') || '0');
    const y = parseFloat(r.getAttribute('y') || '0');
    const w = parseFloat(r.getAttribute('width') || '0');
    const h = parseFloat(r.getAttribute('height') || '0');
    const o = getAbsOffset(r);
    minX = Math.min(minX, x + o.x);
    minY = Math.min(minY, y + o.y);
    maxX = Math.max(maxX, x + w + o.x);
    maxY = Math.max(maxY, y + h + o.y);
  }

  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
    return svgString;
  }

  const vbX = Math.floor(minX - margin);
  const vbY = Math.floor(minY - margin);
  const vbW = Math.ceil((maxX - minX) + margin * 2) || 1;
  const vbH = Math.ceil((maxY - minY) + margin * 2) || 1;

  svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
  // Optional: drop extreme style max-width or width attributes to let viewBox drive layout
  svg.removeAttribute('width');
  svg.removeAttribute('height');

  return svg.outerHTML;
}
