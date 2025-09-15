import { runDeviationSuite, NORMALIZED_DEVIATION_THRESHOLD, POSITION_DEVIATION_THRESHOLD } from '../scripts/deviation-suite.mjs';
import { execSync, spawnSync } from 'child_process';

describe('Samples deviation vs mermaid-cli', () => {
  const hasMmdc = (() => {
    try { execSync('mmdc --version', { stdio: 'ignore', env: process.env }); return true; }
    catch { try { const r = spawnSync('mmdc', ['--version'], { env: process.env }); return r.status === 0; } catch { return false; } }
  })();

  console.log('mmdc presence detected in test:', hasMmdc);
  (hasMmdc ? it : it.skip)('overall deviation within thresholds', async () => {
    const { avgNorm, avgRaw, failuresCount } = await runDeviationSuite();
    console.log('Deviation summary:', { avgNorm, avgRaw, failuresCount, NORMALIZED_DEVIATION_THRESHOLD, POSITION_DEVIATION_THRESHOLD });
    expect(avgNorm).toBeLessThanOrEqual(NORMALIZED_DEVIATION_THRESHOLD);
    expect(avgRaw).toBeLessThanOrEqual(POSITION_DEVIATION_THRESHOLD);
  }, 120000);
});
