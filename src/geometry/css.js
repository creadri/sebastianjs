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

/** Only these affect measurement; everything else is ignored. */
const TRACKED = new Set([
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
      const declarations = parseDeclarations(body);
      if (declarations.size) {
        for (const selector of splitSelectors(prelude)) {
          rules.push({
            selector,
            declarations,
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

function parseDeclarations(body) {
  const out = new Map();
  for (const chunk of body.split(';')) {
    const colon = chunk.indexOf(':');
    if (colon === -1) continue;
    const property = chunk.slice(0, colon).trim().toLowerCase();
    if (!TRACKED.has(property)) continue;
    let value = chunk.slice(colon + 1).trim();
    let important = false;
    if (/!\s*important$/i.test(value)) {
      important = true;
      value = value.replace(/!\s*important$/i, '').trim();
    }
    if (value) out.set(property, { value, important });
  }
  return out;
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
  const document = element.ownerDocument;
  if (!document) return null;
  const rules = getRules(document);
  if (!rules.length) return null;

  let winners = null;
  for (const rule of rules) {
    let matched = false;
    try {
      matched = element.matches(rule.selector);
    } catch {
      continue; // selector jsdom cannot parse; skip rather than fail the render
    }
    if (!matched) continue;

    winners ??= new Map();
    for (const [property, declaration] of rule.declarations) {
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
