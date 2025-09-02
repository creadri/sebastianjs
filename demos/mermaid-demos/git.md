# git

## Example 1

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Simple "branch and merge" (left-to-right)
    ---
    gitGraph LR:
    commit
    branch newbranch
    checkout newbranch
    commit
    checkout main
    merge newbranch
```

## Example 2

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Simple "branch and merge" (top-to-bottom)
    ---
    gitGraph TB:
    commit
    branch newbranch
    checkout newbranch
    commit
    checkout main
    merge newbranch
```

## Example 3

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
      title: Simple "branch and merge" (bottom-to-top)
      ---
      gitGraph BT:
      commit
      branch newbranch
      checkout newbranch
      commit
      checkout main
      merge newbranch
```

## Example 4

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Continuous development (left-to-right)
    ---
    gitGraph LR:
    commit
    branch develop
    checkout develop
    commit
    checkout main
    merge develop
    checkout develop
    commit
    checkout main
    merge develop
```

## Example 5

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Continuous development (top-to-bottom)
    ---
    gitGraph TB:
    commit
    branch develop
    checkout develop
    commit
    checkout main
    merge develop
    checkout develop
    commit
    checkout main
    merge develop
```

## Example 6

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
      title: Continuous development (bottom-to-top)
      ---
      gitGraph BT:
      commit
      branch develop
      checkout develop
      commit
      checkout main
      merge develop
      checkout develop
      commit
      checkout main
      merge develop
```

## Example 7

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Merge feature to advanced main (left-to-right)
    ---
    gitGraph LR:
    commit
    branch newbranch
    checkout newbranch
    commit
    checkout main
    commit
    merge newbranch
```

## Example 8

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Merge feature to advanced main (top-to-bottom)
    ---
    gitGraph TB:
    commit
    branch newbranch
    checkout newbranch
    commit
    checkout main
    commit
    merge newbranch
```

## Example 9

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
      title: Merge feature to advanced main (bottom-to-top)
      ---
      gitGraph BT:
      commit
      branch newbranch
      checkout newbranch
      commit
      checkout main
      commit
      merge newbranch
```

## Example 10

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Two-way merges (left-to-right)
    ---
    gitGraph LR:
    commit
    branch develop
    checkout develop
    commit
    checkout main
    merge develop
    commit
    checkout develop
    merge main
    commit
    checkout main
    merge develop
```

## Example 11

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Two-way merges (top-to-bottom)
    ---
    gitGraph TB:
    commit
    branch develop
    checkout develop
    commit
    checkout main
    merge develop
    commit
    checkout develop
    merge main
    commit
    checkout main
    merge develop
```

## Example 12

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
      title: Two-way merges (bottom-to-top)
      ---
      gitGraph BT:
      commit
      branch develop
      checkout develop
      commit
      checkout main
      merge develop
      commit
      checkout develop
      merge main
      commit
      checkout main
      merge develop
```

## Example 13

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Cherry-pick from branch (left-to-right)
    ---
    gitGraph LR:
    commit
    branch newbranch
    checkout newbranch
    commit id: "Pick me"
    checkout main
    commit
    checkout newbranch
    commit
    checkout main
    cherry-pick id: "Pick me"
```

## Example 14

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Cherry-pick from branch (top-to-bottom)
    ---
    gitGraph TB:
    commit
    branch newbranch
    checkout newbranch
    commit id: "Pick me"
    checkout main
    commit
    checkout newbranch
    commit
    checkout main
    cherry-pick id: "Pick me"
```

## Example 15

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
      title: Cherry-pick from branch (bottom-to-top)
      ---
      gitGraph BT:
      commit
      branch newbranch
      checkout newbranch
      commit id: "Pick me"
      checkout main
      commit
      checkout newbranch
      commit
      checkout main
      cherry-pick id: "Pick me"
```

## Example 16

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Cherry-pick from main (left-to-right)
    ---
    gitGraph LR:
    commit
    branch develop
    commit
    checkout main
    commit id:"A"
    checkout develop
    commit
    cherry-pick id: "A"
```

## Example 17

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Cherry-pick from main (top-to-bottom)
    ---
    gitGraph TB:
    commit
    branch develop
    commit
    checkout main
    commit id:"A"
    checkout develop
    commit
    cherry-pick id: "A"
```

## Example 18

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
      title: Cherry-pick from main (bottom-to-top)
      ---
      gitGraph BT:
      commit
      branch develop
      commit
      checkout main
      commit id:"A"
      checkout develop
      commit
      cherry-pick id: "A"
```

## Example 19

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Cherry-pick then merge (left-to-right)
    ---
    gitGraph LR:
    commit
    branch newbranch
    checkout newbranch
    commit id: "Pick me"
    checkout main
    commit
    checkout newbranch
    commit
    checkout main
    cherry-pick id: "Pick me"
    merge newbranch
```

## Example 20

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Cherry-pick then merge (top-to-bottom)
    ---
    gitGraph TB:
    commit
    branch newbranch
    checkout newbranch
    commit id: "Pick me"
    checkout main
    commit
    checkout newbranch
    commit
    checkout main
    cherry-pick id: "Pick me"
    merge newbranch
```

## Example 21

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
      title: Cherry-pick then merge (bottom-to-top)
      ---
      gitGraph BT:
      commit
      branch newbranch
      checkout newbranch
      commit id: "Pick me"
      checkout main
      commit
      checkout newbranch
      commit
      checkout main
      cherry-pick id: "Pick me"
      merge newbranch
```

## Example 22

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Merge from main onto undeveloped branch (left-to-right)
    ---
    gitGraph LR:
    commit
    branch develop
    commit
    checkout main
    commit
    checkout develop
    merge main
```

## Example 23

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Merge from main onto undeveloped branch (top-to-bottom)
    ---
    gitGraph TB:
    commit
    branch develop
    commit
    checkout main
    commit
    checkout develop
    merge main
```

## Example 24

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
      title: Merge from main onto undeveloped branch (bottom-to-top)
      ---
      gitGraph BT:
      commit
      branch develop
      commit
      checkout main
      commit
      checkout develop
      merge main
```

## Example 25

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Merge from main onto developed branch (left-to-right)
    ---
    gitGraph LR:
    commit
    branch develop
    commit
    checkout main
    commit
    checkout develop
    commit
    merge main
```

## Example 26

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Merge from main onto developed branch (top-to-bottom)
    ---
    gitGraph TB:
    commit
    branch develop
    commit
    checkout main
    commit
    checkout develop
    commit
    merge main
```

## Example 27

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
      title: Merge from main onto developed branch (bottom-to-top)
      ---
      gitGraph BT:
      commit
      branch develop
      commit
      checkout main
      commit
      checkout develop
      commit
      merge main
```

## Example 28

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Two branches from same commit (left-to-right)
    ---
    gitGraph LR:
    commit
    commit
    branch feature-001
    commit
    commit
    checkout main
    branch feature-002
    commit
    checkout feature-001
    merge feature-002
```

## Example 29

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Two branches from same commit (top-to-bottom)
    ---
    gitGraph TB:
    commit
    commit
    branch feature-001
    commit
    commit
    checkout main
    branch feature-002
    commit
    checkout feature-001
    merge feature-002
```

## Example 30

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
      title: Two branches from same commit (bottom-to-top)
      ---
      gitGraph BT:
      commit
      commit
      branch feature-001
      commit
      commit
      checkout main
      branch feature-002
      commit
      checkout feature-001
      merge feature-002
```

## Example 31

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Three branches and a cherry-pick from each (left-to-right)
    ---
    gitGraph LR:
    commit id: "ZERO"
    branch develop
    commit id:"A"
    checkout main
    commit id:"ONE"
    checkout develop
    commit id:"B"
    branch featureA
    commit id:"FIX"
    commit id: "FIX-2"
    checkout main
    commit id:"TWO"
    cherry-pick id:"A"
    commit id:"THREE"
    cherry-pick id:"FIX"
    checkout develop
    commit id:"C"
    merge featureA
```

## Example 32

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Three branches and a cherry-pick from each (top-to-bottom)
    ---
    gitGraph TB:
    commit id: "ZERO"
    branch develop
    commit id:"A"
    checkout main
    commit id:"ONE"
    checkout develop
    commit id:"B"
    branch featureA
    commit id:"FIX"
    commit id: "FIX-2"
    checkout main
    commit id:"TWO"
    cherry-pick id:"A"
    commit id:"THREE"
    cherry-pick id:"FIX"
    checkout develop
    commit id:"C"
    merge featureA
```

## Example 33

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Three branches and a cherry-pick from each (bottom-to-top)
    ---
    gitGraph BT:
    commit id: "ZERO"
    branch develop
    commit id:"A"
    checkout main
    commit id:"ONE"
    checkout develop
    commit id:"B"
    branch featureA
    commit id:"FIX"
    commit id: "FIX-2"
    checkout main
    commit id:"TWO"
    cherry-pick id:"A"
    commit id:"THREE"
    cherry-pick id:"FIX"
    checkout develop
    commit id:"C"
    merge featureA
```

