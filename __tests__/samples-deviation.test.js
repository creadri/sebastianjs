import {
  runDeviationSuite,
  NORMALIZED_DEVIATION_THRESHOLD,
  POSITION_DEVIATION_THRESHOLD,
  VIEWBOX_WIDTH_REL_THRESHOLD,
  KNOWN_DEVIATIONS,
} from '../scripts/deviation-suite.mjs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Broad parity sweep over samples/mermaid-demos against real Chrome. Opt-in
// because every sample launches a browser.
//   DEVIATION_TESTS=1 npm test -- __tests__/samples-deviation.test.js
//
// Passed as an argument rather than via process.env: ESM hoists imports, so
// assigning the env var here runs after the suite has already read it, and the
// whole corpus would be swept — which overruns this test's time budget.
const MAX_SAMPLES = Number(process.env.DEVIATION_MAX_SAMPLES || 40);

const DEVIATION_ENABLED = process.env.DEVIATION_TESTS === '1' || process.env.DEV_COMPARE === '1';

// mermaid-cli is a devDependency, so look for the local binary. Probing `mmdc`
// on PATH (as this test used to) silently skipped everywhere it is not linked.
const MMDC = resolve('node_modules', '.bin', 'mmdc');

(DEVIATION_ENABLED ? describe : describe.skip)('Samples deviation vs mermaid-cli', () => {
  const hasMmdc = existsSync(MMDC);

  (hasMmdc ? it : it.skip)('matches Chrome across the sample corpus', async () => {
    const summary = await runDeviationSuite({ maxSamples: MAX_SAMPLES });
    console.log('Deviation summary:', summary);

    // Without this the suite reports zeros for an empty comparison set and every
    // assertion below passes while nothing has been measured.
    expect(summary.compared).toBeGreaterThan(0);

    // Absolute position error, unaligned — the assertion that can actually catch
    // a size or layout regression.
    expect(summary.avgRaw).toBeLessThanOrEqual(POSITION_DEVIATION_THRESHOLD);
    expect(summary.viewBoxWidthRel).toBeLessThanOrEqual(VIEWBOX_WIDTH_REL_THRESHOLD);
    // Shape-only, scale-invariant: weak on its own, useful alongside the above.
    expect(summary.avgNorm).toBeLessThanOrEqual(NORMALIZED_DEVIATION_THRESHOLD);
    // Any sample that regresses fails here. Samples with a known, documented
    // cause are listed in KNOWN_DEVIATIONS so the gate stays sharp rather than
    // being loosened until everything passes.
    expect(summary.unexpectedFailures).toEqual([]);
    expect(summary.failuresCount).toBeLessThanOrEqual(KNOWN_DEVIATIONS.size);
  }, 300000);
});
