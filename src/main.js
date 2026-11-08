import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { N8AOPass } from 'n8ao';
import { initReport } from './report.js';

const $ = (id) => document.getElementById(id);
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';
// Draw only when something changed, to save battery on phones.
let dirty = true;
function redraw() { dirty = true; }
let cine = null; // the guided camera shot in progress (see the camera director below)
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- colours for each body system (teaching colours, as in Shoulder Lab) ---------- */
const COLOR = {
  skin: '#E0AE92', skeleton: '#EDE2C8', cartilage: '#6FB4E6', joints: '#F1E9DA', muscles: '#B9473D',
  heart: '#A82A35', arteries: '#D23A36', veins: '#3C66C9', nerves: '#F2C33A', senses: '#9B7BD4',
  lungs: '#E59AA6', gut: '#D79A5C', urinary: '#B9644A', genital: '#D58BB0', glands: '#5DB585',
};
// How each kind of tissue catches the light: soft sheen on muscle, satin bone, wet gloss on organs.
const LOOK = {
  muscles: { roughness: 0.5, sheen: 0.7, sheenRoughness: 0.45, sheenColor: '#FFB3A6', clearcoat: 0.12, clearcoatRoughness: 0.5 },
  skeleton: { roughness: 0.62, sheen: 0.25, sheenRoughness: 0.6, sheenColor: '#FFF6E5' },
  cartilage: { roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2 },
  joints: { roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.25, sheen: 0.3, sheenColor: '#FFFFFF' },
  skin: { roughness: 0.6, sheen: 0.35, sheenColor: '#FFD9C7', sheenRoughness: 0.6 },
  nerves: { roughness: 0.4, sheen: 0.5, sheenColor: '#FFF2B0', clearcoat: 0.2 },
  organ: { roughness: 0.38, clearcoat: 0.55, clearcoatRoughness: 0.22 },
};
const DEFAULT_ON = ['skeleton', 'muscles'];
const DEFAULT_GHOST = ['skin'];
const HILITE = new THREE.Color('#F2B705');

/* ---------- renderer and scene ---------- */
const stageEl = $('stage');
const phone = matchMedia('(pointer: coarse)').matches;
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, phone ? 1.5 : 2));
const fullRatio = renderer.getPixelRatio(); // sharpness when still (lower while moving)
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;
stageEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.75;
// Studio lighting: a warm key from the front-left, a cool rim from behind, soft fill from below.
scene.add(new THREE.HemisphereLight(0xfff8f0, 0x3a4542, 0.55));
const key = new THREE.DirectionalLight(0xfff1e2, 1.6);
key.position.set(-2.5, 4, 4);
scene.add(key);
const rim = new THREE.DirectionalLight(0xdfeaff, 1.1);
rim.position.set(2.5, 2.5, -4);
scene.add(rim);
const rim2 = new THREE.DirectionalLight(0xffe6dc, 0.6);
rim2.position.set(-3, 1, -3);
scene.add(rim2);

// Soft radial backdrop in the page's stage colour.
function setBg() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  const base = new THREE.Color(css('--stage'));
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const inner = base.clone().offsetHSL(0, 0, dark ? 0.06 : 0.07).getStyle();
  const outer = base.clone().offsetHSL(0, 0, dark ? -0.03 : -0.09).getStyle();
  const grad = g.createRadialGradient(256, 210, 20, 256, 256, 380);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  scene.background = t;
  redraw();
}
setBg();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', setBg);

const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.rotateSpeed = 0.5;
controls.zoomSpeed = 0.7;
controls.minDistance = 0.04;
controls.maxDistance = 8;
controls.rotateSpeed = phone ? 0.9 : 0.6;
controls.zoomSpeed = phone ? 1.1 : 0.9;
controls.panSpeed = 0.8;
controls.screenSpacePanning = true;

/* ---------- post-processing: soft contact shadows, selection outline, smooth edges ---------- */
const composer = new EffectComposer(renderer);
const aoPass = new N8AOPass(scene, camera, 1, 1);
aoPass.configuration.aoRadius = 0.035; // metres: shadows where muscles, bones and organs meet
aoPass.configuration.distanceFalloff = 1.0;
aoPass.configuration.intensity = 2.4;
aoPass.configuration.gammaCorrection = false;
aoPass.configuration.halfRes = phone;
aoPass.setQualityMode(phone ? 'Low' : 'Medium');
composer.addPass(aoPass);
const outlinePass = new OutlinePass(new THREE.Vector2(1, 1), scene, camera);
outlinePass.edgeStrength = 4;
outlinePass.edgeThickness = 1.2;
outlinePass.edgeGlow = 0.4;
outlinePass.visibleEdgeColor.set('#FFD54A');
outlinePass.hiddenEdgeColor.set('#C79A1E');
composer.addPass(outlinePass);
composer.addPass(new OutputPass());
const smaa = new SMAAPass(1, 1);
composer.addPass(smaa);

function resize() {
  const w = stageEl.clientWidth, h = stageEl.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(fullRatio);
  composer.setSize(w, h);
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
  const dist = Math.max(fitH, fitW) * 1.12 + Math.max(s.x, s.z) / 3;
  const dir = side === 'back' ? new THREE.Vector3(0, 0.08, -1)
    : side === 'right' ? new THREE.Vector3(-1, 0.08, 0.15)
      : new THREE.Vector3(0, 0.08, 1);
  const to = c.clone().addScaledVector(dir.normalize(), Math.max(dist, 0.15));
  if (instant || reduceMotion) { camera.position.copy(to); controls.target.copy(c); fly = null; controls.update(); return; }
  fly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: to, t1: c, start: performance.now(), dur: 750 };
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
  if (focusIds && selected) select(null);
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
  // a little breathing room around regions, more for the small ones
  const pad = r.key === 'body' ? 1.0 : 1.45;
  const c = box.getCenter(new THREE.Vector3()), hs = box.getSize(new THREE.Vector3()).multiplyScalar(pad / 2);
  box = new THREE.Box3(c.clone().sub(hs), c.clone().add(hs));
  frameBox(box, { side: r.side, instant });
  activeRegion = r.key;
  document.querySelectorAll('#views button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.r === r.key));
}

/* ---------- materials ---------- */
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967295; }
function makeMaterial(sysKey, id) {
  const c = new THREE.Color(COLOR[sysKey] || '#BBBBBB');
  // small shade changes between neighbouring parts so they read as separate pieces
  const jitter = sysKey === 'skin' ? 0 : (hash(id) - 0.5) * (sysKey === 'muscles' ? 0.14 : 0.07);
  c.offsetHSL(jitter * 0.25, jitter * 0.3, jitter);
  const look = { ...(LOOK[sysKey] || LOOK.organ) };
  if (phone) { delete look.clearcoat; delete look.clearcoatRoughness; }
  return new THREE.MeshPhysicalMaterial({
    color: c, metalness: 0, envMapIntensity: 0.8, side: THREE.DoubleSide,
    ...look, sheenColor: new THREE.Color(look.sheenColor || '#FFFFFF'),
  });
}
// While a search result or report finding is shown, every other part is see-through.
let focusIds = null;
const isGhost = (sys, m) => lookOf(sys, m).ghost;
/* How see-through the surroundings get around a focused part: bones stay clearly visible and
   muscles faintly, so the spot still sits inside an intact body. focusFade animates 0 -> 1. */
const FOCUS_OPACITY = { skin: 0.04, skeleton: 0.38, muscles: 0.14, joints: 0.22, cartilage: 0.3 };
let focusFade = 1;
function lookOf(sys, m) {
  if (sys.ghost) return { ghost: true, opacity: sys.key === 'skin' ? 0.14 : 0.22 };
  if (focusIds && !focusIds.has(m.userData.id)) {
    const target = FOCUS_OPACITY[sys.key] ?? 0.16;
    const opacity = 1 + (target - 1) * focusFade;
    return { ghost: opacity < 0.999, opacity };
  }
  return { ghost: false, opacity: 1 };
}
function applyLook(sys) {
  redraw();
  sys.meshes.forEach((m) => {
    const mat = m.material;
    const { ghost, opacity } = lookOf(sys, m);
    if (mat.transparent !== ghost) { mat.transparent = ghost; mat.depthWrite = !ghost; mat.needsUpdate = true; }
    mat.opacity = opacity;
    m.renderOrder = ghost ? 2 : 0;
    m.visible = sys.on && !hiddenParts.has(m.userData.id);
  });
}
function setFocusFade(v) {
  focusFade = v;
  Object.values(systems).forEach((s) => s.group && applyLook(s));
}
function paintSelection() {
  redraw();
  Object.values(partMesh).forEach((m) => {
    const isSel = !!selected && selected.ids.has(m.userData.id);
    const tint = isSel && selected.tint && selected.tint.ids.has(m.userData.id) ? selected.tint.color : HILITE;
    m.material.emissive.copy(isSel ? tint : new THREE.Color(0));
    // a whole organ gets a softer glow so its own colours still show
    m.material.emissiveIntensity = isSel ? (selected.ids.size > 8 ? 0.12 : 0.28) : 0;
  });
  // outline the selection (skipped for very large selections, where it would just be noise)
  const sel = selected ? [...selected.ids].map((id) => partMesh[id]).filter(Boolean) : [];
  outlinePass.selectedObjects = sel.length && sel.length <= 60 ? sel : [];
  outlinePass.visibleEdgeColor.copy(selected?.tint ? selected.tint.color : new THREE.Color('#FFD54A'));
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
  if (!sel) { info.hidden = true; clearFocus(); return; }
  $('info-n').textContent = sel.title;
  $('info-s').textContent = sel.sub;
  info.hidden = false;
}
const selBox = (f) => grow(partBox([...selected.ids]), f);
function clearFocus() {
  if (!focusIds) return;
  focusIds = null;
  Object.values(systems).forEach((s) => s.group && applyLook(s));
}
$('info-x').onclick = () => select(null);
$('info-tour').onclick = async () => {
  if (!selected) return;
  const sel = selected;
  await goTo(sel, { noFrame: true, fade: 0 });
  const m = markerFor([...sel.ids]);
  if (m) cinematic(m, { orbitDeg: 70 });
};
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
  Object.values(systems).forEach((s) => s.on && s.meshes.forEach((m) => m.visible && (isGhost(s, m) ? ghost : solid).push(m)));
  // Solid parts win over see-through ones, so you can tap through the skin.
  const hit = ray.intersectObjects(solid, false)[0] || ray.intersectObjects(ghost, false)[0];
  const now = performance.now();
  const double = lastTap && now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30;
  lastTap = double ? null : { t: now, x: e.clientX, y: e.clientY };
  if (double && hit) { zoomInTo(hit.point); return; }
  select(hit ? partSelection(hit.object.userData.id) : null);
});
let lastTap = null;
// Fly in toward a spot and make it the centre that the view turns around.
function zoomInTo(point) {
  document.querySelectorAll('#views button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  const dir = camera.position.clone().sub(controls.target).normalize();
  const dist = Math.max(controls.minDistance * 2, Math.min(camera.position.distanceTo(point) * 0.45, 0.6));
  const to = point.clone().addScaledVector(dir, dist);
  if (reduceMotion) { camera.position.copy(to); controls.target.copy(point); controls.update(); redraw(); return; }
  fly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: to, t1: point.clone(), start: performance.now(), dur: 650 };
}

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

async function goTo(sel, { noFrame = false, fade = 1 } = {}) {
  const need = new Set([...sel.ids].map((id) => INDEX.parts[id].sys));
  sel.ids.forEach((id) => hiddenParts.delete(id));
  await Promise.all([...need].map((k) => (systems[k].on ? null : setOn(systems[k], true))));
  select(sel);
  // Everything else fades to see-through, so nothing blocks the view (closing the card brings it back).
  focusIds = new Set(sel.ids);
  setFocusFade(fade);
  document.querySelectorAll('#views button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  if (!noFrame) frameBox(selBox(1.3));
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

/* ---------- render loop ----------
   While you turn, zoom or the camera flies, frames are drawn the quick way (no soft shadows or
   edge smoothing) so moving stays smooth on phones. Once things are still, one full-quality frame. */
const frameListeners = new Set();
let moving = false;
let settle = null;
const movingRatio = Math.min(fullRatio, phone ? 1 : 1.25);
function setMoving(on) {
  if (moving === on) return;
  moving = on;
  // fewer pixels while moving, full sharpness when still
  if (movingRatio !== fullRatio) {
    renderer.setPixelRatio(on ? movingRatio : fullRatio);
    const w = stageEl.clientWidth, h = stageEl.clientHeight;
    if (w && h) renderer.setSize(w, h, false);
  }
  redraw();
}
function markMoving() {
  if (cineFrame && !phone) return; // the director's own camera moves don't count as dragging
  setMoving(true);
  clearTimeout(settle);
  settle = setTimeout(() => { if (!fly) setMoving(false); }, 180);
}
controls.addEventListener('change', markMoving);
controls.addEventListener('change', redraw);
let cineFrame = false;
function tick() {
  if (cine) { updateCine(performance.now()); dirty = true; cineFrame = true; }
  if (fly) {
    dirty = true;
    if (!moving) setMoving(true);
    // time-based, so a flight takes the same time on a slow phone as on a fast computer
    const k = Math.min(1, (performance.now() - fly.start) / fly.dur);
    const t = k * k * (3 - 2 * k);
    camera.position.lerpVectors(fly.p0, fly.p1, t);
    controls.target.lerpVectors(fly.t0, fly.t1, t);
    if (k >= 1) { fly = null; markMoving(); }
  }
  controls.update();
  cineFrame = false;
  if (dirty) {
    dirty = false;
    // quick frames whenever the camera moves (guided shots keep full sharpness on computers);
    // the full shading fills in as soon as it stops
    if (moving || fly || cine) renderer.render(scene, camera);
    else composer.render();
    frameListeners.forEach((f) => f());
  }
  requestAnimationFrame(tick);
}
controls.addEventListener('start', () => { fly = null; cine = null; });
tick();

// handy for testing in the browser console
window.__body = { systems, select, goTo, INDEX: () => INDEX, partMesh, camera, controls };

/* ---------- walkthrough helpers ---------- */
const _v = new THREE.Vector3();
// World-space vertices of the given parts (sampled so huge parts stay quick).
function vertsOf(ids, max = 6000) {
  const out = [];
  ids.forEach((id) => {
    const m = partMesh[id];
    if (!m) return;
    const pos = m.geometry.attributes.position;
    const step = Math.max(1, Math.floor((pos.count * ids.length) / max));
    for (let i = 0; i < pos.count; i += step) out.push([pos.getX(i), pos.getY(i), pos.getZ(i), m, i]);
  });
  return out;
}
/* Where to pin a finding: the point of the focus part closest to the "near" part
   (e.g. where a tendon meets its bone), or the middle of the focus part. */
function markerFor(focusIds, nearIds) {
  const fv = vertsOf(focusIds);
  if (!fv.length) return null;
  let best = null;
  const nv = nearIds?.length ? vertsOf(nearIds, 3000) : [];
  if (nv.length) {
    let bd = Infinity;
    for (const a of fv) for (const b of nv) {
      const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
      if (d < bd) { bd = d; best = a; }
    }
  } else {
    const c = fv.reduce((acc, a) => acc.add(_v.set(a[0], a[1], a[2])), new THREE.Vector3()).multiplyScalar(1 / fv.length);
    let bd = Infinity;
    for (const a of fv) { const d = c.distanceToSquared(_v.set(a[0], a[1], a[2])); if (d < bd) { bd = d; best = a; } }
  }
  const point = new THREE.Vector3(best[0], best[1], best[2]);
  const nrm = best[3].geometry.attributes.normal;
  const normal = nrm ? new THREE.Vector3(nrm.getX(best[4]), nrm.getY(best[4]), nrm.getZ(best[4])) : new THREE.Vector3(0, 0, 1);
  const size = partBox(focusIds).getSize(new THREE.Vector3()).length();
  return { point, normal, size };
}
/* Fly so the point is in the middle, seen from outside the body. */
function lookAtPoint(m, { closeness = 1 } = {}) {
  const dir = outwardDir(m);
  const dist = THREE.MathUtils.clamp(m.size * 1.6, 0.22, 0.75) / closeness;
  // aim a little below the spot so it sits in the upper part of the view, clear of the subtitles
  const aim = m.point.clone().add(new THREE.Vector3(0, -dist * 0.16, 0));
  const to = aim.clone().addScaledVector(dir, dist);
  if (reduceMotion) { camera.position.copy(to); controls.target.copy(aim); fly = null; controls.update(); redraw(); return; }
  fly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: to, t1: aim, start: performance.now(), dur: 1300 };
}
/* ---------- the camera director ----------
   A guided shot of a spot: start wide with the body intact, glide in while the surroundings fade,
   then circle slowly around it until the scene changes. Touching the screen hands control back.
   (its state, `cine`, is declared at the top because the render loop starts early) */
const ease = (k) => k * k * (3 - 2 * k);
function outwardDir(m) {
  const out = new THREE.Vector3(m.point.x, 0, m.point.z - 0.08); // away from the body's centre line
  if (out.lengthSq() < 1e-4) out.set(0, 0, 1);
  out.normalize();
  const dir = out.multiplyScalar(0.75).add(m.normal.clone().normalize().multiplyScalar(0.25));
  dir.y += 0.18;
  return dir.normalize();
}
function cinematic(m, { wideShot = true, fade = true, orbitDeg = 38, closeness = 1, distance = null } = {}) {
  const dir = outwardDir(m);
  const close = distance ?? THREE.MathUtils.clamp(m.size * 1.6, 0.22, 0.75) / closeness;
  const aim = m.point.clone().add(new THREE.Vector3(0, -close * 0.16, 0)); // spot sits above the subtitles
  if (reduceMotion) {
    camera.position.copy(aim).addScaledVector(dir, close); controls.target.copy(aim);
    controls.update(); if (fade) setFocusFade(1); cine = null; redraw(); return;
  }
  fly = null;
  cine = {
    aim, dir, close, wide: Math.max(close * 2.4, 0.85), wideShot, fade, orbit: THREE.MathUtils.degToRad(orbitDeg),
    from: camera.position.clone(), fromT: controls.target.clone(), t0: performance.now(),
  };
  if (fade) setFocusFade(0);
}
const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _side = new THREE.Vector3();
function shotPos(c, yaw, pitch, dist) {
  const d = c.dir.clone().applyQuaternion(_q.setFromAxisAngle(_up, yaw));
  _side.crossVectors(_up, d).normalize();
  d.applyQuaternion(_q.setFromAxisAngle(_side, -pitch)).normalize();
  return c.aim.clone().addScaledVector(d, dist);
}
function updateCine(now) {
  const c = cine, t = (now - c.t0) / 1000;
  const A = c.wideShot ? 1.3 : 0, B = 2.2; // establish, push in (seconds); then orbit
  const startYaw = -c.orbit * 0.6;
  if (t < A) { // establishing shot: glide from wherever we are to a wide view, body intact
    const k = ease(t / A);
    camera.position.lerpVectors(c.from, shotPos(c, startYaw, 0.12, c.wide), k);
    controls.target.lerpVectors(c.fromT, c.aim, k);
    return;
  }
  if (t < A + B) { // push in, turning a little, while the layers in front fade away
    const k = ease((t - A) / B);
    const from = c.wideShot ? shotPos(c, startYaw, 0.12, c.wide) : c.from;
    const to = shotPos(c, startYaw * 0.4, 0.05, c.close);
    camera.position.lerpVectors(from, to, k);
    if (!c.wideShot) controls.target.lerpVectors(c.fromT, c.aim, k); else controls.target.copy(c.aim);
    if (c.fade) setFocusFade(k);
    return;
  }
  // slow orbit back and forth around the spot, with a gentle drift in height and distance
  const o = t - A - B;
  const ramp = Math.min(1, o / 1.5);
  const yaw = startYaw * 0.4 + Math.sin(o * 0.32) * c.orbit * ramp;
  const pitch = 0.05 + Math.sin(o * 0.21) * 0.1 * ramp;
  const dist = c.close * (1 - 0.06 * Math.sin(o * 0.27) * ramp);
  camera.position.copy(shotPos(c, yaw, pitch, dist));
  controls.target.copy(c.aim);
  if (c.fade && focusFade < 1) setFocusFade(1);
}
function stopCine() { cine = null; setMoving(true); markMoving(); }

// Screen position of a 3D point inside the viewer (null when behind the camera).
function toScreen(p) {
  _v.copy(p).project(camera);
  if (_v.z > 1) return null;
  const r = renderer.domElement.getBoundingClientRect();
  return { x: (_v.x + 1) / 2 * r.width, y: (1 - _v.y) / 2 * r.height };
}

/* ---------- report explainer hooks ---------- */
initReport({
  markerFor, lookAtPoint, toScreen, cinematic, stopCine,
  onFrame: (f) => { frameListeners.add(f); redraw(); return () => frameListeners.delete(f); },
  // light up parts with a colour, fade everything else, and stay put (the walkthrough moves the camera)
  focusParts: async (ids, title, sub, tint, tintIds) => {
    const known = ids.filter((id) => INDEX?.parts[id]);
    if (!known.length) return false;
    await goTo({ ids: new Set(known), title, sub, tint: tint && { color: new THREE.Color(tint), ids: new Set(tintIds || known) } }, { noFrame: true, fade: 0 });
    return true;
  },
  // light up these parts, fading everything else (same as picking a search result)
  showParts: (ids, title, sub) => {
    const known = ids.filter((id) => INDEX?.parts[id]);
    if (known.length) goTo({ ids: new Set(known), title, sub });
  },
  goRegion: (key) => { const r = REGIONS.find((x) => x.key === key); if (r && INDEX) goRegion(r); },
  // slow circling shot of a whole region (used for the intro), body intact
  tourRegion: (key) => {
    const r = REGIONS.find((x) => x.key === key) || REGIONS[0];
    if (!INDEX) return;
    const box = partBox(r.find());
    const size = box.getSize(new THREE.Vector3());
    const point = box.getCenter(new THREE.Vector3());
    select(null);
    const fit = (Math.max(size.y, size.x / Math.max(camera.aspect, 0.4)) / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const distance = fit * (r.key === 'body' ? 1.1 : 1.6) + Math.max(size.x, size.z) / 2;
    cinematic({ point, normal: new THREE.Vector3(0, 0, 1), size: 1 }, { wideShot: false, fade: false, orbitDeg: 30, distance });
  },
  deselect: () => select(null),
  clear: () => reset(),
});
