import { setupEnvironment } from './env.js';
import { installTextMetrics } from './textMetrics.js';
import { ensureDomPurify } from './dompurify.js';
import { createMermaidConfig, renderDiagram } from './mermaidRenderer.js';

export async function render(definition, options = {}) {
  // Extract layout-related sizing options (numeric or string). These affect
  // only the output SVG attributes and (for some diagram types) internal
  // layout when Mermaid inspects container dimensions.
  const containerWidth = options.width || options.containerWidth || 800;
  const containerHeight = options.height || options.containerHeight || 600;

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

  // Intentionally no normalizeViewBox or auto-size: default behavior only
  try {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
    const root = dom.window.document.documentElement;
    if (containerWidth) root.setAttribute('width', `${containerWidth}`);
    if (containerHeight) root.setAttribute('height', `${containerHeight}`);
    return root.outerHTML;
  } catch {
    return svg;
  }
}
