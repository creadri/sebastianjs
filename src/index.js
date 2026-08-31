import { sebDOM, withGlobalDOM } from './sebdom.js';
import { createDefaultRegistry } from './geometry/fonts.js';
import { FONT_REGISTRY } from './geometry/bbox.js';
import { IMAGE_OPTIONS } from './geometry/images.js';

// mermaid (and the d3 and DOMPurify instances inside it) is a module singleton
// that binds to whichever window exists when it is first imported. Building a
// fresh jsdom per render leaves those bindings pointing at a closed window, and
// every render after the first returns an empty string. So the window is created
// once and reused, and renders are serialized because the singleton — and the
// globals it reads — cannot support two renders interleaving at an await.
// HTML void elements are legal unclosed in HTML but not in XML, and jsdom builds
// the SVG string with HTML serialization, so a label containing <img> or <br>
// yields an .svg file no XML parser will accept. mermaid-cli papers over this in
// the browser by re-serializing with XMLSerializer; mermaid removes the live
// element before render() returns, so we repair the string instead.
//
// `br` is included even though mermaid's own cleanUpSvgCode rewrites <br> to
// <br/>: at the default securityLevel that runs BEFORE DOMPurify, whose HTML
// re-serialization turns it straight back into <br>.
const VOID_ELEMENTS = /<(img|br|hr|input|meta|link|area|base|col|embed|source|track|wbr)\b([^>]*?)\s*\/?>/gi;

function selfCloseVoidElements(svg) {
  return svg.replace(VOID_ELEMENTS, (_m, tag, attrs) => `<${tag}${attrs}/>`);
}

// XML predefines only these five named entities. HTML defines hundreds, and
// mermaid emits &nbsp; for block-diagram spacers, which makes the .svg file
// unparseable as XML. Rather than carry an entity table, each distinct name is
// decoded with the DOM we already have and re-emitted as a numeric reference,
// which is always valid XML.
const XML_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);
const NAMED_ENTITY = /&([a-zA-Z][a-zA-Z0-9]*);/g;

function numericEntities(svg, document) {
  const seen = new Map();
  return svg.replace(NAMED_ENTITY, (match, name) => {
    if (XML_ENTITIES.has(name)) return match;
    if (!seen.has(name)) {
      const probe = document.createElement('span');
      probe.innerHTML = match;
      const text = probe.textContent || '';
      // Leave anything that did not decode alone rather than corrupting it.
      seen.set(
        name,
        text && text !== match
          ? [...text].map((c) => `&#${c.codePointAt(0)};`).join('')
          : match
      );
    }
    return seen.get(name);
  });
}

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
 * @param {boolean} [options.htmlLabels]    put labels in <foreignObject> as HTML,
 *                                   matching mermaid's own default. Set false to
 *                                   emit SVG <text> instead, which is what
 *                                   non-browser SVG consumers (librsvg, resvg,
 *                                   Inkscape) can actually render — at the cost
 *                                   of showing raw HTML and entities literally.
 * @param {boolean} [options.allowRemoteImages] fetch http(s) <img> sources to
 *                                   measure them. Off by default: rendering
 *                                   should not perform network I/O unasked.
 * @param {number} [options.imageTimeoutMs]  per-image budget, default 5000
 * @param {Array}  [options.iconPacks]  Iconify packs forwarded to mermaid's
 *                                   registerIconPacks, e.g. the JSON from
 *                                   @iconify-json/fa6-solid, so fa: labels
 *                                   resolve to inline <svg> instead of text
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
    htmlLabels = true,
    allowRemoteImages = false,
    imageTimeoutMs,
    iconPacks,
    theme,
    themeVariables,
    themeCSS,
    mermaidConfig = {},
  } = options;

  const { window, document, setViewport } = await sharedDOM();
  setViewport(width, height);
  if (fontRegistry) document[FONT_REGISTRY] = fontRegistry;
  document[IMAGE_OPTIONS] = { allowRemoteImages, imageTimeoutMs };

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
        // Defaults to mermaid's own htmlLabels. A per-diagram value inside
        // mermaidConfig still wins, so callers can mix.
        htmlLabels,
        ...mermaidConfig,
        flowchart: {
          ...mermaidConfig.flowchart,
          htmlLabels: mermaidConfig.flowchart?.htmlLabels ?? htmlLabels,
        },
        class: {
          ...mermaidConfig.class,
          htmlLabels: mermaidConfig.class?.htmlLabels ?? htmlLabels,
        },
      });

      if (iconPacks?.length) mermaid.registerIconPacks(iconPacks);

      // mermaid derives DOM ids from this; it must be unique per render or a
      // second render in the same process collides with the first.
      const id = `sebastianjs-${++renderCounter}`;
      const { svg } = await mermaid.render(id, definition, container);
      return numericEntities(selfCloseVoidElements(svg), document);
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
