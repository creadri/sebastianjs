# state

## Example 1

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Very simple diagram
    ---
    stateDiagram
      accTitle: This is the accessible title
      accDescr:This is an accessible description
      State1 --> State2
```

## Example 2

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Very simple diagram
    ---
    stateDiagram
      direction TB

      accTitle: This is the accessible title
      accDescr: This is an accessible description

      classDef notMoving fill:white
      classDef movement font-style:italic
      classDef badBadEvent fill:#f00,color:white,font-weight:bold,stroke-width:2px,stroke:yellow

      [*]--> Still
      Still --> [*]
      Still --> Moving
      Moving --> Still
      Moving --> Crash
      Crash --> [*]

      class Still notMoving
      class Moving, Crash movement
      class Crash badBadEvent
      class end badBadEvent
```

## Example 3

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
stateDiagram
      direction TB

		  accTitle: This is the accessible title
      accDescr: This is an accessible description

      classDef notMoving fill:white
      classDef movement font-style:italic
      classDef badBadEvent fill:#f00,color:white,font-weight:bold,stroke-width:2px,stroke:yellow

      [*] --> Still:::notMoving
      Still --> [*]
      Still --> Moving:::movement
      Moving --> Still
      Moving --> Crash:::movement
      Crash:::badBadEvent --> [*]
```

## Example 4

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
stateDiagram-v2
      accTitle: very very simple state
      accDescr: This is a state diagram showing one state
      State1
```

## Example 5

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
stateDiagram
        classDef yourState font-style:italic,font-weight:bold,fill:white

        yswsii: Your state with spaces in it
        [*] --> yswsii:::yourState
        [*] --> SomeOtherState
        SomeOtherState --> YetAnotherState
        yswsii --> YetAnotherState
        YetAnotherState --> [*]
```

## Example 6

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
stateDiagram-v2
    [*] --> State1
    State1 --> State2 : Transition 1
    State1 --> State3 : Transition 2
    State1 --> State4 : Transition 3
    State1 --> [*]
```

## Example 7

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
stateDiagram-v2
    [*] --> First
    First --> Second
    First --> Third

    state "the first composite" as First {
        [*] --> 1st
        state innerFirst {
          state "1 in innerFirst" as 1st1st
          1st2nd: 2 in innerFirst
          [*] --> 1st1st
          1st1st --> 1st2nd
          %% 1st2nd --> 1st
        }
        1st --> innerFirst
        innerFirst --> 2nd
    }
    state Second {
        2nd --> [*]
    }
    state Third {
        [*] --> 3rd
        3rd --> [*]
    }
```

## Example 8

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
stateDiagram-v2
            state Active {
              Idle
            }
            Inactive --> Idle: ACT
            Active --> Active: LOG
```

## Example 9

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
stateDiagram-v2
      [*] --> S1
      S1 --> S2: This long line uses a br tagto create multiplelines.
      S1 --> S3: This transition description uses \na newline character\nto create multiple\nlines.
```

## Example 10

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
stateDiagram-v2
      direction LR
      State1: A state with a note
      note right of State1
        Important information!You can write notes.And\nthey\ncan\nbe\nmulti-\nline.
      end note
      State1 --> State2
      note left of State2 : Notes can be to the left of a state\n(like this one).
      note right of State2 : Notes can be to the right of a state\n(like this one).
```

