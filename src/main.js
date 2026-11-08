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
  added: '#1FA88A',
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
const DEFAULT_ON = ['skeleton', 'muscles', 'added'];
const DEFAULT_GHOST = ['skin'];

/* One-tap views: which systems show, and which are see-through around them. */
const VIEWS = {
  skin: { label: 'Skin', on: ['skin', 'senses'], ghost: [] },
  muscles: { label: 'Muscles', on: ['skeleton', 'muscles', 'added', 'skin'], ghost: ['skin'] },
  organs: { label: 'Organs', on: ['heart', 'lungs', 'gut', 'urinary', 'glands', 'genital', 'added', 'skeleton', 'skin'], ghost: ['skeleton', 'skin'] },
  skeleton: { label: 'Skeleton', on: ['skeleton', 'cartilage', 'joints', 'added'], ghost: [] },
  nerves: { label: 'Nerves', on: ['nerves', 'senses', 'added', 'skeleton'], ghost: ['skeleton'] },
  vessels: { label: 'Vessels', on: ['heart', 'arteries', 'veins', 'skeleton'], ghost: ['skeleton'] },
};
let currentView = 'muscles';
const PART_COLOR = [
  [/sclera/i, '#F3EFE6', { roughness: 0.3, clearcoat: 0.6 }],
  [/cornea/i, '#E4EEF2', { roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.18, depthWrite: false }],
  [/\biris\b/i, '#5B3B22'],
  [/\blens\b/i, '#E9E3C7', { roughness: 0.1 }],
  [/choroid|retina/i, '#7A3A33'],
  [/vitreous|anterior chamber/i, '#E9EEF0', { transparent: true, opacity: 0.5 }],
  [/eyelid|tarsal plate/i, '#D99A84'],
  [/rectus$|oblique$|levator palpebrae/i, '#B9473D'],
  [/lacrimal (gland|sac|canaliculus|lake)|nasolacrimal/i, '#E2A49B'],
  [/external ear|auricle/i, '#DFA98C'],
  [/tooth|teeth|incisor|canine|molar/i, '#F4EFE2', { roughness: 0.25, clearcoat: 0.6 }],
  [/tongue/i, '#C86A6E'],
  [/^lip$|\blip\b/i, '#C7716B'],
  [/hair of head|eyebrow|pubic hair/i, '#3B2A20', { roughness: 0.7 }],
];

/* Man or woman. The anatomy data is a male body; for "woman" the male reproductive organs are
   hidden, drawn female organs and breast tissue are shown, and the skin is reshaped. */
let sex = 'male';
try { sex = localStorage.getItem('dr-pocket:sex') === 'female' ? 'female' : 'male'; } catch { /* private mode */ }
const sexOk = (id) => {
  const p = INDEX?.parts[id];
  if (p?.name === 'Pubic hair') return sex === 'male'; // left out for the woman (her groin is drawn)
  return !p?.sex || p.sex === sex;
};
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
controls.zoomToCursor = true; // pinch or scroll zooms toward the spot under your finger, which becomes the new centre

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
  // parts drawn by Dr Pocket carry their own colour (cartilage blue, labrum green, nerves yellow...)
  const own = INDEX?.parts[id]?.color;
  if (own) {
    return new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(own), metalness: 0, envMapIntensity: 0.8, side: THREE.DoubleSide,
      roughness: 0.38, ...(phone ? {} : { clearcoat: 0.45, clearcoatRoughness: 0.25 }),
    });
  }
  // parts of the eye, ear and mouth get their real colours rather than their system's colour
  const nm = INDEX?.parts[id]?.name || '';
  const named = PART_COLOR.find(([rx]) => rx.test(nm));
  if (named) {
    const [, col, extra] = named;
    const mat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(col), metalness: 0, roughness: 0.4, envMapIntensity: 0.8, side: THREE.DoubleSide, ...(extra || {}) });
    if (extra?.transparent) mat.userData.seeThrough = extra.opacity ?? 1;
    return mat;
  }
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
    if (mat.userData.seeThrough) { // naturally see-through parts (cornea) stay that way
      mat.opacity = mat.userData.seeThrough * opacity;
      if (mat.userData.keepDepth) mat.depthWrite = opacity > 0.9;
    } else {
      if (mat.transparent !== ghost) { mat.transparent = ghost; mat.depthWrite = !ghost; mat.needsUpdate = true; }
      mat.opacity = opacity;
    }
    m.renderOrder = ghost ? 2 : 0;
    m.visible = sys.on && !hiddenParts.has(m.userData.id) && sexOk(m.userData.id);
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
    loader.load(`/models/${sys.file}?v=${__MODELS_VERSION__}`, (gltf) => {
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
      if (sys.key === 'skin') shapeSkin();
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
  return { ids: new Set([id]), title: p.name, sub: p.drawn ? 'Drawn by Dr Pocket · approximate shape' : systems[p.sys].label };
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

/* ---------- the skin for the "woman" option ----------
   The male skin is reshaped: a female chest over the drawn breast tissue, and the male external
   genitals smoothed back into the body outline. Approximate, like the drawn organs. */
const smooth01 = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
// how far forward the body surface comes at each height, from between the thighs up to the pubic mound
const GROIN = [[0.60, 0.035], [0.70, 0.04], [0.72, 0.07], [0.74, 0.115], [0.76, 0.152], [0.78, 0.174], [0.80, 0.186]];
function groinZ(y) {
  if (y <= GROIN[0][0]) return GROIN[0][1];
  for (let k = 1; k < GROIN.length; k++) {
    if (y <= GROIN[k][0]) { const [y0, z0] = GROIN[k - 1], [y1, z1] = GROIN[k]; return z0 + (z1 - z0) * (y - y0) / (y1 - y0); }
  }
  return GROIN[GROIN.length - 1][1];
}
// smooth curve through (height, value) points: a Catmull-Rom spline, so it flows through each point
// without levelling off at it (which would make terraces)
function curve(points, y) {
  const n = points.length;
  if (y <= points[0][0]) return points[0][1];
  if (y >= points[n - 1][0]) return points[n - 1][1];
  let k = 1;
  while (y > points[k][0]) k++;
  const [y0, v0] = points[k - 1], [y1, v1] = points[k];
  const h = y1 - y0, t = (y - y0) / h;
  const slope = (a, b) => (points[b][1] - points[a][1]) / (points[b][0] - points[a][0]);
  const m0 = k - 1 > 0 ? slope(k - 2, k) : slope(k - 1, k);
  const m1 = k + 1 < n ? slope(k - 1, k + 1) : slope(k - 1, k);
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * h * m1;
}
// female proportions: width of the torso relative to the male model at each height (arms move with its edge)
const WIDTH = [[0.45, 1], [0.76, 1], [0.8, 1.08], [0.86, 1.17], [0.92, 1.13], [0.97, 1.0], [1.02, 0.88], [1.07, 0.9], [1.16, 0.96], [1.26, 0.93], [1.34, 0.91], [1.4, 0.88], [1.44, 0.95], [1.5, 1]];
const EDGE = [[0.6, 0.17], [0.86, 0.17], [1.0, 0.15], [1.1, 0.16], [1.3, 0.17], [1.4, 0.06]];
function femaleShape(x, y, z) {
  const sx = curve(WIDTH, y), edge = curve(EDGE, y);
  const ax = Math.abs(x), sgn = Math.sign(x) || 1;
  // torso scaled about the middle; arms (beyond the torso's edge) shifted by the same amount as the edge
  let nx = x + sgn * (sx - 1) * Math.min(ax, edge);
  let ny = y, nz = z;
  // fuller buttocks
  if (z < 0.05 && y > 0.74 && y < 0.96 && ax < 0.17) {
    const w = smooth01((y - 0.74) / 0.06) * (1 - smooth01((y - 0.9) / 0.06)) * (1 - smooth01((ax - 0.12) / 0.05));
    nz -= 0.03 * w;
  }
  // face and neck: smoother brow, slimmer jaw angles and chin, finer nose, fuller lips, no Adam's apple
  if (y > 1.36 && y < 1.6 && z > 0.05) {
    const bump = (v, c, r) => Math.max(0, 1 - ((v - c) / r) ** 2);
    // brow ridge smoothed back
    const brow = bump(y, 1.556, 0.024) * (1 - smooth01((ax - 0.045) / 0.03)) * smooth01((z - 0.14) / 0.02);
    nz -= 0.009 * brow;
    // jaw angles drawn in (not the lips and mouth)
    const jaw = bump(y, 1.45, 0.035) * smooth01((ax - 0.03) / 0.02) * (1 - smooth01((z - 0.15) / 0.02));
    nx -= sgn * 0.014 * jaw;
    // smaller chin
    const chin = bump(y, 1.43, 0.016) * (1 - smooth01((ax - 0.015) / 0.02)) * smooth01((z - 0.15) / 0.015);
    nz -= 0.008 * chin; ny += 0.004 * chin;
    // finer nose
    const nose = bump(y, 1.5, 0.03) * (1 - smooth01((ax - 0.008) / 0.014)) * smooth01((z - 0.175) / 0.01);
    nz -= 0.005 * nose;
    // slightly fuller lips
    const lips = bump(y, 1.462, 0.011) * (1 - smooth01((ax - 0.015) / 0.012)) * smooth01((z - 0.168) / 0.008);
    nz += 0.0025 * lips;
    if (y > 1.37 && y < 1.45 && ax < 0.025 && z > 0.1) nz -= 0.007 * (1 - smooth01((ax - 0.01) / 0.015)); // Adam's apple
  }
  return [nx, ny, nz];
}
// finer, slightly higher and arched eyebrows
function femaleBrow(x, y, z) {
  const ax = Math.abs(x);
  const arch = Math.max(0, 1 - ((ax - 0.033) / 0.028) ** 2);
  return [x, 1.54 + (y - 1.54) * 0.55 + 0.003 + 0.004 * arch, z];
}
// breast shape: a dome with a rounded lower curve and a clear fold underneath, and a gentle upper slope
function breastLift(dx, dy) {
  const ry = dy < 0 ? 0.054 : 0.075;
  const r2 = (dx / 0.062) ** 2 + (dy / ry) ** 2;
  if (r2 >= 1) return 0;
  return dy < 0 ? (1 - r2) ** 0.5 : smooth01(1 - r2);
}
// fine light and dark streaks running down the hair, as vertex colours
const HAIR = new THREE.Color('#3A2619');
function streak(th) { return 0.8 + 0.12 * Math.sin(th * 97) + 0.09 * Math.sin(th * 233 + 1.3) + 0.06 * Math.sin(th * 41 + 0.7); }
function hairColours(geo, zc = 0.065) {
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const th = Math.atan2(pos.getX(i), -(pos.getZ(i) - zc));
    const k = streak(th) * (0.9 + 0.1 * Math.sin(pos.getY(i) * 60));
    col[i * 3] = HAIR.r * k; col[i * 3 + 1] = HAIR.g * k; col[i * 3 + 2] = HAIR.b * k;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
}
const hairMaterial = () => new THREE.MeshPhysicalMaterial({
  color: '#ffffff', vertexColors: true, roughness: 0.5, metalness: 0, side: THREE.DoubleSide,
  sheen: 0.8, sheenRoughness: 0.35, sheenColor: new THREE.Color('#C9A27E'), envMapIntensity: 0.7,
});
/* Long hair for the woman: falls from the hairline at the back and sides to the shoulders, draping
   over the neck and shoulders (kept just outside the skin) with a softly uneven ends line. */
function buildLongHair(cap, skin) {
  const zc = 0.065, NA = 96, NV = 30, YMIN = 1.2, YMAX = 1.66, NY = 92;
  const angleOf = (x, z) => Math.atan2(x, -(z - zc)); // 0 = back of the head
  // how far out the skin reaches at each angle and height (to keep the hair outside it)
  const reach = new Float32Array(NA * NY);
  const sp = skin.geometry.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i);
    if (y < YMIN || y > YMAX || Math.abs(x) > 0.3) continue;
    const a = Math.floor(((angleOf(x, z) + Math.PI) / (2 * Math.PI)) * NA) % NA;
    const b = Math.min(NY - 1, Math.floor(((y - YMIN) / (YMAX - YMIN)) * NY));
    reach[a * NY + b] = Math.max(reach[a * NY + b], Math.hypot(x, z - zc));
  }
  const skinReach = (th, y) => {
    const a = Math.floor(((th + Math.PI) / (2 * Math.PI)) * NA) % NA;
    const b = Math.min(NY - 1, Math.max(0, Math.floor(((y - YMIN) / (YMAX - YMIN)) * NY)));
    let r = 0;
    for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) {
      const aa = (a + da + NA) % NA, bb = Math.min(NY - 1, Math.max(0, b + db));
      r = Math.max(r, reach[aa * NY + bb]);
    }
    return r;
  };
  // lower edge of the short hair cap at each angle
  const cp = cap.geometry.attributes.position;
  const edgeY = new Float32Array(NA).fill(9), edgeR = new Float32Array(NA);
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
    const a = Math.floor(((angleOf(x, z) + Math.PI) / (2 * Math.PI)) * NA) % NA;
    if (y < edgeY[a]) { edgeY[a] = y; edgeR[a] = Math.hypot(x, z - zc); }
  }
  const SPAN = 2.25; // radians each side of the back: the hair frames the face but does not cover it
  const cols = 72;
  const verts = [], cols3 = [], idx = [];
  const radii = [];
  for (let j = 0; j <= cols; j++) {
    const th = -SPAN + (2 * SPAN * j) / cols;
    const a = Math.floor(((th + Math.PI) / (2 * Math.PI)) * NA) % NA;
    const y0 = edgeY[a] < 9 ? edgeY[a] + 0.012 : 1.5;
    const r0 = edgeR[a] || 0.085;
    const side = smooth01((Math.abs(th) - 0.9) / 1.2); // 0 at the back, 1 at the sides by the face
    const yEnd = 1.31 + 0.1 * side + 0.012 * Math.sin(th * 7) + 0.006 * Math.sin(th * 13 + 1);
    const col = [];
    for (let k = 0; k <= NV; k++) {
      const v = k / NV;
      const y = y0 + (yEnd - y0) * v;
      let r = r0 + 0.004 + 0.02 * v ** 1.3;
      r = Math.max(r, skinReach(th, y) + 0.008);
      col.push([th, y, r, v]);
    }
    radii.push(col);
  }
  // smooth the radii across neighbouring columns so the drape has no jagged steps
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 1; j < cols; j++) for (let k = 0; k <= NV; k++) {
      radii[j][k][2] = (radii[j - 1][k][2] + 2 * radii[j][k][2] + radii[j + 1][k][2]) / 4;
    }
  }
  radii.forEach((col) => col.forEach(([th, y, r, v]) => {
    verts.push(Math.sin(th) * r, y, zc - Math.cos(th) * r);
    const k = streak(th) * (0.95 + 0.12 * v); // tips a little lighter
    cols3.push(HAIR.r * k, HAIR.g * k, HAIR.b * k);
  }));
  for (let j = 0; j < cols; j++) for (let k = 0; k < NV; k++) {
    const a = j * (NV + 1) + k, b = (j + 1) * (NV + 1) + k;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols3, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, hairMaterial());
}
/* Nipples and areolae on the skin (both sexes; larger for the woman), placed at the most forward
   point of the chest near where they belong. */
function buildNipples(skin) {
  const pos = skin.geometry.attributes.position, nrm = skin.geometry.attributes.normal;
  const out = [];
  for (const sgn of [-1, 1]) {
    const cx = sgn * (sex === 'female' ? 0.097 : 0.098), cy = sex === 'female' ? 1.19 : 1.235;
    let best = -1, bz = -1;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - cx, dy = pos.getY(i) - cy;
      if (dx * dx + dy * dy < 0.018 * 0.018 && pos.getZ(i) > bz) { bz = pos.getZ(i); best = i; }
    }
    if (best < 0) continue;
    const p = new THREE.Vector3(pos.getX(best), pos.getY(best), pos.getZ(best));
    const n = new THREE.Vector3(nrm.getX(best), nrm.getY(best), nrm.getZ(best)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    const ar = sex === 'female' ? 0.017 : 0.0095;
    const areola = new THREE.Mesh(new THREE.CircleGeometry(ar, 40), new THREE.MeshPhysicalMaterial({ color: sex === 'female' ? '#BF8873' : '#C79482', roughness: 0.55, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
    areola.geometry.applyQuaternion(q); areola.geometry.translate(p.x + n.x * 0.0006, p.y + n.y * 0.0006, p.z + n.z * 0.0006);
    const nr = sex === 'female' ? 0.0048 : 0.003;
    const nipple = new THREE.Mesh(new THREE.SphereGeometry(nr, 20, 14), new THREE.MeshPhysicalMaterial({ color: '#AE7663', roughness: 0.55 }));
    nipple.geometry.scale(1, 1, 0.85); nipple.geometry.applyQuaternion(q);
    nipple.geometry.translate(p.x + n.x * nr * 0.6, p.y + n.y * nr * 0.6, p.z + n.z * nr * 0.6);
    const side = sgn < 0 ? 'Right' : 'Left';
    out.push([`${side} areola`, areola], [`${side} nipple`, nipple]);
  }
  return out;
}
// add or replace made-up skin parts (long hair, nipples) in the skin layer
function setSkinExtras(list) {
  const sys = systems.skin;
  if (!sys?.group) return;
  sys.meshes = sys.meshes.filter((m) => {
    if (!m.userData.extra) return true;
    sys.group.remove(m); m.geometry.dispose(); delete partMesh[m.userData.id]; delete INDEX.parts[m.userData.id];
    return false;
  });
  list.forEach(([name, mesh], k) => {
    const id = `SK${k}`;
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    INDEX.parts[id] = { name, sys: 'skin', drawn: true, b: [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z] };
    mesh.userData.id = id; mesh.userData.sys = 'skin'; mesh.userData.extra = true;
    partMesh[id] = mesh; sys.meshes.push(mesh); sys.group.add(mesh);
  });
  applyLook(sys);
}
/* For the woman, the small patch of skin where the male genitals hang below the crotch is not
   drawn at all (a clip in the skin's shader); the thighs behind it close the view. */
const skinClip = { value: 0 };
function clipSkin(mesh) {
  if (mesh.userData.clipped) return;
  mesh.userData.clipped = true;
  mesh.material.onBeforeCompile = (shader) => {
    shader.uniforms.uFemale = skinClip;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBodyPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBodyPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBodyPos;\nuniform float uFemale;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float vw = 0.028 + 0.022 * clamp((vBodyPos.y - 0.733) / 0.072, 0.0, 1.0) - 0.006;
        if (uFemale > 0.5 && ((abs(vBodyPos.x) < 0.016 && vBodyPos.y > 0.6 && vBodyPos.y < 0.742 - 110.0 * vBodyPos.x * vBodyPos.x && vBodyPos.z > 0.02)
            || (abs(vBodyPos.x) < vw && vBodyPos.y > 0.729 && vBodyPos.y < 0.8 && vBodyPos.z > 0.05))) discard;`);
  };
  mesh.material.needsUpdate = true;
}
/* The woman's groin surface: the front of the thighs at the sides, a soft pubic mound in the middle,
   curving back between the thighs at the crotch, with a subtle crease. The male skin there is
   pulled onto it, blending out into the surrounding skin so there is no seam. */
const GROIN_EDGE = [[0.6, 0.166], [0.78, 0.166], [0.8, 0.173], [0.82, 0.176], [0.84, 0.181]];
const GROIN_MID = [[0.7, 0.04], [0.725, 0.05], [0.735, 0.075], [0.742, 0.103], [0.75, 0.127], [0.76, 0.145], [0.775, 0.16], [0.79, 0.169], [0.805, 0.176], [0.83, 0.183]];
function groinSurface(x, y) {
  const c = Math.cos((Math.PI * Math.min(Math.abs(x), 0.06)) / 0.12) ** 2; // 1 in the middle, 0 at the sides
  return curve(GROIN_EDGE, y) + (curve(GROIN_MID, y) - curve(GROIN_EDGE, y)) * c + vulva(x, y).dz;
}
/* The external female genitalia (vulva), as in a medical atlas, from the front at the top down to
   the underside between the thighs: the labia majora (two rounded outer folds) either side of a
   central cleft, the labia minora inside it, the clitoral hood at its top and the vaginal opening
   lower down. Returns the height change and how much of each tissue colour to use. */
const VULVA_TOP = 0.768, VULVA_BOTTOM = 0.737;
function vulva(x, y) {
  const ax = Math.abs(x);
  // along the vulva: 0 at the bottom (back), 1 at the top (front), with rounded ends
  const along = smooth01((y - VULVA_BOTTOM) / 0.005) * (1 - smooth01((y - (VULVA_TOP - 0.004)) / 0.006));
  const g = (v, c, r) => Math.exp(-(((v - c) / r) ** 2));
  const majora = 0.0034 * g(ax, 0.0078, 0.0052) * along; // the outer folds
  const cleft = 0.0042 * g(x, 0, 0.0026) * along; // the groove between them
  const minora = 0.0017 * g(ax, 0.0024, 0.0013) * along; // the inner folds, inside the groove
  const hood = 0.0024 * g(x, 0, 0.0042) * g(y, VULVA_TOP - 0.003, 0.0045); // clitoral hood at the top
  const opening = g(x, 0, 0.0028) * g(y, 0.7445, 0.0035); // vaginal opening, lower down
  return {
    dz: majora - cleft + minora + hood - 0.0022 * opening,
    inner: Math.min(1, g(x, 0, 0.0042) * along * 1.15 + 0.5 * hood / 0.0024), // pinker tissue inside the folds
    opening,
  };
}
/* A drawn surface over the groin: solid in the middle (where the male skin is hidden), its edge
   overlapping the surrounding skin, following it point by point and fading out, so no seam shows. */
// half-width of the woman's groin area at each height: a V along the creases where the thighs meet the body
const vShape = (y) => 0.028 + 0.022 * Math.min(1, Math.max(0, (y - 0.733) / 0.072));
function buildFemaleGroin(skin) {
  const pos = skin.geometry.attributes.position;
  const NX = 41, NY = 37, X0 = -0.068, X1 = 0.068, Y0 = 0.726, Y1 = 0.826; // coarse grid for sampling the skin
  const FX = 137, FY = 101; // fine grid (about 1 mm) for the drawn surface
  // the skin's front surface at each grid point (front-facing points only; the mesh is coarse here)
  const sample = new Float32Array(NX * NY).fill(NaN);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const x = X0 + (X1 - X0) * i / (NX - 1), y = Y0 + (Y1 - Y0) * j / (NY - 1);
    let wsum = 0, zsum = 0;
    for (let k = 0; k < pos.count; k++) {
      const dx = pos.getX(k) - x, dy = pos.getY(k) - y, vz = pos.getZ(k);
      if (vz < 0.08 || Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) continue;
      const vy = pos.getY(k);
      if (Math.abs(pos.getX(k)) < vShape(vy) - 0.006 && vy > 0.729 && vy < 0.8) continue; // hidden male area
      const wk = 1 / (dx * dx + dy * dy + 1e-5);
      wsum += wk; zsum += wk * vz;
    }
    if (wsum) sample[j * NX + i] = zsum / wsum;
  }
  // the skin's height anywhere in the area, from the coarse samples
  const skinAt = (x, y) => {
    const fi = ((x - X0) / (X1 - X0)) * (NX - 1), fj = ((y - Y0) / (Y1 - Y0)) * (NY - 1);
    const i0 = Math.min(NX - 2, Math.max(0, Math.floor(fi))), j0 = Math.min(NY - 2, Math.max(0, Math.floor(fj)));
    const tx = fi - i0, ty = fj - j0;
    const at = (i, j) => { const v = sample[j * NX + i]; return Number.isNaN(v) ? groinSurface(X0 + (X1 - X0) * i / (NX - 1), Y0 + (Y1 - Y0) * j / (NY - 1)) : v; };
    return (at(i0, j0) * (1 - tx) + at(i0 + 1, j0) * tx) * (1 - ty) + (at(i0, j0 + 1) * (1 - tx) + at(i0 + 1, j0 + 1) * tx) * ty;
  };
  const verts = [], cols = [], idx = [];
  const base = skin.material.color;
  const pink = new THREE.Color('#D3998D'), deep = new THREE.Color('#B07870'), c = new THREE.Color();
  for (let j = 0; j < FY; j++) {
    const y = Y0 + (Y1 - Y0) * j / (FY - 1);
    for (let i = 0; i < FX; i++) {
      const x = X0 + (X1 - X0) * i / (FX - 1), ax = Math.abs(x);
      // how much the designed shape takes over from the real skin: 1 in the middle, 0 at the edge
      const vw = vShape(y);
      const inner = (1 - smooth01((ax - (vw - 0.006)) / 0.016)) * (1 - smooth01((y - 0.8) / 0.016)) * smooth01((y - Y0) / 0.006);
      const skinZ = skinAt(x, y);
      // sits a little above the skin underneath (more in the middle), so none of it shows through
      const z = skinZ + (groinSurface(x, y) - skinZ) * inner + 0.0015 + 0.002 * inner;
      verts.push(x, y, z);
      // colour: skin, pinker inside the folds, darker at the vaginal opening
      const v = vulva(x, y);
      c.copy(base).lerp(pink, 0.75 * v.inner * inner).lerp(deep, 0.6 * Math.min(1, v.opening) * inner);
      // fade the edge out over the surrounding skin
      const alpha = (1 - smooth01((ax - vw) / 0.016)) * (1 - smooth01((y - 0.806) / 0.012));
      cols.push(c.r, c.g, c.b, alpha);
    }
  }
  for (let j = 0; j < FY - 1; j++) for (let i = 0; i < FX - 1; i++) {
    const a = j * FX + i, b = a + FX;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = skin.material;
  const mat = new THREE.MeshPhysicalMaterial({
    color: '#ffffff', vertexColors: true, transparent: true, depthWrite: true, roughness: m.roughness,
    sheen: m.sheen, sheenColor: m.sheenColor.clone(), sheenRoughness: m.sheenRoughness, side: THREE.DoubleSide,
    envMapIntensity: 0.8, polygonOffset: true, polygonOffsetFactor: -1,
  });
  mat.userData.seeThrough = 1; // keeps its own fading edge when the skin's look changes
  mat.userData.keepDepth = true; // records its depth (so soft shadows follow its smooth shape) unless see-through
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 3;
  return mesh;
}
function shapeSkin() {
  const byName = (n) => Object.values(partMesh).find((m) => INDEX.parts[m.userData.id]?.name === n);
  const skinMesh = byName('Skin');
  if (skinMesh) clipSkin(skinMesh);
  skinClip.value = sex === 'female' ? 1 : 0;
  for (const name of ['Skin', 'Eyebrow', 'Hair of head', 'Pubic hair']) {
    const mesh = byName(name);
    if (!mesh) continue;
    const pos = mesh.geometry.attributes.position;
    if (!mesh.userData.orig) mesh.userData.orig = pos.array.slice();
    const o = mesh.userData.orig, a = pos.array;
    a.set(o);
    if (sex === 'female') {
      for (let i = 0; i < a.length; i += 3) {
        let x = o[i], y = o[i + 1], z = o[i + 2];
        if (name === 'Skin') {
          if (z > 0.12) { // front of the chest: breasts
            for (const sgn of [-1, 1]) {
              const w = breastLift(x - sgn * 0.095, y - 1.205);
              if (w > 0) { z += 0.056 * w; x += sgn * 0.006 * w; y -= 0.012 * w; }
            }
          }
          const ax = Math.abs(x);
          if (ax < 0.05 && y > 0.6 && y < 0.8 && z > 0.03) { // groin: flatten the male genitals (covered by the drawn groin)
            const w = (1 - smooth01((ax - 0.032) / 0.016)) * (1 - smooth01((y - 0.78) / 0.02));
            const zs = groinZ(y);
            if (z > zs) z = z + (zs - z) * w;
            if (y < 0.73) x *= 1 - 0.45 * w;
          }
        }
        if (name === 'Eyebrow') [x, y, z] = femaleBrow(x, y, z);
        // proportions are taken from the original height so nothing drifts
        const [nx, ny, nz] = femaleShape(x, o[i + 1], z);
        a[i] = nx; a[i + 1] = y + (ny - o[i + 1]); a[i + 2] = nz;
      }
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
  }
  // natural-looking hair: streaked colour on the cap, and long hair for the woman; nipples for both
  const cap = byName('Hair of head');
  if (cap && !cap.userData.streaked) {
    cap.userData.streaked = true;
    hairColours(cap.geometry);
    cap.material = hairMaterial();
  }
  if (skinMesh) {
    const extras = buildNipples(skinMesh);
    if (sex === 'female' && cap) extras.unshift(['Long hair', buildLongHair(cap, skinMesh)]);
    if (sex === 'female') extras.push(['Vulva', buildFemaleGroin(skinMesh)]);
    setSkinExtras(extras);
  }
  redraw();
}
function setSex(next) {
  if (next !== 'male' && next !== 'female') return;
  sex = next;
  try { localStorage.setItem('dr-pocket:sex', sex); } catch { /* private mode */ }
  document.querySelectorAll('#sex button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.sex === sex));
  if (selected && [...selected.ids].some((id) => !sexOk(id))) select(null);
  Object.values(systems).forEach((s) => s.group && applyLook(s));
  shapeSkin();
}

/* ---------- one-tap views ---------- */
async function setView(key) {
  const v = VIEWS[key];
  if (!v) return;
  currentView = key;
  document.querySelectorAll('#views-layers button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === key));
  select(null);
  hiddenParts.clear();
  Object.values(systems).forEach((s) => { s.ghost = v.ghost.includes(s.key); });
  await Promise.all(Object.values(systems).map((s) => setOn(s, v.on.includes(s.key))));
  renderSystems();
}

/* ---------- reset ---------- */
async function reset() {
  hiddenParts.clear();
  select(null);
  goRegion(REGIONS[0]);
  await setView('muscles');
}
$('reset').onclick = reset;

/* ---------- start ---------- */
async function start() {
  try {
    [INDEX, GROUPS] = await Promise.all(['/models/index.json', '/models/groups.json'].map((u) => fetch(`${u}?v=${__MODELS_VERSION__}`).then((r) => r.json())));
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
  // man / woman switch and the one-tap views
  document.querySelectorAll('#sex button').forEach((b) => {
    b.setAttribute('aria-pressed', b.dataset.sex === sex);
    b.onclick = () => setSex(b.dataset.sex);
  });
  const lv = $('views-layers');
  Object.entries(VIEWS).forEach(([k, v]) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.v = k;
    b.textContent = v.label;
    b.setAttribute('aria-pressed', k === currentView);
    b.onclick = () => setView(k);
    lv.appendChild(b);
  });

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
  // far enough back to see the whole area (the whole shoulder, the whole knee), with the spot in it
  const close = distance ?? THREE.MathUtils.clamp(m.size * 2.8, 0.42, 1.0) / closeness;
  const aim = m.point.clone().add(new THREE.Vector3(0, -close * 0.07, 0)); // spot sits a little above the subtitles
  if (reduceMotion) {
    camera.position.copy(aim).addScaledVector(dir, close); controls.target.copy(aim);
    controls.update(); if (fade) setFocusFade(1); cine = null; redraw(); return;
  }
  fly = null;
  cine = {
    aim, dir, close, wide: Math.max(close * 2.0, 1.1), wideShot, fade, orbit: THREE.MathUtils.degToRad(orbitDeg),
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

/* ---------- drawing a missing structure on the fly ----------
   When a report names something the model still lacks, the explainer describes it as a shape
   between two parts that are in the model, and it is drawn here: a band or cord from one to the
   other, or a pad where they meet. It joins the "Drawn by Dr Pocket" layer. */
let drawnCount = 0;
function nearestTo(points, target) {
  let best = null, bd = Infinity;
  for (const a of points) {
    const d = (a[0] - target.x) ** 2 + (a[1] - target.y) ** 2 + (a[2] - target.z) ** 2;
    if (d < bd) { bd = d; best = a; }
  }
  return new THREE.Vector3(best[0], best[1], best[2]);
}
function centreOf(points) {
  const c = new THREE.Vector3();
  points.forEach((a) => c.add(_v.set(a[0], a[1], a[2])));
  return c.multiplyScalar(1 / points.length);
}
async function drawStandIn({ shape, fromIds, toIds, name, color = '#1FA88A' }) {
  const sys = systems.added;
  if (sys && !sys.on) await setOn(sys, true);
  const need = new Set([...fromIds, ...toIds].map((id) => INDEX.parts[id]?.sys).filter(Boolean));
  await Promise.all([...need].map((k) => (systems[k].group ? null : loadSystem(systems[k]))));
  const A = vertsOf(fromIds, 4000), B = toIds.length ? vertsOf(toIds, 4000) : [];
  if (!A.length) return null;
  let geo;
  if (shape === 'pad' && B.length) {
    const m = markerFor(fromIds, toIds);
    const r = THREE.MathUtils.clamp(m.size * 0.08, 0.004, 0.015);
    geo = new THREE.SphereGeometry(r, 24, 16);
    geo.scale(1, 0.45, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), m.normal.clone().normalize());
    geo.applyQuaternion(q);
    geo.translate(m.point.x, m.point.y, m.point.z);
  } else {
    // band or cord from the side of one part facing the other, to the side of the other facing the first
    const a = nearestTo(A, B.length ? centreOf(B) : centreOf(A));
    const b = B.length ? nearestTo(B, centreOf(A)) : a.clone().add(new THREE.Vector3(0, -0.03, 0));
    const mid = a.clone().lerp(b, 0.5);
    const bow = new THREE.Vector3(mid.x, 0, mid.z - 0.08).normalize().multiplyScalar(a.distanceTo(b) * 0.12);
    const curve = new THREE.CatmullRomCurve3([a, mid.add(bow), b]);
    const r = shape === 'band' ? 0.004 : 0.003;
    geo = new THREE.TubeGeometry(curve, 24, r, 12, false);
    if (shape === 'band') geo.scale(1, 1, 1); // kept round but wider; reads as a ligament or tendon
  }
  const id = `RT${drawnCount++}`;
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  INDEX.parts[id] = { name, sys: 'added', drawn: true, color, b: [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z] };
  const mesh = new THREE.Mesh(geo, makeMaterial('added', id));
  mesh.userData.id = id;
  mesh.userData.sys = 'added';
  partMesh[id] = mesh;
  if (sys) { sys.meshes.push(mesh); sys.group.add(mesh); applyLook(sys); }
  return id;
}

/* ---------- report explainer hooks ---------- */
initReport(window.__hooks = { // also exposed for testing in the browser console
  markerFor, lookAtPoint, toScreen, cinematic, stopCine, drawStandIn,
  isDrawn: (id) => !!INDEX?.parts[id]?.drawn,
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
  // a report about female (or male) organs switches the body to match
  matchSex: (ids) => {
    const need = ids.map((id) => INDEX?.parts[id]?.sex).find(Boolean);
    if (need && need !== sex) setSex(need);
  },
  clear: () => reset(),
});
