// drawings.js — printable 2D views (plan and side elevation) generated from
// the same spec as the 3D model.
import { GROUPS, bounds, inches } from './spec.js';

const SCALE = 5; // px per inch
const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

function hex(c) { return '#' + c.toString(16).padStart(6, '0'); }

// Each part becomes either its true profile polygon (when the view looks
// along its extrusion axis) or a rectangle from its bounds.
function outline(p, view) {
  const b = bounds(p);
  const { axis, profile } = p.geo;
  if (view === 'plan') {                       // horizontal = x, vertical = z
    if (axis === 'y') return profile.map(([h, v]) => [h, v]);
    return [[b.x[0], b.z[0]], [b.x[1], b.z[0]], [b.x[1], b.z[1]], [b.x[0], b.z[1]]];
  }
  // side: horizontal = z, vertical = y (flipped when drawing)
  if (axis === 'x') return profile.map(([h, v]) => [h, v]);
  return [[b.z[0], b.y[0]], [b.z[1], b.y[0]], [b.z[1], b.y[1]], [b.z[0], b.y[1]]];
}

function makeSvg(spec, view) {
  const { W, L, dims: d } = spec;
  const pad = 26;
  const hRange = view === 'plan' ? [-d.LUG_T - 2, W + d.LUG_T + 2] : [-d.LUG_PROJ - 2, L + d.LUG_PROJ + 2];
  const vRange = view === 'plan' ? [-d.LUG_PROJ - 2, L + d.LUG_PROJ + 2] : [-d.WB_PROJ - 3, d.deckTop + d.LIP + 6];
  const wIn = hRange[1] - hRange[0] + 2 * pad, hIn = vRange[1] - vRange[0] + 2 * pad;
  const svg = el('svg', { viewBox: `0 0 ${wIn * SCALE} ${hIn * SCALE}`, class: 'drawing', role: 'img' });
  svg.appendChild(el('title', {}, view === 'plan' ? 'Plan view' : 'Side elevation'));

  // map inches to px. Plan: z increases downward (front at top). Side: y increases upward.
  const X = (h) => (h - hRange[0] + pad) * SCALE;
  const Y = (v) => (view === 'plan' ? (v - vRange[0] + pad) : (vRange[1] - v + pad)) * SCALE;

  const order = ['deck', 'lip', 'frame', 'wear', 'tow'];
  const parts = [...spec.parts].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  for (const p of parts) {
    const pts = outline(p, view).map(([h, v]) => `${X(h)},${Y(v)}`).join(' ');
    svg.appendChild(el('polygon', { points: pts, fill: hex(GROUPS[p.group].color), 'fill-opacity': p.group === 'deck' ? 0.25 : 0.55, stroke: '#1d2733', 'stroke-width': 1, 'data-part': p.id }));
    // holes visible in this view
    const along = p.geo.axis === (view === 'plan' ? 'y' : 'x');
    if (along) for (const hole of p.geo.holes || []) {
      svg.appendChild(el('circle', { cx: X(hole.h), cy: Y(hole.v), r: (hole.d / 2) * SCALE, fill: '#fff', stroke: '#1d2733', 'stroke-width': 1 }));
    }
  }

  const dim = (a, b, text, off) => {
    // a, b in inches [h, v]; off = perpendicular offset in inches
    const horizontal = a[1] === b[1];
    const o = horizontal ? [0, off] : [off, 0];
    const p1 = [X(a[0] + o[0]), Y(a[1] + o[1])], p2 = [X(b[0] + o[0]), Y(b[1] + o[1])];
    const g = el('g', { class: 'dim' });
    g.appendChild(el('line', { x1: X(a[0]), y1: Y(a[1]), x2: p1[0], y2: p1[1] }));
    g.appendChild(el('line', { x1: X(b[0]), y1: Y(b[1]), x2: p2[0], y2: p2[1] }));
    g.appendChild(el('line', { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], 'marker-start': 'url(#arr)', 'marker-end': 'url(#arr)' }));
    const t = el('text', { x: (p1[0] + p2[0]) / 2, y: (p1[1] + p2[1]) / 2, 'text-anchor': 'middle' }, text);
    if (!horizontal) t.setAttribute('transform', `rotate(-90 ${(p1[0] + p2[0]) / 2} ${(p1[1] + p2[1]) / 2})`);
    t.setAttribute('dy', horizontal ? (off > 0 === (view !== 'plan') ? -4 : 12) : -4);
    g.appendChild(t);
    svg.appendChild(g);
  };
  const defs = el('defs');
  const mk = el('marker', { id: 'arr', viewBox: '0 0 10 10', refX: 5, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
  mk.appendChild(el('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#1f4e79' }));
  defs.appendChild(mk);
  svg.appendChild(defs);

  if (view === 'plan') {
    dim([0, L], [W, L], inches(W), 12);
    dim([W, 0], [W, L], inches(L), d.LUG_T + 8);
    dim([d.bladeX0, d.zCut1], [d.bladeX0, d.zCut2], inches(d.zCut2 - d.zCut1), -d.LUG_T - 9);
    dim([d.bladeX0, d.zCut2], [d.bladeX0, d.zFloat], inches(d.zFloat - d.zCut2), -d.LUG_T - 9);
    svg.appendChild(el('text', { x: X(W / 2), y: Y(-d.LUG_PROJ - 2) - 6, 'text-anchor': 'middle', class: 'note' }, '▲ front (truck)'));
  } else {
    dim([0, d.deckTop + d.LIP], [L, d.deckTop + d.LIP], inches(L), 6);
    dim([L, 0], [L, d.A], inches(d.A), d.LUG_PROJ + 6);
    dim([L, d.deckTop], [L, d.deckTop + d.LIP], inches(d.LIP), d.LUG_PROJ + 6);
    dim([d.zCut1 - d.WB_T, -d.WB_PROJ], [d.zCut1 - d.WB_T, 0], inches(d.WB_PROJ), -6);
    dim([-d.LUG_PROJ, d.LUG_Y], [0, d.LUG_Y], inches(d.LUG_PROJ), -d.LUG_Y - 3);
    dim([-d.LUG_PROJ, d.LUG_Y + d.LUG_H], [-d.LUG_PROJ + 2, d.LUG_Y + d.LUG_H], `${inches(2)} to hole`, 3);
    svg.appendChild(el('text', { x: X(L / 2), y: Y(vRange[0]) + 18, 'text-anchor': 'middle', class: 'note' }, '◀ front (truck)'));
  }
  return svg;
}

export function renderDrawings(container, spec) {
  container.innerHTML = '';
  for (const view of ['plan', 'side']) {
    const fig = document.createElement('figure');
    fig.appendChild(makeSvg(spec, view));
    const cap = document.createElement('figcaption');
    cap.textContent = view === 'plan' ? 'Plan view from above. Deck shown transparent.' : 'Side elevation from the left. Wear bars project below the skid line.';
    fig.appendChild(cap);
    container.appendChild(fig);
  }
}
