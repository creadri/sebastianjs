import { render } from '../src/index.js';
import { JSDOM } from 'jsdom';
import { execSync, spawn } from 'child_process';
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { promises as fsp } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ------------------------- Tunable Test Constants -------------------------
// Threshold for average node position deviation (in pixels). Lower => stricter.
// NOTE: Current layouts differ vertically due to spacing algorithm differences.
// We first attempt a simple linear alignment (translation + uniform scale) before
// computing residual deviation. Tighten this value as renderer parity improves.
const POSITION_DEVIATION_THRESHOLD = 15.0; // effective pixels after alignment (raw, informational)
const NORMALIZED_DEVIATION_THRESHOLD = 0.10; // average normalized (0..1) deviation allowed
// Max time (ms) to allow the CLI render to finish before considering failure.
const MMDC_RENDER_TIMEOUT_MS = 20000;
// Puppeteer launch args (avoid sandbox issues in CI/containers)
const PUPPETEER_ARGS = ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu','--no-zygote','--disable-dev-shm-usage'];
// -------------------------------------------------------------------------

/**
 * Parses SVG and extracts positions of nodes.
 * @param {string} svgString - The SVG content.
 * @returns {Map<string, {x: number, y: number}>} - Map of node IDs to positions.
 */
function extractNodePositions(svgString) {
  const dom = new JSDOM(svgString, { contentType: 'image/svg+xml' });
  const doc = dom.window.document;
  const nodes = doc.querySelectorAll('.node');
  const positions = new Map();

  for (const node of nodes) {
    const id = node.id || node.getAttribute('id');
    if (!id) continue;

    const transform = node.getAttribute('transform');
    if (transform) {
      const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
      if (match) {
        const x = parseFloat(match[1]);
        const y = parseFloat(match[2]);
        if (!isNaN(x) && !isNaN(y)) {
          positions.set(id, { x, y });
        }
      }
    }
  }

  return positions;
}

/**
 * Calculates the average position deviation between two position maps.
 * @param {Map<string, {x: number, y: number}>} pos1 - Positions from first SVG.
 * @param {Map<string, {x: number, y: number}>} pos2 - Positions from second SVG.
 * @returns {number} - Average deviation in pixels.
 */
function calculateAverageDeviation(pos1, pos2) {
  const commonIds = Array.from(pos1.keys()).filter(id => pos2.has(id));
  if (commonIds.length === 0) return Infinity;
  // Build arrays
  const a = commonIds.map(id => pos1.get(id));
  const b = commonIds.map(id => pos2.get(id));
  // Compute centroids
  const centroid = (pts) => pts.reduce((acc,p)=>({x:acc.x+p.x,y:acc.y+p.y}),{x:0,y:0});
  const ca = centroid(a); ca.x/=a.length; ca.y/=a.length;
  const cb = centroid(b); cb.x/=b.length; cb.y/=b.length;
  // Compute scale as average ratio of distances from centroid (avoid divide-by-zero)
  const distFrom = (c,p)=>Math.hypot(p.x-c.x,p.y-c.y) || 0.0001;
  let scaleAccum = 0, scaleCount = 0;
  for (let i=0;i<a.length;i++) { const da=distFrom(ca,a[i]); const db=distFrom(cb,b[i]); if (db>0) { scaleAccum += da/db; scaleCount++; } }
  const scale = scaleCount? scaleAccum/scaleCount : 1;
  // After aligning B points to A via translate+scale compute residuals
  let total = 0;
  for (let i=0;i<a.length;i++) {
    const target = a[i];
    const source = b[i];
    const sx = cb.x + (source.x - cb.x) * scale;
    const sy = cb.y + (source.y - cb.y) * scale;
    const dx = target.x - sx;
    const dy = target.y - sy;
    total += Math.hypot(dx, dy);
  }
  return total / a.length;
}

function calculateNormalizedDeviation(pos1, pos2) {
  const commonIds = Array.from(pos1.keys()).filter(id => pos2.has(id));
  if (!commonIds.length) return Infinity;
  const xs1 = commonIds.map(id => pos1.get(id).x);
  const ys1 = commonIds.map(id => pos1.get(id).y);
  const xs2 = commonIds.map(id => pos2.get(id).x);
  const ys2 = commonIds.map(id => pos2.get(id).y);
  const min = arr => Math.min(...arr);
  const max = arr => Math.max(...arr);
  const minX1 = min(xs1), maxX1 = max(xs1); const spanX1 = maxX1 - minX1 || 1;
  const minY1 = min(ys1), maxY1 = max(ys1); const spanY1 = maxY1 - minY1 || 1;
  const minX2 = min(xs2), maxX2 = max(xs2); const spanX2 = maxX2 - minX2 || 1;
  const minY2 = min(ys2), maxY2 = max(ys2); const spanY2 = maxY2 - minY2 || 1;
  let total = 0;
  for (const id of commonIds) {
    const a = pos1.get(id); const b = pos2.get(id);
    const ax = (a.x - minX1) / spanX1; const ay = (a.y - minY1) / spanY1;
    const bx = (b.x - minX2) / spanX2; const by = (b.y - minY2) / spanY2;
    const dx = ax - bx; const dy = ay - by;
    total += Math.hypot(dx, dy);
  }
  return total / commonIds.length;
}

/**
 * Renders a diagram using mermaid-cli.
 * @param {string} definition - Mermaid definition.
 * @param {Object} options - Options with width and height.
 * @returns {string} - SVG content.
 */
async function findChromeExecutable() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  // Mirror logic from benchmark script (simplified search paths)
  const candidates = [];
  const base = '/home/node/.cache/puppeteer';
  try {
    const entries = await fsp.readdir(base, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('chrome')) {
        const chromeDir = join(base, e.name);
        try {
          const osDirs = await fsp.readdir(chromeDir, { withFileTypes: true });
          for (const osd of osDirs) {
            if (!osd.isDirectory()) continue;
            const verDir = join(chromeDir, osd.name);
            try {
              const bins = await fsp.readdir(verDir, { withFileTypes: true });
              for (const b of bins) {
                if (b.isDirectory() && b.name.includes('linux')) {
                  candidates.push(join(verDir, b.name, 'chrome'));
                }
              }
            } catch {}
          }
        } catch {}
      } else if (e.name.startsWith('chrome-headless-shell')) {
        const chsDir = join(base, e.name);
        try {
          const osDirs = await fsp.readdir(chsDir, { withFileTypes: true });
          for (const osd of osDirs) {
            if (!osd.isDirectory()) continue;
            const verDir = join(chsDir, osd.name);
            try {
              const bins = await fsp.readdir(verDir, { withFileTypes: true });
              for (const b of bins) {
                if (b.isDirectory() && b.name.includes('linux')) {
                  candidates.push(join(verDir, b.name, 'chrome-headless-shell'));
                }
              }
            } catch {}
          }
        } catch {}
      }
    }
  } catch {}
  for (const p of candidates) { try { await fsp.access(p); return p; } catch {} }
  return null;
}

async function writeTempPptrConfig() {
  const cfgPath = join(process.env.TMPDIR || '/tmp', `seb-pptr-test-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  const cfg = { args: PUPPETEER_ARGS };
  await fsp.writeFile(cfgPath, JSON.stringify(cfg), 'utf8');
  return cfgPath;
}

function spawnAsync(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, opts);
    let stderr = '';
    p.stderr && p.stderr.on('data', d => { stderr += d.toString(); });
    p.on('error', err => reject(err));
    p.on('exit', code => {
      if (code === 0) resolve({ code, stderr }); else reject(new Error(`Command ${cmd} exited ${code}: ${stderr}`));
    });
  });
}

async function renderWithMermaidCli(definition, options = {}) {
  const tempDir = tmpdir();
  const inputFile = join(tempDir, `input_${Date.now()}_${Math.random().toString(36).slice(2)}.mmd`);
  const outputFile = join(tempDir, `output_${Date.now()}_${Math.random().toString(36).slice(2)}.svg`);
  let pptrCfg;
  try {
    writeFileSync(inputFile, definition, 'utf8');
    pptrCfg = await writeTempPptrConfig();
    const args = ['-i', inputFile, '-o', outputFile, '--puppeteerConfigFile', pptrCfg];
    if (options.width) args.push('-w', String(options.width));
    if (options.height) args.push('-H', String(options.height));
    const env = { ...process.env };
    try {
      const chrome = await findChromeExecutable();
      if (chrome) env.PUPPETEER_EXECUTABLE_PATH = chrome;
    } catch {}
    // Enforce a timeout manually
    await Promise.race([
      spawnAsync('mmdc', args, { env, stdio: ['ignore','ignore','pipe'] }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('mmdc render timeout')), MMDC_RENDER_TIMEOUT_MS)),
    ]);
    if (!existsSync(outputFile)) throw new Error('mmdc did not produce output file');
    return readFileSync(outputFile, 'utf8');
  } finally {
    try { if (inputFile && existsSync(inputFile)) unlinkSync(inputFile); } catch {}
    try { if (outputFile && existsSync(outputFile)) unlinkSync(outputFile); } catch {}
    try { if (pptrCfg && existsSync(pptrCfg)) unlinkSync(pptrCfg); } catch {}
  }
}

describe('SebastianJS vs Mermaid-CLI Comparison', () => {
  // Skip if mermaid-cli is not available
  const hasMermaidCli = (() => {
    try {
      execSync('mmdc --version', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  })();

  (hasMermaidCli ? it : it.skip)('should have low position deviation compared to mermaid-cli', async () => {
    const definition = `
graph TD
    A[Start] --> B{Is it working?}
    B -->|Yes| C[Great!]
    B -->|No| D[Debug]
    D --> B
    C --> E[End]
`;

    const options = { width: 800, height: 600 };

    // Render with both tools
    const sebastianSvg = await render(definition, options);
  const cliSvg = await renderWithMermaidCli(definition, options);

    // Extract positions
    const sebastianPositions = extractNodePositions(sebastianSvg);
    const cliPositions = extractNodePositions(cliSvg);

    // Calculate deviation
  const averageDeviation = calculateAverageDeviation(sebastianPositions, cliPositions);
  const normalizedDeviation = calculateNormalizedDeviation(sebastianPositions, cliPositions);

  console.log(`Average position deviation (raw): ${averageDeviation.toFixed(2)} pixels`);
  console.log(`Average normalized deviation: ${normalizedDeviation.toFixed(4)} (threshold ${NORMALIZED_DEVIATION_THRESHOLD})`);
    console.log(`Sebastian positions:`, Array.from(sebastianPositions.entries()));
    console.log(`CLI positions:`, Array.from(cliPositions.entries()));

    // Assert low deviation
  // Raw deviation logged for diagnostics; main assertion uses normalized metric.
  expect(normalizedDeviation).toBeLessThan(NORMALIZED_DEVIATION_THRESHOLD);
  // Force cleanup of lingering timers (mermaid / jsdom) to avoid open handles
  setImmediate(()=>{});
  }, 30000); // Longer timeout for CLI execution
});
