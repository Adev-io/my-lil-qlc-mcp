/* Build a routing-test-only QLC+ workspace for the Cuepix rig. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseQxwFile } from "../src/qlc/qxwParser.js";
import { loadRig } from "./rig.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.QLC_BUILD_OUT ? path.resolve(process.env.QLC_BUILD_OUT) : REPO;
const { rig, rigPath } = loadRig(process.argv[2] ?? "rigs/cuepix-panel.rig.json");
mkdirSync(OUT, { recursive: true });

type Kind = "panel" | "head" | "par" | "bar";
type Fixture = {
  id: number;
  name: string;
  manufacturer: string;
  model: string;
  mode: string;
  universe: number;
  address: number;
  channels: number;
  kind: Kind;
};
type FixtureValue = { id: number; pairs: number[] };
type Scene = { id: number; type: "Scene"; name: string; values: FixtureValue[]; fadeIn: number; fadeOut: number };
type Chaser = { id: number; type: "Chaser"; name: string; steps: number[]; fade: number; hold: number; runOrder: "Loop" | "SingleShot" };
type FunctionDef = Scene | Chaser;

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const CRC_TBL = [
  0x0000, 0x1081, 0x2102, 0x3183, 0x4204, 0x5285, 0x6306, 0x7387,
  0x8408, 0x9489, 0xa50a, 0xb58b, 0xc60c, 0xd68d, 0xe70e, 0xf78f,
];
function crc16(value: string): number {
  let crc = 0xffff;
  for (const byte of Buffer.from(value, "utf8")) {
    let current = byte;
    crc = ((crc >> 4) & 0x0fff) ^ CRC_TBL[(crc ^ current) & 15];
    current >>= 4;
    crc = ((crc >> 4) & 0x0fff) ^ CRC_TBL[(crc ^ current) & 15];
  }
  return ~crc & 0xffff;
}
if (crc16("123456789") !== 0x906e) throw new Error("CRC-16/X-25 self-check failed");

function oscPath(name: string): string {
  return `/${name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/ /g, "_")}`;
}
function argb(r: number, g: number, b: number): number {
  return ((0xff << 24) | (r << 16) | (g << 8) | b) >>> 0;
}
function dimOf(value: number): number {
  return value <= 0 ? 0 : value === 6 ? 2 : value + 4;
}

const fixtures: Fixture[] = [];
const kindCounts = new Map<Kind, number>();
for (const group of rig.fixtures) {
  const start = kindCounts.get(group.kind) ?? 0;
  for (let i = 0; i < group.count; i++) {
    const suffix = group.kind === "head" && group.count === 2 ? (i === 0 ? "L" : "R") : String(start + i + 1);
    fixtures.push({
      id: fixtures.length,
      name: `${group.namePrefix ?? group.kind} ${suffix}`,
      manufacturer: group.manufacturer,
      model: group.model,
      mode: group.mode,
      universe: group.universe,
      address: group.addresses[i],
      channels: group.channels,
      kind: group.kind,
    });
  }
  kindCounts.set(group.kind, start + group.count);
}

const panels = fixtures.filter((fixture) => fixture.kind === "panel");
const heads = fixtures.filter((fixture) => fixture.kind === "head");
const panelPairs = (rgb: [number, number, number]): number[] => {
  const pairs: number[] = [];
  for (let module = 0; module < 25; module++) {
    pairs.push(module * 3, rgb[0], module * 3 + 1, rgb[1], module * 3 + 2, rgb[2]);
  }
  pairs.push(75, 0, 76, rgb.some(Boolean) ? 255 : 0, 77, 0, 78, 101);
  return pairs;
};
type RGB = [number, number, number];
const solidPixels = (rgb: RGB): RGB[] => Array.from({ length: 25 }, () => rgb);
const rgbPairs = (pixels: RGB[]): number[] => {
  const pairs: number[] = [];
  pixels.forEach((rgb, pixel) => pairs.push(pixel * 3, rgb[0], pixel * 3 + 1, rgb[1], pixel * 3 + 2, rgb[2]));
  pairs.push(75, 0, 78, 101);
  return pairs;
};
const panelValues = (pixels: RGB[]): FixtureValue[] => panels.map((panel) => ({ id: panel.id, pairs: rgbPairs(pixels) }));
const selectedPanelValues = (indexes: number[], rgb: RGB = [255, 255, 255]): FixtureValue[] =>
  indexes.map((index) => ({ id: panels[index].id, pairs: rgbPairs(solidPixels(rgb)) }));
const levelValues = (value: number): FixtureValue[] => panels.map((panel) => ({ id: panel.id, pairs: [76, value] }));
const strobeValues = (value: number): FixtureValue[] => panels.map((panel) => ({ id: panel.id, pairs: [77, value] }));
const selectedStrobeValues = (indexes: number[], value = 95): FixtureValue[] =>
  indexes.map((index) => ({ id: panels[index].id, pairs: [77, value] }));
// Two head models. Channels differ, so every head value goes through its own builder:
//   375ZX 15ch: 0 pan 2 tilt 4 speed 5 colour 6 gobo 7 rot 8 prism 9 focus 10 dim 11 shutter 13 macro 14 zoom
//   140SR 14ch: 0 pan 2 tilt 4 speed 5 colour 6 gobo 7 prism 8 focus 9 dim 10 shutter 11 frost 12 fn 13 macro
type HeadState = { on?: boolean; pan?: number; tilt?: number; color?: number; dim?: number; shutter?: number };
const isBeam = (fixture: Fixture): boolean => /140SR/i.test(fixture.model);
const headRoles = (fixture: Fixture) => (isBeam(fixture)
  ? { pan: 0, tilt: 2, speed: 4, color: 5, gobo: 6, prism: 7, focus: 8, dim: 9, shutter: 10, macro: 13, zoom: null }
  : { pan: 0, tilt: 2, speed: 4, color: 5, gobo: 6, prism: 8, focus: 9, dim: 10, shutter: 11, macro: 13, zoom: 14 });
// Fence, declared up here because the routing tests below are built before the performance looks and
// must land inside the plotted box too. Keyed by 0-based DMX address; see rig.headSafety.
const SAFETY: Record<string, { panMin: number; panMax: number; tiltMin: number; tiltMax: number }> = (rig as any).headSafety ?? {};
const fenced = (head: Fixture, pan: number, tilt: number): [number, number] => {
  const f = SAFETY[String(head.address)];
  if (!f) return [pan, tilt];
  return [Math.min(f.panMax, Math.max(f.panMin, pan)), Math.min(f.tiltMax, Math.max(f.tiltMin, tilt))];
};
// Full state for the routing tests (every channel written, so a stale value cannot survive).
const headPairs = (fixture: Fixture, s: HeadState): number[] => {
  const r = headRoles(fixture);
  const on = s.on ?? false;
  const pairs: number[] = [];
  for (let ch = 0; ch < fixture.channels; ch++) pairs.push(ch, 0);
  const set = (ch: number | null, v: number) => {
    if (ch === null) return;
    if (ch >= fixture.channels) throw new Error(`${fixture.name}: channel ${ch} outside ${fixture.channels}-ch mode`);
    pairs[ch * 2 + 1] = v;
  };
  // A routing test still has to obey the fence: "centre" means the centre of the plotted box, not
  // DMX 128, which on this rig points a head at a wall.
  const [pan, tilt] = fenced(fixture, s.pan ?? 128, s.tilt ?? 128);
  set(r.pan, pan); set(r.tilt, tilt); set(r.focus, 128); set(r.zoom, 128);
  set(r.color, s.color ?? 0);
  set(r.dim, s.dim ?? (on ? 255 : 0)); set(r.shutter, s.shutter ?? (on ? 255 : 0));
  return pairs;
};
// Partial state for the performance pads: only the channels named, so colour, aim and dim layer.
const headPartial = (fixture: Fixture, s: HeadState): number[] => {
  const r = headRoles(fixture);
  const pairs: number[] = [];
  if (s.pan !== undefined) pairs.push(r.pan, s.pan);
  if (s.tilt !== undefined) pairs.push(r.tilt, s.tilt, r.speed, 0);
  if (s.color !== undefined) pairs.push(r.color, s.color);
  if (s.dim !== undefined) pairs.push(r.dim, s.dim);
  if (s.shutter !== undefined) pairs.push(r.shutter, s.shutter);
  return pairs;
};
const off = (fixture: Fixture): FixtureValue => ({
  id: fixture.id,
  pairs: fixture.kind === "panel" ? panelPairs([0, 0, 0]) : headPairs(fixture, { on: false }),
});

const functions: FunctionDef[] = [];
const routingScenes: Scene[] = [];
function addScene(name: string, values: FixtureValue[], fadeIn = 0, fadeOut = 0): number {
  const id = functions.length;
  functions.push({ id, type: "Scene", name, values, fadeIn, fadeOut });
  return id;
}
function addChaser(name: string, steps: number[], fade: number, hold: number, runOrder: "Loop" | "SingleShot" = "Loop"): number {
  const id = functions.length;
  functions.push({ id, type: "Chaser", name, steps, fade, hold, runOrder });
  return id;
}
function addRoutingScene(name: string, active: Map<number, number[]>): void {
  const scene: Scene = {
    id: functions.length,
    type: "Scene",
    name: `TEST · ${name}`,
    values: fixtures.map((fixture) => ({ id: fixture.id, pairs: active.get(fixture.id) ?? off(fixture).pairs })),
    fadeIn: 0,
    fadeOut: 0,
  };
  functions.push(scene);
  routingScenes.push(scene);
}

const palette: RGB[] = [
  [255, 0, 0], [255, 96, 0], [255, 255, 0], [0, 255, 0],
  [0, 255, 255], [0, 0, 255], [160, 0, 255], [255, 255, 255],
];
const solids: [string, RGB][] = [
  ["Red", palette[0]], ["Amber", palette[1]], ["Yellow", palette[2]], ["Green", palette[3]],
  ["Cyan", palette[4]], ["Blue", palette[5]], ["Purple", palette[6]], ["White", palette[7]],
];
for (const [name, rgb] of solids) addScene(`BASE · ${name}`, panelValues(solidPixels(rgb)));

const addPattern = (name: string, pick: (panel: number, pixel: number) => RGB): void => {
  addScene(`BASE · ${name}`, panels.map((panel, panelIndex) => ({
    id: panel.id,
    pairs: rgbPairs(Array.from({ length: 25 }, (_, pixel) => pick(panelIndex, pixel))),
  })));
};
addPattern("Rainbow", (_panel, pixel) => palette[pixel % 7]);
addPattern("Red Blue", (_panel, pixel) => pixel % 2 ? palette[5] : palette[0]);
addPattern("Green Magenta", (_panel, pixel) => pixel % 2 ? [255, 0, 255] : palette[3]);
addPattern("Checkerboard", (_panel, pixel) => (Math.floor(pixel / 5) + pixel % 5) % 2 ? palette[7] : palette[5]);
addPattern("Bands", (_panel, pixel) => palette[Math.floor(pixel / 5) % 7]);
addPattern("Pixels", (_panel, pixel) => pixel % 3 === 0 ? palette[7] : [0, 0, 0]);
addPattern("Wave", (panel, pixel) => palette[(panel + Math.floor(pixel / 5)) % 7]);
addPattern("Random", (panel, pixel) => palette[(panel * 31 + pixel * 17) % 7]);

for (const [label, value] of [["25%", 64], ["50%", 128], ["75%", 191], ["Full", 255]] as const) {
  addScene(`LEVEL · ${label}`, levelValues(value));
}
for (const [label, value] of [["Slow", 40], ["Medium", 64], ["Fast", 95]] as const) {
  addScene(`FX · Strobe ${label}`, strobeValues(value));
}
addScene("FX · Stop", []);
addScene("FLASH · White", [...panelValues(solidPixels([255, 255, 255])), ...strobeValues(95)]);
addScene("FLASH · Burst", strobeValues(95));

const stepScene = (name: string, indexes: number[], rgb: RGB = [255, 255, 255], fade = 0): number =>
  addScene(`_STEP · ${name}`, selectedPanelValues(indexes, rgb), fade, fade);
const panelOrder = panels.map((_, index) => index);
const half = Math.floor(panels.length / 2);
const centerOut = Array.from({ length: half }, (_, k) => [half - 1 - k, half + k]);
const outsideIn = [...centerOut].reverse();
const trussStep = (rig.cuepix?.trusses ?? [panelOrder.map((i) => i + 1)])
  .filter((group) => group.length)
  .map((group) => group.map((panel) => panel - 1));
const bounce = [...panelOrder, ...panels.slice(1, -1).map((_, index) => panels.length - 2 - index)];
const groupedChaser = (name: string, groups: number[][], fade = 0, hold = 250): void => {
  addChaser(`FX · ${name}`, groups.map((group, index) => stepScene(`${name} ${index + 1}`, group, [255, 255, 255], fade)), fade, hold);
};
groupedChaser("Left to Right", panelOrder.map((index) => [index]));
groupedChaser("Right to Left", [...panelOrder].reverse().map((index) => [index]));
groupedChaser("Center Out", centerOut);
groupedChaser("Outside In", outsideIn);
groupedChaser("Truss Step", trussStep);
groupedChaser("Bounce", bounce.map((index) => [index]));
addChaser("FX · Chase Strobe", panelOrder.map((index, step) =>
  addScene(`_STEP · Chase Strobe ${step + 1}`, selectedStrobeValues([index]))), 0, 90);
addChaser("FX · Wave Strobe", centerOut.map((group, step) =>
  addScene(`_STEP · Wave Strobe ${step + 1}`, selectedStrobeValues(group))), 0, 120);

const snakeSteps = Array.from({ length: 25 }, (_, pixel) => addScene(`_STEP · Snake ${pixel + 1}`, panels.map((panel) => ({
  id: panel.id,
  pairs: [pixel * 3, 255, pixel * 3 + 1, 255, pixel * 3 + 2, 255],
}))));
addChaser("FX · Snake", snakeSteps, 0, 120);
const rainbowSteps = palette.slice(0, 7).map((_rgb, shift) => addScene(`_STEP · Rainbow Chase ${shift + 1}`, panels.map((panel, panelIndex) => ({
  id: panel.id,
  pairs: rgbPairs(solidPixels(palette[(panelIndex + shift) % 7])),
}))));
addChaser("FX · Rainbow Chase", rainbowSteps, 100, 350);

const fadeChaser = (name: string, colors: RGB[], fade = 800, hold = 800): void => {
  const steps = colors.map((rgb, index) => addScene(`_STEP · ${name} ${index + 1}`, panelValues(solidPixels(rgb)), fade, fade));
  addChaser(`FX · ${name}`, steps, fade, hold);
};
fadeChaser("Color Fade", palette.slice(0, 7));
fadeChaser("White Fade", [[0, 0, 0], [255, 255, 255]], 1000, 600);
const breatheSteps = [32, 96, 160, 255, 160, 96].map((value, index) => addScene(`_STEP · Breathe ${index + 1}`, levelValues(value), 350, 350));
addChaser("FX · Breathe", breatheSteps, 350, 250);
fadeChaser("Crossfade", [[255, 0, 0], [0, 0, 255]], 700, 700);
fadeChaser("Pastel", [[255, 80, 120], [80, 180, 255], [120, 255, 160], [220, 120, 255]], 900, 700);
fadeChaser("Gradient", [[255, 60, 0], [0, 120, 255], [180, 0, 255]], 750, 600);

const colors: [string, RGB][] = [
  ["Red", [255, 0, 0]],
  ["Green", [0, 255, 0]],
  ["Blue", [0, 0, 255]],
  ["White", [255, 255, 255]],
  ["Blackout", [0, 0, 0]],
];
for (const panel of panels) {
  for (const [label, rgb] of colors) addRoutingScene(`${panel.name} ${label}`, new Map([[panel.id, panelPairs(rgb)]]));
}
const outputUniversesOf = (list: Fixture[]): number[] => [...new Set(list.map((fixture) => fixture.universe))].sort((a, b) => a - b);
for (const head of heads) {
  addRoutingScene(`${head.name} Open White`, new Map([[head.id, headPairs(head, { on: true })]]));
  // Movement tests ride the plotted fence, not raw DMX: house-left edge, house-right edge, then up.
  // Three distinct positions inside the box prove the head answers on pan AND tilt without ever
  // sending it somewhere nobody walked.
  const f = SAFETY[String(head.address)];
  const mid = (lo: number, hi: number): number => Math.round((lo + hi) / 2);
  const panMid = f ? mid(f.panMin, f.panMax) : 128, tiltMid = f ? mid(f.tiltMin, f.tiltMax) : 128;
  addRoutingScene(`${head.name} Pan Center`, new Map([[head.id, headPairs(head, { on: true, pan: panMid, tilt: tiltMid })]]));
  addRoutingScene(`${head.name} Pan Edges`, new Map([[head.id, headPairs(head, { on: true, pan: f?.panMin ?? 64, tilt: tiltMid })]]));
  addRoutingScene(`${head.name} Tilt Up`, new Map([[head.id, headPairs(head, { on: true, pan: panMid, tilt: f?.tiltMax ?? 192 })]]));
  addRoutingScene(`${head.name} Blackout`, new Map([[head.id, headPairs(head, { on: false })]]));
}
for (const universe of outputUniversesOf(panels)) {
  addRoutingScene(
    `Universe ${universe} Panels White`,
    new Map(panels.filter((panel) => panel.universe === universe).map((panel) => [panel.id, panelPairs([255, 255, 255])])),
  );
}
addRoutingScene("All Heads Open White", new Map(heads.map((head) => [head.id, headPairs(head, { on: true })])));
addRoutingScene("All Blackout", new Map());

// ---------------------------------------------------------------------------
// HEADS — page 2. Colour pads (solo), one-shot aim pads, dim groups (solo), shutter.
// Aims are SingleShot chasers: a running Toggle scene rewrites pan/tilt every tick and swallows
// the MiniLab knobs (memory: qlc-toggle-scene-beats-level-slider). Positions come from
// rig.movingHeadSettings[<head key>][<name>] once plotted; until then AIM_DEFAULT below, which keeps
// every pre-plot aim at or above horizontal. headSafety (by DMX address) fences every aim.
// ---------------------------------------------------------------------------
const beams = heads.filter(isBeam);
const spots = heads.filter((head) => !isBeam(head));
const HEAD_COLOURS = ["red", "amber", "yellow", "green", "blue", "cyan", "magenta", "white"] as const;
const wheelOf = (head: Fixture, name: string): number => {
  const group = rig.fixtures.find((g) => g.kind === "head" && head.name.startsWith(`${g.namePrefix} `));
  const v = group?.colorWheel?.[name];
  if (v === undefined) throw new Error(`${head.name}: no colorWheel entry for ${name} in the rig`);
  return v;
};
for (const name of HEAD_COLOURS) {
  addScene(`HEAD · ${name[0].toUpperCase() + name.slice(1)}`, heads.map((head) => ({ id: head.id, pairs: headPartial(head, { color: wheelOf(head, name), shutter: 255 }) })));
}
const PMH: Record<string, Record<string, { pan: number; tilt: number } | null>> = (rig as any).movingHeadSettings ?? {};
const headKey = (head: Fixture): string => head.name.replace(/\s+/g, "").replace(/^(\w)/, (c) => c.toLowerCase()); // "Beam L" -> "beamL", "375ZX R" -> "375ZXR"
// Pre-plot defaults. tilt = 128 + (depression° - 37.5) × 255/270, so a HIGHER tilt aims further
// DOWN: 64 ≈ 30° up, 80 ≈ 13° up, 88 ≈ 5° up, 92 ≈ horizontal. Nothing here goes below horizontal,
// so no beam lands in a face before the real aims are plotted. "Crossed" pans the L heads right and
// the R heads left so the beams actually cross over the floor.
const AIM_DEFAULT = (head: Fixture): Record<string, [number, number]> => ({
  home: [128, 64], centre: [128, 80], crowd: [128, 88], crossed: [head.name.endsWith("L") ? 148 : 108, 80],
  // floor = dance-floor centre for FLOOR · Figure 8. Default aims straight ahead, just under the 92
  // fence (~7° up). Plot the real centre day-of via movingHeadSettings[key].floor.
  floor: [128, 82],
});
const aimOf = (head: Fixture, which: string): [number, number] => {
  const m = PMH[headKey(head)]?.[which];
  const [pan, tilt] = m ? [m.pan, m.tilt] : AIM_DEFAULT(head)[which];
  return fenced(head, pan, tilt);
};
const AIMS = ["home", "centre", "crowd", "crossed"] as const;
for (const which of AIMS) {
  const label = which[0].toUpperCase() + which.slice(1);
  const scene = addScene(`_AIM · ${label}`, heads.map((head) => { const [pan, tilt] = aimOf(head, which); return { id: head.id, pairs: headPartial(head, { pan, tilt, shutter: 255 }) }; }), 400, 400);
  addChaser(`HEAD · ${label} Go`, [scene], 400, 400, "SingleShot");
}
addScene("HEAD · Beams Full", beams.map((head) => ({ id: head.id, pairs: headPartial(head, { shutter: 255 }) })));
addScene("HEAD · Spots Full", spots.map((head) => ({ id: head.id, pairs: headPartial(head, { shutter: 255 }) })));
addScene("HEAD · All Full", heads.map((head) => ({ id: head.id, pairs: headPartial(head, { shutter: 255 }) })));
addScene("HEAD · Open", heads.map((head) => ({ id: head.id, pairs: headPartial(head, { shutter: 255 }) })));
addScene("HEAD · Strobe", heads.map((head) => ({ id: head.id, pairs: headPartial(head, { shutter: 90 }) })));
// RESET — one button back to a known state after a panic or a mess: every head home, white, open
// and full, every panel dark. headPairs writes EVERY channel, so a stale gobo or strobe cannot survive.
// PANIC — every channel of every fixture driven to 0. QLC+'s own Blackout button action was tested
// live on 2026-09-19 and did nothing to the Art-Net output, so panic cannot depend on it. A Scene
// started later than a running chaser outranks it on the channels it writes, so this holds the rig
// dark even mid-chase. Press again to release it.
addScene("UTIL · Panic", [...panels.map((panel) => off(panel)), ...heads.map((head) => ({ id: head.id, pairs: headPartial(head, { shutter: 0 }) }))]);
// HOLD lives in the mover solo frame so pressing it stops whatever look is running. It writes only
// the shutters, so the heads freeze exactly where they are instead of snapping to an aim.
addScene("MOVE · Hold", heads.map((head) => ({ id: head.id, pairs: headPartial(head, { shutter: 255 }) })));
const resetSceneId = addScene("_UTIL · Reset", [
  ...heads.map((head) => {
    const [pan, tilt] = aimOf(head, "home");
    return { id: head.id, pairs: headPairs(head, { on: true, pan, tilt, color: wheelOf(head, "white") }) };
  }),
  ...panels.map((panel) => off(panel)),
], 300, 300);
// RESET fires ONCE and lets go. As a latching Toggle it stayed on and held every head at home,
// beating every look pressed after it — found live on 2026-09-19 with the rig frozen at the rest
// position. SingleShot restores the known state and then hands control straight back to the pads.
addChaser("UTIL · Reset", [resetSceneId], 300, 300, "SingleShot");
// The MiniLab faders get their OWN copies of these looks. A Playback slider at 0 stops its function,
// so pointing a fader at a function a pad also fires would let the fader kill the pad's look.
// Leading "_" keeps them off the pads, exactly like _AIM/_STEP.
addScene("_FADER · Panels", levelValues(255));
addScene("_FADER · Beams", beams.map((head) => ({ id: head.id, pairs: headPartial(head, { dim: 255, shutter: 255 }) })));
addScene("_FADER · Spots", spots.map((head) => ({ id: head.id, pairs: headPartial(head, { dim: 255, shutter: 255 }) })));

// FLOOR · Full: whole panel floor lit (pixels white + master dimmer full) in one scene. A panel look,
// so it lives in the panel FX frame on page 1, not with the movers.
addScene("FLOOR · Full", panels.map((panel) => ({ id: panel.id, pairs: [...rgbPairs(solidPixels([255, 255, 255])), 76, 255] })));

// ---------------------------------------------------------------------------
// CEILING — aerial mover looks for the big gym. Movers aim UP (tilt < 92), so these need NO plotting:
// the fence already keeps every beam at/above horizontal, and up is the ceiling. Beams read across
// the room. Colour is left unset so a HEAD colour pad layers on top. Pan spreads are keyed by head
// name in truss-line order (Beam L | 375ZX L | 375ZX R | Beam R). CEIL · Sweep/Circle ride the FX
// Speed dial. All values fenced by headSafety.
// ---------------------------------------------------------------------------
// ROOM COORDINATES. Every mover look below is written in the room, never in raw DMX. u runs -1 at
// the dance floor's house-left edge to +1 at its house-right edge (|u| > 1 throws wider than the
// floor and the fence clamps it); v runs 0 on the deck to 1 at the plotted ceiling limit. Plotted
// live 2026-09-19 into rig.headPlot, which maps u/v to each head's own pan and tilt — so the two
// 375ZX heads, which count up toward house-left, still travel WITH the Beams, which do not.
type Plot = { panLeft: number; panRight: number; tiltFloor: number; tiltRear: number; tiltHigh: number };
const PLOT: Record<string, Plot> = (rig as any).headPlot ?? {};
const panU = (head: Fixture, u: number): number => {
  const p = PLOT[headKey(head)];
  return p ? p.panLeft + ((u + 1) / 2) * (p.panRight - p.panLeft) : 128 + u * 60;
};
const tiltV = (head: Fixture, v: number): number => {
  const p = PLOT[headKey(head)];
  return p ? p.tiltFloor + v * (p.tiltHigh - p.tiltFloor) : 92 - v * 42;
};
const atUV = (head: Fixture, u: number, v: number): [number, number] =>
  fenced(head, Math.round(panU(head, u)), Math.round(tiltV(head, v)));
// LINE is house-left -> house-right, the same order as the MiniLab knobs; k is a head's place in it.
const LINE = ["375ZX L", "Beam L", "Beam R", "375ZX R"];
const lineIdx = (head: Fixture): number => Math.max(0, LINE.indexOf(head.name));
const CEIL_V = 0.85;                  // up by the plotted ceiling limit
const DECK_V = 0.04;                  // just off the deck
const FAN_U = [-1, -0.35, 0.35, 1];   // spread wide across the room
const CROSS_U = [0.8, 0.25, -0.25, -0.8]; // house-left heads throw right and vice versa -> beams cross
const lookScene = (name: string, uv: (k: number) => [number, number]): void => {
  addScene(name, heads.map((head) => {
    const [u, v] = uv(lineIdx(head));
    const [pan, tilt] = atUV(head, u, v);
    return { id: head.id, pairs: headPartial(head, { pan, tilt, shutter: 255 }) };
  }));
};
lookScene("CEIL · Fan", (k) => [FAN_U[k], CEIL_V]);
lookScene("CEIL · Cross", (k) => [CROSS_U[k], CEIL_V]);
// Sweep: all four travel together across the room, eased so they hang at the ends instead of
// snapping round — a triangle ramp reads as a machine, a cosine reads as a hand on a fader.
const SWEEP_STEPS = 24, SWEEP_FADE = 190;
const ceilSweep = Array.from({ length: SWEEP_STEPS }, (_, i) =>
  addScene(`_STEP · Ceil Sweep ${i + 1}`, heads.map((head) => {
    const [pan, tilt] = atUV(head, -Math.cos((2 * Math.PI * i) / SWEEP_STEPS), CEIL_V);
    return { id: head.id, pairs: headPartial(head, { pan, tilt, shutter: 255 }) };
  }), SWEEP_FADE, SWEEP_FADE));
addChaser("CEIL · Sweep", ceilSweep, SWEEP_FADE, 0, "Loop");
// Circle/windmill: four beams a quarter-turn apart on one circle overhead, rotating together.
const CIRC_STEPS = 24, CIRC_FADE = 150;
const ceilCircle = Array.from({ length: CIRC_STEPS }, (_, i) =>
  addScene(`_STEP · Ceil Circle ${i + 1}`, heads.map((head) => {
    const th = (2 * Math.PI * i) / CIRC_STEPS + lineIdx(head) * (Math.PI / 2);
    const [pan, tilt] = atUV(head, 0.8 * Math.cos(th), 0.58 + 0.3 * Math.sin(th));
    return { id: head.id, pairs: headPartial(head, { pan, tilt, shutter: 255 }) };
  }), CIRC_FADE, CIRC_FADE));
addChaser("CEIL · Circle", ceilCircle, CIRC_FADE, 0, "Loop");
// FLOOR sweep: the beams stay on the deck and walk the plotted floor, end to end.
const FSWEEP_STEPS = 24, FSWEEP_FADE = 200;
const floorSweep = Array.from({ length: FSWEEP_STEPS }, (_, i) =>
  addScene(`_STEP · Floor Sweep ${i + 1}`, heads.map((head) => {
    const [pan, tilt] = atUV(head, -Math.cos((2 * Math.PI * i) / FSWEEP_STEPS), DECK_V);
    return { id: head.id, pairs: headPartial(head, { pan, tilt, shutter: 255 }) };
  }), FSWEEP_FADE, FSWEEP_FADE));
addChaser("FLOOR · Sweep", floorSweep, FSWEEP_FADE, 0, "Loop");

// ---------------------------------------------------------------------------
// MOVE — more aerial movement, all up on the ceiling so none of it needs plotting (fence holds
// tilt <= 92). LINE is house-left -> house-right, the same order as the MiniLab knobs; k is a head's
// place in that line, so a phase of k * quarter-turn reads as a wave travelling along the truss.
// Amplitudes are the tuning knobs at plot time. SEQ · Ceiling Looks is a slow position sequence and
// is kept OFF the FX Speed dial (a 250 ms "FAST" would throw the heads around).
// ---------------------------------------------------------------------------
const moveChaser = (name: string, steps: number, fade: number, hold: number,
  at: (k: number, th: number, i: number) => [number, number, number?], stepName = name,
  map: (head: Fixture, u: number, v: number) => [number, number] = atUV): void => {
  const ids = Array.from({ length: steps }, (_, i) => addScene(`_STEP · ${stepName} ${i + 1}`, heads.map((head) => {
    // Third value gates the beam via the SHUTTER, never the dimmer: the dimmer belongs to the
    // operator's fader and nothing in a look is allowed to take a head's brightness away.
    const [u, v, shutter = 255] = at(lineIdx(head), (2 * Math.PI * i) / steps, i);
    const [pan, tilt] = map(head, u, v);
    return { id: head.id, pairs: headPartial(head, { pan, tilt, shutter }) };
  }), fade, fade));
  addChaser(name, ids, fade, hold, "Loop");
};
const Q = Math.PI / 2;
// Wave: every head crosses the room, each a quarter-turn behind its neighbour, so the crest
// travels along the truss line house-left to house-right.
moveChaser("CEIL · Wave", 24, 180, 0, (k, th) => [Math.sin(th - k * Q), CEIL_V]);
// Scissor: left pair and right pair mirror each other — cross through centre, open wide, repeat.
moveChaser("CEIL · Scissor", 24, 180, 0, (k, th) => [(k < 2 ? 1 : -1) * (k === 0 || k === 3 ? 1 : 0.6) * Math.sin(th), CEIL_V]);
// Tilt Wave: fan held, beams nod deck-to-ceiling in a travelling wave.
moveChaser("CEIL · Tilt Wave", 24, 180, 0, (k, th) => [FAN_U[k], 0.52 + 0.46 * Math.sin(th - k * Q)]);
// Ballyhoo: big 2:3 Lissajous, heads offset so the beams never move as a block.
moveChaser("CEIL · Ballyhoo", 48, 140, 0, (k, th) => [1.15 * Math.sin(2 * th + k * Q), 0.55 + 0.4 * Math.sin(3 * th + k * Math.PI / 3)]);
// Fan Chase: fan held, one beam lit at a time bouncing along the line.
const BOUNCE = [0, 1, 2, 3, 2, 1];
moveChaser("CEIL · Fan Chase", BOUNCE.length, 80, 250, (k, _th, i) => [FAN_U[k], CEIL_V, BOUNCE[i] === k ? 255 : 0]);
// Rise & Fall: pan held at the fan, every beam lifts off the deck to the ceiling together and drops
// back. The one look that shows the room's height.
moveChaser("MOVE · Rise Fall", 20, 220, 0, (k, th) => [FAN_U[k], 0.5 - 0.5 * Math.cos(th)]);
// Look sequence: slow walk through static pictures — fan, cross, tight column, floor fan, floor
// cross, and a high/low split. Positions only: colour and dimmer stay under the pads.
const SEQ_LOOKS: Array<(k: number) => [number, number]> = [
  (k) => [FAN_U[k], CEIL_V], (k) => [CROSS_U[k], CEIL_V], () => [0, 0.35],
  (k) => [FAN_U[k], DECK_V], (k) => [CROSS_U[k], 0.12], (k) => [FAN_U[k], k % 2 ? CEIL_V : DECK_V],
];
moveChaser("SEQ · Ceiling Looks", SEQ_LOOKS.length, 2500, 4000, (k, _th, i) => SEQ_LOOKS[i](k), "Seq Look");

// ---------------------------------------------------------------------------
// DANCE FLOOR + ROOM. The 2026-09-19 show had fifteen mover looks and only two of them ever put a
// beam on the dance floor. v = 0 is the plotted floor centre (headPlot.tiltFloor); the floor runs
// from about v -0.2 (the plotted low edge) to v +0.05 (the rear), only ~12 tilt steps deep, so the
// floor looks move across the width AND near-to-far through DEPTH. ROOM looks map x through atRoom:
// -1..1 spans the head's whole fenced pan box, wall to wall, not just the dance floor.
// ---------------------------------------------------------------------------
const FLOOR_V = -0.06, DEPTH = 0.12;
const V_MID = (CEIL_V + FLOOR_V) / 2, V_HALF = (CEIL_V - FLOOR_V) / 2;   // the floor-to-ceiling span
// ponytail: room width = the fence. Beam R's fence is only the floor box (its wall edges were never
// captured on 9/19, head dark) — re-plot its left/right walls and ROOM looks widen on their own.
const atRoom = (head: Fixture, x: number, v: number): [number, number] => {
  const f = SAFETY[String(head.address)], p = PLOT[headKey(head)];
  if (!f || !p) return atUV(head, x * 1.3, v);
  const [l, r] = p.panLeft > p.panRight ? [f.panMax, f.panMin] : [f.panMin, f.panMax];
  return fenced(head, Math.round(l + ((x + 1) / 2) * (r - l)), Math.round(tiltV(head, v)));
};
// Figure 8 lying on the floor: each beam traces a lemniscate the width of the floor, a quarter-loop
// behind its neighbour, so the four weave through each other. It used to be raw DMX (pan ±24) from
// before the plot; on the plotted 22-step floor the fence pinned it at the edges half the loop.
moveChaser("FLOOR · Figure 8", 24, 180, 0, (k, th) => [0.9 * Math.sin(th + k * Q), FLOOR_V + DEPTH * Math.sin(2 * (th + k * Q))]);
moveChaser("FLOOR · Wave", 24, 180, 0, (k, th) => [Math.sin(th - k * Q), FLOOR_V]);
// Circle: four beams a quarter-turn apart chasing each other round the floor's edge.
moveChaser("FLOOR · Circle", 24, 170, 0, (k, th) => [0.85 * Math.cos(th + k * Q), FLOOR_V + DEPTH * Math.sin(th + k * Q)]);
// Scissor: pairs mirror through the middle of the floor, outer heads on the near lane, inner on the far.
moveChaser("FLOOR · Scissor", 24, 180, 0, (k, th) => [(k < 2 ? 1 : -1) * (k === 0 || k === 3 ? 1 : 0.6) * Math.sin(th), FLOOR_V + (k === 0 || k === 3 ? -0.6 : 0.6) * DEPTH]);
moveChaser("FLOOR · Ballyhoo", 48, 140, 0, (k, th) => [Math.sin(2 * th + k * Q), FLOOR_V + DEPTH * Math.sin(3 * th + k * Math.PI / 3)]);
// X: left pair and right pair sweep the floor in opposite directions on two lanes, crossing mid-floor.
moveChaser("FLOOR · X", 24, 180, 0, (k, th) => [(k < 2 ? -1 : 1) * Math.cos(th), FLOOR_V + (k % 2 ? 0.8 : -0.8) * DEPTH]);
// Zigzag: all four cross the floor end to end while snaking near-far, a quarter-snake apart.
moveChaser("FLOOR · Zigzag", 48, 120, 0, (k, th) => [-Math.cos(th), FLOOR_V + DEPTH * Math.cos(6 * th + k * Q)]);
// Chase: fanned across the floor, one beam lit at a time bouncing along the line (shutter only).
moveChaser("FLOOR · Chase", BOUNCE.length, 80, 250, (k, _th, i) => [0.9 * FAN_U[k], FLOOR_V, BOUNCE[i] === k ? 255 : 0]);
// Spiral: four beams on one circle round the floor centre, winding out to the edges and back in.
moveChaser("FLOOR · Spiral", 48, 130, 0, (k, th) => {
  const r = 0.2 + 0.8 * (0.5 - 0.5 * Math.cos(th)), a = 4 * th + k * Q;
  return [r * Math.cos(a), FLOOR_V + r * DEPTH * Math.sin(a)];
});
// Scatter: quick hops between spread-out floor spots, never two heads on one spot. Deterministic
// (step and head index mod 9 / mod 5), so every generate gives the same show.
moveChaser("FLOOR · Scatter", 12, 90, 260, (k, _th, i) => [((i * 7 + k * 5) % 9) / 4 - 1, FLOOR_V + DEPTH * (((i * 3 + k * 2) % 5) / 2 - 1)]);
// Burst: all four pull into one hot spot mid-floor, then fly out to the floor's edges and corners.
const BURST_TO: Array<[number, number]> = [[-1, FLOOR_V - DEPTH], [-0.5, FLOOR_V + DEPTH], [0.5, FLOOR_V + DEPTH], [1, FLOOR_V - DEPTH]];
moveChaser("FLOOR · Burst", 16, 150, 0, (k, th) => {
  const s = 0.5 - 0.5 * Math.cos(th);
  return [BURST_TO[k][0] * s, FLOOR_V + (BURST_TO[k][1] - FLOOR_V) * s];
});
// Corners: each head holds a different corner of the floor; every step they all rotate one corner on.
const CORNERS: Array<[number, number]> = [[-1, FLOOR_V - DEPTH], [1, FLOOR_V - DEPTH], [1, FLOOR_V + DEPTH], [-1, FLOOR_V + DEPTH]];
moveChaser("FLOOR · Corners", 4, 300, 350, (k, _th, i) => CORNERS[(i + k) % 4]);
// Room sweep: one bar of light across the floor wall to wall, eased at the ends. Replaces MOVE ·
// Sweep Across, which was the same move as FLOOR · Sweep.
moveChaser("ROOM · Sweep", 24, 170, 0, (_k, th) => [-Math.cos(th), FLOOR_V], undefined, atRoom);
// Arc: rainbow wall to wall — floor at house-left, up over the ceiling, down to the floor house-right
// and back. Each head trails the one before it slightly so the arc reads as a ribbon.
moveChaser("ROOM · Arc", 32, 170, 0, (k, th) => {
  const t = th - k * 0.25;
  return [-Math.cos(t), FLOOR_V + (CEIL_V - FLOOR_V) * Math.sin(t) ** 2];
}, undefined, atRoom);
// X Sweep: left pair climbs floor-left to ceiling-right while the right pair mirrors; they cross mid-air.
moveChaser("ROOM · X Sweep", 24, 180, 0, (k, th) => {
  const s = 0.5 - 0.5 * Math.cos(th);
  return [(k < 2 ? -1 : 1) * (1 - 2 * s), FLOOR_V + (CEIL_V - FLOOR_V) * s];
}, undefined, atRoom);
// Flip: alternate heads start on the floor and the ceiling, sweep opposite ways and trade places.
moveChaser("ROOM · Flip", 24, 190, 0, (k, th) => [(k % 2 ? -1 : 1) * Math.sin(th), V_MID + V_HALF * Math.cos(th + k * Math.PI)], undefined, atRoom);
// Perimeter: beams walk the room's outline — across the floor, up the wall, across the ceiling, down
// the other wall — one side apart, so there is always a beam on the floor and one overhead.
const perimeter = (p: number): [number, number] => {
  const s = p % 1;
  switch (Math.floor(p) % 4) {
    case 0: return [-1 + 2 * s, FLOOR_V];
    case 1: return [1, FLOOR_V + (CEIL_V - FLOOR_V) * s];
    case 2: return [1 - 2 * s, CEIL_V];
    default: return [-1, CEIL_V - (CEIL_V - FLOOR_V) * s];
  }
};
moveChaser("ROOM · Perimeter", 32, 150, 0, (k, _th, i) => perimeter(i / 8 + k), undefined, atRoom);
// Dive: fanned on the ceiling, all four dive into one spot mid-floor, then climb back out.
moveChaser("ROOM · Dive", 20, 200, 0, (k, th) => {
  const s = 0.5 - 0.5 * Math.cos(th);
  return [FAN_U[k] * (1 - s), CEIL_V + (FLOOR_V - CEIL_V) * s];
});
// Room circle: one floor-to-ceiling circle across the room, four beams a quarter-turn apart — a windmill.
moveChaser("ROOM · Circle", 24, 170, 0, (k, th) => [Math.cos(th + k * Q), V_MID + V_HALF * Math.sin(th + k * Q)], undefined, atRoom);

const outputUniverses = [...new Set(fixtures.map((fixture) => fixture.universe))].sort((a, b) => a - b);
const controller = rig.controller ?? {
  launchpad: false, profile: "Novation Launchpad Mini MK3",
  inputUid: "None", inputLine: "0", outputUid: "None", outputLine: "0",
};
const universesXml = `${outputUniverses.map((universe) => `   <Universe Name="Lighting U${universe}" ID="${universe}">
    <Input Plugin="OSC" UID="None" Line="0"/>
    <Output Plugin="ArtNet" UID="None" Line="0">
     <PluginParameters outputUni="${universe}" transmitMode="Standard"/>
    </Output>
    <Feedback Plugin="OSC" UID="None" Line="0"/>
   </Universe>`).join("\n")}
   <Universe Name="Launchpad" ID="2" Profile="${esc(controller.profile ?? "Novation Launchpad Mini MK3")}">
    <Input Plugin="MIDI" UID="${esc(controller.inputUid)}" Line="${esc(controller.inputLine)}"/>
    <Feedback Plugin="MIDI" UID="${esc(controller.outputUid)}" Line="${esc(controller.outputLine)}"/>
   </Universe>`;
const ML = rig.controller2;
const minilabUniverseXml = ML ? `
   <Universe Name="MiniLab" ID="3">
    <Input Plugin="MIDI" UID="${esc(ML.inputUid)}" Line="${esc(ML.inputLine)}">
     <PluginParameters midichannel="16"/>
    </Input>
   </Universe>` : "";
// MiniLab keybed and pads. QLC+ maps a MIDI Note to input channel 128 + note and a Control Change
// to the CC number itself, so the keys sit clear of the knob CCs above. The MiniLab's base octave is
// a front-panel setting the show cannot read, so three octaves of white keys are bound to the same
// eight colours — whichever octave the keybed is on, the white keys are the head colour wheel.
const MINILAB_PADS = { white: 36, panic: 37, reset: 38, tap: 39 };
const WHITE_KEYS = [0, 2, 4, 5, 7, 9, 11];        // C D E F G A B within an octave
const KEY_OCTAVES = [48, 60, 72];                  // C3, C4, C5
const KEY_COLOURS = ["Red", "Amber", "Yellow", "Green", "Blue", "Cyan", "Magenta"];
const fixturesXml = fixtures.map((fixture) => `  <Fixture>
   <Manufacturer>${esc(fixture.manufacturer)}</Manufacturer>
   <Model>${esc(fixture.model)}</Model>
   <Mode>${esc(fixture.mode)}</Mode>
   <ID>${fixture.id}</ID>
   <Name>${esc(fixture.name)}</Name>
   <Universe>${fixture.universe}</Universe>
   <Address>${fixture.address}</Address>
   <Channels>${fixture.channels}</Channels>
  </Fixture>`).join("\n");
const functionsXml = functions.map((fn) => {
  if (fn.type === "Scene") {
    return `  <Function ID="${fn.id}" Type="Scene" Name="${esc(fn.name)}">
   <Speed FadeIn="${fn.fadeIn}" FadeOut="${fn.fadeOut}" Duration="0"/>
${fn.values.map((value) => `   <FixtureVal ID="${value.id}">${value.pairs.join(",")}</FixtureVal>`).join("\n")}
  </Function>`;
  }
  const steps = fn.steps.map((sceneId, index) =>
    `   <Step Number="${index}" FadeIn="${fn.fade}" Hold="${fn.hold}" FadeOut="${fn.fade}">${sceneId}</Step>`,
  ).join("\n");
  return `  <Function ID="${fn.id}" Type="Chaser" Name="${esc(fn.name)}">
   <Speed FadeIn="${fn.fade}" FadeOut="${fn.fade}" Duration="${fn.hold}"/>
   <Direction>Forward</Direction>
   <RunOrder>${fn.runOrder}</RunOrder>
   <SpeedModes FadeIn="Common" FadeOut="Common" Duration="Common"/>
${steps}
  </Function>`;
}).join("\n");

const functionIdByName = new Map(functions.map((fn) => [fn.name, fn.id]));
const PAD_ROWS = [209, 199, 189, 179, 169, 159, 149, 139];
const padChannel = (row: number, col: number): number => PAD_ROWS[row] + col;
const LED = { red: 10, amber: 18, yellow: 26, green: 42, cyan: 50, blue: 66, purple: 90, white: 6, gray: 1 };

type ButtonAction = "Toggle" | "Flash" | "Blackout";
type ButtonSpec = {
  label: string; row: number; col: number; page: number; frame: string;
  fn?: string; action?: ButtonAction; led: number; bg: RGB; enabled?: boolean;
};
type PlacedButton = ButtonSpec & { display: string; pad: number; osc: string; oscId: number; midiId: number };
const placed: PlacedButton[] = [];
let widgetId = 100;
function place(spec: ButtonSpec): void {
  if (spec.fn && !functionIdByName.has(spec.fn)) throw new Error(`Unknown function for ${spec.label}: ${spec.fn}`);
  const display = `${spec.label} P${spec.page + 1} R${spec.row + 1}C${spec.col + 1}`;
  placed.push({ ...spec, enabled: spec.enabled ?? true, display, pad: padChannel(spec.row, spec.col),
    osc: oscPath(display), oscId: widgetId++, midiId: widgetId++ });
}

const addRow = (page: number, row: number, frame: string, specs: Array<[string, string | undefined, number, RGB, ButtonAction?]>, startCol = 0): void => {
  specs.forEach(([label, fn, led, bg, action], col) => place({ label, fn, led, bg, action, page, row, col: startCol + col, frame }));
};

addRow(0, 0, "BASE-P1", [
  ["RED", "BASE · Red", LED.red, [210, 28, 28]], ["AMBER", "BASE · Amber", LED.amber, [235, 110, 20]],
  ["YELLOW", "BASE · Yellow", LED.yellow, [230, 205, 30]], ["GREEN", "BASE · Green", LED.green, [35, 190, 70]],
  ["CYAN", "BASE · Cyan", LED.cyan, [25, 175, 190]], ["BLUE", "BASE · Blue", LED.blue, [35, 85, 220]],
  ["PURPLE", "BASE · Purple", LED.purple, [135, 55, 210]], ["WHITE", "BASE · White", LED.white, [225, 225, 220]],
]);
addRow(0, 1, "BASE-P1", [
  ["RAINBOW", "BASE · Rainbow", LED.purple, [160, 70, 200]], ["R/B", "BASE · Red Blue", LED.red, [175, 45, 95]],
  ["G/M", "BASE · Green Magenta", LED.green, [60, 165, 105]], ["CHECKER", "BASE · Checkerboard", LED.white, [170, 170, 170]],
  ["BANDS", "BASE · Bands", LED.amber, [210, 125, 45]], ["PIXELS", "BASE · Pixels", LED.white, [190, 190, 190]],
  ["WAVE", "BASE · Wave", LED.cyan, [35, 155, 180]], ["RANDOM", "BASE · Random", LED.purple, [115, 75, 180]],
]);
addRow(0, 2, "FX-P1", [
  ["L → R", "FX · Left to Right", LED.cyan, [35, 150, 185]], ["R → L", "FX · Right to Left", LED.cyan, [35, 150, 185]],
  ["CENTER OUT", "FX · Center Out", LED.blue, [55, 100, 190]], ["OUT IN", "FX · Outside In", LED.blue, [55, 100, 190]],
  ["TRUSS STEP", "FX · Truss Step", LED.amber, [200, 125, 35]], ["BOUNCE", "FX · Bounce", LED.green, [55, 165, 85]],
  ["SNAKE", "FX · Snake", LED.green, [55, 165, 85]], ["RAIN CHASE", "FX · Rainbow Chase", LED.purple, [140, 65, 190]],
]);
addRow(0, 3, "FX-P1", [
  ["COLOR FADE", "FX · Color Fade", LED.purple, [130, 75, 185]], ["WHITE FADE", "FX · White Fade", LED.white, [190, 190, 190]],
  ["BREATHE", "FX · Breathe", LED.cyan, [50, 150, 175]], ["CROSSFADE", "FX · Crossfade", LED.blue, [65, 90, 190]],
  ["PASTEL", "FX · Pastel", LED.purple, [170, 105, 190]], ["GRADIENT", "FX · Gradient", LED.amber, [195, 115, 50]],
]);
addRow(0, 4, "FX-P1", [
  ["STROBE SLOW", "FX · Strobe Slow", LED.white, [180, 180, 180]], ["STROBE MED", "FX · Strobe Medium", LED.white, [195, 195, 195]],
  ["STROBE FAST", "FX · Strobe Fast", LED.white, [220, 220, 220]], ["CHASE STROBE", "FX · Chase Strobe", LED.white, [165, 165, 180]],
  ["WAVE STROBE", "FX · Wave Strobe", LED.white, [165, 175, 185]], ["BURST", "FLASH · Burst", LED.white, [225, 225, 225], "Flash"],
  ["FLOOR FULL", "FLOOR · Full", LED.white, [205, 205, 205]],
]);

addRow(1, 0, "BASE-P2", [
  ["RED", "BASE · Red", LED.red, [210, 28, 28]], ["AMBER", "BASE · Amber", LED.amber, [235, 110, 20]],
  ["GREEN", "BASE · Green", LED.green, [35, 190, 70]], ["CYAN", "BASE · Cyan", LED.cyan, [25, 175, 190]],
  ["BLUE", "BASE · Blue", LED.blue, [35, 85, 220]], ["PURPLE", "BASE · Purple", LED.purple, [135, 55, 210]],
  ["WHITE", "BASE · White", LED.white, [225, 225, 220]], ["BLACK", undefined, LED.gray, [20, 20, 24], "Blackout"],
]);
addRow(1, 1, "BASE-P2", [
  ["RAINBOW", "BASE · Rainbow", LED.purple, [160, 70, 200]], ["CHECKER", "BASE · Checkerboard", LED.white, [170, 170, 170]],
  ["BANDS", "BASE · Bands", LED.amber, [210, 125, 45]], ["PIXELS", "BASE · Pixels", LED.white, [190, 190, 190]],
]);
addRow(1, 1, "FX-P2", [
  ["L → R", "FX · Left to Right", LED.cyan, [35, 150, 185]], ["R → L", "FX · Right to Left", LED.cyan, [35, 150, 185]],
  ["FADE", "FX · Color Fade", LED.purple, [130, 75, 185]], ["BREATHE", "FX · Breathe", LED.cyan, [50, 150, 175]],
], 4);

// Head colour (solo), aims (one-shot) and shutter utilities: page 2 rows 3 + 6, and again on the
// mover page (page 3 rows 5-6) so colour and aim are one press away from the looks.
const headRows = (page: number, colRow: number, aimRow: number): void => {
  addRow(page, colRow, `HEADCOL-P${page + 1}`, [
    ["HD RED", "HEAD · Red", LED.red, [200, 30, 30]], ["HD AMBER", "HEAD · Amber", LED.amber, [225, 120, 25]],
    ["HD YELLOW", "HEAD · Yellow", LED.yellow, [225, 205, 35]], ["HD GREEN", "HEAD · Green", LED.green, [40, 185, 75]],
    ["HD BLUE", "HEAD · Blue", LED.blue, [40, 90, 215]], ["HD CYAN", "HEAD · Cyan", LED.cyan, [30, 170, 190]],
    ["HD MAGENTA", "HEAD · Magenta", LED.purple, [190, 50, 190]], ["HD WHITE", "HEAD · White", LED.white, [225, 225, 220]],
  ]);
  // Aims and shutter sit OUT of the mover solo frame: they must layer on top of a running look.
  addRow(page, aimRow, `HEADAIM-P${page + 1}`, [
    ["HOME", "HEAD · Home Go", LED.gray, [90, 90, 100]], ["CENTRE", "HEAD · Centre Go", LED.gray, [90, 90, 100]],
    ["CROWD", "HEAD · Crowd Go", LED.gray, [90, 90, 100]], ["CROSSED", "HEAD · Crossed Go", LED.gray, [90, 90, 100]],
  ]);
  addRow(page, aimRow, `HEADUTIL-P${page + 1}`, [
    ["BM OPEN", "HEAD · Beams Full", LED.white, [160, 160, 170]], ["SP OPEN", "HEAD · Spots Full", LED.white, [160, 160, 170]],
    ["HD OPEN", "HEAD · Open", LED.green, [50, 150, 80]], ["HD STROBE", "HEAD · Strobe", LED.white, [225, 225, 225], "Flash"],
  ], 4);
};
headRows(1, 2, 5);
headRows(2, 4, 5);
// PAGE 3 = MOVERS. Rows 1-4 are ONE solo frame holding EVERY mover look. Separate frames let a
// running CEIL chaser keep writing pan/tilt over a FLOOR look pressed after it (found live
// 2026-09-19), and a second page with its own frame would do the same — so no mover look lives on
// any other page. One frame, one look at a time. HOLD parks the heads and stops whatever is running.
// Rows run floor -> floor FX + room -> floor/ceiling -> ceiling.
const FLR: [number, RGB] = [LED.cyan, [35, 150, 185]], FLX: [number, RGB] = [LED.green, [55, 165, 85]];
const RM: [number, RGB] = [LED.purple, [140, 65, 190]], CL: [number, RGB] = [LED.blue, [60, 90, 200]];
const moveRow = (row: number, looks: Array<[string, string, [number, RGB]]>): void =>
  addRow(2, row, "MOVE-P3", looks.map(([label, fn, [led, bg]]) => [label, fn, led, bg] as [string, string, number, RGB]));
moveRow(0, [
  ["FIGURE 8", "FLOOR · Figure 8", FLR], ["FLR SWEEP", "FLOOR · Sweep", FLR], ["FLR WAVE", "FLOOR · Wave", FLR],
  ["FLR CIRCLE", "FLOOR · Circle", FLR], ["FLR SCISSOR", "FLOOR · Scissor", FLR], ["FLR BALLYHOO", "FLOOR · Ballyhoo", FLR],
  ["FLR X", "FLOOR · X", FLR], ["FLR ZIGZAG", "FLOOR · Zigzag", FLR],
]);
moveRow(1, [
  ["FLR CHASE", "FLOOR · Chase", FLX], ["FLR SPIRAL", "FLOOR · Spiral", FLX], ["FLR SCATTER", "FLOOR · Scatter", FLX],
  ["FLR BURST", "FLOOR · Burst", FLX], ["FLR CORNERS", "FLOOR · Corners", FLX], ["ROOM SWEEP", "ROOM · Sweep", RM],
  ["ARC", "ROOM · Arc", RM], ["X SWEEP", "ROOM · X Sweep", RM],
]);
moveRow(2, [
  ["FLIP", "ROOM · Flip", RM], ["PERIMETER", "ROOM · Perimeter", RM], ["DIVE", "ROOM · Dive", RM],
  ["ROOM CIRCLE", "ROOM · Circle", RM], ["RISE FALL", "MOVE · Rise Fall", RM], ["TILT WAVE", "CEIL · Tilt Wave", RM],
  ["BALLYHOO", "CEIL · Ballyhoo", RM], ["LOOK SEQ", "SEQ · Ceiling Looks", [LED.amber, [200, 125, 35]]],
]);
moveRow(3, [
  ["CEIL FAN", "CEIL · Fan", CL], ["CEIL CROSS", "CEIL · Cross", CL], ["CEIL SWEEP", "CEIL · Sweep", CL],
  ["CEIL CIRCLE", "CEIL · Circle", CL], ["WAVE", "CEIL · Wave", CL], ["SCISSOR", "CEIL · Scissor", CL],
  ["FAN CHASE", "CEIL · Fan Chase", CL], ["HOLD", "MOVE · Hold", [LED.gray, [90, 90, 100]]],
]);

for (const page of [0, 1, 2]) {
  addRow(page, 6, `LEVEL-P${page + 1}`, [
    ["25%", "LEVEL · 25%", LED.blue, [55, 80, 145]], ["50%", "LEVEL · 50%", LED.blue, [65, 100, 175]],
    ["75%", "LEVEL · 75%", LED.cyan, [65, 145, 180]], ["FULL", "LEVEL · Full", LED.white, [205, 205, 205]],
  ]);
  ["SLOW", "MED", "FAST", "TAP"].forEach((label, index) => place({
    label, row: 6, col: index + 4, page, frame: `SPEED-P${page + 1}`, led: LED.amber, bg: [185, 110, 35], enabled: false,
  }));
  addRow(page, 7, `UTILITY-P${page + 1}`, [
    ["BLACK", undefined, LED.gray, [20, 20, 24], "Blackout"], ["STOP FX", "FX · Stop", LED.red, [155, 40, 45]],
    ["WHITE", "BASE · White", LED.white, [225, 225, 220]],
  ]);
  place({ label: "FLASH", row: 7, col: 4, page, frame: `UTILITY-P${page + 1}`, fn: "FLASH · White", action: "Flash", led: LED.white, bg: [235, 235, 230] });
  // RESET puts the rig back to a known state; PANIC kills the output outright. Both also sit on the
  // MiniLab pads (see MINILAB KEYS), because in a real panic nobody is hunting for a mouse.
  place({ label: "RESET", row: 7, col: 5, page, frame: `UTILITY-P${page + 1}`, fn: "UTIL · Reset", led: LED.amber, bg: [190, 120, 40] });
  place({ label: "PANIC", row: 7, col: 6, page, frame: `UTILITY-P${page + 1}`, fn: "UTIL · Panic", led: LED.red, bg: [190, 30, 30] });
  place({ label: "PAGE", row: 7, col: 7, page, frame: `UTILITY-P${page + 1}`, led: LED.green, bg: [45, 155, 85], enabled: false });
}

function appearance(bg: RGB, foreground = argb(0, 0, 0)): string {
  return `<Appearance><FrameStyle>None</FrameStyle><ForegroundColor>${foreground}</ForegroundColor><BackgroundColor>${argb(...bg)}</BackgroundColor><BackgroundImage>None</BackgroundImage><Font>Default</Font></Appearance>`;
}
function buttonXml(button: PlacedButton, x: number, y: number): string {
  const fn = button.fn ? `\n     <Function ID="${functionIdByName.get(button.fn)}"/>` : "";
  const action = button.action ?? "Toggle";
  const one = (id: number, input: string) => `    <Button Caption="${esc(button.display)}" ID="${id}" Icon="">
     <WindowState Visible="True" X="${x}" Y="${y}" Width="90" Height="44"/>
     ${appearance(button.bg, button.bg[0] < 45 && button.bg[1] < 45 && button.bg[2] < 45 ? argb(255, 255, 255) : argb(0, 0, 0))}${fn}
     <Action>${action}</Action>${input}
    </Button>`;
  if (!button.enabled) return one(button.oscId, "");
  return `${one(button.oscId, `\n     <Input Universe="0" Channel="${crc16(button.osc)}"/>`)}\n${one(button.midiId,
    `\n     <Input Universe="2" Channel="${button.pad}" LowerValue="${dimOf(button.led)}" UpperValue="${button.led}"/>`)}`;
}

function frameXml(tag: "Frame" | "SoloFrame", name: string, id: number, page: number, buttons: PlacedButton[]): string {
  const minRow = Math.min(...buttons.map((button) => button.row));
  const maxRow = Math.max(...buttons.map((button) => button.row));
  const minCol = Math.min(...buttons.map((button) => button.col));
  const maxCol = Math.max(...buttons.map((button) => button.col));
  const x = 8 + minCol * 96, y = 8 + minRow * 50;
  const inner = buttons.map((button) => buttonXml(button, 4 + (button.col - minCol) * 96, 4 + (button.row - minRow) * 50)).join("\n");
  return `   <${tag} Caption="${esc(name)}" ID="${id}" Page="${page}">
    ${appearance([32, 34, 39])}
    <WindowState Visible="True" X="${x}" Y="${y}" Width="${(maxCol - minCol) * 96 + 98}" Height="${(maxRow - minRow) * 50 + 52}"/>
    <AllowChildren>True</AllowChildren><AllowResize>True</AllowResize><ShowHeader>False</ShowHeader><ShowEnableButton>False</ShowEnableButton><Collapsed>False</Collapsed><Disabled>False</Disabled>
${inner}
   </${tag}>`;
}

const performanceFrames: string[] = [];
let frameId = 10;
for (const page of [0, 1, 2]) {
  for (const name of [`BASE-P${page + 1}`, `FX-P${page + 1}`, `HEADCOL-P${page + 1}`, `HEADAIM-P${page + 1}`, `HEADDIM-P${page + 1}`, `HEADUTIL-P${page + 1}`, `FLOOR-P${page + 1}`, `CEIL-P${page + 1}`, `MOVE-P${page + 1}`, `MOVESEQ-P${page + 1}`, `LEVEL-P${page + 1}`, `SPEED-P${page + 1}`, `UTILITY-P${page + 1}`]) {
    const buttons = placed.filter((button) => button.page === page && button.frame === name);
    if (buttons.length) performanceFrames.push(frameXml(/^(BASE|FX|HEADCOL|HEADDIM|LEVEL|MOVE)/.test(name) ? "SoloFrame" : "Frame", name, frameId++, page, buttons));
  }
}

// MINILAB sits directly under the pad pages so the knobs and faders are on screen without
// scrolling on the 1300x773 show laptop; the routing tests (collapsed, setup-only) go below it.
const MINILAB_Y = 430 + 8, MINILAB_HEIGHT = 190;
// One collapsed key frame PER PAGE: QLC+ only routes external input to widgets on the page that is
// showing, so a single frame would go deaf the moment the operator flipped to page 2.
const minilabKeyFrames = ML ? [0, 1, 2].map((page) => {
  const btn = (id: number, caption: string, fnName: string, note: number, action = "Toggle"): string =>
    `    <Button Caption="${esc(caption)}" ID="${id}" Icon="">
     <WindowState Visible="True" X="8" Y="8" Width="90" Height="28"/>
     ${appearance([52, 56, 65], argb(245, 245, 245))}${fnName ? `\n     <Function ID="${functionIdByName.get(fnName)}"/>` : ""}
     <Action>${action}</Action>
     <Input Universe="3" Channel="${128 + note}"/>
    </Button>`;
  let id = 3000 + page * 100;   // clear of the routing-test buttons, which run into the 1000s
  const keys = KEY_OCTAVES.flatMap((root) => WHITE_KEYS.map((offset, i) =>
    btn(id++, `${KEY_COLOURS[i]} ${root}`, `HEAD · ${KEY_COLOURS[i]}`, root + offset)));
  const pads = [
    btn(id++, "White", "HEAD · White", MINILAB_PADS.white),
    btn(id++, "PANIC", "UTIL · Panic", MINILAB_PADS.panic),
    btn(id++, "RESET", "UTIL · Reset", MINILAB_PADS.reset),
  ];
  return `   <Frame Caption="MINILAB KEYS · white keys = head colour, pads = white / PANIC / RESET / TAP" ID="${65 + page}" Page="${page}">
    ${appearance([35, 36, 41], argb(245, 245, 245))}<WindowState Visible="True" X="8" Y="${MINILAB_Y + MINILAB_HEIGHT - 26}" Width="960" Height="26"/>
    <AllowChildren>True</AllowChildren><AllowResize>True</AllowResize><ShowHeader>True</ShowHeader><ShowEnableButton>False</ShowEnableButton><Collapsed>True</Collapsed><Disabled>False</Disabled>
${[...keys, ...pads].join("\n")}
   </Frame>`;
}).join("\n") : "";

const chaserIds = functions.filter((fn) => fn.type === "Chaser" && !fn.name.startsWith("TEST ·") && !fn.name.startsWith("HEAD ·") && !fn.name.startsWith("SEQ ·")).map((fn) => fn.id);
const speedFunctionsXml = chaserIds.map((id) => `     <Function FadeIn="0" FadeOut="0" Duration="6">${id}</Function>`).join("\n");
const speedDial = `   <Frame Caption="FX SPEED" ID="40">
    ${appearance([32, 34, 39])}
    <WindowState Visible="True" X="790" Y="8" Width="196" Height="142"/>
    <AllowChildren>True</AllowChildren><AllowResize>True</AllowResize><ShowHeader>True</ShowHeader><ShowEnableButton>False</ShowEnableButton><Collapsed>False</Collapsed><Disabled>False</Disabled>
    <SpeedDial Caption="FX Speed" ID="900">
     ${appearance([52, 56, 65], argb(245, 245, 245))}
     <WindowState Visible="True" X="8" Y="8" Width="180" Height="120"/>
     <AbsoluteValue Minimum="100" Maximum="4000"><Input Universe="0" Channel="${crc16(oscPath("FX Speed"))}"/></AbsoluteValue>
     <Tap><Input Universe="${ML ? 3 : 2}" Channel="${ML ? 128 + MINILAB_PADS.tap : 156}"/></Tap><Time>500</Time>
${speedFunctionsXml}
    </SpeedDial>
${[[901, 153, 1199, 1200], [902, 154, 599, 600], [903, 155, 249, 250]].map(([id, channel, minimum, maximum]) => `    <SpeedDial Caption="_Speed ${maximum}" ID="${id}">
     ${appearance([32, 34, 39])}<WindowState Visible="True" X="1" Y="1" Width="1" Height="1"/>
     <AbsoluteValue Minimum="${minimum}" Maximum="${maximum}"><Input Universe="2" Channel="${channel}"/></AbsoluteValue><Time>${maximum}</Time>
${speedFunctionsXml}
    </SpeedDial>`).join("\n")}
   </Frame>`;

const routingButtons = routingScenes.map((scene, index) => {
  const x = 6 + (index % 8) * 118, y = 6 + Math.floor(index / 8) * 38;
  return `    <Button Caption="${esc(scene.name)}" ID="${1000 + index}" Icon=""><WindowState Visible="True" X="${x}" Y="${y}" Width="112" Height="34"/>${appearance([70, 72, 78], argb(245, 245, 245))}<Function ID="${scene.id}"/><Action>Toggle</Action></Button>`;
}).join("\n");
const routingHeight = Math.ceil(routingScenes.length / 8) * 38 + 12;
// MINILAB sits directly under the pad pages so the knobs and faders are on screen without
// scrolling on the 1300x773 show laptop; the routing tests (collapsed, setup-only) go below it and
// may run off-screen when expanded.
const ROUTING_Y = 430 + MINILAB_HEIGHT + 16;
const routingFrame = `  <SoloFrame Caption="SETUP · ROUTING TESTS" ID="50">
   ${appearance([35, 36, 41], argb(245, 245, 245))}<WindowState Visible="True" X="8" Y="${ROUTING_Y}" Width="960" Height="${routingHeight}"/>
   <AllowChildren>True</AllowChildren><AllowResize>True</AllowResize><ShowHeader>True</ShowHeader><ShowEnableButton>False</ShowEnableButton><Collapsed>True</Collapsed><Disabled>False</Disabled>
${routingButtons}
  </SoloFrame>`;

// MINILAB — universe 3. TOP row K1-K4 = TILT of light 1-4, BOTTOM row K5-K8 = PAN, house-left
// to house-right along the truss line. Level mode is right HERE and only here: a knob owns its
// pan/tilt channel and every aim pad is a one-shot, so the knob always has the last word.
// Fenced by rig.headSafety (by DMX address). F1-F3 = Playback faders (intensity of a running
// scene, never a Level slider on a panel channel).
const knobHeads = [spots[0], beams[0], beams[1], spots[1]].filter(Boolean);
const midiIn = (cc: number) => `<Input Universe="3" Channel="${cc}"/>`;
function levelSliderXml(id: number, caption: string, x: number, y: number, fixture: Fixture, ch: number, lo: number, hi: number, cc?: number): string {
  return `    <Slider Caption="${esc(caption)}" ID="${id}" WidgetStyle="Slider" InvertedAppearance="false">
     ${appearance([52, 56, 65], argb(245, 245, 245))}
     <WindowState Visible="True" X="${x}" Y="${y}" Width="60" Height="150"/>
     <SliderMode ValueDisplayStyle="Exact" ClickAndGoType="None" Monitor="false">Level</SliderMode>
     <Level LowLimit="${lo}" HighLimit="${hi}" Value="0">
      <Channel Fixture="${fixture.id}">${ch}</Channel>
     </Level>
     <Playback><Function>4294967295</Function></Playback>
     ${cc === undefined ? "" : midiIn(cc)}
    </Slider>`;
}
function playbackSliderXml(id: number, caption: string, x: number, y: number, fn: string, cc: number): string {
  return `    <Slider Caption="${esc(caption)}" ID="${id}" WidgetStyle="Slider" InvertedAppearance="false">
     ${appearance([52, 56, 65], argb(245, 245, 245))}
     <WindowState Visible="True" X="${x}" Y="${y}" Width="60" Height="150"/>
     <SliderMode ValueDisplayStyle="Percentage" ClickAndGoType="None" Monitor="false">Playback</SliderMode>
     <Level LowLimit="0" HighLimit="255" Value="0"/>
     <Playback><Function>${functionIdByName.get(fn)}</Function></Playback>
     ${midiIn(cc)}
    </Slider>`;
}
const knobCcs = ML ? [[ML.cc.k1, ML.cc.k2, ML.cc.k3, ML.cc.k4], [ML.cc.k5, ML.cc.k6, ML.cc.k7, ML.cc.k8]] : [[], []];
const tagOf = (head: Fixture): string => (isBeam(head) ? "B" : "S") + head.name.slice(-1);   // SL, BL, BR, SR
// FADERS 1-4 = the four movers' DIMMERS, house-left to house-right: 375ZX L, Beam L, Beam R,
// 375ZX R. Level mode, so a fader OWNS its head's dimmer channel outright and no look can take the
// head away from the operator. That is deliberate: the looks below write pan, tilt and shutter and
// never touch a dimmer, so a mover can never cut out on its own — if a head is dark, its fader is
// down. Raise all four before the doors open.
// The pan/tilt knobs are NOT emitted unless rig.controller2.plotMode is true. In Level mode a
// touched knob holds that channel for good, which on 2026-09-19 left the heads frozen mid-show with
// every movement look running and nothing moving. Plot with them on, run the show with them off.
const PLOT_MODE = Boolean((ML as any)?.plotMode);
const minilabSliders = ML ? [
  ...knobHeads.map((head, i) => levelSliderXml(958 + i, `Dim${i + 1}${tagOf(head)}`, 8 + i * 64, 8, head, headRoles(head).dim, 0, 255,
    [ML.cc.f1, ML.cc.f2, ML.cc.f3, ML.cc.f4][i])),
  ...(PLOT_MODE ? [
    ...knobHeads.map((head, i) => { const f = SAFETY[String(head.address)]; return levelSliderXml(950 + i, `Tilt${i + 1}${tagOf(head)}`, 8 + (4 + i) * 64, 8, head, headRoles(head).tilt, f?.tiltMin ?? 0, f?.tiltMax ?? 255, knobCcs[0][i]); }),
    ...knobHeads.map((head, i) => { const f = SAFETY[String(head.address)]; return levelSliderXml(954 + i, `Pan${i + 1}${tagOf(head)}`, 8 + (8 + i) * 64, 8, head, headRoles(head).pan, f?.panMin ?? 0, f?.panMax ?? 255, knobCcs[1][i]); }),
  ] : []),
  // Optics, mouse only: sharp focus depends on the throw, so it is tuned by eye at the venue.
  ...knobHeads.map((head, i) => levelSliderXml(961 + i, `Foc${i + 1}${tagOf(head)}`, 8 + (11 + i) * 64, 8, head, headRoles(head).focus, 0, 255)),
  ...spots.map((head, i) => levelSliderXml(965 + i, `Zoom${tagOf(head)}`, 8 + (15 + i) * 64, 8, head, headRoles(head).zoom as number, 0, 255)),
] : [];
const minilabFrame = ML ? `  <Frame Caption="MINILAB" ID="60">
   ${appearance([35, 36, 41], argb(245, 245, 245))}<WindowState Visible="True" X="8" Y="${MINILAB_Y}" Width="${16 + 17 * 64}" Height="${MINILAB_HEIGHT}"/>
   <AllowChildren>True</AllowChildren><AllowResize>True</AllowResize><ShowHeader>True</ShowHeader><ShowEnableButton>False</ShowEnableButton><Collapsed>False</Collapsed><Disabled>False</Disabled>
${minilabSliders.join("\n")}
  </Frame>` : "";

const monitorXml = `  <Monitor DisplayMode="1" ShowLabels="1">
   <Grid Width="7" Height="4" Depth="4" Units="0"/>
${panels.map((panel, index) => `   <FxItem ID="${panel.id}" XPos="${600 + index * 500}" YPos="1900" ZPos="0"/>`).join("\n")}
${heads.map((head, index) => `   <FxItem ID="${head.id}" XPos="${index === 0 ? 850 : 6350}" YPos="700" ZPos="0"/>`).join("\n")}
  </Monitor>`;

const qxw = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE Workspace>
<Workspace xmlns="http://www.qlcplus.org/Workspace" CurrentWindow="VirtualConsole">
 <Creator><Name>Q Light Controller Plus</Name><Version>4.14.4</Version><Author>A_Development</Author></Creator>
 <Engine>
  <InputOutputMap><BeatGenerator BeatType="Disabled" BPM="0"/>
${universesXml}${minilabUniverseXml}
  </InputOutputMap>
${fixturesXml}
${functionsXml}
${monitorXml}
 </Engine>
 <VirtualConsole>
  <Frame Caption="">${appearance([25, 27, 32], argb(245, 245, 245))}
   <Frame Caption="PAGES" ID="9">
    ${appearance([25, 27, 32], argb(245, 245, 245))}
    <WindowState Visible="True" X="0" Y="0" Width="782" Height="418"/>
    <AllowChildren>True</AllowChildren><AllowResize>True</AllowResize><ShowHeader>False</ShowHeader><ShowEnableButton>False</ShowEnableButton><Collapsed>False</Collapsed><Disabled>False</Disabled>
    <Multipage PagesNum="3" CurrentPage="0"/>
    <Next><Input Universe="2" Channel="146"/><Key>PgDown</Key></Next><Previous><Key>PgUp</Key></Previous><PagesLoop>True</PagesLoop>
${performanceFrames.join("\n")}
   </Frame>
${speedDial}
${minilabFrame}
${minilabKeyFrames}
${routingFrame}
  </Frame>
  <Properties><Size Width="1130" Height="${ROUTING_Y + routingHeight + 12}"/><GrandMaster ChannelMode="All" ValueMode="Reduce" SliderMode="Normal"/></Properties>
 </VirtualConsole>
</Workspace>
`;

const dmxChain = heads.map((head) => `${head.name} at ${head.address + 1}`).join(" → ");
const panelsByUniverse = outputUniversesOf(panels)
  .map((u) => `Cuepix ${panels.filter((p) => p.universe === u).map((p) => p.name.split(" ")[1]).join(", ")} receive Art-Net Universe ${u}.`)
  .join("\n- ");
const patchRows = fixtures.map((fixture) =>
  `| ${fixture.name} | ${fixture.model} | ${fixture.universe} | ${fixture.address + 1} | ${fixture.address + fixture.channels} | ${fixture.channels} |`,
).join("\n");
const patchChart = `# Cuepix rig patch chart

QLC+ stores addresses zero-based internally. Table shows fixture-display DMX addresses.

| Fixture | Model | Art-Net universe | Start | End | Channels |
|---|---|---:|---:|---:|---:|
${patchRows}

CR011R DMX output handles Universe 0 only: ${dmxChain}. Universe 1 goes directly by Art-Net to the panels listed above.
`;
const trussSetupLines = (rig.cuepix?.trusses ?? [])
  .map((group, index) => ({ group, index }))
  .filter(({ group }) => group.length)
  .map(({ group, index }) => `- Truss ${index + 1}: Cuepix ${group[0]}-${group[group.length - 1]}, bottom to top.`)
  .join("\n");
const setupGuide = `# Cuepix + QLC+ show setup

## Rig and physical order

${trussSetupLines}
- Beam L / Beam R (Intimidator Beam 140SR, 14-channel mode) mount on the inside 8 ft trusses 2 and 3.
- 375ZX L / 375ZX R (15-channel mode) mount on the outside 4 ft trusses 1 and 4, with the Cuepix stacks.
- All Cuepix panels use 79-channel mode (the units report 75; addressing is unaffected).
- Maximum 4 panels per Elation rigging bar; each panel gets an independent safety cable; never daisy-chain safety cables.
- Maximum 2 Cuepix panels power-linked at 120 V.
- Mover pads are live from the first launch with pre-plot defaults, all at or above horizontal; capture real aims on plot night, then regenerate.

## Lighting LAN

- Use a dedicated unmanaged Ethernet switch. Connect QLC+ computer, CR011R, and all ${panels.length} Cuepix panels.
- Computer lighting NIC: static \`10.201.6.1\`, mask \`255.255.255.0\`, no gateway. Disable sharing and bridging.
- Pknight CR011R: \`10.201.6.100\`; Art-Net Universe 0 to its DMX output.
- ${panelsByUniverse}
- Panels: Service PIN \`050\`, Network Switch \`ON\`, Protocol \`ArtNet\` (per-panel menu).
- Set panel addresses from \`CUEPIX-PATCH-CHART.md\`.
- CR011R DMX OUT → ${dmxChain} → DMX terminator.
- Cuepix panels receive Ethernet directly. Do not add them to the CR011R DMX chain.

## First install

1. Install QLC+ 4.14.x. Do not use QLC+ 5 for this show.
2. Close QLC+.
3. Run \`powershell.exe -NoProfile -File .\\start-cuepix.ps1 -InstallOnly\`.
4. Start QLC+ once, close it, then reconnect the controller.

## Normal launch

1. Connect the Novation Launchpad Mini MK3 before opening QLC+.
2. Confirm Windows exposes \`MIDIIN2 (LPMiniMK3 MIDI)\` and \`MIDIOUT2 (LPMiniMK3 MIDI)\`.
3. Run \`powershell.exe -NoProfile -File .\\start-cuepix.ps1\`.
4. Launcher creates \`cuepix-panel-show.runtime.qxw\`, resolves current WinMM indexes, puts Launchpad in Programmer Mode, starts QLC+, MCP, and 3D monitor.
5. MCP/dashboard: http://127.0.0.1:8788/dashboard
6. 3D monitor: http://127.0.0.1:7800

If Launchpad is absent, launcher removes MIDI routes from runtime copy. QLC+ Virtual Console and MCP remain usable. To force this mode, add \`-DisableLaunchpad\`. QLC+ MIDI feedback owns pad LEDs; \`LAUNCHPAD_LEDS\` stays \`0\`.

## Virtual Console and Launchpad

- Page 1: full Cuepix colors, pixel patterns, chasers, fades, strobes, burst, levels, speed, tap, blackout, stop, white flash, page switch.
- Page 2: compact Cuepix controls plus the HEAD rows — colours R3, aims + shutter R6.
- Page 3: MOVERS. R1 floor looks, R2 floor FX + room sweeps, R3 floor-to-ceiling room looks, R4 ceiling looks + HOLD (one solo frame: one look at a time). R5 head colours, R6 aims + shutter.
- Page 1 R5C7: FLOOR FULL (whole panel floor white).
- R7C1-R7C4: 25%, 50%, 75%, Full. R7C5-R7C7: Slow, Medium, Fast. R7C8: Tap.
- R8C1: Blackout. R8C2: Stop FX. R8C3: White. R8C5: Flash. R8C8: Page.
- Use visible \`FX Speed\` dial for exact speed. Use QLC+ Grand Master for overall output.
- No Cuepix dimmer or strobe DMX Level slider exists. Such sliders would seize channels from scenes and pads.

### MiniLab 3

K1-K4 tilt, K5-K8 pan of ${[spots[0], beams[0], beams[1], spots[1]].filter(Boolean).map((head) => head.name).join(" · ")}; F1 panels, F2 beams, F3 spots. Port \`${ML?.portName ?? "—"}\`; the launcher binds it at start.

## Test gate — routing before performance

1. Expand collapsed \`SETUP · ROUTING TESTS\` in Virtual Console.
2. Power one Cuepix only. Test its Red, Green, Blue, White, and Blackout buttons.
3. Repeat for Cuepix 1-${panels.length}, one fixture at a time.
4. Test Universe 0 Panels White, Universe 1 Panels White, then All Blackout.
5. Test ${heads.slice(0, -1).map((head) => head.name).join(", ")} and ${heads[heads.length - 1]?.name} one at a time through CR011R.
6. Collapse setup controls. Test grouped solids, patterns, fades, chasers, levels, strobe, stop, flash press/release, and blackout.
7. Test Launchpad page switch and LED feedback. Compare both universes against 3D monitor.
8. Perform mover calibration last. Stop if any wrong fixture, universe, address, direction, or unsafe aim appears.

## Art-Net numbering warning

Workspace maps QLC+ Universe ID 0 → Art-Net universe 0 and QLC+ Universe ID 1 → Art-Net universe 1. Some device screens label these 1 and 2. Match wire values, not display wording.
`;

const qxwPath = path.join(OUT, "cuepix-panel-show.qxw");
writeFileSync(qxwPath, qxw, "utf8");
writeFileSync(path.join(OUT, "CUEPIX-PATCH-CHART.md"), patchChart, "utf8");
writeFileSync(path.join(OUT, "CUEPIX-SETUP.md"), setupGuide, "utf8");
const parsedWidgets = await parseQxwFile(qxwPath);
if (parsedWidgets.errors.length) throw new Error(`Widget map parse failed: ${parsedWidgets.errors.join("; ")}`);
mkdirSync(path.join(OUT, "config"), { recursive: true });
writeFileSync(path.join(OUT, "config", "cuepix-widgets.json"), JSON.stringify({ widgets: parsedWidgets.widgets, generated: true }, null, 2) + "\n", "utf8");
console.log(`Built ${path.basename(rigPath)}: ${fixtures.length} fixtures, ${routingScenes.length} routing tests, ${functions.length - routingScenes.length} performance functions, ${placed.length} console pads, Art-Net ${outputUniverses.join(", ")}, ${heads.length} heads, MiniLab ${ML ? "on" : "off"}`);
