# SebastainJS

SebastianJS is a mermaid wrapper designed to make it able to perform server-side svg renderers without needing a headless browser.

Sebastian :crab: is the little mermaid :mermaid: buttler/friend/assistant. And it's a catchy name so be it sebastianJS.

## Goal

Use default mermaidjs implementation, this is not a fork. It is designed to remain a wrapper.

Re-implementation of render methods in order to avoid the need of browser full dom support.

Focus is made on implementing SVG exports.

## Roadmap

- [x] Make structure of render method
- [x] Implement tests for all known mermaidjs diagrams (excluding beta ones)
- [x] Make first render implementation with minimal DOM support for basic flowchart
- [x] Make a tiny CLI
- [x] Mermaid theme support
- [ ] Extend render support by resolving test issues.
    - [ ] Flowchart
- [ ] Release First viable option

## Licence

[MIT License](./LICENSE.md)
