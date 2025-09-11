import { JSDOM } from 'jsdom';

/**
 * Sets up the JSDOM environment and global polyfills required for Mermaid rendering.
 * @param {Object} options - Rendering options.
 * @returns {Object} - { window, document }
 */
export function setupEnvironment(options = {}) {
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

  return { window, document };
}
