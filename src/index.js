import mermaid from 'mermaid';
import { JSDOM } from 'jsdom';

export async function render(definition) {
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
  try {
    const mod = await import('dompurify');
    const dp = mod?.default ?? mod;
    const inst = typeof dp === 'function' ? dp(window) : dp;
    // Normalize shape: ensure sanitize function and hooks exist
    if (typeof inst === 'function') {
      inst.sanitize = inst.sanitize || inst; // function can be the sanitizer itself
    }
    if (!inst.addHook) inst.addHook = () => {};
    if (!inst.removeHook) inst.removeHook = () => {};
    window.DOMPurify = inst;
  } catch (_) {
    // optional
  }

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    htmlLabels: false,
    flowchart: { htmlLabels: false },
  });

  // Use an explicit container inside body
  const container = document.createElement('div');
  document.body.appendChild(container);
  const result = await mermaid.render('graph', definition, container);
  const svg = result?.svg || container.innerHTML || '';

  // Cleanup
  delete global.window;
  delete global.document;

  return svg;
}
