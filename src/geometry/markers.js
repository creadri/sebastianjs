// Draw the arrowheads that <marker> references stand for.
//
// An arrowhead in mermaid's output is a `marker-end="url(#...)"` on the edge
// path, and the shape itself lives once in a <marker> definition. SVG Tiny does
// not have markers, so a renderer built on it (QtSvg, and so Okular) draws the
// edges as bare lines with no heads at all.
//
// So each reference is resolved into the geometry it stands for: the point and
// tangent at the end of the path, and a copy of the marker's content placed
// there under the transform the spec defines.
//
// Like inline.js, this pass only ADDS. The marker-* attributes stay, so a
// renderer that implements markers keeps drawing them from the definition and
// paints the baked copy in exactly the same place — an opaque arrowhead drawn
// twice over itself is the arrowhead. Nothing that works today can regress.
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Marker geometry, not paint: these describe the placement, so they are not copied. */
const MARKER_OWN = new Set([
  'id', 'viewBox', 'refX', 'refY', 'markerWidth', 'markerHeight',
  'markerUnits', 'orient', 'preserveAspectRatio', 'overflow',
]);

const ENDS = [
  { attribute: 'marker-start', at: 'start' },
  { attribute: 'marker-end', at: 'end' },
];

/**
 * Replace every marker reference under `root` with drawn geometry.
 *
 * `marker-mid` is not handled: it needs a position per intermediate vertex
 * rather than per endpoint, and mermaid emits no diagram that uses one.
 *
 * @param {Element} root  an <svg> element
 * @returns {{baked: number, skipped: number}}
 */
export function bakeMarkers(root) {
  const stats = { baked: 0, skipped: 0 };

  const markers = new Map();
  for (const marker of descendants(root, 'marker')) {
    const id = marker.getAttribute('id');
    if (id) markers.set(id, marker);
  }
  if (!markers.size) return stats;

  for (const el of descendants(root)) {
    // A marker's own content can carry marker-* attributes; resolving those
    // would place arrowheads inside arrowheads.
    if (el.closest?.('marker')) continue;

    for (const { attribute, at } of ENDS) {
      const marker = markers.get(referencedId(el.getAttribute(attribute)));
      if (!marker) continue;

      const placement = placementOn(el, at);
      if (!placement) {
        stats.skipped++;
        continue;
      }
      const group = drawMarker(marker, el, placement, at);
      if (!group) {
        stats.skipped++;
        continue;
      }
      // After the element, so an arrowhead is never painted under its own edge.
      el.parentNode.insertBefore(group, el.nextSibling);
      stats.baked++;
    }
  }

  return stats;
}

function descendants(root, localName) {
  const found = [];
  const walk = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== 1 || child.namespaceURI !== SVG_NS) continue;
      if (!localName || child.localName === localName) found.push(child);
      walk(child);
    }
  };
  walk(root);
  return found;
}

/** `url(#id)` -> `id`, for the one reference form SVG allows here. */
function referencedId(value) {
  const match = /^\s*url\(\s*["']?#([^"')\s]+)["']?\s*\)\s*$/.exec(value || '');
  return match ? match[1] : null;
}

/**
 * Where an endpoint sits and which way the path is heading there.
 *
 * The tangent is sampled rather than derived: the path's own geometry engine
 * already answers getPointAtLength exactly, and two points a hair apart give
 * the direction without re-implementing the derivative of every segment type.
 */
function placementOn(el, at) {
  if (typeof el.getTotalLength !== 'function') return null;

  let total;
  try {
    total = el.getTotalLength();
  } catch {
    return null; // not a geometry element
  }
  if (!Number.isFinite(total) || total <= 0) return null;

  const step = Math.min(Math.max(total / 100, 0.01), 1);
  const [from, to] =
    at === 'start' ? [step, 0] : [total - step, total];

  try {
    const tail = el.getPointAtLength(from);
    const head = el.getPointAtLength(to);
    const angle = Math.atan2(head.y - tail.y, head.x - tail.x) * (180 / Math.PI);
    return { x: head.x, y: head.y, angle };
  } catch {
    return null;
  }
}

function drawMarker(marker, el, placement, at) {
  const document = marker.ownerDocument;

  const viewBox = parseViewBox(marker.getAttribute('viewBox'));
  const width = number(marker.getAttribute('markerWidth'), 3);
  const height = number(marker.getAttribute('markerHeight'), 3);

  // With the default preserveAspectRatio the viewBox is fitted uniformly. The
  // centring that `meet` also applies cancels out: the marker is positioned by
  // its reference point, which moves with it.
  let scale = viewBox
    ? Math.min(width / viewBox.width, height / viewBox.height)
    : 1;
  if (marker.getAttribute('markerUnits') !== 'userSpaceOnUse') {
    scale *= number(strokeWidthOf(el), 1);
  }
  if (!Number.isFinite(scale) || scale === 0) return null;

  const refX = number(marker.getAttribute('refX'), 0);
  const refY = number(marker.getAttribute('refY'), 0);

  const orient = (marker.getAttribute('orient') || '0').trim();
  let angle;
  if (orient === 'auto') angle = placement.angle;
  else if (orient === 'auto-start-reverse') {
    angle = at === 'start' ? placement.angle + 180 : placement.angle;
  } else angle = number(orient, 0);

  const group = document.createElementNS(SVG_NS, 'g');
  // scale() then translate(-ref) maps the reference point to the origin, which
  // rotate() then turns about and translate() carries to the path's endpoint.
  group.setAttribute(
    'transform',
    `translate(${round(placement.x)},${round(placement.y)}) rotate(${round(angle)}) ` +
      `scale(${round(scale)}) translate(${round(-refX)},${round(-refY)})`
  );

  // The content inherits its paint from the <marker>, which it is about to stop
  // being a child of, so what the marker carries has to come with it.
  for (const attribute of Array.from(marker.attributes)) {
    if (MARKER_OWN.has(attribute.name)) continue;
    group.setAttribute(attribute.name, attribute.value);
  }

  for (const child of Array.from(marker.childNodes)) {
    if (child.nodeType === 1) group.appendChild(child.cloneNode(true));
  }
  return group.childNodes.length ? group : null;
}

/** The stroke-width a `markerUnits: strokeWidth` marker scales with. */
function strokeWidthOf(el) {
  for (let node = el; node && node.nodeType === 1; node = node.parentNode) {
    const value = node.style?.getPropertyValue?.('stroke-width') || node.getAttribute('stroke-width');
    if (value) return value;
  }
  return null;
}

function parseViewBox(value) {
  if (!value) return null;
  const parts = value.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x, y, width, height] = parts;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function number(value, fallback) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const round = (value) => Math.round(value * 10000) / 10000;
