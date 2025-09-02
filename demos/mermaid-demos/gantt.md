# gantt

## Example 1

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
gantt
        title A Gantt Diagram
        accTitle: A simple sample gantt diagram
        accDescr: 2 sections with 2 tasks each, from 2014
        dateFormat  YYYY-MM-DD
        section Section
        A task           :a1, 2014-01-01, 30d
        Another task     :after a1  , 20d
        section Another
        Task in sec      :2014-01-12  , 12d
        another task      : 24d
```

## Example 2

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
gantt
        title #; Gantt Diagrams Allow Semicolons and Hashtags #;!
        accTitle: A simple sample gantt diagram
        accDescr: 2 sections with 2 tasks each, from 2014
        dateFormat  YYYY-MM-DD
        section #;Section
        #;A task           :a1, 2014-01-01, 30d
        #;Another task     :after a1  , 20d
        section #;Another
        Task in sec      :2014-01-12  , 12d
        another task      : 24d
```

## Example 3

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
gantt
      title Airworks roadmap
      dateFormat YYYY-MM-DD
      axisFormat %m-%d %a
      excludes	weekends, 2021-10-01,2021-10-04,2021-10-05,2021-10-06,2021-10-07
      includes 2021-10-09

      section Airworks 3.4.1
      开发	:b, 2021-10-07, 5d
      测试	:after b, 4d
      OK  :milestore
      section Airworks 3.4.2
      开发	:a, 2021-10-09, 4d
      测试	:after a, 4d
```

## Example 4

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
gantt
    title Exclusive end dates (Manual date should end on 3d)
    dateFormat YYYY-MM-DD
    axisFormat %d
    section Section1
    2 Days: 1, 2019-01-01,2d
    Manual Date: 2, 2019-01-01,2019-01-03
```

## Example 5

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
gantt
    title Inclusive end dates (Manual date should end on 4th)
    dateFormat YYYY-MM-DD
    axisFormat %d
    inclusiveEndDates
    section Section1
    2 Days: 1, 2019-01-01,2d
    Manual Date: 2, 2019-01-01,2019-01-03
```

## Example 6

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
gantt
    title Hide today marker (vertical line should not be visible)
    dateFormat Z
    axisFormat %d/%m
    todayMarker off
    section Section1
    Today: 1, 08-08-09-01:00, 5min
```

## Example 7

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
gantt
    title Style today marker (vertical line should be 5px wide and half-transparent blue)
    dateFormat Z
    axisFormat %d/%m
    todayMarker stroke-width:5px,stroke:#00f,opacity:0.5
    section Section1
    Today: 1, 08-08-09-01:00, 5min
```

## Example 8

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
gantt
    dateFormat YYYY-MM-DD
    axisFormat %d/%m
    title Adding GANTT diagram to mermaid
    excludes weekdays 2014-01-10

    section A section
    Completed task :done, des1, 2014-01-06,2014-01-08
    Active task :active, des2, 2014-01-09, 3d
    Future task : des3, after des2, 5d
    Future task2 : des4, after des3, 5d

    section Critical tasks
    Completed task in the critical line :crit, done, 2014-01-06,24h
    Implement parser and jison :crit, done, after des1, 2d
    Create tests for parser :crit, active, 3d
    Future task in critical line :crit, 5d
    Create tests for renderer :2d
    Add to mermaid :1d

    section Documentation
    Describe gantt syntax :active, a1, after des1, 3d
    Add gantt diagram to demo page :after a1 , 20h
    Add another diagram to demo page :doc1, after a1 , 48h

    section Clickable
    Visit mermaidjs :active, cl1, 2014-01-07,2014-01-10
    Calling a Callback (look at the console log) :cl2, after cl1, 3d

    click cl1 href "https://mermaidjs.github.io/"
    click cl2 call ganttTestClick("test", test, test)

    section Last section
    Describe gantt syntax :after doc1, 3d
    Add gantt diagram to demo page : 20h
    Add another diagram to demo page : 48h
```

## Example 9

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
gantt
    dateFormat YYYY-MM-DD
    axisFormat %d/%m
    title GANTT diagram with multiline section titles
    excludes weekdays 2014-01-10

    section A sectionmultiline
    Completed task : done, des1, 2014-01-06,2014-01-08
    Active task : active, des2, 2014-01-09, 3d
    Future task : des3, after des2, 5d
    Future task2 : des4, after des3, 5d

    section Critical tasksmultiline
    Completed task in the critical line : crit, done, 2014-01-06, 24h
    Implement parser and jison : crit, done, after des1, 2d
    Create tests for parser : crit, active, 3d
    Future task in critical line : crit, 5d
    Create tests for renderer : 2d
    Add to mermaid : 1d

    section Documentationmultiline
    Describe gantt syntax : active, a1, after des1, 3d
    Add gantt diagram to demo page : after a1, 20h
    Add another diagram to demo page : doc1, after a1, 48h

    section Last sectionmultiline
    Describe gantt syntax : after doc1, 3d
    Add gantt diagram to demo page : 20h
    Add another diagram to demo page : 48h
```

## Example 10

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
      displayMode: compact
    ---
    gantt
    title GANTT compact
    dateFormat  HH:mm:ss
    axisFormat  %Hh%M

    section DB Clean
    Clean: 12:00:00, 10m
    Clean: 12:30:00, 12m
    Clean: 13:00:00, 8m
    Clean: 13:30:00, 9m
    Clean: 14:00:00, 13m
    Clean: 14:30:00, 10m
    Clean: 15:00:00, 11m

    section Sessions
    A: 12:00:00, 63m
    B: 12:30:00, 12m
    C: 13:05:00, 12m
    D: 13:06:00, 33m
    E: 13:15:00, 55m
    F: 13:20:00, 12m
    G: 13:32:00, 18m
    H: 13:50:00, 20m
    I: 14:10:00, 10m
```

