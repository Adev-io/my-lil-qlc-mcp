// 3D monitor renderer. Reads /fixtures.json, streams DMX over SSE (/stream), draws the
// rig live with Three.js. Standalone — no rig, no Blender. Colourblind-aware: every
// fixture carries a text label and a fixed stage position; colour is supplementary.
//
// COORDINATES. Builder convention (matches build-show.ts): +X audience-right, +Y upstage,
// +Z up, origin = front-centre of stage at floor. Three.js uses Y-up, camera looks down -Z
// from the audience, so we map:  three = (x, z, -y)  and back  builder = (x, -z, y).
//
// HEAD BEAMS. pan/tilt DMX -> direction, using the same convention aim() encodes in
// build-show.ts: pan 128 = straight upstage, +pan -> audience-right (540 deg over 0-255);
// tilt 128 = 37.5 deg below horizontal, +tilt = steeper down (270 deg over 0-255). Verified
// to reproduce the show's documented aims (e.g. Crowd Near = pan 185 / tilt 108).

import * as THREE from "three";
import { OrbitControls } from "/vendor/OrbitControls.js";
import { beamDirBuilder, HEAD_DEFAULTS } from "/aim.js";

const NEG_Y = new THREE.Vector3(0, -1, 0);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round = (n) => Math.round(n * 100) / 100;
const toThree = ([x, y, z]) => new THREE.Vector3(x, z, -y);
const toBuilder = (v) => [round(v.x), round(-v.z), round(v.y)];

// ---- scene -----------------------------------------------------------------
const mount = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
mount.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07080c);
scene.fog = new THREE.FogExp2(0x07080c, 0.012);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 500);
const HOME_POS = new THREE.Vector3(0, 15, 31);
const HOME_TARGET = new THREE.Vector3(0, 6, -3);
camera.position.copy(HOME_POS);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.copy(HOME_TARGET);

scene.add(new THREE.HemisphereLight(0x404a66, 0x0a0c12, 0.9));
scene.add(new THREE.AmbientLight(0x101522, 0.6));

function buildStage(stage) {
  const { width: W, depth: D, deck } = stage;
  const grid = new THREE.GridHelper(64, 64, 0x2a3350, 0x161a26);
  scene.add(grid);

  const deckMesh = new THREE.Mesh(
    new THREE.BoxGeometry(W, deck, D),
    new THREE.MeshStandardMaterial({ color: 0x0e1018, roughness: 0.95 })
  );
  // stage spans builder x[-W/2,W/2], y[0,D], z[0,deck] -> three centre (0, deck/2, -D/2)
  deckMesh.position.set(0, deck / 2, -D / 2);
  scene.add(deckMesh);
}

// ---- colour helpers --------------------------------------------------------
// Blend a Rainbow par's six emitters (R,G,B,W,A,UV) into an approximate RGB.
function parColor(r, g, b, w, a, uv) {
  const cr = r + w + a + uv * 0.45;
  const cg = g + w + a * 0.6;
  const cb = b + w + uv * 0.6;
  return [clamp(cr, 0, 255), clamp(cg, 0, 255), clamp(cb, 0, 255)];
}

// 375Z colour wheel slots actually used by the show (HEAD_COLOR table in build-show.ts):
// white 0, orange 8, lime 16, cyan 24, red 36, green 44, magenta 50, yellow 60.
function headColor(v) {
  if (v < 8) return [255, 255, 255];
  if (v < 16) return [255, 120, 0];
  if (v < 24) return [170, 255, 0];
  if (v < 36) return [0, 200, 255];
  if (v < 44) return [255, 30, 30];
  if (v < 50) return [0, 220, 60];
  if (v < 60) return [255, 0, 200];
  return [255, 220, 0];
}

// pan/tilt DMX -> beam direction. Math lives in the shared, tested aim.js (builder coords);
// here we just rotate it into Three.js axes: three = (x, z, -y).
let headCfg = { ...HEAD_DEFAULTS };
function beamDir(pan, tilt) {
  const [bx, by, bz] = beamDirBuilder(pan, tilt, headCfg);
  return new THREE.Vector3(bx, bz, -by); // already unit length
}

// ---- labels (colourblind-friendly fixture IDs) -----------------------------
function makeLabel(text) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "rgba(8,10,16,0.72)";
  ctx.fillRect(0, 14, 256, 36);
  ctx.font = "bold 28px ui-monospace, Consolas, monospace";
  ctx.fillStyle = "#eef";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
  );
  spr.scale.set(3.2, 0.8, 1);
  spr.position.set(0, 1.5, 0);
  spr.renderOrder = 10;
  return spr;
}

function beamMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
// Cone aimed along -Y locally (apex at origin), so setFromUnitVectors(NEG_Y, dir) aims it.
function makeBeam(radius, length) {
  const geo = new THREE.ConeGeometry(radius, length, 28, 1, true);
  geo.translate(0, -length / 2, 0);
  const mesh = new THREE.Mesh(geo, beamMaterial());
  mesh.visible = false;
  return mesh;
}

const litMat = () => new THREE.MeshBasicMaterial({ color: 0x000000 });
const bodyMat = () => new THREE.MeshStandardMaterial({ color: 0x161922, roughness: 0.7, metalness: 0.3 });

// ---- build fixtures --------------------------------------------------------
const fixtureObjs = [];
const pickTargets = [];

function buildFixtures(data) {
  for (const def of data.fixtures) {
    const group = new THREE.Group();
    group.position.copy(toThree(def.pos));
    scene.add(group);

    const fx = { def, group, roles: def.roles, kind: def.kind };

    if (def.kind === "par") {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.6, 16), bodyMat());
      const lit = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), litMat());
      const beam = makeBeam(2.4, 8);
      beam.quaternion.setFromUnitVectors(NEG_Y, toThree(def.point || [0, 0, 1]).normalize());
      group.add(body, lit, beam);
      fx.lit = lit;
      fx.beam = beam;
      body.userData = { group, fx };
      pickTargets.push(body);
    } else if (def.kind === "bar") {
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.3, 0.3), bodyMat());
      const cells = [];
      for (let i = 0; i < 3; i++) {
        // cells are LARGER than the body's cross-section so the lit colour always shows
        // (a smaller cell tucked inside the dark body gets occluded — bars looked unlit).
        const cell = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.52, 0.52), litMat());
        cell.position.x = (i - 1) * 0.9;
        cell.userData = { group, fx };
        group.add(cell);
        cells.push(cell);
        pickTargets.push(cell);
      }
      const beam = makeBeam(1.3, 11);
      beam.quaternion.setFromUnitVectors(NEG_Y, toThree(def.point || [0, 0, 1]).normalize());
      group.add(body, beam);
      fx.cells = cells;
      fx.beam = beam;
    } else {
      // head
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 1.1, 18), bodyMat());
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.4, 18), litMat());
      lens.position.set(0, -0.2, 0.0);
      lens.rotation.x = -Math.PI / 2;
      const beam = makeBeam(1.7, 16);
      group.add(body, lens, beam);
      fx.lit = lens;
      fx.beam = beam;
      body.userData = { group, fx };
      pickTargets.push(body);
    }

    group.add(makeLabel(def.name));
    fixtureObjs.push(fx);
  }
}

function setLit(mesh, rgb, k) {
  mesh.material.color.setRGB((rgb[0] / 255) * k, (rgb[1] / 255) * k, (rgb[2] / 255) * k);
}
function setBeam(mesh, rgb, opacity) {
  const o = clamp(opacity, 0, 0.85);
  mesh.material.color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
  mesh.material.opacity = o;
  mesh.visible = o > 0.02;
}

// ---- per-frame DMX -> visuals ----------------------------------------------
function applyFrame(dmx) {
  for (const fx of fixtureObjs) {
    const a = fx.def.address;
    const r = fx.roles;
    if (fx.kind === "par") {
      const dim = dmx[a + r.dim] / 255;
      const col = parColor(
        dmx[a + r.r], dmx[a + r.g], dmx[a + r.b], dmx[a + r.w], dmx[a + r.a], dmx[a + r.uv]
      );
      setLit(fx.lit, col, dim);
      setBeam(fx.beam, col, dim * 0.5);
    } else if (fx.kind === "bar") {
      const dim = dmx[a + r.dim] / 255;
      let sr = 0, sg = 0, sb = 0;
      fx.cells.forEach((cell, i) => {
        const [rc, gc, bc] = r.cells[i];
        const col = [dmx[a + rc], dmx[a + gc], dmx[a + bc]];
        setLit(cell, col, dim);
        sr += col[0]; sg += col[1]; sb += col[2];
      });
      setBeam(fx.beam, [sr / 3, sg / 3, sb / 3], dim * 0.55);
    } else {
      const dim = dmx[a + r.dim] / 255;
      const open = dmx[a + r.shutter] >= (data?.meta?.shutterOpenMin ?? 216);
      const col = headColor(dmx[a + r.color]);
      const dir = beamDir(dmx[a + r.pan], dmx[a + r.tilt]);
      fx.beam.quaternion.setFromUnitVectors(NEG_Y, dir);
      const on = open ? dim : 0;
      setLit(fx.lit, col, on);
      setBeam(fx.beam, col, on * 0.85);
    }
  }
}

// ---- DMX stream (SSE) ------------------------------------------------------
let latest = new Uint8Array(512);
let haveFrame = false;
let lastChangeAt = 0;
let es = null;

function connect() {
  es = new EventSource("/stream");
  es.onmessage = (e) => {
    const bin = atob(e.data);
    for (let i = 0; i < 512; i++) latest[i] = i < bin.length ? bin.charCodeAt(i) : 0;
    haveFrame = true;
    lastChangeAt = performance.now();
  };
  // EventSource auto-reconnects on error; nothing to do but reflect state in the HUD.
}

// ---- HUD -------------------------------------------------------------------
const el = (id) => document.getElementById(id);
function updateHud() {
  const dot = el("statusDot");
  const txt = el("statusText");
  const open = es && es.readyState === 1;
  dot.className = "dot " + (open ? "live" : es && es.readyState === 0 ? "stale" : "down");
  txt.textContent = open ? "connected" : es && es.readyState === 0 ? "connecting…" : "disconnected";
  if (!haveFrame) {
    el("age").textContent = "no DMX yet";
  } else {
    const s = (performance.now() - lastChangeAt) / 1000;
    el("age").textContent = s < 1 ? "just now" : `${s.toFixed(0)}s ago`;
  }
}

// ---- drag to reposition ----------------------------------------------------
let dragMode = false;
let dragging = null;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane();

function setPointer(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}
el("dragBtn").onclick = () => {
  dragMode = !dragMode;
  controls.enabled = !dragMode; // orbit pauses while placing fixtures
  el("dragBtn").textContent = `Move fixtures: ${dragMode ? "ON" : "OFF"}`;
};
renderer.domElement.addEventListener("pointerdown", (e) => {
  if (!dragMode) return;
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickTargets, false);
  if (hits.length) {
    dragging = hits[0].object.userData;
    dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), dragging.group.position);
  }
});
renderer.domElement.addEventListener("pointermove", (e) => {
  if (!dragMode || !dragging) return;
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const pt = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(dragPlane, pt)) {
    dragging.group.position.x = pt.x;
    dragging.group.position.z = pt.z;
  }
});
addEventListener("pointerup", () => (dragging = null));

el("saveBtn").onclick = async () => {
  const layout = {};
  for (const fx of fixtureObjs) layout[fx.def.id] = toBuilder(fx.group.position);
  try {
    const res = await fetch("/layout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(layout),
    });
    el("saved").textContent = res.ok ? "layout saved ✓" : "save failed";
  } catch {
    el("saved").textContent = "save failed";
  }
  setTimeout(() => (el("saved").textContent = ""), 2500);
};
el("resetBtn").onclick = () => {
  camera.position.copy(HOME_POS);
  controls.target.copy(HOME_TARGET);
  controls.update();
};

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- boot ------------------------------------------------------------------
let data = null;
function loop() {
  requestAnimationFrame(loop);
  controls.update();
  if (haveFrame) applyFrame(latest);
  updateHud();
  renderer.render(scene, camera);
}

fetch("/fixtures.json")
  .then((r) => r.json())
  .then((d) => {
    data = d;
    if (d.meta?.head) headCfg = { ...headCfg, ...d.meta.head };
    buildStage(d.meta.stage);
    buildFixtures(d);
    el("fxCount").textContent = `${d.fixtures.length} (U${d.meta.universe})`;
    connect();
    loop();
  })
  .catch((err) => {
    el("statusText").textContent = "fixtures.json failed";
    console.error(err);
  });
