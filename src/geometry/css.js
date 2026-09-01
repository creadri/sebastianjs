// A minimal CSS cascade for the properties that change text metrics.
//
// Mermaid sets text-anchor, font-weight and font-size from an injected
// stylesheet, not from presentation attributes — e.g.
//   #id .node .label text { text-anchor: middle; }
// Without this, every label measures as if left-anchored and node bounding
// boxes come out wrong even when the layout itself is right.
//
// We cannot lean on jsdom for this: getComputedStyle returns "" for SVG
// presentation properties, and document.styleSheets is empty for <style>
// elements inside <svg>. So we parse the rule text ourselves and match with
// Element.matches(), which jsdom does support for complex selectors.

/**
 * SVG presentation attributes — every CSS property that can equivalently be
 * written as an attribute on an SVG element. This is the set inline.js is
 * allowed to write, so it is also the set worth keeping when a stylesheet is
 * parsed: a property outside it can never be inlined, whoever declares it.
 *
 * Deliberately excluded: `display`, because mermaid only ever sets it to the
 * HTML values (`flex`, `inline-block`) on label content, where an SVG renderer
 * would either ignore it or, worse, read an unknown value as `none`.
 */
export const PRESENTATION = new Set([
  'alignment-baseline', 'baseline-shift', 'clip-path', 'clip-rule', 'color',
  'color-interpolation', 'color-interpolation-filters', 'cursor', 'direction',
  'dominant-baseline', 'fill', 'fill-opacity', 'fill-rule', 'filter',
  'flood-color', 'flood-opacity', 'font-family', 'font-size', 'font-size-adjust',
  'font-stretch', 'font-style', 'font-variant', 'font-weight', 'image-rendering',
  'letter-spacing', 'lighting-color', 'marker-end', 'marker-mid', 'marker-start',
  'mask', 'opacity', 'overflow', 'paint-order', 'pointer-events',
  'shape-rendering', 'stop-color', 'stop-opacity', 'stroke', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'stroke-opacity', 'stroke-width', 'text-anchor', 'text-decoration',
  'text-rendering', 'unicode-bidi', 'vector-effect', 'visibility', 'word-spacing',
  'writing-mode',
]);

/** These affect measurement; the rest of TRACKED is there to be inlined. */
const MEASURED = new Set([
  // text metrics (SVG and HTML)
  'font-size',
  'font-family',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
  // HTML box model, for labels inside <foreignObject>
  'display',
  'white-space',
  'line-height',
  'text-align',
  'max-width',
  'width',
  'padding',
  'padding-left',
  'padding-right',
  'padding-top',
  'padding-bottom',
  'margin',
  'margin-left',
  'margin-right',
  'margin-top',
  'margin-bottom',
  // Paint, not metrics. Nothing measures these; flatten.js reads them to give
  // the <text> it emits the colour the HTML label would have painted.
  'color',
  'background-color',
  // Where a replaced box sits relative to the baseline. It does not change the
  // measured width or height either, but it decides where flatten.js draws the
  // <image> it emits for an <img>. mermaid's `.label-icon` rule is the only
  // place it appears.
  'vertical-align',
]);


const RULES = Symbol.for('sebastianjs.cssRules');

/** Strip comments, then walk top level tracking brace depth so at-rules are skipped. */
function parseStylesheet(cssText, rules) {
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;

  while (i < css.length) {
    const braceStart = css.indexOf('{', i);
    if (braceStart === -1) break;

    const prelude = css.slice(i, braceStart).trim();

    // Find the matching close brace, allowing one level of nesting (@media etc).
    let depth = 1;
    let j = braceStart + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    const body = css.slice(braceStart + 1, j - 1);

    if (prelude.startsWith('@')) {
      // Conditional groups still contain style rules; keyframes do not apply to us.
      if (/^@(media|supports|layer)\b/i.test(prelude)) parseStylesheet(body, rules);
    } else if (prelude) {
      const { measured, presentation } = parseDeclarations(body);
      if (measured.size || presentation.size) {
        for (const selector of splitSelectors(prelude)) {
          rules.push({
            selector,
            measured,
            presentation,
            specificity: specificityOf(selector),
            order: rules.length,
          });
        }
      }
    }

    i = j;
  }
  return rules;
}

/** Split on commas that are not inside brackets or parentheses. */
function splitSelectors(prelude) {
  const out = [];
  let depth = 0;
  let current = '';
  for (const ch of prelude) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out.filter(Boolean);
}

/**
 * Declarations split into the two audiences that read them.
 *
 * They are kept apart rather than filtered on lookup because measurement calls
 * cssStyleFor once per property per element, and every call walks the winning
 * rules' declarations. Handing that loop the presentation properties as well —
 * which measurement can never read — cost 55% on a full corpus render.
 */
function parseDeclarations(body) {
  const measured = new Map();
  const presentation = new Map();

  for (const chunk of body.split(';')) {
    const colon = chunk.indexOf(':');
    if (colon === -1) continue;
    const property = chunk.slice(0, colon).trim().toLowerCase();
    const wanted = MEASURED.has(property);
    const paints = PRESENTATION.has(property);
    if (!wanted && !paints) continue;

    let value = chunk.slice(colon + 1).trim();
    let important = false;
    if (/!\s*important$/i.test(value)) {
      important = true;
      value = value.replace(/!\s*important$/i, '').trim();
    }
    if (!value) continue;
    if (wanted) measured.set(property, { value, important });
    if (paints) presentation.set(property, { value, important });
  }
  return { measured, presentation };
}

/** (ids, classes/attrs/pseudo-classes, elements/pseudo-elements) packed into one number. */
function specificityOf(selector) {
  const cleaned = selector.replace(/\[[^\]]*\]/g, '[]');
  const ids = (cleaned.match(/#[\w-]+/g) || []).length;
  const classes =
    (cleaned.match(/\.[\w-]+/g) || []).length +
    (cleaned.match(/\[\]/g) || []).length +
    (cleaned.match(/:(?!:)[\w-]+/g) || []).length;
  const elements =
    (cleaned.match(/(^|[\s>+~])([a-zA-Z][\w-]*)/g) || []).length +
    (cleaned.match(/::[\w-]+/g) || []).length;
  return ids * 10000 + classes * 100 + elements;
}

/**
 * Collect and cache the tracked rules for a document.
 *
 * The cache is keyed on the identity of the <style> elements, not on their
 * text. Mermaid scopes every rule to the diagram id (#sebastianjs-1,
 * #sebastianjs-2, ...), so successive renders in one process produce
 * stylesheets of *identical length* — a length-based key collides, and the
 * second render silently reuses rules that match nothing, leaving every label
 * measured as if unstyled.
 */
export function getRules(document) {
  const styles = Array.from(document.getElementsByTagName('style'));

  const cached = document[RULES];
  if (
    cached &&
    cached.styles.length === styles.length &&
    cached.styles.every(
      (entry, i) =>
        entry.element === styles[i] &&
        entry.length === (styles[i].textContent || '').length
    )
  ) {
    return cached.rules;
  }

  const rules = [];
  for (const style of styles) parseStylesheet(style.textContent || '', rules);

  document[RULES] = {
    styles: styles.map((element) => ({
      element,
      length: (element.textContent || '').length,
    })),
    rules,
  };
  return rules;
}

/**
 * Declarations from the stylesheet that apply to `element`, as
 * Map<property, { value, important }>, already resolved by specificity.
 */
export function cssStyleFor(element) {
  return resolve(element, 'measured');
}

/**
 * The same, over the properties that can be written as SVG presentation
 * attributes. Only inline.js reads these.
 */
export function cssPresentationFor(element) {
  return resolve(element, 'presentation');
}

function resolve(element, kind) {
  const document = element.ownerDocument;
  if (!document) return null;
  const rules = getRules(document);
  if (!rules.length) return null;

  let winners = null;
  for (const rule of rules) {
    const declarations = rule[kind];
    // Matching is the expensive half, so a rule with nothing this caller can
    // use is dropped before the selector is ever tested.
    if (!declarations.size) continue;

    let matched = false;
    try {
      matched = element.matches(rule.selector);
    } catch {
      continue; // selector jsdom cannot parse; skip rather than fail the render
    }
    if (!matched) continue;

    winners ??= new Map();
    for (const [property, declaration] of declarations) {
      const previous = winners.get(property);
      if (
        !previous ||
        (declaration.important && !previous.important) ||
        (declaration.important === previous.important &&
          (rule.specificity > previous.specificity ||
            (rule.specificity === previous.specificity && rule.order > previous.order)))
      ) {
        winners.set(property, {
          value: declaration.value,
          important: declaration.important,
          specificity: rule.specificity,
          order: rule.order,
        });
      }
    }
  }
  return winners;
}
