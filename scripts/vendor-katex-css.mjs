#!/usr/bin/env node
// Vendors the parts of KaTeX that a headless renderer needs: the TTF faces, and
// the subset of katex.css that selects them.
//
// mermaid bundles KaTeX's *code* into its own dist, so the formulas render
// without us depending on the package. What it cannot bundle is the stylesheet
// and the fonts, which a browser would load separately -- and without them
// every glyph is measured in the diagram's body font, at the wrong size.
//
// Only the font-* declarations are kept, plus text-align -- which is not
// decoration here but structure: it is what centres a numerator over its
// denominator and a sum's limits over its sigma. The rest of katex.css is box
// layout
// (vlist stacking, struts, negative margins, border-drawn fraction rules) whose
// numbers KaTeX has already written into the DOM as inline styles; carrying
// rules we read from elsewhere would just be dead weight in every diagram.
//
// Re-run after bumping mermaid or katex, then run the tests.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'node_modules', 'katex');
const FONT_OUT = path.join(root, 'fonts', 'KaTeX');
const CSS_OUT = path.join(root, 'src', 'geometry', 'katex-css.js');

const KEPT = /^(font-family|font-weight|font-style|font-size|font|text-align)\s*:/;

// Two box properties earn their place. `.katex-display { margin: 1em 0 }` is
// 32px of height around every formula at a 16px body font, and `.katex
// { line-height: 1.2 }` sets the strut of the line box the formula sits on —
// whose descent is deeper than most formulas. A label measured without them is
// a third shorter than the same diagram in a browser.
const KEPT_BOX = {
  '.katex-display': /^(margin|margin-top|margin-bottom)\s*:/,
  '.katex': /^line-height\s*:/,
  // An empty span whose only job is to be 0.12em wide. A fraction has one on
  // each side, so leaving it out makes every \frac 4.6px too narrow.
  '.katex .nulldelimiter': /^width\s*:/,
};

/** Expand the `font:` shorthand katex.css uses on `.katex` into longhands. */
function expandFontShorthand(value) {
  const match = value.match(/^\s*(.*?)\s*(\d[\d.]*(?:em|px|pt|rem))\s*(?:\/\s*\S+)?\s+(.+)$/);
  if (!match) return [`font-family: ${value.trim()}`];
  const [, leading, size, family] = match;
  const out = [];
  for (const word of leading.split(/\s+/).filter(Boolean)) {
    if (/^(italic|oblique)$/.test(word)) out.push(`font-style: ${word}`);
    else if (/^(bold|bolder|lighter|\d{3})$/.test(word)) out.push(`font-weight: ${word}`);
    else if (word === 'normal') out.push('font-style: normal', 'font-weight: normal');
  }
  out.push(`font-size: ${size}`, `font-family: ${family.trim()}`);
  return out;
}

function extractFontRules(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  for (const match of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].split(/\s+/).join(' ').trim();
    // Everything KaTeX draws is under `.katex`; @font-face and the host page's
    // own rules are not ours to carry.
    if (!selector.startsWith('.katex')) continue;
    // Box properties are carried for these two selectors and no others.
    const box = KEPT_BOX[selector];
    const declarations = [];
    for (const raw of match[2].split(';')) {
      const declaration = raw.trim();
      if (!KEPT.test(declaration) && !box?.test(declaration)) continue;
      const [property, ...rest] = declaration.split(':');
      if (property.trim() === 'font' && KEPT.test(declaration)) {
        declarations.push(...expandFontShorthand(rest.join(':')));
      }
      else declarations.push(declaration);
    }
    if (declarations.length) rules.push(`${selector} { ${declarations.join('; ')}; }`);
  }
  return rules;
}

/**
 * KaTeX's TTFs all declare themselves Regular, upright and non-bold: every face
 * has fsSelection.regular set and the italic/bold bits clear, and macStyle is
 * zeroed. A browser never notices, because @font-face states the style
 * externally -- but a rasterizer handed the bare files has only this metadata to
 * go on, so resvg sees four indistinguishable KaTeX_Main faces and picks one at
 * random. In practice that drew upright text in the italic face and vice versa.
 *
 * The style is recoverable from the filename, which is where our own registry
 * reads it from too. Rewrite the two bitfields to agree, and recompute the
 * checksums so the files stay well-formed fonts.
 */
function patchStyleBits(input, { bold, italic }) {
  const buf = Buffer.from(input);
  const tables = {};
  const numTables = buf.readUInt16BE(4);
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    tables[buf.toString('ascii', record, record + 4)] = {
      record,
      offset: buf.readUInt32BE(record + 8),
      length: buf.readUInt32BE(record + 12),
    };
  }

  if (tables.head) {
    const at = tables.head.offset + 44; // head.macStyle
    const macStyle = (buf.readUInt16BE(at) & ~0b11) | (bold ? 0b01 : 0) | (italic ? 0b10 : 0);
    buf.writeUInt16BE(macStyle, at);
  }
  if (tables['OS/2']) {
    const at = tables['OS/2'].offset + 62; // OS/2.fsSelection
    let flags = buf.readUInt16BE(at) & ~((1 << 0) | (1 << 5) | (1 << 6));
    if (italic) flags |= 1 << 0;
    if (bold) flags |= 1 << 5;
    if (!italic && !bold) flags |= 1 << 6; // REGULAR is exclusive of the other two
    buf.writeUInt16BE(flags, at);
  }

  const checksum = (start, length) => {
    let total = 0;
    for (let i = start; i + 4 <= start + length; i += 4) total = (total + buf.readUInt32BE(i)) >>> 0;
    return total >>> 0;
  };
  for (const table of Object.values(tables)) {
    const padded = (table.length + 3) & ~3;
    if (table.offset + padded > buf.length) continue;
    buf.writeUInt32BE(checksum(table.offset, padded), table.record + 4);
  }
  if (tables.head) {
    // checkSumAdjustment is defined as 0xB1B0AFBA minus the whole file's
    // checksum taken with the field itself zeroed.
    buf.writeUInt32BE(0, tables.head.offset + 8);
    buf.writeUInt32BE((0xb1b0afba - checksum(0, buf.length & ~3)) >>> 0, tables.head.offset + 8);
  }
  return buf;
}

const version = JSON.parse(readFileSync(path.join(SRC, 'package.json'), 'utf8')).version;
const rules = extractFontRules(readFileSync(path.join(SRC, 'dist', 'katex.css'), 'utf8'));
if (!rules.length) throw new Error('No .katex font rules found; did katex.css change shape?');

writeFileSync(
  CSS_OUT,
  `// Generated by scripts/vendor-katex-css.mjs from katex ${version}. Do not edit.\n` +
    `//\n` +
    `// The font-selecting subset of katex.css, injected into every diagram so the\n` +
    `// bundled KaTeX faces in fonts/KaTeX are the ones formulas measure against.\n` +
    `export const KATEX_FONT_CSS = ${JSON.stringify(rules.join('\n'))};\n`
);

rmSync(FONT_OUT, { recursive: true, force: true });
mkdirSync(FONT_OUT, { recursive: true });
const fontDir = path.join(SRC, 'dist', 'fonts');
// TTF only: fontkit reads it directly, and resvg is handed the same files.
const faces = readdirSync(fontDir).filter((f) => f.endsWith('.ttf'));
for (const face of faces) {
  const style = face.replace(/\.ttf$/i, '').split('-').pop();
  writeFileSync(
    path.join(FONT_OUT, face),
    patchStyleBits(readFileSync(path.join(fontDir, face)), {
      bold: /bold/i.test(style),
      italic: /italic/i.test(style),
    })
  );
}
copyFileSync(path.join(SRC, 'LICENSE'), path.join(FONT_OUT, 'LICENSE'));

console.log(`katex ${version}: ${rules.length} font rules, ${faces.length} faces`);
