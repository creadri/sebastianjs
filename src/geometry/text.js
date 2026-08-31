// Text measurement. Replaces svgdom's textUtils so we can (a) honour font-weight
// and font-style and (b) apply the Blink vertical-metrics rule from calibrate.js.
//
// Horizontal advances come from fontkit's shaper, which reproduces Chrome's
// getComputedTextLength to within float rounding (mean 0.014%, max 0.077% over
// the calibration corpus) — kerning and ligatures included.
import { Box, NoBox } from './vendor/Box.js';
import { blinkVerticalMetrics } from './calibrate.js';

const DEFAULT_FONT_SIZE = 16;

/** Advance width of `text` in px, plus letter-spacing between glyphs. */
export function advanceWidth(font, text, fontSize, letterSpacing = 0) {
  if (!text) return 0;
  const units = font
    .layout(text)
    .glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0);
  const width = (units / font.unitsPerEm) * fontSize;
  // Letter-spacing applies between characters, not after the last one.
  const gaps = Math.max(0, Array.from(text).length - 1);
  return width + letterSpacing * gaps;
}

/**
 * Resolve the baseline offset for a dominant-baseline value, in px below the
 * box top. Mirrors svgdom's table (SVG 1.1 §10.9.2) but uses calibrated ascent.
 */
function baselineOffset(font, fontSize, ascent, dominantBaseline) {
  const scale = fontSize / font.unitsPerEm;
  switch (dominantBaseline) {
    case 'before-edge':
    case 'text-before-edge':
      return 0;
    case 'hanging':
      return ascent - (font.xHeight + font.capHeight) * scale;
    case 'mathematical':
      return ascent - font.xHeight * scale;
    case 'middle':
      return ascent - (font.xHeight / 2) * scale;
    case 'central':
      return (font.ascent / 2 + font.descent / 2) * scale;
    case 'ideographic':
      return (font.ascent + font.descent) * scale;
    default: // 'alphabetic'
      return ascent;
  }
}

/**
 * Bounding box of a text run whose baseline starts at (x, y).
 * `details` carries the resolved CSS: fontFamily, fontSize, fontWeight,
 * fontStyle, letterSpacing, textAnchor, dominantBaseline.
 * `registry` is a FontRegistry.
 */
export function textBBox(text, x, y, details, registry) {
  if (!text) return new NoBox();

  const font = registry.resolve(
    details.fontFamily,
    details.fontWeight,
    details.fontStyle
  );
  if (!font) return new NoBox();

  let fontSize = parseFloat(details.fontSize);
  if (!Number.isFinite(fontSize)) fontSize = DEFAULT_FONT_SIZE;

  const letterSpacing = parseFloat(details.letterSpacing) || 0;
  const width = advanceWidth(font, text, fontSize, letterSpacing);
  const { ascent, height } = blinkVerticalMetrics(font, fontSize);

  // https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/text-anchor
  let xAdjust = 0;
  if (details.textAnchor === 'end') xAdjust = -width;
  else if (details.textAnchor === 'middle') xAdjust = -width / 2;

  const yAdjust = baselineOffset(font, fontSize, ascent, details.dominantBaseline);

  return new Box(x + xAdjust, y - yAdjust, width, height);
}

/** Advance-only measurement, for getComputedTextLength / getSubStringLength. */
export function textAdvance(text, details, registry) {
  if (!text) return 0;
  const font = registry.resolve(
    details.fontFamily,
    details.fontWeight,
    details.fontStyle
  );
  if (!font) return 0;
  let fontSize = parseFloat(details.fontSize);
  if (!Number.isFinite(fontSize)) fontSize = DEFAULT_FONT_SIZE;
  return advanceWidth(font, text, fontSize, parseFloat(details.letterSpacing) || 0);
}
