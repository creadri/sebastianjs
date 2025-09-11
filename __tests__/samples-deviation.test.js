import { runDeviationSuite, NORMALIZED_DEVIATION_THRESHOLD, POSITION_DEVIATION_THRESHOLD } from '../scripts/deviation-suite.mjs';

describe('Samples deviation vs mermaid-cli', () => {
  const hasMmdc = await (async () => {
    try {
      const mod = await import('child_process');
      const { execSync, spawnSync } = mod;
      try {
        execSync('mmdc --version', { stdio: 'ignore', env: process.env });
        return true;
      } catch (e) {
        try { const r = spawnSync('mmdc', ['--version'], { env: process.env }); if (r.status === 0) return true; } catch {}
        return false;
      }
    } catch { return false; }
  })();

  console.log('mmdc presence detected in test:', hasMmdc);
  (hasMmdc ? it : it.skip)('overall deviation within thresholds', async () => {
    const { avgNorm, avgRaw, failuresCount } = await runDeviationSuite();
    console.log('Deviation summary:', { avgNorm, avgRaw, failuresCount, NORMALIZED_DEVIATION_THRESHOLD, POSITION_DEVIATION_THRESHOLD });
    expect(avgNorm).toBeLessThanOrEqual(NORMALIZED_DEVIATION_THRESHOLD);
    expect(avgRaw).toBeLessThanOrEqual(POSITION_DEVIATION_THRESHOLD);
  }, 120000);
});
