# SebastianJS

SebastianJS is a mermaid wrapper designed to make it able to perform server-side svg renderers without needing a headless browser.

Sebastian :crab: is the little mermaid :mermaid: buttler/friend/assistant. And it's a catchy name so be it sebastianJS.

## Initial use case

I was tired of needing to use a headless browser in order to render mermaid diagrams. I tried different ways including mermaidjs-cli that still requires puppeter and a headless browser.

Browsing some of mermaidjs requests I found some that are demanding exactly this. So this is an attempt at fixing a problem not a lot of people have.

## Goal

Use default mermaidjs implementation, this is not a fork. It is designed to remain a wrapper.

Focus is made on implementing SVG exports.

As this doesn't require a headless browser, it should be faster to render.

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
    normalizeViewBox: true,
    viewBoxMargin: 6,
});

// svg is a <svg …> string
```

### CLI

```bash
# From a file
sebastianjs input.mmd -o output.svg --normalize-viewbox

# From stdin
echo 'graph TD; A-->B' | sebastianjs - > out.svg

# With theme options
sebastianjs input.mmd -o output.svg -t dark \
    --theme-vars '{"primaryColor":"#3366ff"}' \
    --theme-css '.node rect{rx:4;ry:4}' \
    --normalize-viewbox --viewbox-margin 6
```

## Demos

Prebuilt comparison demos are located in the github pages: https://creadri.github.io/sebastianjs/


```bash
npm run fetch:samples
npm run build:site
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
- [ ] Create a benchmark to assess the difference in performance compared to mermaid-cli

## Current conditions

| Diagram Name      | Mermaid Status | SebastianJS Status     |
|-------------------|---------------|-------------------------|
| graph             | Supported     | Not yet supported       |
| flowchart         | Supported     | Not yet supported       |
| sequenceDiagram   | Supported     | Not yet supported       |
| classDiagram      | Supported     | Not yet supported       |
| erDiagram         | Supported     | Not yet supported       |
| gantt             | Supported     | Not yet supported       |
| pie               | Supported     | Not yet supported       |
| journey           | Supported     | Not yet supported       |
| stateDiagram      | Supported     | Not yet supported       |
| gitGraph          | Supported     | Not yet supported       |
| quadrantChart     | Beta          | Not yet supported       |

## Limitations and Dependencies

Note on accuracy
- SebastianJS requires node-canvas for accurate, browserless text measurement (no headless browser). Ensure the canvas package is installed and system libraries are present.

Fonts
- Don’t hardcode system font paths in code. Provide fonts one of these ways:
    - At call time: render(def, { fonts: [{ path: '/path/YourFont.ttf', family: 'Your Font', weight: '400', style: 'normal' }] })
    - Environment variables:
        - SEBASTIANJS_FONT_PATH and SEBASTIANJS_FONT_FAMILY (optional: SEBASTIANJS_FONT_WEIGHT, SEBASTIANJS_FONT_STYLE)
    - Default font family used for measurement can be set via options.themeVariables.fontFamily or SEBASTIANJS_DEFAULT_FONT_FAMILY.

## Licence

[MIT License](./LICENSE)
