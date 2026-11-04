import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const $ = (id) => document.getElementById(id);
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';
// Draw only when something changed, to save battery on phones.
let dirty = true;
function redraw() { dirty = true; }
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- colours for each body system (teaching colours, as in Shoulder Lab) ---------- */
const COLOR = {
  skin: '#E2B59A', skeleton: '#E6DCC4', cartilage: '#4FA3E0', joints: '#EEE6D6', muscles: '#C9604F',
  heart: '#B8323C', arteries: '#D8433F', veins: '#3F6FD3', nerves: '#F0C23B', senses: '#9B7BD4',
  lungs: '#E99AA7', gut: '#D69B57', urinary: '#C46F52', genital: '#D58BB0', glands: '#5DB585',
};
const DEFAULT_ON = ['skeleton', 'muscles'];
const DEFAULT_GHOST = ['skin'];
const HILITE = new THREE.Color('#F2B705');

/* ---------- renderer and scene ---------- */
const stageEl = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
stageEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight(0xffffff, 0x4d5a57, 0.5));
const key = new THREE.DirectionalLight(0xfff4e8, 1.4);
key.position.set(-2, 4, 4);
scene.add(key);
const rim = new THREE.DirectionalLight(0xe8f0ff, 0.5);
rim.position.set(3, 2, -4);
scene.add(rim);
function setBg() { scene.background = new THREE.Color(css('--stage')); redraw(); }
setBg();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', setBg);

const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.rotateSpeed = 0.5;
controls.zoomSpeed = 0.7;
controls.minDistance = 0.08;
controls.maxDistance = 8;

function resize() {
  const w = stageEl.clientWidth, h = stageEl.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  redraw();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stageEl);
resize();

/* ---------- camera moves ---------- */
let fly = null;
function frameBox(box, { side = 'front', instant = false } = {}) {
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const fitH = s.y / 2 / Math.tan(fov / 2);
  const fitW = Math.max(s.x, s.z) / 2 / Math.tan(fov / 2) / Math.max(camera.aspect, 0.3);
  const dist = Math.max(fitH, fitW) * 1.25 + Math.max(s.x, s.z) / 2;
  const dir = side === 'back' ? new THREE.Vector3(0, 0.08, -1)
    : side === 'right' ? new THREE.Vector3(-1, 0.08, 0.15)
      : new THREE.Vector3(0, 0.08, 1);
  const to = c.clone().addScaledVector(dir.normalize(), Math.max(dist, 0.15));
  if (instant || reduceMotion) { camera.position.copy(to); controls.target.copy(c); fly = null; controls.update(); return; }
  fly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: to, t1: c, k: 0 };
}

/* ---------- data ---------- */
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
let INDEX = null;
let GROUPS = {}; // whole organ or region name -> part ids
const systems = {}; // key -> { label, file, on, ghost, group, loading, meshes: [] }
const partMesh = {}; // file id -> mesh
const hiddenParts = new Set();
let selected = null;

function partBox(ids) {
  const box = new THREE.Box3();
  ids.forEach((id) => {
    const b = INDEX.parts[id].b;
    box.expandByPoint(new THREE.Vector3(b[0], b[1], b[2]));
    box.expandByPoint(new THREE.Vector3(b[3], b[4], b[5]));
  });
  return box;
}
function findParts(rx, sys) {
  return Object.keys(INDEX.parts).filter((id) => (!sys || INDEX.parts[id].sys === sys) && rx.test(INDEX.parts[id].name));
}

/* Regions are framed from the bones they contain, so they fit the real model. */
const REGIONS = [
  { key: 'body', label: 'Whole body', find: () => findParts(/./, 'skeleton') },
  { key: 'head', label: 'Head', find: () => findParts(/(frontal|parietal|occipital|temporal|sphenoid|zygomatic|nasal) bone|mandible|maxilla/i, 'skeleton') },
  { key: 'chest', label: 'Chest', find: () => findParts(/\brib\b|sternum|manubrium/i, 'skeleton') },
  { key: 'belly', label: 'Belly', find: () => findParts(/liver|stomach|kidney|colon|jejunum|ileum|spleen/i) },
  { key: 'pelvis', label: 'Hips', find: () => findParts(/hip bone|sacrum|coccyx/i, 'skeleton') },
  { key: 'shoulder', label: 'Shoulder', find: () => findParts(/^right (scapula|clavicle)$|^right humerus$/i, 'skeleton'), crop: 0.55 },
  { key: 'arm', label: 'Arm', find: () => findParts(/^right (humerus|radius|ulna)$/i, 'skeleton') },
  { key: 'hand', label: 'Hand', find: () => findParts(/^right (scaphoid|lunate|triquetral|pisiform|trapezium|trapezoid|capitate|hamate)|right .*metacarpal|phalanx of right (thumb|index finger|middle finger|ring finger|little finger)/i, 'skeleton') },
  { key: 'knee', label: 'Knee', find: () => findParts(/^right patella$/i, 'skeleton'), grow: 3.2 },
  { key: 'leg', label: 'Leg', find: () => findParts(/^right (femur|tibia|fibula|patella)$/i, 'skeleton') },
  { key: 'foot', label: 'Foot', find: () => findParts(/^right (talus|calcaneus|navicular|cuboid)|right .*(cuneiform|metatarsal)|phalanx of right .*toe/i, 'skeleton') },
  { key: 'back', label: 'Back', find: () => findParts(/vertebra|sacrum/i, 'skeleton'), side: 'back' },
];
let activeRegion = 'body';

function goRegion(r, instant) {
  const ids = r.find();
  if (!ids.length) return;
  let box = partBox(ids);
  if (r.crop) { // keep the top part only (e.g. the head of the humerus, not the whole arm)
    const h = box.max.y - box.min.y;
    box.min.y = box.max.y - h * r.crop;
  }
  if (r.grow) {
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()).multiplyScalar(r.grow / 2);
    box = new THREE.Box3(c.clone().sub(s), c.clone().add(s));
  }
  frameBox(box, { side: r.side, instant });
  activeRegion = r.key;
  document.querySelectorAll('#views button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.r === r.key));
}

/* ---------- materials ---------- */
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967295; }
function makeMaterial(sysKey, id) {
  const c = new THREE.Color(COLOR[sysKey] || '#BBBBBB');
  // small shade changes between neighbouring parts so they read as separate pieces
  const jitter = sysKey === 'skin' ? 0 : (hash(id) - 0.5) * (sysKey === 'muscles' ? 0.16 : 0.08);
  c.offsetHSL(jitter * 0.3, 0, jitter);
  return new THREE.MeshStandardMaterial({
    color: c, roughness: sysKey === 'skeleton' ? 0.75 : 0.5, metalness: 0,
    envMapIntensity: 0.6, side: THREE.DoubleSide,
  });
}
function applyLook(sys) {
  redraw();
  sys.meshes.forEach((m) => {
    const mat = m.material;
    const ghost = sys.ghost;
    mat.transparent = ghost;
    mat.opacity = ghost ? (sys.key === 'skin' ? 0.14 : 0.22) : 1;
    mat.depthWrite = !ghost;
    mat.needsUpdate = true;
    m.renderOrder = ghost ? 2 : 0;
    m.visible = sys.on && !hiddenParts.has(m.userData.id);
  });
}
function paintSelection() {
  redraw();
  Object.values(partMesh).forEach((m) => {
    const isSel = !!selected && selected.ids.has(m.userData.id);
    m.material.emissive.copy(isSel ? HILITE : new THREE.Color(0));
    // a whole organ gets a softer glow so its own colours still show
    m.material.emissiveIntensity = isSel ? (selected.ids.size > 1 ? 0.18 : 0.55) : 0;
  });
}

/* ---------- loading systems on demand ---------- */
function loadSystem(sys) {
  if (sys.group || sys.loading) return sys.loading;
  renderSystems();
  sys.loading = new Promise((resolve, reject) => {
    loader.load(`/models/${sys.file}`, (gltf) => {
      const group = new THREE.Group();
      const found = [];
      gltf.scene.traverse((o) => { if (o.isMesh) found.push(o); });
      found.forEach((o) => {
        o.updateWorldMatrix(true, false);
        const id = (o.name || o.parent?.name || '').replace(/_\d+$/, '');
        const g = o.geometry.clone();
        g.applyMatrix4(o.matrixWorld);
        if (!g.attributes.normal) g.computeVertexNormals();
        const m = new THREE.Mesh(g, makeMaterial(sys.key, id));
        m.userData.id = id;
        m.userData.sys = sys.key;
        partMesh[id] = m;
        sys.meshes.push(m);
        group.add(m);
      });
      sys.group = group;
      scene.add(group);
      applyLook(sys);
      paintSelection();
      sys.loading = null;
      renderSystems();
      resolve(sys);
    }, undefined, (err) => {
      sys.loading = null;
      sys.failed = true;
      renderSystems();
      reject(err);
    });
  });
  return sys.loading;
}

async function setOn(sys, on) {
  sys.on = on;
  if (on && !sys.group) {
    try { await loadSystem(sys); } catch (e) { sys.on = false; }
  }
  if (sys.group) applyLook(sys);
  if (!on && selected && [...selected.ids].every((id) => INDEX.parts[id].sys === sys.key)) select(null);
  renderSystems();
}

/* ---------- side panel: systems ---------- */
function renderSystems() {
  const ul = $('systems');
  ul.innerHTML = '';
  INDEX.systems.forEach(({ key }) => {
    const s = systems[key];
    const li = document.createElement('li');
    li.className = 'sys';
    const status = s.loading ? 'loading…' : s.failed ? 'could not load' : `${s.count} parts`;
    li.innerHTML = `<button class="tog" aria-pressed="${s.on}"><span class="sw" style="background:${COLOR[key]};border-color:${COLOR[key]}"></span><span class="nm">${s.label}</span><span class="st">${status}</span></button>`
      + `<button class="ghost" aria-pressed="${s.ghost}" ${s.on ? '' : 'disabled'}>See-through</button>`;
    li.querySelector('.tog').onclick = () => setOn(s, !s.on);
    li.querySelector('.ghost').onclick = () => { s.ghost = !s.ghost; if (s.group) applyLook(s); renderSystems(); };
    ul.appendChild(li);
  });
  $('unhide').hidden = hiddenParts.size === 0;
}

/* ---------- selecting parts ----------
   A selection is one part (tapped or searched) or a whole organ made of several parts (searched). */
function partSelection(id) {
  const p = INDEX.parts[id];
  return { ids: new Set([id]), title: p.name, sub: systems[p.sys].label };
}
function groupSelection(name) {
  const ids = GROUPS[name];
  const sys = [...new Set(ids.map((id) => systems[INDEX.parts[id].sys].label))];
  return { ids: new Set(ids), title: name, sub: `${ids.length} parts · ${sys.slice(0, 3).join(', ')}${sys.length > 3 ? '…' : ''}` };
}
function select(sel) {
  selected = sel;
  paintSelection();
  const info = $('info');
  if (!sel) { info.hidden = true; return; }
  $('info-n').textContent = sel.title;
  $('info-s').textContent = sel.sub;
  info.hidden = false;
}
const selBox = (f) => grow(partBox([...selected.ids]), f);
$('info-x').onclick = () => select(null);
$('info-focus').onclick = () => { if (selected) frameBox(selBox(1.6)); };
$('info-hide').onclick = () => {
  if (!selected) return;
  selected.ids.forEach((id) => hiddenParts.add(id));
  select(null);
  Object.values(systems).forEach((s) => s.group && applyLook(s));
  renderSystems();
};
$('info-only').onclick = () => {
  if (!selected) return;
  Object.values(partMesh).forEach((m) => { if (!selected.ids.has(m.userData.id)) hiddenParts.add(m.userData.id); });
  Object.values(systems).forEach((s) => s.group && applyLook(s));
  frameBox(selBox(1.6));
  renderSystems();
};
$('unhide').onclick = () => {
  hiddenParts.clear();
  Object.values(systems).forEach((s) => s.group && applyLook(s));
  renderSystems();
};
function grow(box, f) {
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()).multiplyScalar(f / 2);
  const m = Math.max(s.x, s.y, s.z, 0.03);
  s.max(new THREE.Vector3(m * 0.6, m * 0.6, m * 0.6));
  return new THREE.Box3(c.clone().sub(s), c.clone().add(s));
}

// Tap (not drag) picks the part under the finger.
const ray = new THREE.Raycaster();
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
  down = null;
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const solid = [], ghost = [];
  Object.values(systems).forEach((s) => s.on && s.meshes.forEach((m) => m.visible && (s.ghost ? ghost : solid).push(m)));
  // Solid parts win over see-through ones, so you can tap through the skin.
  const hit = ray.intersectObjects(solid, false)[0] || ray.intersectObjects(ghost, false)[0];
  select(hit ? partSelection(hit.object.userData.id) : null);
});

/* ---------- search ---------- */
let names = null;
function buildNames() {
  const seen = new Map();
  Object.entries(INDEX.parts).forEach(([id, p]) => {
    const k = p.name.toLowerCase();
    if (!seen.has(k)) seen.set(k, { id, name: p.name, sys: p.sys });
  });
  names = [...seen.values()];
  // whole organs and regions (several parts each) come first in results
  Object.entries(GROUPS).forEach(([name, ids]) => {
    if (!seen.has(name.toLowerCase())) names.push({ group: true, name, count: ids.length });
  });
}
function runSearch() {
  const q = $('q').value.trim().toLowerCase();
  const ul = $('results');
  if (q.length < 2) { ul.hidden = true; ul.innerHTML = ''; return; }
  const words = q.split(/\s+/);
  const hits = names.filter((n) => words.every((w) => n.name.toLowerCase().includes(w)))
    .sort((a, b) => (b.name.toLowerCase() === q) - (a.name.toLowerCase() === q)
      || (b.name.toLowerCase().startsWith(q)) - (a.name.toLowerCase().startsWith(q))
      || a.name.length - b.name.length)
    .slice(0, 40);
  ul.innerHTML = hits.length ? '' : '<li class="empty">Nothing found. Try another word.</li>';
  hits.forEach((h) => {
    const li = document.createElement('li');
    li.innerHTML = `<button><span></span><small>${h.group ? `whole · ${h.count} parts` : systems[h.sys].label}</small></button>`;
    li.querySelector('span').textContent = h.name;
    li.querySelector('button').onclick = () => (h.group ? goTo(groupSelection(h.name)) : goTo(partSelection(h.id)));
    ul.appendChild(li);
  });
  ul.hidden = false;
}
$('q').addEventListener('input', runSearch);

async function goTo(sel) {
  const need = new Set([...sel.ids].map((id) => INDEX.parts[id].sys));
  sel.ids.forEach((id) => hiddenParts.delete(id));
  await Promise.all([...need].map((k) => (systems[k].on ? null : setOn(systems[k], true))));
  // Everything else that is showing fades to see-through, so nothing blocks the view.
  Object.values(systems).forEach((s) => { if (s.on && !need.has(s.key)) s.ghost = true; });
  Object.values(systems).forEach((s) => s.group && applyLook(s));
  select(sel);
  document.querySelectorAll('#views button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  frameBox(selBox(1.8));
  renderSystems();
}

/* ---------- reset ---------- */
async function reset() {
  hiddenParts.clear();
  select(null);
  goRegion(REGIONS[0]);
  for (const s of Object.values(systems)) {
    s.ghost = DEFAULT_GHOST.includes(s.key);
    await setOn(s, DEFAULT_ON.includes(s.key));
  }
}
$('reset').onclick = reset;

/* ---------- start ---------- */
async function start() {
  try {
    [INDEX, GROUPS] = await Promise.all(['/models/index.json', '/models/groups.json'].map((u) => fetch(u).then((r) => r.json())));
  } catch (e) {
    $('loading-t').textContent = 'The body model could not be loaded. Reload the page to try again.';
    return;
  }
  const counts = {};
  Object.values(INDEX.parts).forEach((p) => { counts[p.sys] = (counts[p.sys] || 0) + 1; });
  INDEX.systems.forEach(({ key, label, file }) => {
    systems[key] = { key, label, file, count: counts[key] || 0, on: DEFAULT_ON.includes(key), ghost: DEFAULT_GHOST.includes(key), group: null, loading: null, meshes: [] };
  });
  buildNames();
  renderSystems();

  const views = $('views');
  REGIONS.forEach((r) => {
    const b = document.createElement('button');
    b.textContent = r.label;
    b.dataset.r = r.key;
    b.onclick = () => goRegion(r);
    views.appendChild(b);
  });
  goRegion(REGIONS[0], true);

  try {
    await Promise.all(DEFAULT_ON.map((k) => loadSystem(systems[k])));
    $('loading').hidden = true;
  } catch (e) {
    $('loading-t').textContent = 'Part of the body model could not be loaded. Reload the page to try again.';
  }
}
start();

/* ---------- render loop ---------- */
controls.addEventListener('change', redraw);
function tick() {
  if (fly) {
    dirty = true;
    fly.k = Math.min(1, fly.k + 0.06);
    const t = fly.k * fly.k * (3 - 2 * fly.k);
    camera.position.lerpVectors(fly.p0, fly.p1, t);
    controls.target.lerpVectors(fly.t0, fly.t1, t);
    if (fly.k >= 1) fly = null;
  }
  controls.update();
  if (dirty) { dirty = false; renderer.render(scene, camera); }
  requestAnimationFrame(tick);
}
controls.addEventListener('start', () => { fly = null; });
tick();

// handy for testing in the browser console
window.__body = { systems, select, goTo, INDEX: () => INDEX, partMesh };
