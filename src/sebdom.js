import { JSDOM } from 'jsdom';
import { installGeometry } from './geometry/adapter.js';
import { createDefaultRegistry } from './geometry/fonts.js';

/**
 * Build a DOM that mermaid can render into: jsdom for the document, plus
 * svgdom's geometry engine for the measurement APIs jsdom lacks.
 *
 * @param {object} options
 * @param {number} [options.width]  viewport width reported to the page
 * @param {number} [options.height] viewport height reported to the page
 * @param {import('./geometry/fonts.js').FontRegistry} [options.fontRegistry]
 */
export async function sebDOM({ width = 800, height = 600, fontRegistry } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    pretendToBeVisual: true,
  });
  const { window } = dom;

  const registry = installGeometry(window, {
    fontRegistry: fontRegistry ?? createDefaultRegistry(),
  });

  // Mutable so one long-lived window can serve renders with different viewports.
  const viewport = { width, height };

  // jsdom reports 0 for these; mermaid reads them when sizing the diagram.
  Object.defineProperties(window.HTMLElement.prototype, {
    clientWidth: { get() { return this === window.document.body ? viewport.width : 0; }, configurable: true },
    clientHeight: { get() { return this === window.document.body ? viewport.height : 0; }, configurable: true },
  });

  const setViewport = (w, h) => {
    viewport.width = w;
    viewport.height = h;
  };

  // jsdom keeps timers (and, with pretendToBeVisual, a requestAnimationFrame
  // loop) alive until the window is closed. A library that leaks one window per
  // render would keep a long-running server's event loop busy, so callers must
  // close; render() does it in a finally.
  const close = () => window.close();

  return { window, document: window.document, dom, fontRegistry: registry, close, setViewport };
}

/**
 * Publish a window on globalThis for the duration of `fn`, then restore.
 * mermaid and d3 read the globals directly rather than taking an injected
 * document, so there is no way around this; scoping it keeps it from leaking.
 */
export async function withGlobalDOM(window, fn) {
  // Anything mermaid or d3 reads off the global object. Missing entries surface
  // as "X is not defined" from deep inside a diagram renderer: `screen` broke
  // every C4 diagram and `Option` broke a sequence diagram, both of which render
  // fine once forwarded.
  const keys = [
    'window', 'document', 'navigator', 'location', 'screen', 'history',
    'Node', 'Element', 'HTMLElement', 'SVGElement', 'DocumentFragment',
    'Text', 'Comment', 'Image', 'Option', 'DOMParser', 'XMLSerializer',
    'NodeFilter', 'CustomEvent', 'Event', 'MutationObserver', 'ResizeObserver',
    'IntersectionObserver', 'DOMRect', 'getComputedStyle', 'matchMedia',
    'requestAnimationFrame', 'cancelAnimationFrame',
  ];
  const saved = new Map();
  for (const key of keys) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === 'window' ? window : window[key];
    if (value === undefined) continue;
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  try {
    return await fn();
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}
