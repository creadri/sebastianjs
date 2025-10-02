/**
 * DOM API instrumentation for profiling Mermaid's DOM usage.
 * Records method calls, arguments, return values, and call stacks.
 */

export class DOMInstrumenter {
  constructor() {
    this.calls = [];
    this.callIndex = 0;
  }

  /**
   * Instruments a window object's DOM APIs to record all calls.
   * @param {Window} win - The window object to instrument
   * @param {Object} options - Instrumentation options
   * @returns {Object} - The instrumenter instance with restore function
   */
  instrument(win, options = {}) {
    const {
      captureStacks = true,
      captureElements = true,
      maxElementLength = 200,
      methods = [
        // Text measurement
        'getBBox',
        'getComputedTextLength',
        'getSubStringLength',
        'getStartPositionOfChar',
        'getEndPositionOfChar',
        'getExtentOfChar',
        
        // Layout measurement
        'getBoundingClientRect',
        'getClientRects',
        
        // SVG path
        'getTotalLength',
        'getPointAtLength',
        
        // Style
        'getComputedStyle',
        
        // Attributes
        'getAttribute',
        'setAttribute',
        'getBBox',
      ]
    } = options;

    const originals = new Map();
    const instrumenter = this;

    // Helper to serialize return values
    const serializeValue = (val) => {
      if (val === null || val === undefined) return val;
      if (typeof val === 'number' || typeof val === 'string' || typeof val === 'boolean') {
        return val;
      }
      // Check for rect-like objects (works in both real browsers and jsdom)
      if (val && typeof val === 'object' && 'x' in val && 'y' in val && 'width' in val && 'height' in val) {
        return { x: val.x, y: val.y, width: val.width, height: val.height };
      }
      // Check for point-like objects
      if (val && typeof val === 'object' && 'x' in val && 'y' in val && !('width' in val)) {
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

    // Helper to capture element context
    const captureElementContext = (el) => {
      if (!captureElements || !el) return null;
      try {
        const tag = el.tagName?.toLowerCase() || 'unknown';
        const id = el.id || '';
        const classes = el.className?.baseVal || el.className || '';
        let html = el.outerHTML || '';
        if (html.length > maxElementLength) {
          html = html.slice(0, maxElementLength) + '...';
        }
        
        // Capture computed styles for text elements
        let computedFont = null;
        if (tag === 'text' || tag === 'tspan') {
          try {
            const style = win.getComputedStyle(el);
            computedFont = {
              fontFamily: style.fontFamily,
              fontSize: style.fontSize,
              fontWeight: style.fontWeight,
              fontStyle: style.fontStyle,
            };
          } catch {}
        }

        return { tag, id, classes, html, computedFont };
      } catch {
        return { tag: 'error', id: '', classes: '', html: '' };
      }
    };

    // Wrap Element prototype methods
    const wrapElementMethod = (method) => {
      const proto = win.Element.prototype;
      if (!proto[method]) return;
      
      const original = proto[method];
      originals.set(`Element.${method}`, original);

      proto[method] = function(...args) {
        const callId = instrumenter.callIndex++;
        const elementContext = captureElementContext(this);
        
        let stack = null;
        if (captureStacks) {
          try {
            stack = new Error().stack
              .split('\n')
              .slice(2, 8) // Skip instrumentation frames
              .map(line => line.trim())
              .join('\n');
          } catch {}
        }

        const startTime = performance.now();
        let result, error;
        
        try {
          result = original.apply(this, args);
        } catch (err) {
          error = { message: err.message, stack: err.stack };
          throw err;
        } finally {
          const duration = performance.now() - startTime;
          
          instrumenter.calls.push({
            callId,
            method: `Element.${method}`,
            element: elementContext,
            args: args.map(serializeValue),
            result: serializeValue(result),
            error,
            duration,
            stack,
            timestamp: Date.now(),
          });
        }

        return result;
      };
    };

    // Wrap SVG-specific methods
    const wrapSVGMethod = (proto, protoName, method) => {
      if (!proto || !proto[method]) return;
      
      const original = proto[method];
      originals.set(`${protoName}.${method}`, original);

      proto[method] = function(...args) {
        const callId = instrumenter.callIndex++;
        const elementContext = captureElementContext(this);
        
        let stack = null;
        if (captureStacks) {
          try {
            stack = new Error().stack.split('\n').slice(2, 8).map(l => l.trim()).join('\n');
          } catch {}
        }

        const startTime = performance.now();
        let result, error;
        
        try {
          result = original.apply(this, args);
        } catch (err) {
          error = { message: err.message, stack: err.stack };
          throw err;
        } finally {
          const duration = performance.now() - startTime;
          
          instrumenter.calls.push({
            callId,
            method: `${protoName}.${method}`,
            element: elementContext,
            args: args.map(serializeValue),
            result: serializeValue(result),
            error,
            duration,
            stack,
            timestamp: Date.now(),
          });
        }

        return result;
      };
    };

    // Wrap window.getComputedStyle
    if (methods.includes('getComputedStyle')) {
      const originalGetComputedStyle = win.getComputedStyle;
      originals.set('window.getComputedStyle', originalGetComputedStyle);

      win.getComputedStyle = function(el, pseudoElt) {
        const callId = instrumenter.callIndex++;
        const elementContext = captureElementContext(el);
        
        const result = originalGetComputedStyle.call(this, el, pseudoElt);
        
        // Capture relevant style properties
        const capturedStyles = {};
        const relevantProps = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'width', 'height', 'display'];
        for (const prop of relevantProps) {
          try {
            capturedStyles[prop] = result[prop];
          } catch {}
        }

        instrumenter.calls.push({
          callId,
          method: 'window.getComputedStyle',
          element: elementContext,
          args: [null, pseudoElt],
          result: capturedStyles,
          error: null,
          duration: 0,
          stack: null,
          timestamp: Date.now(),
        });

        return result;
      };
    }

    // Install wrappers
    methods.forEach(method => {
      wrapElementMethod(method);
      wrapSVGMethod(win.SVGGraphicsElement?.prototype, 'SVGGraphicsElement', method);
      wrapSVGMethod(win.SVGTextContentElement?.prototype, 'SVGTextContentElement', method);
      wrapSVGMethod(win.SVGGeometryElement?.prototype, 'SVGGeometryElement', method);
    });

    // Return restore function
    return {
      getCalls: () => this.calls,
      getCallCount: () => this.calls.length,
      clear: () => { this.calls = []; this.callIndex = 0; },
      restore: () => {
        originals.forEach((original, key) => {
          const [obj, method] = key.split('.');
          if (obj === 'window') {
            win[method] = original;
          } else if (obj === 'Element') {
            win.Element.prototype[method] = original;
          } else if (obj === 'SVGGraphicsElement') {
            win.SVGGraphicsElement.prototype[method] = original;
          } else if (obj === 'SVGTextContentElement') {
            win.SVGTextContentElement.prototype[method] = original;
          } else if (obj === 'SVGGeometryElement') {
            win.SVGGeometryElement.prototype[method] = original;
          }
        });
        originals.clear();
      }
    };
  }

  /**
   * Export collected calls as JSON
   */
  export() {
    return {
      callCount: this.calls.length,
      calls: this.calls,
      summary: this.getSummary(),
    };
  }

  /**
   * Get summary statistics
   */
  getSummary() {
    const methodCounts = {};
    const elementCounts = {};
    let totalDuration = 0;

    for (const call of this.calls) {
      methodCounts[call.method] = (methodCounts[call.method] || 0) + 1;
      if (call.element?.tag) {
        elementCounts[call.element.tag] = (elementCounts[call.element.tag] || 0) + 1;
      }
      totalDuration += call.duration || 0;
    }

    return {
      totalCalls: this.calls.length,
      methodCounts,
      elementCounts,
      totalDuration,
      averageDuration: this.calls.length ? totalDuration / this.calls.length : 0,
    };
  }
}
