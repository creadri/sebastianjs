# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

---

## [0.4.0] - 2026-09-01

### Added
- **`inlineStyles`, `bakeMarkers`, and a `portable` preset that turns on both
  plus `flattenLabels`.** Removing `foreignObject` in 0.3.0 was only the first
  of three things a simple renderer cannot do. Mermaid keeps essentially all of
  its paint in the `<style>` block addressed by class -- a node is emitted as
  `<rect class="basic label-container">` with no fill and no stroke of its own
  -- and draws its arrowheads with `<marker>` references. Renderers built on
  SVG Tiny (QtSvg, and so Okular) implement neither, and fall back to the SVG
  initial values: black boxes, no strokes, no arrows.

  `inlineStyles` resolves the cascade onto the elements it applies to, as SVG
  presentation attributes, reusing the same matcher measurement uses. Lengths
  are written as bare numbers, because an SVG Tiny renderer that rejects
  `stroke-width="1px"` falls back to 1 rather than reading it. `bakeMarkers`
  resolves each `marker-end` into geometry: the point and tangent at the end of
  the path, and a copy of the marker's content under the transform the spec
  defines, carrying the paint it used to inherit from the `<marker>`.

  Both passes only ever ADD. The `<style>` block and the `marker-*` attributes
  stay, so a renderer that understood them keeps rendering from them -- CSS
  beats a presentation attribute, which is what makes this safe. Nothing that
  renders correctly today can regress. Across the sample corpus every diagram
  has a fill or a stroke on every shape with the stylesheet deleted, and node
  placement is byte-identical to a plain render.

- **`textAsPaths`, which draws every text run as glyph outlines.** `portable`
  still leaves the renderer one thing to find: the font. Nothing is embedded in
  the SVG, so a rasterizer without Open Sans substitutes a face with different
  metrics and the glyphs stop fitting the boxes they were measured into.

  Each run becomes a `<path>` transformed out of the very font file fontkit
  measured it with, so the file needs no font at all. It covers the text mermaid
  draws itself -- sequence, gantt, pie, radar -- not only flattened labels;
  across the sample corpus not one `<text>` survives. Chunking follows the SVG
  model, so each absolute `x` re-anchors independently, and `xml:space` is
  honoured because that is what flatten.js relies on. Implies `inlineStyles`,
  since a rule like `.label text { fill: #333 }` stops matching the moment its
  `<text>` becomes a `<g>`. Not part of `portable`: the corpus grows 5.4x and
  the text stops being selectable.

- **`renderPng()`, and a `.png` output path on the CLI.** Rasterizing is the one
  thing this package cannot do from its own geometry, so it is delegated to
  resvg -- as WebAssembly rather than a native binding, which keeps the promise
  that there is no build step and no per-platform binaries, and as an
  plain dependency, imported lazily so rendering only SVG never instantiates
  the wasm. (npm has no equivalent of Python's `pkg[extra]`. Optional peer and
  then optionalDependency were both tried: 2.5MB against mermaid's 84MB is 3%
  of an install, which is not worth charging every PNG user a second package to
  discover. Note it is MPL-2.0 where this package is MIT — no condition on your
  code as an unmodified dependency, but a bundle redistributing it carries the
  notice.)

  What is not delegated is which fonts it draws with. Every run was measured
  against a specific file in the registry, and those exact files are handed to
  the rasterizer with system fonts switched off -- so the raster is drawn from
  the faces the layout was computed from, on every machine, where mermaid-cli
  gets whatever Chrome's font stack happens to find. Labels are flattened by
  default, since resvg has no `foreignObject` and would otherwise draw a diagram
  of empty boxes. The whole corpus rasterizes in 52s, 221 of 226 diagrams, none
  malformed.

  GIF and JPEG are not planned: they need separate encoders for formats nobody
  wants for a line diagram.

### Fixed
- **`resolveLength` rejected the exponent form of a number.** `x="1.7451e-14"`
  is valid SVG and mermaid emits it for radar axis labels; it parsed as NaN, and
  every caller read that as "no value stated". Verified to change no geometry
  across the 179 deterministic samples.

### Changed
- A parsed stylesheet now keeps its measured and its presentation declarations
  apart. Measurement calls `cssStyleFor` once per property per element and each
  call walks the winning rules' declarations, so handing that loop the paint
  properties as well cost 55% on a full corpus render. Rules with nothing the
  caller can use are now also skipped before their selector is matched, which is
  the expensive half.
- The comparison site shows every output form. The SebastianJS pane switches
  between plain SVG, SVG with the text traced, and a PNG, one page-wide radio
  group and no script -- the site still renders with JavaScript disabled.
  `SITE_SAMPLES` and `SITE_OUT` make a build from a handful of samples possible,
  since a full one is eleven minutes of headless Chrome.

---

## [0.3.0] - 2026-09-01

### Added
- **`flattenLabels` option (`--flatten-labels` on the CLI), which rewrites
  `<foreignObject>` HTML labels as SVG `<text>`.** librsvg and resvg do not
  implement `foreignObject` and Inkscape only partly does, so every label
  vanished in a non-browser rasterizer. The existing escape hatch,
  mermaid's own `htmlLabels: false`, avoids that by measuring and drawing a
  *different* label, which moves every node in the diagram and shows markdown,
  entities and raw HTML literally.

  Nothing is re-measured here. `html.js` already lays each label out to decide
  how big its node is; `layoutLines()` now returns the runs that produced each
  line alongside its width, and a post-processing pass turns those lines into
  `<tspan>`s anchored on CSS half-leading baselines. Only the leaf changes: the
  diagram keeps the geometry it was laid out with -- across the sample corpus
  every deterministic diagram is byte-identical outside the labels -- and
  `<b>`/`<i>`, entities and markdown emphasis survive as real styled text. The
  HTML background behind an edge label becomes a `<rect>`.

  Replaced boxes are placed too: runs now carry their offset along the line, and
  `vertical-align` is resolved for them, so an `<img>` becomes an `<image>` on
  the line's baseline (or wherever `vertical-align` puts it) with the text
  around it pinned to the same offsets. A label keeps its `<foreignObject>` only
  when it holds a box with no SVG equivalent (`<canvas>`, `<video>`,
  `<iframe>`), or an image whose size never resolved.

### Changed
- README limitations. The `<foreignObject>` portability entry is gone, now that
  `flattenLabels` answers it, and the fonts entry says that nothing is embedded
  in the SVG -- so a rasterizer has to resolve the emitted `font-family` itself
  or substitute one with different metrics. Sample counts corrected to the
  current corpus: 226 diagrams, 221 of which render.

---

## [0.2.1] - 2026-09-01

### Fixed
- **mindmap and architecture required the optional native `canvas` module.**
  Both lay out through cytoscape, which builds a `CanvasRenderer` during
  construction; jsdom implements `getContext()` only when that native peer is
  installed, and cytoscape treats a null context as fatal
  (`Could not create canvas of type 2d`). The mindmap fix in 0.2.0 therefore
  shipped resting on a dependency this package deliberately dropped in 0.1.0
  along with the cairo/pango toolchain -- invisible locally, because jsdom
  declares `canvas` as an optional peer and npm had installed it.

  jsdom's `getContext` is now replaced unconditionally with a stub covering the
  four members cytoscape actually touches: `getContext('2d')`,
  `backingStorePixelRatio`, setting `font`, and `measureText`. Nothing is ever
  painted -- mermaid uses cytoscape purely as a layout engine, removing the
  container before the layout runs and reading node positions back out
  afterwards. Output is now identical whether or not `canvas` is installed, and
  "no native build step" holds for every diagram type.

  `measureText` answers from the same fontkit metrics as the rest of the
  geometry engine rather than returning 0.

### Changed
- **The package is 74% smaller: 50.8 MB unpacked to 13.2 MB** (6.6 MB packed).
  `fonts/` carried every width variant Google Fonts ships -- 78 files, 35.9 MB
  of `*_Condensed`, `*_SemiCondensed` and `*_ExtraCondensed` faces.

  They were unreachable, not merely unused. Each registers as its own family
  (`open sans condensed`, `noto sans extra condensed`, ...), mermaid never
  names one, and `resolve()` falls back to the default family rather than to a
  narrower width. The registry now holds exactly `open sans` (12 faces) and
  `noto sans` (18), and the corpus renders identically -- 223 of 228, node
  deviation unchanged at 0.016px.

  The one visible edge: a caller who explicitly asked for
  `fontFamily: 'Open Sans Condensed'` now falls back to Open Sans. Register the
  face yourself with `FontRegistry#registerFont` if you need it.

---

## [0.2.0] - 2026-09-01

Two diagram types went from unusable to matching Chrome. Both were browser
fidelity gaps in the DOM shim rather than anything mermaid does wrong, and
both were invisible to the parity gate: it measures node placement on the
stable diagram types, and neither gantt nor mindmap contributes nodes to it.

### Fixed
- **gantt placed every element at a negative coordinate.** Mermaid's gantt
  renderer takes the chart's total width from `elem.parentElement.offsetWidth`
  and guards only against `undefined`. Our `offsetWidth` shrink-to-fit every
  HTML element, so the div mermaid renders into measured 0, the d3 time
  scale's range became `[0, -150]`, and `gantt__1` came out as
  `viewBox="0 0 0 196"` with negative bar widths. A block-level element in the
  page's own flow now takes its width from its containing block, as in a
  browser; label HTML inside `<foreignObject>` and out-of-flow boxes still
  shrink to fit. gantt is the only renderer that reads a page-flow width.
- **gantt task labels measured their own padding.** SVG text lays out under
  `white-space: normal`, so Chrome collapses the trailing spaces in a line
  like `Describe gantt syntax : after doc1, 3d`. Measuring the raw character
  data made labels up to 30px too wide -- enough to flip a label from inside
  its bar to `taskTextOutsideRight`. Whitespace is now collapsed across a text
  element's runs before measuring.

  All ten gantt demos now match mermaid-cli exactly on viewBox, on every task
  rect and on every label's placement and position.
- **mindmap did not render at all**, throwing `Cannot read properties of
  undefined (reading 'h')`. Mermaid lays mindmaps out with cytoscape, which
  sizes its container as `clientWidth - parseFloat(padding-left) - ...`;
  jsdom returns `""` for any property outside its small UA stylesheet where a
  browser returns `"0px"`, so that produced `NaN`, the layout's bounding box
  came back `undefined`, and it threw inside the `cytoscape()` constructor
  before a single node was placed. `getComputedStyle` now reports the CSS
  initial `0px` for the box-model lengths whose initial value is 0.

  Both demos render, deterministically, with node sizes matching Chrome to
  0.02px. Node positions land within ~15px on a 750px diagram: cose-bilkent
  is an iterative force layout and amplifies sub-pixel size differences.

### Changed
- Node deviation across the corpus is unchanged at 0.016px over 86 compared
  diagrams, with no unexpected failures. Corpus render failures drop from 7 to
  5: the two mindmap demos now render, leaving the two `zenuml` demos and the
  three samples mermaid-cli rejects as invalid syntax.

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