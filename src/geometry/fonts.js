// Font registry: resolves a CSS (font-family, font-weight, font-style) triple to a
// fontkit font. svgdom's own registry maps family -> single file, so bold/italic
// labels silently measure as regular; mermaid uses bold for class titles, markdown
// emphasis and several node types, so we need the full triple.
import * as fontkit from 'fontkit';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const BUNDLED_FONT_DIR = path.join(__dirname, '..', '..', 'fonts');

// Google Fonts static naming: <Family>[_<Width>]-<Weight><Italic?>.ttf
const WEIGHT_NAMES = {
  thin: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  regular: 400,
  normal: 400,
  book: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
};

// CSS generic families we answer for. Anything unresolvable lands on the default.
const GENERIC_FAMILIES = new Set([
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
]);

const normalize = (family) =>
  String(family || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .toLowerCase();

// "OpenSans_Condensed" -> "Open Sans Condensed"
const humanizeFamily = (raw) =>
  raw
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Split a Google-Fonts-style static filename into a face descriptor.
 * Returns null when the name does not follow the convention, in which case the
 * caller should register the file explicitly.
 */
export function parseFontFileName(file) {
  const base = path.basename(file).replace(/\.(ttf|otf|woff2?|ttc)$/i, '');
  const dash = base.lastIndexOf('-');
  if (dash === -1) return null;

  const familyPart = base.slice(0, dash);
  let stylePart = base.slice(dash + 1);

  let italic = false;
  if (/italic$/i.test(stylePart)) {
    italic = true;
    stylePart = stylePart.replace(/italic$/i, '');
  }

  const weight = WEIGHT_NAMES[stylePart.toLowerCase()] ?? (stylePart === '' ? 400 : null);
  if (weight === null) return null;

  return { family: humanizeFamily(familyPart), weight, italic, file };
}

export class FontRegistry {
  constructor() {
    /** @type {Map<string, Array<{weight:number, italic:boolean, file:string, font:any}>>} */
    this.families = new Map();
    this.defaultFamily = null;
  }

  /** Register one face. `family`/`weight`/`italic` override filename parsing. */
  registerFont(file, descriptor = {}) {
    const parsed = parseFontFileName(file) || {};
    const family = descriptor.family ?? parsed.family;
    if (!family) {
      throw new Error(
        `Cannot infer a font family from "${path.basename(file)}"; pass { family } explicitly.`
      );
    }
    const face = {
      family,
      weight: descriptor.weight ?? parsed.weight ?? 400,
      italic: descriptor.italic ?? parsed.italic ?? false,
      file,
      font: null, // opened lazily; scanning a full family eagerly is slow
    };

    const key = normalize(family);
    if (!this.families.has(key)) this.families.set(key, []);
    const faces = this.families.get(key);
    const existing = faces.findIndex((f) => f.weight === face.weight && f.italic === face.italic);
    if (existing === -1) faces.push(face);
    else faces[existing] = face;

    if (!this.defaultFamily) this.defaultFamily = key;
    return this;
  }

  /** Register every font file in a directory (non-recursive by default). */
  registerFontDir(dir, { recursive = true } = {}) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return this;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      if (recursive && statSync(full).isDirectory()) {
        this.registerFontDir(full, { recursive });
        continue;
      }
      if (!/\.(ttf|otf)$/i.test(entry)) continue;
      if (parseFontFileName(full)) this.registerFont(full);
    }
    return this;
  }

  /**
   * Every registered face's file path.
   *
   * A rasterizer has to be handed the same faces the diagram was measured
   * against, or it substitutes one with different metrics and the glyphs stop
   * fitting the boxes they were laid out into. This is what png.js feeds it.
   */
  fontFiles() {
    const files = new Set();
    for (const faces of this.families.values()) {
      for (const face of faces) files.add(face.file);
    }
    return [...files];
  }

  setDefaultFamily(family) {
    const key = normalize(family);
    if (!this.families.has(key)) {
      throw new Error(`Cannot default to unregistered font family "${family}".`);
    }
    this.defaultFamily = key;
    return this;
  }

  /**
   * CSS font matching, reduced to what SVG text needs: walk the family list in
   * order, and within the first family that exists pick the closest face.
   * `families` may be a raw CSS font-family string or an array.
   */
  resolve(families, weight = 400, italic = false) {
    const list = Array.isArray(families)
      ? families
      : String(families || '').split(',');

    for (const raw of list) {
      const key = normalize(raw);
      if (!key || GENERIC_FAMILIES.has(key)) continue;
      const faces = this.families.get(key);
      if (faces?.length) return this.#open(pickFace(faces, weight, italic));
    }

    if (!this.defaultFamily) return null;
    const faces = this.families.get(this.defaultFamily);
    return faces?.length ? this.#open(pickFace(faces, weight, italic)) : null;
  }

  #open(face) {
    if (!face) return null;
    if (!face.font) {
      try {
        face.font = fontkit.openSync(face.file);
      } catch (e) {
        // A collection (.ttc) or a corrupt file: drop the face so we fall back.
        face.font = null;
        return null;
      }
    }
    return face.font;
  }
}

/**
 * CSS font-matching weight rules (CSS Fonts 4, §5.2), restricted to a single
 * family. Italic is preferred but never blocks a match.
 */
function pickFace(faces, weight, italic) {
  const candidates = faces.filter((f) => f.italic === italic);
  const pool = candidates.length ? candidates : faces;

  const exact = pool.find((f) => f.weight === weight);
  if (exact) return exact;

  const below = pool.filter((f) => f.weight < weight).sort((a, b) => b.weight - a.weight);
  const above = pool.filter((f) => f.weight > weight).sort((a, b) => a.weight - b.weight);

  // 400 checks 500 first; 500 checks 400 first; <400 prefers lighter; >500 prefers heavier.
  if (weight === 400) {
    const five = pool.find((f) => f.weight === 500);
    if (five) return five;
    return below[0] || above[0];
  }
  if (weight === 500) {
    const four = pool.find((f) => f.weight === 400);
    if (four) return four;
    return below[0] || above[0];
  }
  if (weight < 400) return below[0] || above[0];
  return above[0] || below[0];
}

/** CSS font-weight keyword/number -> numeric weight. */
export function parseWeight(value) {
  if (value == null || value === '') return 400;
  const str = String(value).trim().toLowerCase();
  if (str === 'normal') return 400;
  if (str === 'bold') return 700;
  // `bolder`/`lighter` are relative to the parent; mermaid never emits them, and
  // resolving them properly needs the full cascade, so approximate.
  if (str === 'bolder') return 700;
  if (str === 'lighter') return 300;
  const num = parseFloat(str);
  return Number.isFinite(num) ? num : 400;
}

/** CSS font-style -> italic boolean. */
export function parseItalic(value) {
  const str = String(value || '').trim().toLowerCase();
  return str === 'italic' || str === 'oblique';
}

/** Registry preloaded with the fonts bundled in this repo. */
export function createDefaultRegistry() {
  const registry = new FontRegistry();
  registry.registerFontDir(BUNDLED_FONT_DIR);
  if (registry.families.has('open sans')) registry.setDefaultFamily('Open Sans');
  return registry;
}
