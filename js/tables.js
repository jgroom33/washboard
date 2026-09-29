// tables.js — cut list, order list, weights, cost and hitch calculator, all
// rendered from the spec object.
import { STOCK, GROUPS, STEPS, inches, feetInches, hitch } from './spec.js';

function h(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const c of children.flat()) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}

function table(headers, rows, cls = '') {
  return h('table', { class: cls },
    h('thead', {}, h('tr', {}, headers.map((t) => h('th', {}, t)))),
    h('tbody', {}, rows));
}

const money = (x) => `$${Math.round(x)}`;

export function renderCutList(container, spec, { onSelect } = {}) {
  container.innerHTML = '';
  // Group identical cuts.
  const groups = new Map();
  for (const p of spec.parts) {
    const key = `${p.stock}|${p.cut.length ?? `${p.cut.w}x${p.cut.l}`}|${p.name.replace(/,.*$/, '').replace(/ \d$/, '')}`;
    const g = groups.get(key) || { stock: p.stock, cut: p.cut, name: p.name.replace(/,.*$/, '').replace(/ \d$/, ''), ids: [], weight: p.weight, step: p.step };
    g.ids.push(p.id);
    groups.set(key, g);
  }
  const rows = [...groups.values()].sort((a, b) => a.step - b.step).map((g) => {
    const len = g.cut.length ? inches(g.cut.length) : `${inches(g.cut.w)} x ${inches(g.cut.l)}`;
    const tr = h('tr', { 'data-ids': g.ids.join(' '), onclick: () => onSelect?.(g.ids[0]) },
      h('td', {}, g.name), h('td', {}, g.ids.length), h('td', {}, STOCK[g.stock].label),
      h('td', { class: 'num' }, len), h('td', { class: 'num' }, g.weight.toFixed(1)),
      h('td', {}, g.cut.note || (g.stock === 'PL3/16' ? 'sheared by the yard; 4 x 1/2" drain holes' : g.name.startsWith('Lip') ? '1/2" strap holes about 12" apart' : g.name.startsWith('Tow lug') ? '3/4" hole 2" from the rounded tip' : g.name.startsWith('Cutter') || g.name.startsWith('Float') || g.name.startsWith('Wear') ? '1/16" gap each end for the fillet' : '')));
    return tr;
  });
  container.appendChild(table(['Part', 'Qty', 'Stock', 'Cut', 'lb each', 'Notes'], rows, 'cutlist'));
  container.appendChild(h('p', { class: 'muted' }, `Click a row to highlight the part in the model. ${spec.parts.length} pieces, ${spec.parts.reduce((a, p) => a + p.weight, 0).toFixed(0)} lb of steel.`));
}

export function highlightRow(container, id) {
  for (const tr of container.querySelectorAll('tr[data-ids]')) tr.classList.toggle('selected', !!id && tr.dataset.ids.split(' ').includes(id));
}

export function renderOrderList(container, spec, opts) {
  container.innerHTML = '';
  const pricePerLb = opts.pricePerLb;
  const steelLb = spec.parts.reduce((a, p) => a + p.weight, 0);

  // Stock rollup from nesting, plus the plate.
  const rows = [];
  let stockLb = 0;
  for (const n of spec.nest) {
    const lbPerIn = spec.parts.find((p) => p.stock === n.stock).weight / spec.parts.find((p) => p.stock === n.stock).cut.length;
    const lb = n.sticks.length * n.stickLen * lbPerIn;
    stockLb += lb;
    rows.push(h('tr', {}, h('td', {}, STOCK[n.stock].label), h('td', { class: 'num' }, `${n.sticks.length} x ${feetInches(n.stickLen)}`),
      h('td', {}, n.sticks.map((s, i) => `stick ${i + 1}: ${s.pieces.map((p) => inches(p.length)).join(' + ')} (drop ${inches(s.drop)})`).join('; ')),
      h('td', { class: 'num' }, lb.toFixed(0))));
  }
  const deck = spec.parts.find((p) => p.id === 'deck');
  stockLb += deck.weight;
  rows.push(h('tr', {}, h('td', {}, STOCK['PL3/16'].label), h('td', { class: 'num' }, `1 pc ${inches(deck.cut.w)} x ${inches(deck.cut.l)}`),
    h('td', {}, `sheared from a ${STOCK['PL3/16'].sheet.join(' x ')} sheet`), h('td', { class: 'num' }, deck.weight.toFixed(0))));
  container.appendChild(h('h3', {}, 'Steel'));
  container.appendChild(table(['Stock', 'Buy', 'Cutting plan (1/8" kerf)', 'lb'], rows));
  const steelCost = stockLb * pricePerLb;
  container.appendChild(h('p', {}, `About ${stockLb.toFixed(0)} lb of stock at `,
    h('input', { type: 'number', step: '0.05', min: '0.5', value: pricePerLb, class: 'inline', 'aria-label': 'steel price per pound', onchange: (e) => opts.onPrice?.(parseFloat(e.target.value) || 1.25) }),
    ` $/lb = ${money(steelCost)}. Small-order yard prices run $1.00 to $1.50 per lb; ask for a "drop" price on the angle.`));

  container.appendChild(h('h3', {}, 'Tow hardware'));
  const hwRows = spec.hardware.map((x) => h('tr', {}, h('td', {}, x.item), h('td', { class: 'num' }, x.qty), h('td', { class: 'num' }, money(x.est * x.qty)), h('td', {}, x.why)));
  const hwCost = spec.hardware.reduce((a, x) => a + x.est * x.qty, 0);
  container.appendChild(table(['Item', 'Qty', 'Est.', 'Purpose'], hwRows));

  container.appendChild(h('h3', {}, 'Consumables'));
  const csRows = spec.consumables.map((x) => h('tr', {}, h('td', {}, x.item), h('td', { class: 'num' }, x.qty), h('td', { class: 'num' }, money(x.est))));
  const csCost = spec.consumables.reduce((a, x) => a + x.est, 0);
  container.appendChild(table(['Item', 'Qty', 'Est.'], csRows));

  container.appendChild(h('p', { class: 'total' }, `Estimated total: ${money(steelCost + hwCost + csCost)} (steel ${money(steelCost)}, hardware ${money(hwCost)}, consumables ${money(csCost)}). Prices are 2026 US retail guesses; check locally.`));
}

export function renderWeights(container, spec, ballastLb) {
  container.innerHTML = '';
  const byGroup = {};
  for (const p of spec.parts) byGroup[p.group] = (byGroup[p.group] || 0) + p.weight;
  const steel = Object.values(byGroup).reduce((a, b) => a + b, 0);
  const rows = Object.entries(byGroup).map(([g, w]) => h('tr', {}, h('td', {}, GROUPS[g].label), h('td', { class: 'num' }, w.toFixed(0))));
  rows.push(h('tr', { class: 'sum' }, h('td', {}, 'Empty drag'), h('td', { class: 'num' }, steel.toFixed(0))));
  rows.push(h('tr', {}, h('td', {}, 'Ballast'), h('td', { class: 'num' }, ballastLb)));
  rows.push(h('tr', { class: 'sum' }, h('td', {}, 'Loaded'), h('td', { class: 'num' }, (steel + ballastLb).toFixed(0))));
  container.appendChild(table(['', 'lb'], rows, 'weights'));

  container.appendChild(h('h3', {}, 'Ballast options'));
  container.appendChild(table(['Option', 'Detail', 'lb'], spec.ballast.map((b) => h('tr', {}, h('td', {}, b.name), h('td', {}, b.detail), h('td', { class: 'num' }, b.lb)))));
}

export function renderHitch(container, spec, ballastLb) {
  container.innerHTML = '';
  const steel = spec.parts.reduce((a, p) => a + p.weight, 0);
  const inputs = { hitchHeight: 20, chainLength: 190, mu: 0.7 };
  const out = h('p', { class: 'result' });
  const update = () => {
    const pull = inputs.mu * (steel + ballastLb);
    const r = hitch({ hitchHeight: inputs.hitchHeight, chainLength: inputs.chainLength, lugHoleHeight: spec.dims.LUG_Y + spec.dims.LUG_H / 2, pull });
    out.textContent = `Pull about ${pull.toFixed(0)} lb. Chain angle ${r.angleDeg.toFixed(1)}° up, which lifts the front ${r.lift.toFixed(0)} lb and leaves ${r.horizontal.toFixed(0)} lb of horizontal drag. Keep the angle under about 8° so the cutters stay loaded.`;
  };
  const field = (label, key, step, min, max) => h('label', {}, `${label} `,
    h('input', { type: 'number', value: inputs[key], step, min, max, class: 'inline', oninput: (e) => { inputs[key] = parseFloat(e.target.value) || inputs[key]; update(); } }));
  container.append(
    h('p', {}, field('Hitch height above ground (in)', 'hitchHeight', 1, 10, 40), ' ',
      field('Chain length, hitch to lug (in)', 'chainLength', 6, 60, 400), ' ',
      field('Friction coefficient on gravel', 'mu', 0.05, 0.3, 1.2)),
    out);
  update();
}

export function renderSteps(container) {
  container.innerHTML = '';
  container.appendChild(h('ol', {}, STEPS.map((s) => h('li', {}, s))));
}
