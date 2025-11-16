import { sebDOM } from './sebdom.js';


export async function render(definition, options = {}) {
  // Extract layout-related sizing options (numeric or string). These affect
  // only the output SVG attributes and (for some diagram types) internal
  // layout when Mermaid inspects container dimensions.
  const containerWidth = options.width || 800;
  const containerHeight = options.height || 600;

  // Set up the environment
  const { window, document } = sebDOM();
  
  // Import mermaid only after environment is ready
  const { default: mermaid } = await import('mermaid');

  // Create and apply Mermaid config
  const initConfig = {
    startOnLoad: false
  };
  
  mermaid.initialize(initConfig);

  // Use an explicit container inside body. If width/height provided, apply as inline style
  const container = document.createElement('div');
  if (containerWidth) container.style.width = (typeof containerWidth === 'number') ? `${containerWidth}px` : String(containerWidth);
  if (containerHeight) container.style.height = (typeof containerHeight === 'number') ? `${containerHeight}px` : String(containerHeight);
  document.body.appendChild(container);

  // Render the diagram
  const result = await mermaid.render('graph', definition, container);

  return result.svg
}
