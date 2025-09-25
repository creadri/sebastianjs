import { JSDOM } from 'jsdom';

/**
 * Applies explicit width and height to the SVG if provided.
 * @param {string} svg - The SVG string.
 * @param {number|string} containerWidth - The desired width.
 * @param {number|string} containerHeight - The desired height.
 * @returns {string} - The modified SVG.
 */
export function applyExplicitSize(svg, containerWidth, containerHeight) {
  if (!containerWidth && !containerHeight) return svg;
  try {
    const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
    const root = dom.window.document.documentElement;
    if (containerWidth) root.setAttribute('width', (typeof containerWidth === 'number') ? `${containerWidth}` : String(containerWidth));
    if (containerHeight) root.setAttribute('height', (typeof containerHeight === 'number') ? `${containerHeight}` : String(containerHeight));
    return root.outerHTML;
  } catch (_) {
    return svg; // best-effort
  }
}

/**
 * Applies auto-sizing based on maxWidth, maxHeight, or autoSize flag.
 * @param {string} svg - The SVG string.
 * @param {Object} options - Rendering options.
 * @returns {string} - The modified SVG.
 */
export function applyAutoSize(svg, options) {
  try {
    const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
    const root = dom.window.document.documentElement;
    const vb = root.getAttribute('viewBox');
    if (vb) {
      const parts = vb.split(/\s+/).map(Number);
      if (parts.length === 4 && parts.every(n => Number.isFinite(n))) {
        const [, , vbW, vbH] = parts;
        let targetW = vbW;
        let targetH = vbH;
        const maxW = typeof options.maxWidth === 'number' ? options.maxWidth : undefined;
        const maxH = typeof options.maxHeight === 'number' ? options.maxHeight : undefined;
        let scale = 1;
        if (maxW && vbW > maxW) scale = Math.min(scale, maxW / vbW);
        if (maxH && vbH * scale > maxH) scale = Math.min(scale, maxH / vbH);
        if (options.autoSize === true && !maxW && !maxH) {
          // Provide a gentle cap if user just set autoSize: cap width to 1000 by default
          const defaultCap = 1000;
          if (vbW > defaultCap) scale = Math.min(scale, defaultCap / vbW);
        }
        if (scale !== 1) {
          targetW = Math.round(vbW * scale);
          targetH = Math.round(vbH * scale);
        }
        root.setAttribute('width', `${targetW}`);
        root.setAttribute('height', `${targetH}`);
        return root.outerHTML;
      }
    }
  } catch (_) {
    // ignore auto-size failure
  }
  return svg;
}

/**
 * Parses SVG and computes a union bbox of visible rect nodes, accounting for simple translate() transforms on ancestor groups.
 * @param {string} svgString - The SVG string.
 * @param {number} margin - Margin to add around the viewBox.
 * @returns {string} - The modified SVG with normalized viewBox.
 */
export function normalizeViewBox(svgString, margin = 4) {
  // jsdom can parse XML with image/svg+xml
  const dom = new JSDOM(svgString, { contentType: 'image/svg+xml' });
  const doc = dom.window.document;
  const svg = doc.documentElement;
  if (!svg || svg.tagName.toLowerCase() !== 'svg') return svgString;

  // Consider common node shapes for bounds
  const shapes = Array.from(svg.querySelectorAll('rect, circle, ellipse, polygon, polyline'));
  if (shapes.length === 0) return svgString;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const parseTranslate = (transform) => {
    let x = 0, y = 0;
    if (!transform) return { x, y };
    // handle translate(x,y) or translate(x)
    const m = /translate\(([^)]+)\)/.exec(transform);
    if (m) {
      const parts = m[1].split(/[,\s]+/).map(Number).filter(n => !Number.isNaN(n));
      if (parts.length >= 1) x += parts[0];
      if (parts.length >= 2) y += parts[1];
    }
    return { x, y };
  };

  const getAbsOffset = (el) => {
    let tx = 0, ty = 0;
    // include element's own translate first
    const selfT = parseTranslate(el.getAttribute('transform'));
    tx += selfT.x; ty += selfT.y;
    let cur = el.parentElement;
    while (cur && cur !== svg) {
      const t = parseTranslate(cur.getAttribute('transform'));
      tx += t.x; ty += t.y;
      cur = cur.parentElement;
    }
    return { x: tx, y: ty };
  };

  const clampFinite = (n) => (Number.isFinite(n) ? n : 0);
  const includeRect = (el) => {
    const x = parseFloat(el.getAttribute('x') || '0');
    const y = parseFloat(el.getAttribute('y') || '0');
    const w = parseFloat(el.getAttribute('width') || '0');
    const h = parseFloat(el.getAttribute('height') || '0');
    const o = getAbsOffset(el);
    minX = Math.min(minX, x + o.x);
    minY = Math.min(minY, y + o.y);
    maxX = Math.max(maxX, x + w + o.x);
    maxY = Math.max(maxY, y + h + o.y);
  };
  const includeCircle = (el) => {
    const cx = parseFloat(el.getAttribute('cx') || '0');
    const cy = parseFloat(el.getAttribute('cy') || '0');
    const r = parseFloat(el.getAttribute('r') || '0');
    const o = getAbsOffset(el);
    minX = Math.min(minX, cx - r + o.x);
    minY = Math.min(minY, cy - r + o.y);
    maxX = Math.max(maxX, cx + r + o.x);
    maxY = Math.max(maxY, cy + r + o.y);
  };
  const includeEllipse = (el) => {
    const cx = parseFloat(el.getAttribute('cx') || '0');
    const cy = parseFloat(el.getAttribute('cy') || '0');
    const rx = parseFloat(el.getAttribute('rx') || '0');
    const ry = parseFloat(el.getAttribute('ry') || '0');
    const o = getAbsOffset(el);
    minX = Math.min(minX, cx - rx + o.x);
    minY = Math.min(minY, cy - ry + o.y);
    maxX = Math.max(maxX, cx + rx + o.x);
    maxY = Math.max(maxY, cy + ry + o.y);
  };
  const includePoints = (el) => {
    const raw = el.getAttribute('points') || '';
    const pts = raw.trim().split(/\s+/).map(p => p.split(/[,\s]+/).map(Number)).filter(a => a.length >= 2 && a.every(n => Number.isFinite(n)));
    if (pts.length === 0) return;
    const o = getAbsOffset(el);
    for (const [px, py] of pts) {
      minX = Math.min(minX, clampFinite(px + o.x));
      minY = Math.min(minY, clampFinite(py + o.y));
      maxX = Math.max(maxX, clampFinite(px + o.x));
      maxY = Math.max(maxY, clampFinite(py + o.y));
    }
  };

  for (const el of shapes) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'rect') includeRect(el);
    else if (tag === 'circle') includeCircle(el);
    else if (tag === 'ellipse') includeEllipse(el);
    else if (tag === 'polygon' || tag === 'polyline') includePoints(el);
  }

  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
    return svgString;
  }

  const vbX = Math.floor(minX - margin);
  const vbY = Math.floor(minY - margin);
  const vbW = Math.ceil((maxX - minX) + margin * 2) || 1;
  const vbH = Math.ceil((maxY - minY) + margin * 2) || 1;

  svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
  // Optional: drop extreme style max-width/width/height to let viewBox drive layout
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.removeAttribute('style');

  return svg.outerHTML;
}

/**
 * Normalizes the SVG root viewBox origin to (0,0) by compensating with a wrapper translation.
 * This preserves visual layout while eliminating negative x/y offsets, helping sub-pixel parity.
 * @param {string} svgString - The SVG string.
 * @returns {string} - The modified SVG string.
 */
export function normalizeViewBoxOrigin(svgString) {
  try {
    const dom = new JSDOM(svgString, { contentType: 'image/svg+xml' });
    const doc = dom.window.document;
    const svg = doc.documentElement;
    if (!svg || svg.tagName.toLowerCase() !== 'svg') return svgString;
    const vb = svg.getAttribute('viewBox');
    if (!vb) return svgString;
    const parts = vb.trim().split(/\s+/).map(Number);
    if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) return svgString;
    let [vx, vy, vw, vh] = parts;
    if ((vx === 0 && vy === 0) || !Number.isFinite(vw) || !Number.isFinite(vh)) return svgString;
    // Reset origin to 0,0
    svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
    // Wrap existing children in a translating group to preserve visuals
    const ns = 'http://www.w3.org/2000/svg';
    const wrapper = doc.createElementNS(ns, 'g');
    const tx = -vx; const ty = -vy;
    wrapper.setAttribute('transform', `translate(${tx}, ${ty})`);
    while (svg.firstChild) {
      wrapper.appendChild(svg.firstChild);
    }
    svg.appendChild(wrapper);
    return svg.outerHTML;
  } catch (_) {
    return svgString;
  }
}
