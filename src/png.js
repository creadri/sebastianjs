// PNG output, without a headless browser and without a native build step.
//
// Rasterizing is the one thing this package cannot do from its own geometry, so
// it is delegated to resvg — as WebAssembly rather than a native binding, which
// keeps the promise the README makes: no build step, no per-platform binaries.
// It is a plain dependency. Making it optional was tried twice and was not
// worth it: 2.5MB against mermaid's 84MB is 3% of an install, and buying that
// back cost every PNG user a second package to discover and this file an
// error path for a thing that was simply absent.
//
// It is still imported lazily, so a caller who only ever renders SVG never
// loads the module and never instantiates the wasm.
//
// What is not delegated is which fonts it draws with. Every run in the diagram
// was measured against a specific file in the registry, and those exact files
// are handed to the rasterizer with system fonts switched off. That is the
// whole point: mermaid-cli renders through Chrome's font stack and gets
// whatever the machine happens to have, whereas here the raster is drawn from
// the faces the layout was computed from, on every machine.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { render, defaultFontRegistry } from './index.js';

let wasm = null;

/** Load and initialise the rasterizer once per process. */
async function rasterizer() {
  wasm ??= (async () => {
    let module;
    try {
      module = await import('@resvg/resvg-wasm');
    } catch (cause) {
      throw new Error('renderPng() could not load @resvg/resvg-wasm', { cause });
    }
    const require = createRequire(import.meta.url);
    // The wasm is loaded from disk rather than fetched: this is Node, and the
    // package ships the binary beside its own entry point.
    await module.initWasm(await readFile(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
    return module;
  })().catch((error) => {
    wasm = null; // a failed init must not poison every later call
    throw error;
  });
  return wasm;
}

/**
 * Render a mermaid definition straight to PNG.
 *
 * Takes everything render() takes, plus:
 * @param {string} definition       mermaid source
 * @param {object} [options]
 * @param {number} [options.scale]  zoom applied to the diagram's own size,
 *                                  default 1. 2 gives a 2x raster.
 * @param {string} [options.background] a CSS colour painted behind the diagram.
 *                                  Transparent by default.
 * @returns {Promise<{data: Buffer, width: number, height: number}>}
 */
export async function renderPng(definition, options = {}) {
  const { scale = 1, background, ...svgOptions } = options;

  if (!(scale > 0) || !Number.isFinite(scale)) {
    throw new Error(`renderPng: scale must be a positive number, got ${scale}`);
  }

  const module = await rasterizer();

  // resvg does not implement foreignObject, so an HTML label would simply not
  // be drawn. Flattening is the default here for that reason, and a caller who
  // turns it off is choosing to lose the labels.
  const svg = await render(definition, { flattenLabels: true, ...svgOptions });

  const image = new module.Resvg(svg, {
    background,
    fitTo: scale === 1 ? { mode: 'original' } : { mode: 'zoom', value: scale },
    font: {
      // Outlines carry their own shapes, so there is nothing left to resolve.
      fontBuffers: svgOptions.textAsPaths ? [] : await faces(svgOptions.fontRegistry),
      defaultFontFamily: svgOptions.fontFamily ?? 'Open Sans',
      loadSystemFonts: false,
    },
  }).render();

  return { data: Buffer.from(image.asPng()), width: image.width, height: image.height };
}

/** The font files the diagram was measured against, as buffers. */
async function faces(fontRegistry) {
  const registry = fontRegistry ?? (await defaultFontRegistry());
  const files = registry?.fontFiles?.() ?? [];
  const buffers = await Promise.all(
    files.map((file) => readFile(file).catch(() => null))
  );
  return buffers.filter(Boolean);
}
