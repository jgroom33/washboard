// viewer.js — Three.js scene built from spec.parts. Rotate: drag. Pan: right
// drag or two fingers. Zoom: wheel or pinch.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GROUPS, inches } from './spec.js';

export function createViewer(container, { onSelect } = {}) {
  const scene = new THREE.Scene();
  scene.background = null;

  const persp = new THREE.PerspectiveCamera(38, 1, 1, 2000);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 2000);
  let camera = persp;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = 'none';

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'labels';
  container.appendChild(labels.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 3, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x99866b, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(60, 120, -80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: 10, far: 400 });
  scene.add(sun);

  const model = new THREE.Group();   // parts, centered on the drag
  const dims = new THREE.Group();    // dimension lines and labels
  const ballast = new THREE.Group();
  const ground = new THREE.Group();
  scene.add(model, dims, ballast, ground);

  const state = { spec: null, meshes: new Map(), explode: 0, step: 6, hovered: null, selected: null, ballast: 'none', dims: true };

  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  container.appendChild(tooltip);

  // ---------- geometry ----------

  function shapeFromProfile(profile, holes = []) {
    const shape = new THREE.Shape(profile.map(([h, v]) => new THREE.Vector2(h, v)));
    for (const hole of holes) {
      const path = new THREE.Path();
      path.absarc(hole.h, hole.v, hole.d / 2, 0, Math.PI * 2, true);
      shape.holes.push(path);
    }
    return shape;
  }

  // Place an extruded mesh so its local (x, y, z) = (h, v, depth) lands on
  // the world axes the part's geo.axis describes.
  function place(mesh, geo) {
    if (geo.axis === 'z') {
      mesh.position.set(0, 0, geo.from);
    } else if (geo.axis === 'x') {
      mesh.rotation.y = -Math.PI / 2;            // local x -> world z, local z -> world -x
      mesh.position.set(geo.from + geo.depth, 0, 0);
    } else {
      mesh.rotation.x = Math.PI / 2;             // local y -> world z, local z -> world -y
      mesh.position.set(0, geo.from + geo.depth, 0);
    }
  }

  function build(spec) {
    state.spec = spec;
    for (const m of state.meshes.values()) { m.geometry.dispose(); m.material.dispose(); }
    state.meshes.clear();
    model.clear();

    for (const p of spec.parts) {
      const shape = shapeFromProfile(p.geo.profile, p.geo.holes);
      const geom = new THREE.ExtrudeGeometry(shape, { depth: p.geo.depth, bevelEnabled: false, curveSegments: 12 });
      const mat = new THREE.MeshStandardMaterial({
        color: GROUPS[p.group].color, metalness: 0.45, roughness: 0.55,
        transparent: p.group === 'deck', opacity: p.group === 'deck' ? 0.65 : 1,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.castShadow = mesh.receiveShadow = true;
      place(mesh, p.geo);
      mesh.userData = { part: p, base: mesh.position.clone() };
      model.add(mesh);
      state.meshes.set(p.id, mesh);
    }
    model.position.set(-spec.W / 2, 0, -spec.L / 2);
    dims.position.copy(model.position);
    ballast.position.copy(model.position);

    buildGround(spec);
    buildDims(spec);
    buildBallast(spec, state.ballast);
    applyExplode();
    applyStep();
    fitCamera(spec);
  }

  // ---------- ground with washboard behind the drag ----------

  function buildGround(spec) {
    ground.clear();
    const gw = spec.W + 120, gl = spec.L + 240;
    const geom = new THREE.PlaneGeometry(gw, gl, 60, 200);
    geom.rotateX(-Math.PI / 2);
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);                            // world z after rotation
      const zRel = z + spec.L / 2;                       // 0 at drag front
      const blend = THREE.MathUtils.smoothstep(zRel, spec.L, spec.L + 24);
      const wave = 1.0 * (0.5 - 0.5 * Math.cos((2 * Math.PI * zRel) / 24)) * blend;
      pos.setY(i, -1.0 + wave);
    }
    geom.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xb9a37f, roughness: 1, metalness: 0 });
    const g = new THREE.Mesh(geom, mat);
    g.receiveShadow = true;
    g.position.y = 0;
    ground.add(g);

    const grid = new THREE.GridHelper(gw, gw / 12, 0x000000, 0x000000);
    grid.material.transparent = true;
    grid.material.opacity = 0.12;
    grid.position.y = 0.02;
    ground.add(grid);

    // Travel arrow at the front.
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, -spec.L / 2 - 14), 16, 0x2b6cb0, 5, 3);
    ground.add(arrow);
    const lbl = makeLabel('truck pulls this way', 'dim-label travel');
    lbl.position.set(0, 3, -spec.L / 2 - 24);
    ground.add(lbl);
  }

  // ---------- dimension lines ----------

  function makeLabel(text, cls = 'dim-label') {
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = text;
    return new CSS2DObject(div);
  }

  function dimLine(a, b, text, tick) {
    const mat = new THREE.LineBasicMaterial({ color: 0x1f4e79 });
    const pts = [new THREE.Vector3(...a), new THREE.Vector3(...b)];
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
    dims.add(line);
    // end ticks
    const t = new THREE.Vector3(...tick);
    for (const p of pts) {
      const tg = new THREE.BufferGeometry().setFromPoints([p.clone().add(t), p.clone().sub(t)]);
      dims.add(new THREE.Line(tg, mat));
    }
    const lbl = makeLabel(text);
    lbl.position.copy(pts[0]).lerp(pts[1], 0.5);
    dims.add(lbl);
  }

  function buildDims(spec) {
    dims.clear();
    const { W, L, dims: d } = spec;
    dimLine([0, -3, -9], [W, -3, -9], `${inches(W)} wide`, [0, 1.5, 0]);
    dimLine([W + 9, -3, 0], [W + 9, -3, L], `${inches(L)} long`, [1.5, 0, 0]);
    dimLine([-9, 3.2, d.zCut1], [-9, 3.2, d.zCut2], `${inches(d.zCut2 - d.zCut1)} blade spacing`, [1.5, 0, 0]);
    dimLine([-9, 3.2, d.zCut2], [-9, 3.2, d.zFloat], `${inches(d.zFloat - d.zCut2)}`, [1.5, 0, 0]);
    dimLine([W + 4, 0, L + 6], [W + 4, d.A, L + 6], `${inches(d.A)} to deck`, [0, 0, 1]);
    dimLine([W + 4, d.deckTop, L + 6], [W + 4, d.deckTop + d.LIP, L + 6], `${inches(d.LIP)} lip`, [0, 0, 1]);
    dimLine([-6, -d.WB_PROJ, d.zCut2], [-6, 0, d.zCut2], `${inches(d.WB_PROJ)} wear bar below skids`, [0, 0, 1]);
    dimLine([-d.LUG_T - 3, d.LUG_Y + 2, -d.LUG_PROJ], [-d.LUG_T - 3, d.LUG_Y + 2, 0], `${inches(d.LUG_PROJ)} lug`, [0, 1, 0]);
    dims.visible = state.dims;
  }

  // ---------- ballast ----------

  function buildBallast(spec, mode) {
    ballast.clear();
    state.ballast = mode;
    const { W, L, dims: d } = spec;
    if (mode === 'logs') {
      const len = d.innerW - 4;
      const mat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9 });
      const n = 3;
      const pitch = (d.innerL - 12) / (n - 1);
      for (let i = 0; i < n; i++) {
        const g = new THREE.CylinderGeometry(6, 6, len, 24);
        g.rotateZ(Math.PI / 2);
        const m = new THREE.Mesh(g, mat);
        m.castShadow = true;
        m.position.set(W / 2, d.deckTop + 6, d.LT + 6 + i * pitch);
        ballast.add(m);
      }
    } else if (mode === 'blocks') {
      const mat = new THREE.MeshStandardMaterial({ color: 0xa9a9a9, roughness: 0.95 });
      const across = Math.floor(d.innerW / 16), deep = Math.floor(d.innerL / 8);
      const x0 = W / 2 - (across * 16) / 2 + 8;
      const geom = new THREE.BoxGeometry(15.6, 7.6, 7.6);
      let count = 0;
      const target = Math.ceil(600 / 38);
      for (let layer = 0; layer < 2 && count < target; layer++) {
        for (let i = 0; i < across && count < target; i++) {
          for (let j = 0; j < deep && count < target; j++) {
            const m = new THREE.Mesh(geom, mat);
            m.castShadow = true;
            m.position.set(x0 + i * 16, d.deckTop + 4 + layer * 8, d.LT + 4 + j * 8);
            ballast.add(m);
            count++;
          }
        }
      }
    }
  }

  // ---------- state ----------

  function applyExplode() {
    const t = state.explode;
    for (const m of state.meshes.values()) {
      const e = m.userData.part.explode || [0, 0, 0];
      m.position.set(m.userData.base.x + e[0] * t, m.userData.base.y + e[1] * t, m.userData.base.z + e[2] * t);
    }
    ballast.visible = t < 0.05 && state.ballast !== 'none';
    dims.visible = state.dims && t < 0.05;
  }

  function applyStep() {
    for (const m of state.meshes.values()) m.visible = m.userData.part.step <= state.step;
  }

  function setHighlight(mesh, on, strong) {
    if (!mesh) return;
    mesh.material.emissive.setHex(on ? (strong ? 0xff8c1a : 0x3366aa) : 0x000000);
    mesh.material.emissiveIntensity = strong ? 0.5 : 0.35;
  }

  // ---------- camera ----------

  function fitCamera(spec) {
    const r = Math.max(spec.W, spec.L) * 1.25;
    persp.position.set(r * 0.9, r * 0.7, -r * 1.1);
    controls.target.set(0, 4, 0);
    controls.update();
  }

  function setView(name) {
    const spec = state.spec;
    const r = Math.max(spec.W, spec.L) * 2.2;
    const t = new THREE.Vector3(0, 3, 0);
    const pos = {
      iso: [r * 0.55, r * 0.45, -r * 0.7],
      top: [0, r, 0.001],
      front: [0, 3, -r],
      side: [r, 3, 0],
      rear: [0, 3, r],
    }[name];
    camera.position.set(...pos);
    controls.target.copy(t);
    if (name === 'top') camera.up.set(0, 0, -1); else camera.up.set(0, 1, 0);
    controls.update();
  }

  function setOrtho(on) {
    const from = camera;
    camera = on ? ortho : persp;
    camera.position.copy(from.position);
    camera.up.copy(from.up);
    resize();
    controls.object = camera;
    controls.update();
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false);
    labels.setSize(w, h);
    persp.aspect = w / h;
    persp.updateProjectionMatrix();
    const spec = state.spec;
    const half = spec ? Math.max(spec.W, spec.L) * 0.75 : 60;
    ortho.left = -half * (w / h); ortho.right = half * (w / h); ortho.top = half; ortho.bottom = -half;
    ortho.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);

  // ---------- picking ----------

  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  function pick(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    ptr.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hits = ray.intersectObjects([...state.meshes.values()].filter((m) => m.visible), false);
    return hits[0]?.object || null;
  }
  renderer.domElement.addEventListener('pointermove', (ev) => {
    const m = pick(ev);
    if (m !== state.hovered) {
      if (state.hovered !== state.selected) setHighlight(state.hovered, false);
      state.hovered = m;
      if (m && m !== state.selected) setHighlight(m, true, false);
    }
    if (m) {
      const p = m.userData.part;
      tooltip.textContent = `${p.name} — ${p.stock}${p.cut.length ? ', ' + inches(p.cut.length) : ''} — ${p.weight.toFixed(1)} lb`;
      tooltip.style.display = 'block';
      const rect = container.getBoundingClientRect();
      tooltip.style.left = `${ev.clientX - rect.left + 12}px`;
      tooltip.style.top = `${ev.clientY - rect.top + 12}px`;
    } else tooltip.style.display = 'none';
    renderer.domElement.style.cursor = m ? 'pointer' : 'grab';
  });
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (ev) => { downAt = [ev.clientX, ev.clientY]; });
  renderer.domElement.addEventListener('pointerup', (ev) => {
    if (!downAt || Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 4) return;
    select(pick(ev)?.userData.part.id || null);
  });
  renderer.domElement.addEventListener('pointerleave', () => { tooltip.style.display = 'none'; });

  function select(id) {
    setHighlight(state.selected, false);
    state.selected = id ? state.meshes.get(id) : null;
    setHighlight(state.selected, true, true);
    onSelect?.(id);
  }

  // ---------- loop ----------

  function frame() {
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
    requestAnimationFrame(frame);
  }
  resize();
  frame();

  return {
    build,
    select,
    setExplode(t) { state.explode = t; applyExplode(); },
    setStep(n) { state.step = n; applyStep(); },
    setBallast(mode) { buildBallast(state.spec, mode); applyExplode(); },
    setDims(on) { state.dims = on; applyExplode(); },
    setDeckOpacity(op) { const m = state.meshes.get('deck'); if (m) { m.material.opacity = op; m.material.transparent = op < 1; } },
    setView,
    setOrtho,
  };
}
