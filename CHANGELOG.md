# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

---

## [0.1.1] - 2026-08-31

### Fixed
- `CSSStyleSheet is not defined` on every render against mermaid >= 11.17.
  Mermaid now builds its user styles with `new CSSStyleSheet()`, and the
  constructor was not among the globals forwarded to the render scope. Since a
  fresh install resolves the newest mermaid, this broke 0.1.0 for all new
  consumers.

### Changed
- **mermaid is now an exact dependency**, held at the version mermaid-cli pins
  in its own lockfile (11.9.0). Parity is defined as agreement with
  mermaid-cli's Chrome output, so rendering against a different mermaid than
  mmdc moves the reference and makes the numbers meaningless. `mermaid` was a
  `>=10.11.10` range while the lockfile held 11.10.1 and consumers resolved
  11.17.2.
- The remaining runtime dependencies are caret ranges pinned to the tested
  majors (`jsdom@^26.1.0`, `dompurify@^3.2.6`, `fontkit@^2.0.4`,
  `image-size@^2.0.2`). All were open-ended `>=`, so a fresh install could
  float onto an untested major -- jsdom's declared floor of 24.1.0 would have
  resolved 30.x.
- `npm run fetch:samples` now clones the `mermaid@<pinned version>` tag instead
  of the default branch, so the corpus matches the mermaid under test rather
  than drifting with upstream `develop`. `manifest.json` records the version
  and ref it was built from.

  This shrank the corpus from 292 samples to 228: the 64 that went away are
  `venn`, `wardley`, `treeView`, `railroad`, `ishikawa`, `usecase` and
  `eventmodeling` demos -- diagram types that do not exist in the pinned
  mermaid. They had been counted as render failures. Failures drop from 58 to
  7 for SebastianJS and 54 to 3 for mermaid-cli; of the remaining 7, three
  (`classchart__8`, `error__2`, `error__4`) fail under mermaid-cli too, leaving
  mindmap and zenuml as the only genuine gaps. Node deviation across the
  corpus is unchanged at 0.016px over 86 compared diagrams.

### Added
- `npm run sync:mermaid` reads mermaid-cli's lockfile from its release tag and
  pins `mermaid` to match; `npm run check:mermaid` verifies without writing.
- `__tests__/versions.test.js`: offline guards that mermaid is pinned exactly,
  that the installed copy matches, that mermaid-cli shares the hoisted mermaid
  rather than nesting its own, that the corpus came from the matching tag, and
  that no runtime dependency uses an open-ended range.

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