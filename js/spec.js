// spec.js — single source of truth for the washboard drag.
// Every part carries both its cut information (for the cut list) and its
// geometry (for the 3D viewer and 2D drawings). The two can't disagree
// because they come from the same object.
//
// Coordinates (inches): x across the width (0 = left rail outside face),
// y up (0 = skid line: bottom of the side rails), z along the direction of
// travel (0 = front face of the frame, L = rear). The truck is at -z.
//
// Geometry: every part is a 2D profile extruded along one axis.
//   axis 'x': profile (h, v) = (z, y), extruded from x=from over depth
//   axis 'z': profile (h, v) = (x, y), extruded from z=from over depth
//   axis 'y': profile (h, v) = (x, z), extruded from y=from over depth
// Holes are circles in the profile plane and go through the extrusion.

export const STEEL_DENSITY = 0.2836; // lb per cubic inch
export const KERF = 0.125;           // abrasive saw kerf per cut, inches

export const STOCK = {
  'L3x3x1/4': { label: '3" x 3" x 1/4" angle, A36 hot-rolled', stick: 120, note: '10 ft sticks fit a pickup bed' },
  'FB4x1/4':  { label: '4" x 1/4" flat bar, A36',              stick: 240, note: '20 ft stick, or 2 x 10 ft' },
  'FB2x3/8':  { label: '2" x 3/8" flat bar, A36',              stick: 120, note: 'wear bars' },
  'FB4x3/8':  { label: '4" x 3/8" flat bar, A36',              stick: 36,  note: 'tow lugs; buy 3 ft' },
  'PL3/16':   { label: '3/16" (7 ga) hot-rolled plate',         sheet: [48, 96], note: 'ask the yard to shear to size' },
};

export const GROUPS = {
  frame:   { label: 'Frame (rails and blades)', color: 0x6b7b8c },
  wear:    { label: 'Wear bars',                color: 0x3d4650 },
  deck:    { label: 'Deck plate',               color: 0x9aa7b4 },
  lip:     { label: 'Lip',                      color: 0x7f8c99 },
  tow:     { label: 'Tow lugs and gussets',     color: 0xc97a2b },
};

export const STEPS = [
  'Cut rails and blades, drill lugs and lip',
  'Tack blades between rails, square, weld',
  'Weld wear bars to cutter faces',
  'Deck plate on, stitch, flip and weld below',
  'Lip around the deck',
  'Tow lugs and gussets, then paint',
];

// ---------- profile helpers ----------

// Angle profile. corner = [h, v] of the outside corner. hDir/vDir = +1 or -1
// give the direction each leg runs from the corner. a = leg along v, b = leg
// along h, t = thickness.
function angle(corner, hDir, vDir, a, b, t) {
  const [h0, v0] = corner;
  return [
    [h0, v0],
    [h0 + hDir * b, v0],
    [h0 + hDir * b, v0 + vDir * t],
    [h0 + hDir * t, v0 + vDir * t],
    [h0 + hDir * t, v0 + vDir * a],
    [h0, v0 + vDir * a],
  ];
}

function rect(h0, v0, h1, v1) {
  return [[h0, v0], [h1, v0], [h1, v1], [h0, v1]];
}

// Tow lug outline in (z, y): a 4" tall bar with a full-radius rounded tip.
// zTip is the tip end; the lug runs 8" from the tip toward zBody.
function lug(zTip, dir, yBot, height, length) {
  const r = height / 2;
  const zc = zTip + dir * r;       // arc center z
  const yc = yBot + r;
  const zEnd = zTip + dir * length;
  const pts = [[zEnd, yBot], [zEnd, yBot + height], [zc, yBot + height]];
  const n = 12;
  for (let i = 1; i < n; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / n; // from top of arc, over the tip, to the bottom
    pts.push([zc + dir * Math.cos(a) * r, yc + Math.sin(a) * r]);
  }
  pts.push([zc, yBot]);
  return { pts, hole: { h: zc, v: yc, d: 0.75 } };
}

export function polygonArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

export function partWeight(p) {
  const holes = (p.geo.holes || []).reduce((a, h) => a + Math.PI * (h.d / 2) ** 2, 0);
  return (polygonArea(p.geo.profile) - holes) * p.geo.depth * STEEL_DENSITY;
}

export function bounds(p) {
  const hs = p.geo.profile.map((q) => q[0]);
  const vs = p.geo.profile.map((q) => q[1]);
  const h = [Math.min(...hs), Math.max(...hs)];
  const v = [Math.min(...vs), Math.max(...vs)];
  const ex = [p.geo.from, p.geo.from + p.geo.depth];
  switch (p.geo.axis) {
    case 'x': return { x: ex, y: v, z: h };
    case 'z': return { x: h, y: v, z: ex };
    case 'y': return { x: h, y: ex, z: v };
  }
}

// ---------- the design ----------

export const DEFAULT_WIDTH = 60;
export const WIDTHS = [48, 60, 72];

export function buildSpec(W = DEFAULT_WIDTH) {
  const L = 48;          // length along travel
  const A = 3;           // angle leg
  const T = 0.25;        // angle thickness
  const TP = 0.1875;     // deck plate thickness
  const LIP = 4;         // lip height
  const LT = 0.25;       // lip thickness
  const WB_H = 2, WB_T = 0.375, WB_PROJ = 0.625; // wear bar
  const GAP = 1 / 16;    // per-end weld gap for blades
  const LUG_T = 0.375, LUG_H = 4, LUG_LEN = 8, LUG_Y = 1, LUG_PROJ = 4;

  const bladeLen = W - 2 * T - 2 * GAP;
  const bladeX0 = T + GAP;
  const deckTop = A + TP;
  const zCut1 = 0;
  const zCut2 = (L - A) / 2;
  const zFloat = L - A;
  const lipEndLen = W - 2 * LT;

  const dims = { W, L, A, T, TP, LIP, LT, WB_H, WB_T, WB_PROJ, GAP, LUG_T, LUG_H, LUG_LEN, LUG_Y, LUG_PROJ,
    bladeLen, bladeX0, deckTop, zCut1, zCut2, zFloat, lipEndLen, innerW: W - 2 * T, innerL: L - 2 * LT };

  const parts = [];
  const add = (p) => { parts.push(p); return p; };

  // Side rails: vertical leg outboard on the ground, top leg pointing in.
  add({ id: 'rail-l', name: 'Side rail, left', group: 'frame', step: 1, stock: 'L3x3x1/4',
    cut: { length: L },
    geo: { axis: 'z', from: 0, depth: L, profile: angle([0, A], +1, -1, A, A, T) },
    explode: [-14, 0, 0] });
  add({ id: 'rail-r', name: 'Side rail, right', group: 'frame', step: 1, stock: 'L3x3x1/4',
    cut: { length: L },
    geo: { axis: 'z', from: 0, depth: L, profile: angle([W, A], -1, -1, A, A, T) },
    explode: [14, 0, 0] });

  // Cutter blades: vertical leg forward (cutting face), top leg trailing.
  for (const [i, z0] of [zCut1, zCut2].entries()) {
    add({ id: `cutter-${i + 1}`, name: `Cutter blade ${i + 1}`, group: 'frame', step: 2, stock: 'L3x3x1/4',
      cut: { length: bladeLen },
      geo: { axis: 'x', from: bladeX0, depth: bladeLen, profile: angle([z0, A], +1, -1, A, A, T) },
      explode: [0, 0, i === 0 ? -10 : -4] });
    add({ id: `wear-${i + 1}`, name: `Wear bar ${i + 1}`, group: 'wear', step: 3, stock: 'FB2x3/8',
      cut: { length: bladeLen },
      geo: { axis: 'x', from: bladeX0, depth: bladeLen,
        profile: rect(z0 - WB_T, -WB_PROJ, z0, -WB_PROJ + WB_H) },
      explode: [0, -6, i === 0 ? -16 : -10] });
  }

  // Float blade: sole on the ground trailing, vertical leg forward and up.
  add({ id: 'float', name: 'Float blade (rear)', group: 'frame', step: 2, stock: 'L3x3x1/4',
    cut: { length: bladeLen },
    geo: { axis: 'x', from: bladeX0, depth: bladeLen, profile: angle([zFloat, 0], +1, +1, A, A, T) },
    explode: [0, 0, 10] });

  // Deck plate on top of all the horizontal legs, with 4 drain holes.
  add({ id: 'deck', name: 'Deck plate', group: 'deck', step: 4, stock: 'PL3/16',
    cut: { w: L, l: W },
    geo: { axis: 'y', from: A, depth: TP, profile: rect(0, 0, W, L),
      holes: [[8, 8], [W - 8, 8], [8, L - 8], [W - 8, L - 8]].map(([h, v]) => ({ h, v, d: 0.5 })) },
    explode: [0, 14, 0] });

  // Lip: side pieces sit over the rails, end pieces fit between them.
  const lipHoles = (len, start) => {
    const n = Math.max(2, Math.round(len / 12));
    const pitch = (len - 4) / (n - 1);
    return Array.from({ length: n }, (_, i) => ({ h: start + 2 + i * pitch, v: deckTop + LIP / 2 + 0.5, d: 0.5 }));
  };
  add({ id: 'lip-l', name: 'Lip, left side', group: 'lip', step: 5, stock: 'FB4x1/4',
    cut: { length: L },
    geo: { axis: 'x', from: 0, depth: LT, profile: rect(0, deckTop, L, deckTop + LIP), holes: lipHoles(L, 0) },
    explode: [-10, 26, 0] });
  add({ id: 'lip-r', name: 'Lip, right side', group: 'lip', step: 5, stock: 'FB4x1/4',
    cut: { length: L },
    geo: { axis: 'x', from: W - LT, depth: LT, profile: rect(0, deckTop, L, deckTop + LIP), holes: lipHoles(L, 0) },
    explode: [10, 26, 0] });
  add({ id: 'lip-f', name: 'Lip, front end', group: 'lip', step: 5, stock: 'FB4x1/4',
    cut: { length: lipEndLen },
    geo: { axis: 'z', from: 0, depth: LT, profile: rect(LT, deckTop, W - LT, deckTop + LIP), holes: lipHoles(lipEndLen, LT) },
    explode: [0, 26, -10] });
  add({ id: 'lip-b', name: 'Lip, rear end', group: 'lip', step: 5, stock: 'FB4x1/4',
    cut: { length: lipEndLen },
    geo: { axis: 'z', from: L - LT, depth: LT, profile: rect(LT, deckTop, W - LT, deckTop + LIP), holes: lipHoles(lipEndLen, LT) },
    explode: [0, 26, 10] });

  // Tow lugs on the outside face of each rail, front and rear.
  const lugDefs = [
    { id: 'lug-fl', name: 'Tow lug, front left',  x: -LUG_T, zTip: -LUG_PROJ, dir: +1, ex: [-12, 0, -8] },
    { id: 'lug-fr', name: 'Tow lug, front right', x: W,      zTip: -LUG_PROJ, dir: +1, ex: [12, 0, -8] },
    { id: 'lug-rl', name: 'Tow lug, rear left',   x: -LUG_T, zTip: L + LUG_PROJ, dir: -1, ex: [-12, 0, 8] },
    { id: 'lug-rr', name: 'Tow lug, rear right',  x: W,      zTip: L + LUG_PROJ, dir: -1, ex: [12, 0, 8] },
  ];
  for (const d of lugDefs) {
    const { pts, hole } = lug(d.zTip, d.dir, LUG_Y, LUG_H, LUG_LEN);
    add({ id: d.id, name: d.name, group: 'tow', step: 6, stock: 'FB4x3/8',
      cut: { length: LUG_LEN },
      geo: { axis: 'x', from: d.x, depth: LUG_T, profile: pts, holes: [hole] },
      explode: d.ex });
  }

  // Gussets: 3" triangles cut from the angle drop, lying flat between the
  // lug's inner face and the blade face, level with the top leg.
  const gussetDefs = [
    { id: 'gusset-fl', name: 'Gusset, front left',  x: 0, xd: +1, z: 0, zd: -1, ex: [-4, 8, -4] },
    { id: 'gusset-fr', name: 'Gusset, front right', x: W, xd: -1, z: 0, zd: -1, ex: [4, 8, -4] },
    { id: 'gusset-rl', name: 'Gusset, rear left',   x: 0, xd: +1, z: L, zd: +1, ex: [-4, 8, 4] },
    { id: 'gusset-rr', name: 'Gusset, rear right',  x: W, xd: -1, z: L, zd: +1, ex: [4, 8, 4] },
  ];
  for (const g of gussetDefs) {
    add({ id: g.id, name: g.name, group: 'tow', step: 6, stock: 'L3x3x1/4',
      cut: { length: 3, note: 'triangle from angle drop', fromDrop: true },
      geo: { axis: 'y', from: A - 0.75, depth: T,
        profile: [[g.x, g.z], [g.x + g.xd * 3, g.z], [g.x, g.z + g.zd * 3]] },
      explode: g.ex });
  }

  for (const p of parts) p.weight = partWeight(p);

  return { W, L, dims, parts, nest: nest(parts), hardware: HARDWARE, consumables: CONSUMABLES,
    ballast: ballastOptions(dims), errors: [] };
}

// ---------- nesting: first-fit decreasing per stock ----------

export function nest(parts, kerf = KERF) {
  const byStock = {};
  for (const p of parts) {
    if (!p.cut.length) continue;
    (byStock[p.stock] ||= []).push({ id: p.id, name: p.name, length: p.cut.length, fromDrop: !!p.cut.fromDrop });
  }
  const out = [];
  for (const [stock, pieces] of Object.entries(byStock)) {
    const stickLen = STOCK[stock].stick;
    const sticks = [];
    pieces.sort((a, b) => b.length - a.length);
    // Small pieces flagged fromDrop go last, into whichever stick has the most left.
    const main = pieces.filter((p) => !p.fromDrop);
    const drops = pieces.filter((p) => p.fromDrop);
    for (const pc of main) {
      let placed = false;
      for (const s of sticks) {
        const need = pc.length + (s.pieces.length ? kerf : 0);
        if (s.used + need <= stickLen + 1e-9) { s.pieces.push(pc); s.used += need; placed = true; break; }
      }
      if (!placed) {
        if (pc.length > stickLen) out.push({ stock, error: `${pc.name} (${pc.length}") is longer than a ${stickLen}" stick` });
        sticks.push({ pieces: [pc], used: pc.length });
      }
    }
    for (const pc of drops) {
      sticks.sort((a, b) => a.used - b.used);
      const s = sticks[0];
      if (s && s.used + pc.length + kerf <= stickLen) { s.pieces.push(pc); s.used += pc.length + kerf; }
      else sticks.push({ pieces: [pc], used: pc.length });
    }
    sticks.sort((a, b) => b.used - a.used);
    out.push({ stock, stickLen, sticks: sticks.map((s) => ({ ...s, drop: stickLen - s.used })) });
  }
  return out;
}

// ---------- checks that the design is self-consistent ----------

export function verify(spec) {
  const e = [];
  const { dims: d, parts } = spec;
  const byId = Object.fromEntries(parts.map((p) => [p.id, p]));
  const close = (a, b) => Math.abs(a - b) < 1e-6;

  if (!close(byId['cutter-1'].cut.length, d.innerW - 2 * d.GAP)) e.push('blade length is not inner width minus weld gaps');
  if (!close(byId['lip-f'].cut.length, d.W - 2 * d.LT)) e.push('end lip does not fit between side lips');
  const fb = bounds(byId.float);
  if (!close(fb.z[1], d.L)) e.push('float blade sole does not end at the rear of the rails');
  const deck = bounds(byId.deck);
  if (!close(deck.y[0], d.A)) e.push('deck does not sit on the angle top legs');
  for (const p of parts) {
    const b = bounds(p);
    if (p.group !== 'tow' && p.group !== 'wear' && (b.x[0] < -1e-9 || b.x[1] > d.W + 1e-9)) e.push(`${p.name} is outside the width`);
    if (p.group !== 'tow' && p.group !== 'wear' && (b.z[0] < -1e-9 || b.z[1] > d.L + 1e-9)) e.push(`${p.name} is outside the length`);
  }
  for (const n of spec.nest) if (n.error) e.push(n.error);
  const [sw, sl] = STOCK['PL3/16'].sheet;
  const dk = byId.deck.cut;
  if (!((dk.w <= sw && dk.l <= sl) || (dk.l <= sw && dk.w <= sl))) e.push(`deck plate ${dk.w} x ${dk.l} does not come out of a ${sw} x ${sl} sheet`);
  return e;
}

// ---------- lists that don't depend on geometry ----------

export const HARDWARE = [
  { item: '1/2" screw-pin anchor shackle, 2 t WLL', qty: 4, unit: 'ea', est: 8, why: 'one per lug' },
  { item: '5/8" screw-pin shackle or 1/2" alloy master link', qty: 1, unit: 'ea', est: 12, why: 'bridle apex' },
  { item: '3/8" grade 70 chain, 5 ft, clevis grab hook each end', qty: 2, unit: 'ea', est: 25, why: 'bridle legs' },
  { item: '3/8" grade 70 chain, 20 ft, clevis grab hooks', qty: 1, unit: 'ea', est: 60, why: 'main tow chain' },
  { item: '2" receiver shackle mount, 10,000 lb', qty: 1, unit: 'ea', est: 30, why: 'never tow from the ball or bumper' },
  { item: '5/8" hitch pin and clip', qty: 1, unit: 'ea', est: 8, why: '' },
  { item: '2" x 12 ft ratchet strap, 3,300 lb WLL', qty: 2, unit: 'ea', est: 15, why: 'tie down logs or blocks through the lip holes' },
];

export const CONSUMABLES = [
  { item: 'MIG wire .035 ER70S-6, 10 lb, with C25 gas (or 5 lb 1/8" 7018 stick)', qty: 1, est: 45 },
  { item: '4-1/2" cutoff wheels .045"', qty: 10, est: 15 },
  { item: '4-1/2" grinding wheels 1/4"', qty: 3, est: 9 },
  { item: '4-1/2" flap discs 60 grit', qty: 3, est: 12 },
  { item: '14" chop saw abrasive blade', qty: 2, est: 20 },
  { item: 'Drill bits 3/8", 1/2"; 3/4" step bit or bi-metal hole saw; cutting oil', qty: 1, est: 35 },
  { item: 'Anti-spatter spray, chipping hammer, wire cup brush', qty: 1, est: 25 },
  { item: 'Welding magnets and 4 C-clamps', qty: 1, est: 30 },
  { item: 'Degreaser, 1 qt rust-inhibitive primer, 1 qt enamel (or 6 rattle cans)', qty: 1, est: 40 },
  { item: 'Two 2x4 skids so it does not rust to the ground in storage', qty: 1, est: 8 },
];

export function ballastOptions(d) {
  const innerW = d.W - 2 * d.LT;
  const innerL = d.L - 2 * d.LT;
  const trayFt3 = (innerW * innerL * d.LIP) / 1728;
  const blocksAcross = Math.floor(innerW / 16);
  const blocksDeep = Math.floor(innerL / 8);
  const layer = blocksAcross * blocksDeep;
  return [
    { name: 'Gravel, level with the lip', detail: `${trayFt3.toFixed(1)} cu ft at about 100 lb/cu ft`, lb: Math.round(trayFt3 * 100) },
    { name: 'CMU blocks 8x8x16 (38 lb)', detail: `${blocksAcross} across x ${blocksDeep} deep = ${layer} per layer; add ${Math.max(0, Math.ceil((600 - layer * 38) / 38))} on top for 600 lb`, lb: Math.max(600, layer * 38) },
    { name: 'Green oak logs, 12" dia', detail: `each ${innerW - 4}" log is about ${Math.round(Math.PI * 36 * (innerW - 4) / 1728 * 55)} lb; three across the deck, strapped`, lb: 3 * Math.round(Math.PI * 36 * (innerW - 4) / 1728 * 55) },
  ];
}

// ---------- formatting ----------

export function frac(x, denom = 16) {
  const sign = x < 0 ? '-' : '';
  x = Math.abs(x);
  let whole = Math.floor(x);
  let n = Math.round((x - whole) * denom);
  let dnm = denom;
  if (n === denom) { whole += 1; n = 0; }
  while (n && n % 2 === 0) { n /= 2; dnm /= 2; }
  if (!n) return `${sign}${whole}`;
  return whole ? `${sign}${whole}-${n}/${dnm}` : `${sign}${n}/${dnm}`;
}

export function inches(x) { return `${frac(x)}"`; }

export function feetInches(x) {
  const ft = Math.floor(x / 12);
  const rem = x - ft * 12;
  return ft ? `${ft}' ${frac(rem)}"` : `${frac(rem)}"`;
}

// Hitch geometry: how the chain pull angle affects the drag.
export function hitch({ hitchHeight = 20, chainLength = 190, lugHoleHeight = 3, pull = 650 }) {
  const rise = hitchHeight - lugHoleHeight;
  const angle = Math.asin(Math.min(1, rise / chainLength));
  return { angleDeg: (angle * 180) / Math.PI, lift: pull * Math.sin(angle), horizontal: pull * Math.cos(angle) };
}
