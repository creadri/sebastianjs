import { sebDOM, withGlobalDOM } from './sebdom.js';
import { createDefaultRegistry } from './geometry/fonts.js';
import { FONT_REGISTRY } from './geometry/bbox.js';
import { IMAGE_OPTIONS } from './geometry/images.js';
import { flattenForeignObjects } from './geometry/flatten.js';
import { KATEX_FONT_CSS } from './geometry/katex-css.js';
import { inlineStyles as inlineCascade } from './geometry/inline.js';
import { bakeMarkers as bakeMarkersInto } from './geometry/markers.js';
import { outlineText as outlineTextIn } from './geometry/outline.js';

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

/**
 * Run the portability passes over a finished diagram.
 *
 * mermaid removes its element from the document before render() returns, so the
 * markup is parsed back in to do this. That is not a workaround but the point:
 * the emitted SVG carries the diagram's own <style>, so re-attaching it puts
 * every element back under exactly the cascade that laid it out.
 *
 * Order matters. Labels are flattened first so the cascade has <text> to write
 * to rather than HTML, and markers are baked last so the copies they leave
 * behind already carry their resolved paint.
 */
async function postProcess(svg, document, passes) {
  if (!passes.flattenLabels && !passes.inlineStyles && !passes.bakeMarkers && !passes.textAsPaths) {
    return svg;
  }

  const holder = document.createElement('div');
  document.body.appendChild(holder);
  try {
    holder.innerHTML = svg;
    const root = holder.firstElementChild;
    if (!root) return svg;

    if (passes.flattenLabels) {
      await settleImages(holder);
      flattenForeignObjects(root);
    }
    // Outlining needs the cascade resolved first, so it forces the pass: a rule
    // like `.label text { fill: #333 }` selects on the element name and stops
    // matching the moment its <text> becomes a <g>.
    if (passes.inlineStyles || passes.textAsPaths) inlineCascade(root);
    if (passes.textAsPaths) outlineTextIn(root);
    // After inlining, so a marker's content is copied out carrying the paint it
    // used to inherit from the <marker> element.
    if (passes.bakeMarkers) bakeMarkersInto(root);

    return holder.innerHTML;
  } finally {
    holder.remove();
  }
}

/**
 * Wait for the <img> elements in a re-parsed diagram to report their intrinsic
 * size, the same way mermaid waited for them when it measured the label.
 *
 * Reading `complete` is what starts the load (see geometry/images.js); the
 * resolved size lives on the element, so a freshly parsed copy of the same
 * markup knows nothing until it has been asked. Without this an image label
 * measures 0x0 and its box has nothing to draw.
 */
function settleImages(root) {
  const pending = [];
  for (const img of Array.from(root.getElementsByTagName('img'))) {
    if (img.complete) continue;
    pending.push(new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    }));
  }
  return Promise.all(pending);
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
 * @param {boolean} [options.portable]     turn on every pass that makes the
 *                                   output render outside a browser:
 *                                   flattenLabels, inlineStyles and bakeMarkers.
 *                                   Each can still be set on its own to override
 *                                   one of them.
 * @param {boolean} [options.flattenLabels] rewrite the <foreignObject> HTML
 *                                   labels as SVG <text> after rendering, so the
 *                                   output renders in librsvg, resvg and
 *                                   Inkscape. Unlike htmlLabels:false the
 *                                   diagram keeps the geometry it was laid out
 *                                   with, and markdown emphasis, entities and
 *                                   raw HTML survive as styled text. Labels
 *                                   holding an <img> or an icon-pack <svg> are
 *                                   left as <foreignObject>.
 * @param {boolean} [options.inlineStyles] write the diagram's stylesheet onto
 *                                   the elements it applies to, as SVG
 *                                   presentation attributes. mermaid keeps
 *                                   nearly all of its paint in a <style> block
 *                                   addressed by class, which SVG Tiny
 *                                   renderers (QtSvg, and so Okular) do not
 *                                   implement — they draw the whole diagram as
 *                                   black boxes. Purely additive: the <style>
 *                                   block stays, and CSS still wins wherever it
 *                                   is understood.
 * @param {boolean} [options.bakeMarkers] draw each `marker-end` arrowhead as
 *                                   real geometry at the end of its edge. SVG
 *                                   Tiny has no markers, so those renderers draw
 *                                   edges with no heads. Purely additive: the
 *                                   marker-* attributes stay, and a renderer
 *                                   that implements them paints the definition
 *                                   over the baked copy in the same place.
 * @param {boolean} [options.textAsPaths] draw every text run as glyph outlines
 *                                   from the font file it was measured with, so
 *                                   the SVG needs no font to render. The tier
 *                                   above `portable`, not part of it: it costs
 *                                   file size and the text can no longer be
 *                                   selected or searched. Implies inlineStyles.
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
    // Each pass stays individually settable; `portable` just turns the set on.
    portable = false,
    flattenLabels = portable,
    inlineStyles = portable,
    bakeMarkers = portable,
    textAsPaths = false,
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
        // KaTeX's font rules, ahead of the caller's own CSS so those still win.
        // mermaid bundles KaTeX's code but a browser would load its stylesheet
        // separately; without it every formula is measured in the diagram's body
        // font instead of the bundled KaTeX faces.
        themeCSS: themeCSS ? `${KATEX_FONT_CSS}\n${themeCSS}` : KATEX_FONT_CSS,
        // Defaults to mermaid's own htmlLabels. A per-diagram value inside
        // mermaidConfig still wins, so callers can mix.
        htmlLabels,
        // mermaid gates KaTeX on `window.MathMLElement`, which jsdom does not
        // implement, and without it replaces every $$...$$ with the literal
        // text "MathML is unsupported in this environment.". Forcing the legacy
        // path both runs KaTeX and asks it for `htmlAndMathml` rather than bare
        // MathML -- which is what we want regardless of the gate, since no SVG
        // rasterizer draws MathML and the HTML branch is the one html.js can
        // measure.
        forceLegacyMathML: true,
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
      const processed = await postProcess(svg, document, {
        flattenLabels, inlineStyles, bakeMarkers, textAsPaths,
      });
      return numericEntities(selfCloseVoidElements(processed), document);
    });
  } finally {
    container.remove();
    if (fontRegistry) document[FONT_REGISTRY] = await defaultRegistry();
  }
}

let defaultRegistryInstance = null;

/** The registry a render uses when the caller passes none. Read by png.js. */
export async function defaultFontRegistry() {
  return defaultRegistry();
}

async function defaultRegistry() {
  defaultRegistryInstance ??= (await sharedDOM()).fontRegistry ?? createDefaultRegistry();
  return defaultRegistryInstance;
}

export { renderPng } from './png.js';

export default { render, dispose };
