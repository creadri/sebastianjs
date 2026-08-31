import { sebDOM, withGlobalDOM } from './sebdom.js';
import { createDefaultRegistry } from './geometry/fonts.js';
import { FONT_REGISTRY } from './geometry/bbox.js';

// mermaid (and the d3 and DOMPurify instances inside it) is a module singleton
// that binds to whichever window exists when it is first imported. Building a
// fresh jsdom per render leaves those bindings pointing at a closed window, and
// every render after the first returns an empty string. So the window is created
// once and reused, and renders are serialized because the singleton — and the
// globals it reads — cannot support two renders interleaving at an await.
let domPromise = null;
let queue = Promise.resolve();
let renderCounter = 0;

function sharedDOM() {
  domPromise ??= sebDOM({});
  return domPromise;
}

/** Close the shared DOM. Optional: it holds no timers, but frees the window. */
export async function dispose() {
  if (!domPromise) return;
  const dom = await domPromise;
  domPromise = null;
  dom.close();
}

/**
 * Render a mermaid definition to an SVG string, with no headless browser.
 *
 * Calls are serialized internally, so concurrent invocations are safe but do
 * not run in parallel.
 *
 * @param {string} definition        mermaid source
 * @param {object} [options]
 * @param {number} [options.width]   viewport width the page reports (layout hint,
 *                                   not the output size — mermaid sizes the SVG
 *                                   from the diagram's own bounding box)
 * @param {number} [options.height]  viewport height the page reports
 * @param {string} [options.fontFamily] font for all diagram text. Defaults to a
 *                                   bundled family so output is deterministic;
 *                                   mermaid's own default names Trebuchet/Verdana,
 *                                   which are not redistributable and would fall
 *                                   back silently to different metrics.
 * @param {import('./geometry/fonts.js').FontRegistry} [options.fontRegistry]
 * @param {string} [options.theme]          mermaid theme name, e.g. 'dark'
 * @param {object} [options.themeVariables] mermaid theme variable overrides
 * @param {string} [options.themeCSS]       extra CSS appended to the diagram
 * @param {object} [options.mermaidConfig]  merged over the defaults below
 * @returns {Promise<string>} the SVG markup
 */
export async function render(definition, options = {}) {
  const run = () => renderOne(definition, options);
  // Chain onto the queue whether or not the previous render failed.
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

async function renderOne(definition, options) {
  const {
    width = 800,
    height = 600,
    fontFamily = 'Open Sans',
    fontRegistry,
    theme,
    themeVariables,
    themeCSS,
    mermaidConfig = {},
  } = options;

  const { window, document, setViewport } = await sharedDOM();
  setViewport(width, height);
  if (fontRegistry) document[FONT_REGISTRY] = fontRegistry;

  const container = document.createElement('div');
  document.body.appendChild(container);

  try {
    return await withGlobalDOM(window, async () => {
      const { default: mermaid } = await import('mermaid');

      mermaid.initialize({
        startOnLoad: false,
        fontFamily,
        ...(theme ? { theme } : {}),
        ...(themeVariables ? { themeVariables } : {}),
        ...(themeCSS ? { themeCSS } : {}),
        // SVG <text> instead of HTML in <foreignObject>. foreignObject content is
        // laid out by the CSS engine, which we do not implement; the <text> path
        // is measured with font metrics that match Chrome to ~0.01%. See README.
        htmlLabels: false,
        ...mermaidConfig,
        flowchart: { ...mermaidConfig.flowchart, htmlLabels: false },
        class: { ...mermaidConfig.class, htmlLabels: false },
      });

      // mermaid derives DOM ids from this; it must be unique per render or a
      // second render in the same process collides with the first.
      const id = `sebastianjs-${++renderCounter}`;
      const { svg } = await mermaid.render(id, definition, container);
      return svg;
    });
  } finally {
    container.remove();
    if (fontRegistry) document[FONT_REGISTRY] = await defaultRegistry();
  }
}

let defaultRegistryInstance = null;
async function defaultRegistry() {
  defaultRegistryInstance ??= (await sharedDOM()).fontRegistry ?? createDefaultRegistry();
  return defaultRegistryInstance;
}

export default { render, dispose };
