import { setupEnvironment } from './env.js';
import { installTextMetrics } from './textMetrics.js';
import { ensureDomPurify } from './dompurify.js';
import { createMermaidConfig, renderDiagram } from './mermaidRenderer.js';
import { applyExplicitSize, applyAutoSize, normalizeViewBox } from './postProcess.js';

export async function render(definition, options = {}) {
  // Extract layout-related sizing options (numeric or string). These affect
  // only the output SVG attributes and (for some diagram types) internal
  // layout when Mermaid inspects container dimensions.
  const containerWidth = options.width || options.containerWidth;
  const containerHeight = options.height || options.containerHeight;

  // Set up the environment
  const { window, document } = setupEnvironment(options);

  // Install text metrics
  await installTextMetrics(window, options);

  // Ensure DOMPurify
  window.DOMPurify = await ensureDomPurify(window);

  // Import mermaid only after environment is ready
  const { default: mermaid } = await import('mermaid');

  // Create and apply Mermaid config
  const initConfig = createMermaidConfig(options);
  mermaid.initialize(initConfig);

  // Use an explicit container inside body. If width/height provided, apply as inline style
  const container = document.createElement('div');
  if (containerWidth) container.style.width = (typeof containerWidth === 'number') ? `${containerWidth}px` : String(containerWidth);
  if (containerHeight) container.style.height = (typeof containerHeight === 'number') ? `${containerHeight}px` : String(containerHeight);
  document.body.appendChild(container);

  // Render the diagram
  const result = await renderDiagram(definition, options, container, mermaid, initConfig);
  let svg = result?.svg || container.innerHTML || '';

  // Optional: normalize viewBox post-process
  if (options.normalizeViewBox) {
    try {
      svg = normalizeViewBox(svg, options.viewBoxMargin ?? 4);
    } catch (e) {
      // Fallback to raw svg on failure
    }
  }

  // Auto-size logic
  const wantsAuto = (!containerWidth && !containerHeight) && (options.autoSize || options.maxWidth || options.maxHeight);
  if (wantsAuto) {
    svg = applyAutoSize(svg, options);
  }

  return applyExplicitSize(svg, containerWidth, containerHeight);
}
