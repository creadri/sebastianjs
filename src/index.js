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

  // Polyfill minimal SVG measurement APIs used by Mermaid
  const avgCharWidth = 8; // rough estimate
  const lineHeight = 14;  // rough estimate
  const ensureProto = (ctor, name, fn) => {
    if (ctor && !ctor.prototype[name]) {
      Object.defineProperty(ctor.prototype, name, { value: fn, configurable: true });
    }
  };
  const getBBoxStub = function () {
    const text = (this.textContent || '').split('\n');
    const width = Math.max(0, ...text.map(t => t.length * avgCharWidth)) + 10;
    const height = Math.max(1, text.length) * lineHeight + 10;
    return { x: 0, y: 0, width, height };
  };
  const getComputedTextLengthStub = function () {
    return (this.textContent || '').length * avgCharWidth;
  };
  ensureProto(window.SVGElement, 'getBBox', getBBoxStub);
  ensureProto(window.SVGGraphicsElement, 'getBBox', getBBoxStub);
  ensureProto(window.SVGTextContentElement, 'getComputedTextLength', getComputedTextLengthStub);
  ensureProto(window.SVGElement, 'getComputedTextLength', getComputedTextLengthStub);

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
