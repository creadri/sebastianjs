// Intrinsic sizing for <img> in labels, plus the load semantics mermaid depends on.
//
// mermaid measures an image label like this:
//
//   setTimeout(() => { if (img.complete) setupImage(); });
//   img.addEventListener('error', setupImage);
//   img.addEventListener('load', setupImage);
//   ... await Promise.all(imagePromises)
//
// jsdom never loads resources, so `complete` stays false and neither event ever
// fires: the promise never settles and the render hangs forever. Faking
// `complete = true` would unhang it but report a zero-sized image, so instead we
// emulate real loading — resolve the source, then dispatch load or error — which
// also lets an opt-in remote fetch work even though measurement is synchronous.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { imageSize } from 'image-size';

/** Options stashed per-document by the adapter. */
export const IMAGE_OPTIONS = Symbol.for('sebastianjs.imageOptions');
/** Resolved intrinsic size, stashed per <img>. */
const NATURAL = Symbol.for('sebastianjs.naturalSize');

const DEFAULT_TIMEOUT_MS = 5000;

const sizeOf = (buffer) => {
  try {
    const { width, height } = imageSize(buffer);
    return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null;
  } catch {
    return null; // unsupported or corrupt format
  }
};

function decodeDataUri(src) {
  const match = /^data:([^,]*?)(;base64)?,(.*)$/is.exec(src);
  if (!match) return null;
  const [, , base64, payload] = match;
  try {
    return base64
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'binary');
  } catch {
    return null;
  }
}

async function fetchRemote(src, timeoutMs) {
  // Never reached unless the caller passed allowRemoteImages: rendering should
  // not perform network I/O by surprise.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(src, { signal: controller.signal });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve an <img> src to its intrinsic size, or null. */
export async function resolveImageSize(src, options = {}) {
  if (!src) return null;
  const { allowRemoteImages = false, imageTimeoutMs = DEFAULT_TIMEOUT_MS } = options;

  if (/^data:/i.test(src)) {
    const buffer = decodeDataUri(src);
    return buffer ? sizeOf(buffer) : null;
  }

  if (/^https?:/i.test(src)) {
    if (!allowRemoteImages) return null;
    const buffer = await fetchRemote(src, imageTimeoutMs);
    return buffer ? sizeOf(buffer) : null;
  }

  try {
    const path = /^file:/i.test(src) ? fileURLToPath(src) : src;
    return sizeOf(await readFile(path));
  } catch {
    return null;
  }
}

/** Intrinsic size previously resolved for this element, if any. */
export const naturalSizeOf = (img) => img[NATURAL] ?? null;

/**
 * Give a window's HTMLImageElement browser-like load behaviour.
 * Setting `src` starts resolution; `complete` reports whether it has finished;
 * a `load` or `error` event fires when it does. A hard timeout guarantees one of
 * them always fires, so a hung source can never wedge a render.
 */
export function installImageLoading(window) {
  const proto = window.HTMLImageElement?.prototype;
  if (!proto || proto[NATURAL] !== undefined) return;
  proto[NATURAL] = null;

  const srcDescriptor =
    Object.getOwnPropertyDescriptor(proto, 'src') ||
    Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'src');

  const settle = (img, size) => {
    img[NATURAL] = size;
    img.__complete = true;
    const event = new window.Event(size ? 'load' : 'error');
    img.dispatchEvent(event);
  };

  const startLoading = function startLoading(img, value) {
    img.__loading = true;
    img.__complete = false;
    img[NATURAL] = null;
    const options = img.ownerDocument?.[IMAGE_OPTIONS] ?? {};
    const timeoutMs = options.imageTimeoutMs ?? DEFAULT_TIMEOUT_MS;

    let settled = false;
    const once = (size) => {
      if (settled) return;
      settled = true;
      settle(img, size);
    };
    // Belt and braces: whatever happens, one of load/error fires.
    const guard = setTimeout(() => once(null), timeoutMs + 500);
    if (typeof guard.unref === 'function') guard.unref();

    resolveImageSize(value, options)
      .then((size) => { clearTimeout(guard); once(size); })
      .catch(() => { clearTimeout(guard); once(null); });
  };

  Object.defineProperty(proto, 'src', {
    configurable: true,
    get() {
      return srcDescriptor?.get ? srcDescriptor.get.call(this) : this.getAttribute('src');
    },
    set(value) {
      if (srcDescriptor?.set) srcDescriptor.set.call(this, value);
      else this.setAttribute('src', value);
      startLoading(this, value);
    },
  });

  // mermaid builds labels with innerHTML, so images come from the HTML parser and
  // the `src` property setter above is never called. Loading therefore has to
  // start lazily, on the first read of any load-related property. mermaid reads
  // `complete` inside a setTimeout, after attaching its load/error listeners, so
  // returning false here and dispatching later is exactly the browser sequence.
  const ensureLoading = (img) => {
    if (img.__loading === undefined) {
      const src = img.getAttribute('src');
      if (src) startLoading(img, src);
      else { img.__loading = true; img.__complete = true; img[NATURAL] = null; }
    }
    return img;
  };

  Object.defineProperty(proto, 'complete', {
    configurable: true,
    get() { return ensureLoading(this).__complete === true; },
  });

  Object.defineProperty(proto, 'naturalWidth', {
    configurable: true,
    get() { return ensureLoading(this)[NATURAL]?.width ?? 0; },
  });
  Object.defineProperty(proto, 'naturalHeight', {
    configurable: true,
    get() { return ensureLoading(this)[NATURAL]?.height ?? 0; },
  });
}
