import { JSDOM } from 'jsdom';

export async function sebDOM() {
    const { window } = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    const { document } = window;

    // Minimal globals expected by libraries
    global.window = window;
    global.document = document;

    // Try to enhance the jsdom window with svgdom's SVG implementations when available.
    // This is best-effort: if the `svgdom` package isn't installed the function still works.
    try {
        const svgdom = await import('svgdom');
        const { createSVGWindow, createSVGDocument } = svgdom;
        if (typeof createSVGWindow === 'function' && typeof createSVGDocument === 'function') {
            const svgWin = createSVGWindow();
            const svgDoc = createSVGDocument(svgWin);

            // Copy named globals (constructors, helpers) from svgdom window to jsdom window if missing.
            Object.getOwnPropertyNames(svgWin).forEach((name) => {
                if (!(name in window)) {
                    try {
                        window[name] = svgWin[name];
                    } catch (e) {
                        // Ignore non-writable globals
                    }
                }
            });

            // Prefer svgdom's DOMParser / XMLSerializer if jsdom doesn't already provide them
            if (!window.DOMParser && svgWin.DOMParser) window.DOMParser = svgWin.DOMParser;
            if (!window.XMLSerializer && svgWin.XMLSerializer) window.XMLSerializer = svgWin.XMLSerializer;

            // For SVG element creation, delegate to svgdom's document for the SVG namespace to get
            // proper SVGElement subclasses when possible.
            const origCreateElementNS = document.createElementNS.bind(document);
            document.createElementNS = (ns, tagName) => {
                if (ns === 'http://www.w3.org/2000/svg' && svgDoc && typeof svgDoc.createElementNS === 'function') {
                    return svgDoc.createElementNS(ns, tagName);
                }
                return origCreateElementNS(ns, tagName);
            };

            // Also copy common SVG constructors to global scope for libraries that check them
            ['SVGElement', 'SVGSVGElement', 'SVGRectElement', 'SVGTextContentElement', 'SVGGeometryElement'].forEach((ctor) => {
                if (svgWin[ctor] && !global[ctor]) global[ctor] = svgWin[ctor];
                if (svgWin[ctor] && !window[ctor]) window[ctor] = svgWin[ctor];
            });
        }
    } catch (err) {
        // svgdom not available or failed to load — silent fallback to plain jsdom
    }

    return { window, document };
}