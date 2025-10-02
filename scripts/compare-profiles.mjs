/**
 * Analyze and compare DOM profiling data from Chrome vs jsdom
 * to identify mismatches that cause layout deviations.
 */

import { readFile, writeFile } from 'fs/promises';

/**
 * Compare two DOM profiles and identify mismatches
 */
export function compareProfiles(chromeProfile, jsdomProfile) {
  const mismatches = [];
  const insights = {
    totalCalls: {
      chrome: chromeProfile.callCount,
      jsdom: jsdomProfile.callCount,
      diff: jsdomProfile.callCount - chromeProfile.callCount,
    },
    methodDifferences: {},
    significantMismatches: [],
    recommendations: [],
  };

  // Build call maps keyed by callId (assuming they align by order)
  // For more robust matching, we could hash element+method+args
  const chromeCalls = new Map(chromeProfile.calls.map(c => [c.callId, c]));
  const jsdomCalls = new Map(jsdomProfile.calls.map(c => [c.callId, c]));

  // Compare method call counts
  const allMethods = new Set([
    ...Object.keys(chromeProfile.summary.methodCounts),
    ...Object.keys(jsdomProfile.summary.methodCounts),
  ]);

  for (const method of allMethods) {
    const chromeCount = chromeProfile.summary.methodCounts[method] || 0;
    const jsdomCount = jsdomProfile.summary.methodCounts[method] || 0;
    if (chromeCount !== jsdomCount) {
      insights.methodDifferences[method] = {
        chrome: chromeCount,
        jsdom: jsdomCount,
        diff: jsdomCount - chromeCount,
      };
    }
  }

  // Compare individual calls (match by index/order)
  const maxCalls = Math.max(chromeProfile.calls.length, jsdomProfile.calls.length);
  
  for (let i = 0; i < maxCalls; i++) {
    const chromeCall = chromeProfile.calls[i];
    const jsdomCall = jsdomProfile.calls[i];

    if (!chromeCall && jsdomCall) {
      mismatches.push({
        index: i,
        type: 'extra_jsdom_call',
        jsdomCall,
      });
      continue;
    }

    if (chromeCall && !jsdomCall) {
      mismatches.push({
        index: i,
        type: 'missing_jsdom_call',
        chromeCall,
      });
      continue;
    }

    // Both exist - compare
    if (chromeCall.method !== jsdomCall.method) {
      mismatches.push({
        index: i,
        type: 'method_mismatch',
        chrome: chromeCall.method,
        jsdom: jsdomCall.method,
        chromeCall,
        jsdomCall,
      });
      continue;
    }

    // Compare return values for same method
    const valueMismatch = compareValues(chromeCall.result, jsdomCall.result);
    if (valueMismatch) {
      const severity = calculateSeverity(chromeCall.method, valueMismatch);
      mismatches.push({
        index: i,
        type: 'value_mismatch',
        method: chromeCall.method,
        element: chromeCall.element?.tag || 'unknown',
        chrome: chromeCall.result,
        jsdom: jsdomCall.result,
        diff: valueMismatch,
        severity,
        chromeCall,
        jsdomCall,
      });

      if (severity === 'high') {
        insights.significantMismatches.push({
          method: chromeCall.method,
          element: chromeCall.element,
          diff: valueMismatch,
        });
      }
    }
  }

  // Generate recommendations
  insights.recommendations = generateRecommendations(mismatches, insights);

  return {
    mismatches,
    insights,
    summary: {
      totalMismatches: mismatches.length,
      valueMismatches: mismatches.filter(m => m.type === 'value_mismatch').length,
      highSeverityMismatches: mismatches.filter(m => m.severity === 'high').length,
    },
  };
}

/**
 * Compare two values and return difference details
 */
function compareValues(chromeVal, jsdomVal) {
  if (chromeVal === jsdomVal) return null;
  
  // Handle null/undefined
  if (chromeVal == null || jsdomVal == null) {
    return { type: 'null_mismatch', chrome: chromeVal, jsdom: jsdomVal };
  }

  // Numeric comparison
  if (typeof chromeVal === 'number' && typeof jsdomVal === 'number') {
    const diff = Math.abs(chromeVal - jsdomVal);
    const relDiff = chromeVal !== 0 ? diff / Math.abs(chromeVal) : Infinity;
    return { type: 'numeric', absolute: diff, relative: relDiff };
  }

  // DOMRect/SVGRect comparison
  if (chromeVal?.x !== undefined && jsdomVal?.x !== undefined) {
    const xDiff = Math.abs((chromeVal.x || 0) - (jsdomVal.x || 0));
    const yDiff = Math.abs((chromeVal.y || 0) - (jsdomVal.y || 0));
    const wDiff = Math.abs((chromeVal.width || 0) - (jsdomVal.width || 0));
    const hDiff = Math.abs((chromeVal.height || 0) - (jsdomVal.height || 0));
    
    if (xDiff + yDiff + wDiff + hDiff > 0.01) {
      return {
        type: 'rect',
        x: xDiff,
        y: yDiff,
        width: wDiff,
        height: hDiff,
        total: xDiff + yDiff + wDiff + hDiff,
      };
    }
    return null;
  }

  // String comparison
  if (typeof chromeVal === 'string' && typeof jsdomVal === 'string') {
    if (chromeVal !== jsdomVal) {
      return { type: 'string', chrome: chromeVal, jsdom: jsdomVal };
    }
    return null;
  }

  // Generic mismatch
  return { type: 'other', chrome: chromeVal, jsdom: jsdomVal };
}

/**
 * Calculate severity of a mismatch
 */
function calculateSeverity(method, diff) {
  if (!diff) return 'low';

  // High severity for layout-critical methods with significant differences
  if (method.includes('getBBox') || method.includes('getBoundingClientRect')) {
    if (diff.type === 'rect' && diff.total > 5) return 'high';
    if (diff.type === 'numeric' && diff.absolute > 5) return 'high';
  }

  if (method.includes('getComputedTextLength')) {
    if (diff.type === 'numeric' && diff.absolute > 2) return 'high';
  }

  if (method.includes('getComputedStyle')) {
    if (diff.type === 'string' && 
        (diff.chrome?.includes('px') || diff.jsdom?.includes('px'))) {
      return 'medium';
    }
  }

  // Medium severity for smaller differences
  if (diff.type === 'rect' && diff.total > 1) return 'medium';
  if (diff.type === 'numeric' && diff.absolute > 1) return 'medium';

  return 'low';
}

/**
 * Generate actionable recommendations
 */
function generateRecommendations(mismatches, insights) {
  const recommendations = [];

  // Check for getBBox issues
  const bboxMismatches = mismatches.filter(m => 
    m.method?.includes('getBBox') && m.severity === 'high'
  );
  if (bboxMismatches.length > 0) {
    recommendations.push({
      priority: 'high',
      area: 'text measurement',
      issue: `${bboxMismatches.length} high-severity getBBox mismatches detected`,
      action: 'Review textMetrics.js getBBox implementation. Consider adjusting TEXT_WIDTH_SCALE and TEXT_HEIGHT_SCALE constants, or padding values.',
      affectedElements: [...new Set(bboxMismatches.map(m => m.element))],
    });
  }

  // Check for getComputedTextLength issues
  const textLengthMismatches = mismatches.filter(m =>
    m.method?.includes('getComputedTextLength') && m.severity === 'high'
  );
  if (textLengthMismatches.length > 0) {
    recommendations.push({
      priority: 'high',
      area: 'text measurement',
      issue: `${textLengthMismatches.length} high-severity text length mismatches`,
      action: 'Check canvas text measurement accuracy in textMetrics.js. Verify font loading and actualBoundingBox usage.',
      affectedElements: [...new Set(textLengthMismatches.map(m => m.element))],
    });
  }

  // Check for method count differences
  for (const [method, counts] of Object.entries(insights.methodDifferences)) {
    if (Math.abs(counts.diff) > 10) {
      recommendations.push({
        priority: 'medium',
        area: 'API coverage',
        issue: `${method} called ${counts.chrome} times in Chrome but ${counts.jsdom} times in jsdom`,
        action: counts.jsdom < counts.chrome 
          ? `Ensure ${method} polyfill is properly installed`
          : `Investigate why jsdom triggers extra ${method} calls`,
      });
    }
  }

  // Check for getComputedStyle font mismatches
  const styleMismatches = mismatches.filter(m =>
    m.method === 'window.getComputedStyle' && 
    m.diff?.type === 'string' &&
    (JSON.stringify(m.chrome).includes('font') || JSON.stringify(m.jsdom).includes('font'))
  );
  if (styleMismatches.length > 0) {
    recommendations.push({
      priority: 'high',
      area: 'font configuration',
      issue: `${styleMismatches.length} font-related style mismatches`,
      action: 'Verify font registration in textMetrics.js matches Chrome\'s available fonts. Check SEBASTIANJS_FONT_PATH environment variable.',
    });
  }

  return recommendations;
}

/**
 * Generate a human-readable report
 */
export function generateReport(comparison, options = {}) {
  const { verbose = false } = options;
  
  let report = '=== DOM Profile Comparison Report ===\n\n';
  
  report += `Total Calls:\n`;
  report += `  Chrome: ${comparison.insights.totalCalls.chrome}\n`;
  report += `  jsdom:  ${comparison.insights.totalCalls.jsdom}\n`;
  report += `  Diff:   ${comparison.insights.totalCalls.diff > 0 ? '+' : ''}${comparison.insights.totalCalls.diff}\n\n`;
  
  report += `Mismatches:\n`;
  report += `  Total:        ${comparison.summary.totalMismatches}\n`;
  report += `  Value diffs:  ${comparison.summary.valueMismatches}\n`;
  report += `  High severity: ${comparison.summary.highSeverityMismatches}\n\n`;

  if (Object.keys(comparison.insights.methodDifferences).length > 0) {
    report += `Method Call Count Differences:\n`;
    for (const [method, counts] of Object.entries(comparison.insights.methodDifferences)) {
      report += `  ${method}: Chrome=${counts.chrome}, jsdom=${counts.jsdom}, diff=${counts.diff > 0 ? '+' : ''}${counts.diff}\n`;
    }
    report += '\n';
  }

  if (comparison.insights.significantMismatches.length > 0) {
    report += `Significant Mismatches (top 10):\n`;
    comparison.insights.significantMismatches.slice(0, 10).forEach((m, i) => {
      report += `  ${i + 1}. ${m.method} on <${m.element?.tag || 'unknown'}>\n`;
      if (m.diff?.type === 'rect') {
        report += `     Δwidth: ${m.diff.width.toFixed(2)}, Δheight: ${m.diff.height.toFixed(2)}\n`;
      } else if (m.diff?.type === 'numeric') {
        report += `     Δ: ${m.diff.absolute.toFixed(2)} (${(m.diff.relative * 100).toFixed(1)}%)\n`;
      }
    });
    report += '\n';
  }

  if (comparison.insights.recommendations.length > 0) {
    report += `Recommendations:\n`;
    comparison.insights.recommendations.forEach((rec, i) => {
      report += `  ${i + 1}. [${rec.priority.toUpperCase()}] ${rec.area}\n`;
      report += `     Issue: ${rec.issue}\n`;
      report += `     Action: ${rec.action}\n`;
      if (rec.affectedElements) {
        report += `     Affected: ${rec.affectedElements.join(', ')}\n`;
      }
      report += '\n';
    });
  }

  if (verbose && comparison.mismatches.length > 0) {
    report += `\nDetailed Mismatches (showing first 20):\n`;
    comparison.mismatches.slice(0, 20).forEach((m, i) => {
      report += `  ${i + 1}. [${m.severity || 'n/a'}] ${m.type} at index ${m.index}\n`;
      if (m.method) report += `     Method: ${m.method}\n`;
      if (m.element) report += `     Element: <${m.element}>\n`;
      if (m.diff) {
        report += `     Chrome: ${JSON.stringify(m.chrome)}\n`;
        report += `     jsdom:  ${JSON.stringify(m.jsdom)}\n`;
        report += `     Diff:   ${JSON.stringify(m.diff)}\n`;
      }
      report += '\n';
    });
  }

  return report;
}

/**
 * CLI entry point
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: node scripts/compare-profiles.mjs <chrome-profile.json> <jsdom-profile.json> [output-comparison.json]');
    process.exit(1);
  }

  const chromePath = args[0];
  const jsdomPath = args[1];
  const outputPath = args[2];

  try {
    const chromeProfile = JSON.parse(await readFile(chromePath, 'utf8'));
    const jsdomProfile = JSON.parse(await readFile(jsdomPath, 'utf8'));

    console.log('Comparing profiles...');
    const comparison = compareProfiles(chromeProfile, jsdomProfile);

    const report = generateReport(comparison, { verbose: true });
    console.log('\n' + report);

    if (outputPath) {
      await writeFile(outputPath, JSON.stringify(comparison, null, 2));
      console.log(`\nFull comparison saved to: ${outputPath}`);
    }
  } catch (error) {
    console.error('Error comparing profiles:', error);
    process.exit(1);
  }
}
