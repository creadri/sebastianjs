// Calibration constants that make our metrics agree with Blink (Chrome), which
// is the reference renderer mermaid was written against and what mermaid-cli
// produces. Every value here was derived by measuring the same string in both
// engines — see scripts/calibrate-metrics.mjs, which regenerates the evidence.
//
// Keep the reasoning next to each rule: these look like magic numbers otherwise,
// and a future font change needs to know which rules are font-independent.

/**
 * Blink derives a font's pixel ascent/descent by scaling the design-unit values
 * and rounding EACH to an integer, then the line box is their sum. svgdom
 * instead scales (ascent - descent + lineGap) as one float, which is why its
 * text bboxes come out ~0.7px short at 12px.
 *
 * Open Sans (ascent 2189, descent -600, unitsPerEm 2048) verified against Chrome:
 *   12px -> round(12.826)=13 + round(3.516)=4  = 17  (Chrome: 17.00)
 *   16px -> round(17.102)=17 + round(4.688)=5  = 22  (Chrome: 22.00)
 */
export function blinkVerticalMetrics(font, fontSize) {
  const scale = fontSize / font.unitsPerEm;
  const ascent = Math.round(font.ascent * scale);
  const descent = Math.round(-font.descent * scale);
  return { ascent, descent, height: ascent + descent };
}

/**
 * svgdom's un-calibrated rule, kept so the calibration script can report the
 * delta it removes and so we can fall back if a font trips the Blink rule.
 */
export function svgdomVerticalMetrics(font, fontSize) {
  const fontHeight = font.ascent - font.descent;
  const lineHeight =
    fontHeight > font.unitsPerEm ? fontHeight : fontHeight + font.lineGap;
  const height = (lineHeight / font.unitsPerEm) * fontSize;
  return { ascent: (font.ascent / font.unitsPerEm) * fontSize, descent: height - (font.ascent / font.unitsPerEm) * fontSize, height };
}
