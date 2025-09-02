# dataflowchart

## Example 1

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
flowchart LR
      accTitle: A simple linear flowchart.
      accDescr: A Database has input to a circle System has output to a square Customer.
      DataStore[|borders:tb|Database] -->|input| Process((System)) -->|output| Entity[Customer];
```

## Example 2

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
flowchart TD
      allSides[ stroke all sides ];
      allSides2[|borders:ltrb| stroke all sides ];
      rbSides[|borders:rb| stroke right and bottom sides ];
      ltSides[|borders:lt| stroke left and top sides ];
      lrSides[|borders:lr| stroke left and right sides ];
      noSide[|borders:no| stroke no side ];
```

