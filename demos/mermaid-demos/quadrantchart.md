# quadrantchart

## Example 1

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
%%{init: {"quadrantChart": {"quadrantPadding": 10}, "theme": "forest", "themeVariables": {"quadrant1TextFill": "blue"}} }%%
    quadrantChart
      x-axis Urgent --> Not Urgent
      y-axis Not Important --> important
      quadrant-1 Plan
      quadrant-2 Do
      quadrant-3 Delegate
      quadrant-4 Delete
```

## Example 2

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
%%{init: {"quadrantChart": {"chartWidth": 600, "chartHeight": 600} } }%%
    quadrantChart
      title Analytics and Business Intelligence Platforms
      x-axis "Completeness of Vision ❤" -->
      y-axis Ability to Execute
      quadrant-1 Leaders
      quadrant-2 Challengers
      quadrant-3 Niche
      quadrant-4 Visionaries
      Microsoft: [0.75, 0.75]
      Salesforce: [0.55, 0.60]
      IBM: [0.51, 0.40]
      Incorta: [0.20, 0.30]
```

