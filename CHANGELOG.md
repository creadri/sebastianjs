# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

---

## [0.1.0] - 2026-08-31

Rendering was rebuilt around a DOM that measures correctly, instead of letting
an empty DOM compute a wrong layout and patching the SVG afterwards. Mermaid's
layout (dagre/ELK) is pure JS and was always right; it was being fed wrong
measurements, and no amount of post-processing can undo a node placed from a
wrong size.

### Added
- Geometry engine under `src/geometry/`: jsdom hosts the document, and svgdom's
  maths (vendored, driven by fontkit) answers `getBBox`, `getComputedTextLength`,
  `getCTM`, `getTotalLength` and friends.
- HTML label measurement for mermaid's `<foreignObject>` labels, including a
  minimal CSS cascade for the properties that affect text metrics.
- `htmlLabels`, `allowRemoteImages`, `imageTimeoutMs` and `iconPacks` options on
  `render()`; `dispose()` for releasing the shared window.
- Weight- and style-aware font registry, so bold and italic labels measure with
  the right face.
- `scripts/compare-chrome.mjs` and `scripts/vendor-svgdom.mjs`.

### Changed
- **Breaking:** `width`/`height` are viewport hints, matching mermaid-cli's
  `-w`/`-H`. The SVG sizes itself from its own bounding box, as it does in a
  browser, rather than being stamped with those values.
- **Breaking:** labels default to HTML in `<foreignObject>`, as in mermaid. Pass
  `htmlLabels: false` for SVG `<text>`, which is what non-browser rasterizers can
  render.
- `render()` reuses one window and serializes calls; previously only the first
  render in a process returned anything.
- Output is repaired to valid XML (void elements closed, named entities made
  numeric), which jsdom's HTML serialization does not produce.

### Fixed
- Elliptical arc bounding boxes returned `rx` as the vertical extent of a
  half-ellipse, making every cylinder node about 61px too tall. Reproduced in
  upstream svgdom and fixed in the vendored copy.
- Text measured as if unstyled on the second and later render in a process, from
  a stylesheet cache keyed on a value that collides between renders.
- `text-anchor` from a stylesheet was ignored, `dy="1.1em"` was read as 1.1px,
  and anchoring was applied per tspan rather than per text chunk.
- `<marker>` and other never-painted elements were counted in ancestor bounding
  boxes, pinning every diagram to the origin.
- An `<img>` in a label hung the render forever.
- Missing browser globals broke every C4 diagram and one sequence diagram.

### Removed
- **Breaking:** the `canvas` dependency, and with it the cairo/pango build
  toolchain. Text is measured with fontkit; there is no native build step.
- `src/postProcess.js` and `src/textMetrics.js`.

---

## [0.0.1] - 2025-09-03

### Added
- Project initialized.

## [0.0.3] - 2025-09-25

### Added
- Benchmarking with mermaid-cli
- Deviation scripts with mermaid-cli

### Changed
- Calculations on bbox sizing
- PostProcess