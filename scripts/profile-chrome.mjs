/**
 * Puppeteer-based DOM profiler that captures ground-truth DOM API responses
 * from real Chrome for comparison with jsdom polyfills.
 */

import puppeteer from 'puppeteer';
import { readFile, writeFile } from 'fs/promises';

/**
 * Profile a Mermaid diagram in real Chrome with instrumentation
 */
export async function profileInChrome(definition, options = {}) {
  const {
    width = 800,
    height = 600,
    mermaidConfig = {
      startOnLoad: false,
      securityLevel: 'loose',
      htmlLabels: false,
      themeVariables: { fontFamily: 'DejaVu Sans, Arial, sans-serif' },
    },
    outputPath = null,
  } = options;

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--no-zygote',
      '--disable-dev-shm-usage',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height });

    // Load page with Mermaid
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { margin: 0; padding: 20px; font-family: 'DejaVu Sans', Arial, sans-serif; }
          #container { width: ${width}px; height: ${height}px; }
        </style>
      </head>
      <body>
        <div id="container"></div>
        <script type="module">
          import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
          window.mermaid = mermaid;
          window.mermaidReady = true;
        </script>
      </body>
      </html>
    `);

    // Wait for Mermaid to load
    await page.waitForFunction(() => window.mermaidReady === true, { timeout: 10000 });

    // Inject instrumentation code
    await page.evaluate(() => {
      window.__domCalls = [];
      window.__callIndex = 0;

      const serializeValue = (val) => {
        if (val === null || val === undefined) return val;
        if (typeof val === 'number' || typeof val === 'string' || typeof val === 'boolean') {
          return val;
        }
        if (val instanceof DOMRect || val instanceof SVGRect) {
          return { x: val.x, y: val.y, width: val.width, height: val.height };
        }
        if (val instanceof DOMPoint || val instanceof SVGPoint) {
          return { x: val.x, y: val.y };
        }
        if (val && typeof val === 'object') {
          try {
            return JSON.parse(JSON.stringify(val));
          } catch {
            return String(val);
          }
        }
        return String(val);
      };

      const captureElement = (el) => {
        if (!el) return null;
        const tag = el.tagName?.toLowerCase() || 'unknown';
        const id = el.id || '';
        const classes = el.className?.baseVal || el.className || '';
        let html = el.outerHTML || '';
        if (html.length > 200) html = html.slice(0, 200) + '...';
        
        let computedFont = null;
        if (tag === 'text' || tag === 'tspan') {
          try {
            const style = getComputedStyle(el);
            computedFont = {
              fontFamily: style.fontFamily,
              fontSize: style.fontSize,
              fontWeight: style.fontWeight,
              fontStyle: style.fontStyle,
            };
          } catch {}
        }
        
        return { tag, id, classes, html, computedFont };
      };

      const wrapMethod = (proto, protoName, method) => {
        if (!proto || !proto[method]) return;
        const original = proto[method];
        proto[method] = function(...args) {
          const callId = window.__callIndex++;
          const startTime = performance.now();
          let result, error;
          
          try {
            result = original.apply(this, args);
          } catch (err) {
            error = { message: err.message };
            throw err;
          } finally {
            const duration = performance.now() - startTime;
            window.__domCalls.push({
              callId,
              method: `${protoName}.${method}`,
              element: captureElement(this),
              args: args.map(serializeValue),
              result: serializeValue(result),
              error,
              duration,
              timestamp: Date.now(),
            });
          }
          
          return result;
        };
      };

      // Wrap key methods
      wrapMethod(Element.prototype, 'Element', 'getBBox');
      wrapMethod(Element.prototype, 'Element', 'getBoundingClientRect');
      wrapMethod(Element.prototype, 'Element', 'getAttribute');
      wrapMethod(SVGGraphicsElement.prototype, 'SVGGraphicsElement', 'getBBox');
      wrapMethod(SVGTextContentElement.prototype, 'SVGTextContentElement', 'getComputedTextLength');
      wrapMethod(SVGTextContentElement.prototype, 'SVGTextContentElement', 'getSubStringLength');
      wrapMethod(SVGGeometryElement.prototype, 'SVGGeometryElement', 'getTotalLength');
      wrapMethod(SVGGeometryElement.prototype, 'SVGGeometryElement', 'getPointAtLength');

      // Wrap getComputedStyle
      const origGetComputedStyle = window.getComputedStyle;
      window.getComputedStyle = function(el, pseudoElt) {
        const callId = window.__callIndex++;
        const result = origGetComputedStyle.call(this, el, pseudoElt);
        const captured = {};
        ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'width', 'height'].forEach(p => {
          try { captured[p] = result[p]; } catch {}
        });
        window.__domCalls.push({
          callId,
          method: 'window.getComputedStyle',
          element: captureElement(el),
          args: [null, pseudoElt],
          result: captured,
          error: null,
          duration: 0,
          timestamp: Date.now(),
        });
        return result;
      };
    });

    // Render the diagram
    const result = await page.evaluate(async (def, config) => {
      mermaid.initialize(config);
      const container = document.getElementById('container');
      const { svg } = await mermaid.render('profiled-diagram', def, container);
      container.innerHTML = svg;
      
      return {
        svg,
        calls: window.__domCalls || [],
      };
    }, definition, mermaidConfig);

    const { svg, calls } = result;

    // Compute summary
    const methodCounts = {};
    const elementCounts = {};
    let totalDuration = 0;

    for (const call of calls) {
      methodCounts[call.method] = (methodCounts[call.method] || 0) + 1;
      if (call.element?.tag) {
        elementCounts[call.element.tag] = (elementCounts[call.element.tag] || 0) + 1;
      }
      totalDuration += call.duration || 0;
    }

    const profile = {
      environment: 'chrome',
      definition,
      callCount: calls.length,
      calls,
      summary: {
        totalCalls: calls.length,
        methodCounts,
        elementCounts,
        totalDuration,
        averageDuration: calls.length ? totalDuration / calls.length : 0,
      },
      svg,
    };

    if (outputPath) {
      await writeFile(outputPath, JSON.stringify(profile, null, 2));
      console.log(`Chrome profile saved to: ${outputPath}`);
    }

    return profile;
  } finally {
    await browser.close();
  }
}

/**
 * CLI entry point
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: node scripts/profile-chrome.mjs <diagram.mmd> [output.json]');
    process.exit(1);
  }

  const diagramPath = args[0];
  const outputPath = args[1] || diagramPath.replace(/\.mmd$/, '-chrome-profile.json');

  try {
    const definition = await readFile(diagramPath, 'utf8');
    const profile = await profileInChrome(definition, { outputPath });
    
    console.log('\n=== Chrome Profile Summary ===');
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
  } catch (error) {
    console.error('Error profiling diagram:', error);
    process.exit(1);
  }
}
