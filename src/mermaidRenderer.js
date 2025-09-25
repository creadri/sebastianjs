/**
 * Initializes Mermaid with the given configuration.
 * @param {Object} options - Rendering options.
 * @returns {Object} - The Mermaid configuration.
 */
export function createMermaidConfig(options = {}) {
  const initConfig = {
    startOnLoad: false,
    securityLevel: 'loose',
    htmlLabels: false,
    themeVariables: {
      fontFamily: (options?.themeVariables?.fontFamily) || 'DejaVu Sans, Arial, sans-serif',
    },
  };
  if (options && options.theme) initConfig.theme = options.theme;
  if (options && options.themeVariables) initConfig.themeVariables = { ...initConfig.themeVariables, ...options.themeVariables };
  if (options && options.themeCSS) initConfig.themeCSS = options.themeCSS;
  return initConfig;
}

/**
 * Renders the Mermaid diagram with error handling and fallbacks.
 * @param {string} definition - The Mermaid diagram definition.
 * @param {Object} options - Rendering options.
 * @param {HTMLElement} container - The DOM container.
 * @param {Object} mermaid - The Mermaid module.
 * @param {Object} initConfig - The Mermaid init config.
 * @returns {Promise<Object>} - The render result.
 */
export async function renderDiagram(definition, options, container, mermaid, initConfig) {
  let result;
  try {
    result = await mermaid.render('graph', definition, container);
  } catch (err) {
    const msg = (err?.message || '').toString();
    // Fallback for edge label placement errors on complex flowcharts
    if (msg.includes('suitable point for the given distance')) {
      try {
        // Re-initialize with a simpler curve and extra spacing to avoid degenerate paths
        mermaid.initialize({
          ...initConfig,
        });
        result = await mermaid.render('graph', definition, container);
      } catch (err2) {
        // Final fallback: strip edge labels (|label|) to avoid label positioning
        try {
          const defNoEdgeLabels = String(definition).replace(/\|[^|]*\|/g, '');
          mermaid.initialize(initConfig);
          result = await mermaid.render('graph', defNoEdgeLabels, container);
        } catch (err3) {
          throw err3;
        }
      }
    } else {
      throw err;
    }
  }
  return result;
}
