// CSS length resolution shared by the SVG and HTML measurement paths.

/**
 * Resolve a CSS length that may carry a unit, in px.
 * parseFloat alone silently reads "1.1em" as 1.1, which collapses every
 * line-height mermaid emits into roughly a pixel.
 *
 * @param {string|number|null} value
 * @param {number} fontSize  px, for em/ex-relative units
 * @returns {number} px, or NaN when the value is absent or not a length
 */
export function resolveLength(value, fontSize) {
  if (value == null || value === '') return NaN;
  const match = String(value).trim().match(/^(-?[\d.]+)\s*(px|em|rem|ex|pt|pc|in|cm|mm|%)?$/);
  if (!match) return NaN;
  const n = parseFloat(match[1]);
  if (!Number.isFinite(n)) return NaN;
  switch (match[2]) {
    case 'em': return n * fontSize;
    case 'rem': return n * 16; // no root font-size tracking; 16 is the CSS initial
    case 'ex': return n * fontSize * 0.5; // approximation: real ex is font.xHeight
    case 'pt': return (n * 4) / 3;
    case 'pc': return n * 16;
    case 'in': return n * 96;
    case 'cm': return (n * 96) / 2.54;
    case 'mm': return (n * 96) / 25.4;
    case '%': return NaN; // percentage of the containing block; not modelled
    default: return n;
  }
}

/**
 * Resolve a CSS line-height, which unlike other lengths may be a unitless
 * multiplier. Chrome computes `line-height: 1.5` at 16px as exactly 24px.
 */
export function resolveLineHeight(value, fontSize) {
  if (value == null || value === '' || value === 'normal') {
    // The CSS initial is font-dependent; 1.2 is the usual approximation and is
    // only reached when mermaid has not set a line-height (it always does).
    return fontSize * 1.2;
  }
  const bare = String(value).trim();
  if (/^-?[\d.]+$/.test(bare)) return parseFloat(bare) * fontSize;
  const px = resolveLength(bare, fontSize);
  return Number.isFinite(px) ? px : fontSize * 1.2;
}
