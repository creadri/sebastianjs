import { setupEnvironment } from './env.js';
import { installTextMetrics } from './textMetrics.js';
import { ensureDomPurify } from './dompurify.js';
import { createMermaidConfig, renderDiagram } from './mermaidRenderer.js';
import { normalizeViewBoxOrigin } from './postProcess.js';

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
  // Normalize viewBox origin to (0,0) to match CLI tendencies and reduce sub-pixel diffs
  svg = normalizeViewBoxOrigin(svg);
  // Apply explicit width/height attributes when provided (CLI expects these)
  try {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
    const root = dom.window.document.documentElement;
    if (containerWidth != null) root.setAttribute('width', `${containerWidth}`);
    if (containerHeight != null) root.setAttribute('height', `${containerHeight}`);
    return root.outerHTML;
  } catch {
    return svg;
  }
}
