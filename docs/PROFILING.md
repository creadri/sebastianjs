# DOM Profiling Tools

This directory contains tools for profiling and comparing DOM API usage between Chrome (Puppeteer) and sebastianjs (jsdom) to identify mismatches causing layout deviations.

## Overview

The profiling system works in three stages:

1. **Chrome profiling** - Runs Mermaid in real Chrome with instrumentation to capture ground-truth DOM API calls and responses
2. **jsdom profiling** - Runs sebastianjs with instrumentation to capture its DOM API calls and responses  
3. **Comparison** - Analyzes both profiles to identify mismatches and generate actionable recommendations

## Quick Start

```bash
# 1. Profile a diagram in Chrome (ground truth)
node scripts/profile-chrome.mjs samples/profiling/simple-flowchart.mmd

# 2. Profile the same diagram in jsdom (sebastianjs)
node scripts/profile-jsdom.mjs samples/profiling/simple-flowchart.mmd

# 3. Compare the profiles
node scripts/compare-profiles.mjs \
  samples/profiling/simple-flowchart-chrome-profile.json \
  samples/profiling/simple-flowchart-jsdom-profile.json
```

## Sample Diagrams

The `samples/profiling/` directory contains test cases:

- `simple-flowchart.mmd` - Basic flowchart with decision nodes
- `simple-sequence.mmd` - Sequence diagram with actors and messages
- `simple-class.mmd` - Class diagram with inheritance
- `simple-er.mmd` - Entity-relationship diagram
- `styled-flowchart.mmd` - Flowchart with custom classes (like flowchart__33.mmd)

## Understanding the Output

### Chrome Profile (`-chrome-profile.json`)
Contains:
- `calls[]` - Array of all DOM API calls with args/results
- `summary` - Call counts by method and element
- `svg` - The rendered SVG output

### jsdom Profile (`-jsdom-profile.json`)
Same structure as Chrome profile for direct comparison.

### Comparison Report
Shows:
- **Call count differences** - Methods called more/less often in jsdom
- **Value mismatches** - Where return values differ between Chrome and jsdom
- **Severity ratings** - High/medium/low impact on layout
- **Recommendations** - Specific actions to fix polyfills

Example output:
```
=== DOM Profile Comparison Report ===

Mismatches:
  Total:        156
  Value diffs:  89
  High severity: 12

Significant Mismatches:
  1. SVGGraphicsElement.getBBox on <text>
     Δwidth: 8.42, Δheight: 3.11

Recommendations:
  1. [HIGH] text measurement
     Issue: 12 high-severity getBBox mismatches detected
     Action: Review textMetrics.js getBBox implementation...
```

## Workflow for Fixing Deviations

1. **Identify the problem diagram**
   ```bash
   npm run deviation -- --sample flowchart__33.mmd --simple
   ```

2. **Profile it**
   ```bash
   node scripts/profile-chrome.mjs samples/mermaid-demos/flowchart__33.mmd
   node scripts/profile-jsdom.mjs samples/mermaid-demos/flowchart__33.mmd
   ```

3. **Compare**
   ```bash
   node scripts/compare-profiles.mjs \
     samples/mermaid-demos/flowchart__33-chrome-profile.json \
     samples/mermaid-demos/flowchart__33-jsdom-profile.json
   ```

4. **Fix the polyfill** based on recommendations
   - Edit `src/textMetrics.js` for text measurement issues
   - Edit `src/env.js` for missing DOM APIs
   - Adjust scaling constants (TEXT_WIDTH_SCALE, etc.)

5. **Verify improvement**
   ```bash
   npm run deviation -- --sample flowchart__33.mmd --simple
   ```

## Advanced Usage

### Verbose comparison
```bash
node scripts/compare-profiles.mjs chrome.json jsdom.json output.json --verbose
```

### Custom diagram
```bash
echo "graph TD; A-->B" > test.mmd
node scripts/profile-chrome.mjs test.mmd
node scripts/profile-jsdom.mjs test.mmd
node scripts/compare-profiles.mjs test-chrome-profile.json test-jsdom-profile.json
```

### Batch profiling
```bash
for diagram in samples/profiling/*.mmd; do
  echo "Profiling $diagram..."
  node scripts/profile-chrome.mjs "$diagram"
  node scripts/profile-jsdom.mjs "$diagram"
done
```

## Key Files

- `src/domInstrumentation.js` - Core instrumentation class
- `scripts/profile-chrome.mjs` - Puppeteer-based Chrome profiler
- `scripts/profile-jsdom.mjs` - jsdom profiler
- `scripts/compare-profiles.mjs` - Comparison and analysis tool

## Integration with Existing Tools

This profiling system complements:
- `scripts/deviation-suite.mjs` - Visual deviation testing
- `scripts/benchmark.mjs` - Performance benchmarking
- `npm test` - Unit tests

Use profiling when deviation tests show layout issues to understand *why* they happen.

## Tips

- Profile **before** and **after** polyfill changes to measure improvement
- Focus on "high severity" mismatches first (biggest layout impact)
- Chrome profiles are ~5-10x slower than jsdom due to Puppeteer overhead
- Save profiles for regression testing (`git add samples/profiling/*-profile.json`)
