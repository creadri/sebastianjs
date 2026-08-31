# SebastianJS

SebastianJS is a mermaid wrapper designed to make it able to perform server-side svg renderers without needing a headless browser.

Sebastian :crab: is the little mermaid :mermaid: buttler/friend/assistant. And it's a catchy name so be it sebastianJS.

## Initial use case

Got attached in generating mermaid diagrams for different projects. But quickly got stuck and amazed as well on how well mermaidjs is supported throughout a lot of tools.

One key problem tough is that when it comes to exporting, not a lot of applications exports the mermaid diagrams well.

In trying to create a simple application to solve this problem I came accross another problem: it requires a browser to render.

Even mermaid-cli requires a headless browser and relies on puppeter. This is fine on a lot of levels but I think there should be an easier solution.

This project is therefore born trying to render mermaid diagrams inside nodejs without requiring the whole browser and DOM.

## Goal

Use default mermaidjs implementation, this is not a fork. It is designed to remain a wrapper.

Focus is made on implementing SVG exports.

As this doesn't require a headless browser, it should be faster to render.

## How are things so far

### August 2026

The rewrite landed. Instead of letting a hollow DOM compute a wrong layout and
patching the SVG afterwards, the DOM now measures correctly in the first place:
jsdom hosts the document and svgdom's geometry engine (vendored, driven by
fontkit) answers `getBBox`, `getComputedTextLength`, `getCTM` and friends.

Layout in mermaid is pure JS (dagre/ELK) — it was always correct, it was just
being fed wrong measurements. Fixing the measurements fixed the layout, which
post-processing structurally could not do: by the time you have the SVG, nodes
have already been placed from the wrong sizes.

Measured against real Chrome via mermaid-cli, both pinned to `htmlLabels: false`
and Open Sans:

| diagram | sebastianjs | chrome | Δ width |
| --- | --- | --- | --- |
| flowchart TD | 127.3 x 383.3 | 127.4 x 383.4 | 0.08% |
| flowchart LR | 1050.7 x 170.0 | 1052.1 x 170.0 | 0.13% |
| sequence | 500.0 x 333.0 | 500.0 x 333.0 | 0.00% |
| class | 299.2 x 367.0 | 299.7 x 367.0 | 0.17% |
| state | 121.5 x 358.0 | 121.9 x 358.0 | 0.26% |
| er | 449.1 x 474.0 | 449.3 x 474.0 | 0.05% |

Individual text runs match Chrome exactly (Δy 0.00, Δx ≤ 0.02, Δheight 0.00);
node positions land within 0.05px. Regenerate with
`node scripts/compare-chrome.mjs`.

**Labels use HTML in `<foreignObject>`, as mermaid does by default.** Measuring
that means modelling the small slice of CSS mermaid actually emits — the label
markup is 8 tags and 6 properties, and reduces to `width = widest line advance`,
`height = lines x line-height`. Raw HTML, entities and `<img>` in labels all work.

Set `htmlLabels: false` to emit SVG `<text>` instead:

```js
const svg = await render(def, { htmlLabels: false });
```

That matters for **portability**: `<foreignObject>` is not supported by librsvg
or resvg and only partly by Inkscape, so HTML labels render correctly in a
browser but can lose every label in a non-browser rasterizer pipeline. The
`<text>` path renders anywhere, at the cost of showing raw HTML, HTML entities
and `fa:` icons as literal text.

Images in labels are sized from `data:` URIs and local files. Pass
`allowRemoteImages: true` to fetch `http(s)` sources — off by default so
rendering never performs network I/O unasked. Pass `iconPacks` (Iconify JSON,
e.g. from `@iconify-json/fa6-solid`) to make `fa:` labels resolve to real icons
instead of literal text.

### November 2025

Not Great, mermaid uses a lot of DOM features to perform the layout. So far the goal was to: let an empty shell of a DOM do the math wrongly and get a very wrong layout. Then post process the results and try to mimic the looks. It worked for some demos but I don't think it's the right approach. Looking into svgdom project in order to have a more detailled and implemented DOM.

### August 2025

Doing great, already got some results and the benchmarks are showing obvious benefits in rendering with sebastianjs instead of mermaid-cli.

## Installation

```bash
npm install sebastianjs
```

## Usage

### API

```js
import { render } from 'sebastianjs';

const def = `graph TD; A[Start] --> B{OK?}; B -- Yes --> C[Done]; B -- No --> A;`;

const svg = await render(def, {
  theme: 'dark',
  themeVariables: { primaryColor: '#3366ff' },
  themeCSS: '.node rect{ rx:4; ry:4 }',
  // Viewport hints only — the size of the "page" the diagram is laid out on.
  // The rendered SVG sizes itself from its own bounding box (width="100%" plus
  // a max-width style and a viewBox), exactly as mermaid does in a browser and
  // as mermaid-cli emits.
  width: 800,        // optional (defaults to 800)
  height: 600,       // optional (defaults to 600)
});

// svg is a <svg …> string
```

### CLI

```bash
# From a file
sebastianjs input.mmd -o output.svg

# From stdin
echo 'graph TD; A-->B' | sebastianjs - > out.svg

# With theme options
sebastianjs input.mmd -o output.svg -t dark \
  --theme-vars '{"primaryColor":"#3366ff"}' \
  --theme-css '.node rect{rx:4;ry:4}'

# Set the viewport the diagram is laid out on. Like mermaid-cli's -w/-H these
# are layout hints; the emitted SVG still sizes itself from its own bounding box.
sebastianjs input.mmd -o out.svg -W 1200 -H 700
```

## Demos

Prebuilt comparison demos are located in the github pages: https://creadri.github.io/sebastianjs/


```bash
npm run fetch:samples
npm run build:site
npm run benchmark

# Optional: Run deviation comparison tests (requires mermaid-cli in PATH)
DEVIATION_TESTS=1 npm test -- __tests__/samples-deviation.test.js --runInBand

# Run deviation on a single sample
# Using env var (matches by basename or relative path under samples folder):
DEVIATION_TESTS=1 DEVIATION_SAMPLE=flowchart__1.mmd npm test -- __tests__/samples-deviation.test.js --runInBand

# Direct CLI for ad-hoc runs:
node scripts/deviation-suite.mjs -f samples/mermaid-demos/flowchart__1.mmd
```

## Roadmap

- [x] Make structure of render method
- [x] Implement tests for all known mermaidjs diagrams (excluding beta ones)
- [x] Make first render implementation with minimal DOM support for basic flowchart
- [x] Make a tiny CLI
- [x] Mermaid theme support
- [ ] Fix positioning and sizing issues
- [ ] Release First viable option
- [ ] Analyze the feasability of PNG/GIF/JPEG exports and if reasonable implement it
- [x] Create a benchmark to assess the difference in performance compared to mermaid-cli


## Limitations

Note on accuracy
: SebastianJS requires node-canvas for accurate, browserless text measurement (no headless browser).

## Dependencies

### Install dependencies for Canvas (Ubuntu/Debian)
```bash
sudo apt-get install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```

Src: https://www.npmjs.com/package/canvas

## Licence

[MIT License](./LICENSE)

Demo files where taken from mermaid-js/mermaid repository
: [Mermaid MIT License](https://github.com/mermaid-js/mermaid?tab=MIT-1-ov-file)

Thanks for the fonts under `fonts/` with their licenses:
- Noto Sans: [OFL](./fonts/Noto_Sans/OFL.txt)
- Open Sans: [OFL](./fonts/Open_Sans/OFL.txt)

<!-- BENCHMARK_START -->
## Benchmark

_Last updated: 2025-09-25T12:26:58.647Z_

Rendering all sample diagrams (count: 228).



### Summary Table

| Metric | sebastianjs | mermaid-cli |
| --- | --- | --- |
| Samples | 228 | 228 |
| Successful | 199 | 224 |
| Avg ms | 84.81 | 1960.71 |
| Total ms | 19336.00 | 447043.00 |
| Min ms | 8.00 | 1750.00 |
| Max ms | 1325.00 | 2659.00 |

### Mermaid Graph



```mermaid
xychart
  title "Average Render Time (ms)"
  x-axis [sebastianjs, mermaid-cli]
  bar [84.81, 1960.71]
```

<!-- BENCHMARK_END -->
