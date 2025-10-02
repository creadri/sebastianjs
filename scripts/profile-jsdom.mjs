/**
 * Profile sebastianjs (jsdom-based) rendering to capture DOM API calls
 * for comparison with Chrome ground truth.
 */

import { readFile, writeFile } from 'fs/promises';
import { DOMInstrumenter } from '../src/domInstrumentation.js';
import { setupEnvironment } from '../src/env.js';
import { installTextMetrics } from '../src/textMetrics.js';
import { ensureDomPurify } from '../src/dompurify.js';
import { createMermaidConfig, renderDiagram } from '../src/mermaidRenderer.js';
import { normalizeViewBox, normalizeViewBoxOrigin } from '../src/postProcess.js';

/**
 * Profile a Mermaid diagram using sebastianjs with instrumentation
 */
export async function profileInJsdom(definition, options = {}) {
  const {
    width = 800,
    height = 600,
    outputPath = null,
  } = options;

  // Set up jsdom environment
  const { window, document } = setupEnvironment(options);

  // Install text metrics BEFORE instrumenting (so we instrument the polyfilled version)
  await installTextMetrics(window, options);

  // Create instrumenter and install it AFTER polyfills
  const instrumenter = new DOMInstrumenter();
  const { getCalls, restore } = instrumenter.instrument(window, {
    captureStacks: false, // Disabled to avoid OOM in jsdom
    captureElements: false, // Disabled to avoid OOM with outerHTML in jsdom
  });

  try {

    // Ensure DOMPurify
    window.DOMPurify = await ensureDomPurify(window);

    // Import mermaid
    const { default: mermaid } = await import('mermaid');

    // Create and apply Mermaid config
    const initConfig = createMermaidConfig(options);
    mermaid.initialize(initConfig);

    // Create container
    const container = document.createElement('div');
    if (width) container.style.width = `${width}px`;
    if (height) container.style.height = `${height}px`;
    document.body.appendChild(container);

    // Render the diagram
    const result = await renderDiagram(definition, options, container, mermaid, initConfig);
    let svg = result?.svg || container.innerHTML || '';
    
    // Apply post-processing (this is what we want to optimize)
    svg = normalizeViewBox(svg);
    svg = normalizeViewBoxOrigin(svg);

    // Apply explicit width/height
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
    const root = dom.window.document.documentElement;
    if (width != null) root.setAttribute('width', `${width}`);
    if (height != null) root.setAttribute('height', `${height}`);
    svg = root.outerHTML;

    // Get all recorded calls
    const calls = getCalls();

    // Compute summary
    const profile = {
      environment: 'jsdom',
      definition,
      callCount: calls.length,
      calls,
      summary: instrumenter.getSummary(),
      svg,
    };

    if (outputPath) {
      await writeFile(outputPath, JSON.stringify(profile, null, 2));
      console.log(`jsdom profile saved to: ${outputPath}`);
    }

    return profile;
  } finally {
    restore();
  }
}

/**
 * CLI entry point
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: node scripts/profile-jsdom.mjs <diagram.mmd> [output.json]');
    process.exit(1);
  }

  const diagramPath = args[0];
  const outputPath = args[1] || diagramPath.replace(/\.mmd$/, '-jsdom-profile.json');

  try {
    const definition = await readFile(diagramPath, 'utf8');
    const profile = await profileInJsdom(definition, { outputPath });
    
    console.log('\n=== jsdom Profile Summary ===');
    console.log(`Total DOM calls: ${profile.callCount}`);
    console.log(`Total duration: ${profile.summary.totalDuration.toFixed(2)}ms`);
    console.log(`Average call duration: ${profile.summary.averageDuration.toFixed(3)}ms`);
    console.log('\nTop methods:');
    Object.entries(profile.summary.methodCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([method, count]) => {
        console.log(`  ${method}: ${count}`);
      });
    console.log('\nTop elements:');
    Object.entries(profile.summary.elementCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([element, count]) => {
        console.log(`  <${element}>: ${count}`);
      });
    
    // Exit cleanly
    setImmediate(() => process.exit(0));
  } catch (error) {
    console.error('Error profiling diagram:', error);
    process.exit(1);
  }
}
