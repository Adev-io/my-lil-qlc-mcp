/*
 * build-show.ts — generates <show>.qxw + PATCH-CHART.md + SETUP-MANUAL.html
 * from a rig config (rig.json — see scripts/rig.ts and rigs/punk-rock-show.rig.json).
 *
 * Why a generator: ~50 scenes/chasers x N fixtures + ~100 VC buttons with
 * CRC-16 OSC hashes is infeasible to hand-author and easy to get wrong.
 * The RIG (fixtures, addresses, stage geometry) comes from rig.json; the SHOW
 * DESIGN (colours, looks, presets, pad layout — the DATA TABLES below) lives
 * here. Tweak either and re-run to rebuild:
 *     npx tsx scripts/build-show.ts [path/to/rig.json]
 * then: npm run generate:widgets ./<show>.qxw config/widgets.json
 *
 * XML shapes mirror QLC+'s own saveXML (engine/src + ui/src/virtualconsole)
 * and the worked example intervalPI.qxw. Control model is "dual button":
 * every look has ONE OSC button (Universe 0, Channel=crc16(path)) for the
 * MCP/dashboard AND ONE Launchpad button (Universe 1, Channel=pad, with LED
 * feedback) — QLC+ VCButton persists only one input source per button.
 */

import { writeFileSync, chmodSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { renderManual } from "./manual.js";
import { loadRig, slugify } from "./rig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");

const { rig, rigPath } = loadRig(process.argv[2]);
const SHOW_SLUG = slugify(rig.meta.name);
const QXW_FILE = `${SHOW_SLUG}.qxw`;
// Tests (and CI) can redirect output away from the repo root.
const OUT = process.env.QLC_BUILD_OUT ? path.resolve(process.env.QLC_BUILD_OUT) : REPO;
mkdirSync(OUT, { recursive: true });

// ----------------------------------------------------------------------------
// CRC-16-CCITT, byte-identical to Utils::getChecksum (plugins/interfaces/utils.h)
// ----------------------------------------------------------------------------
const CRC_TBL = [
  0x0000, 0x1081, 0x2102, 0x3183, 0x4204, 0x5285, 0x6306, 0x7387, 0x8408,
  0x9489, 0xa50a, 0xb58b, 0xc60c, 0xd68d, 0xe70e, 0xf78f,
];
function crc16(s: string): number {
  let crc = 0xffff;
  for (const byte of Buffer.from(s, "utf8")) {
    let c = byte;
    crc = ((crc >> 4) & 0x0fff) ^ CRC_TBL[(crc ^ c) & 15];
    c = c >> 4;
    crc = ((crc >> 4) & 0x0fff) ^ CRC_TBL[(crc ^ c) & 15];
  }
  crc = ~crc & 0xffff;
  return crc;
}

// Mirror of QLCPlus-MCP/src/qlc/qxwParser.ts getWidgetPath so OSC paths match.
function oscPath(name: string): string {
  return `/${name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ /g, "_")}`;
}

// Verify the algorithm matches Qt/QLC+ (CRC-16/X-25). Standard check vector:
// crc("123456789") == 0x906E. This is what QLC+'s OSC plugin computes for paths,
// so a button's stored Channel = crc16(path) will match the path the MCP sends.
const check = crc16("123456789");
if (check !== 0x906e) {
  throw new Error(`CRC algorithm wrong: crc16("123456789")=0x${check.toString(16)}, expected 0x906e`);
}

// ----------------------------------------------------------------------------
// XML helpers
// ----------------------------------------------------------------------------
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function argb(r: number, g: number, b: number): number {
  // QLC+ stores colors as a 32-bit ARGB unsigned int.
  return ((0xff << 24) | (r << 16) | (g << 8) | b) >>> 0;
}
// Launchpad LED feedback: idle pads glow their look color at 30%, the active look at 100%.
// The Mini MK3 colour table groups each hue as [bright,100%,60%,30%] on even values, so the
// 30% variant of a 100% value V is V+4 (white 100%=6 -> 30%=2; 0 stays off).
function dimOf(v: number): number {
  return v <= 0 ? 0 : v === 6 ? 2 : v + 4;
}

// ----------------------------------------------------------------------------
// Fixture channel maps (0-indexed within each fixture footprint)
// ----------------------------------------------------------------------------
// The VALUE BUILDERS below (parVal/barVal/headVal and the raw-pair FX) assume the
// per-kind role LAYOUT of the reference fixtures (see rigs/punk-rock-show.rig.json):
//   par 10ch:  0 Dim 1 Strobe 2 R 3 G 4 B 5 W 6 A 7 UV 8 Macro 9 Speed
//   bar 13ch:  0..8 = 3 RGB cells, 9 Strobe, 10 AutoProg, 11 Speed, 12 Dim
//   head 15ch: 0 Pan 1 PanF 2 Tilt 3 TiltF 4 PTSpeed 5 Color 6 Gobo
//              7 GoboRot 8 Prism 9 Focus 10 Dim 11 Shutter 12 Ctrl 13 Mov 14 Zoom
// A fixture with a DIFFERENT layout needs builder edits (qlc-show-designer agent's job);
// counts, addresses, names, stage geometry and head wheel/gobo data all come from rig.json.
const headGroup = rig.fixtures.find((g) => g.kind === "head");
const SHUTTER_OPEN = headGroup?.beam?.shutterOpen ?? 255;
const HEAD_COLOR: Record<string, number> = {
  white: 0, orange: 8, lime: 16, cyan: 24, red: 36, green: 44, magenta: 50, yellow: 60,
  ...(headGroup?.colorWheel ?? {}),
};

interface Fixture {
  id: number; manuf: string; model: string; mode: string; name: string;
  address: number; channels: number; kind: "par" | "bar" | "head";
}

const fixtures: Fixture[] = [];
let fxId = 0;
for (const g of rig.fixtures) {
  const prefix = g.namePrefix ?? g.kind.charAt(0).toUpperCase() + g.kind.slice(1);
  for (let i = 0; i < g.count; i++) {
    // Two heads keep the classic L/R names; any other count numbers them.
    const suffix = g.kind === "head" && g.count === 2 ? (i === 0 ? "L" : "R") : `${i + 1}`;
    fixtures.push({ id: fxId++, manuf: g.manufacturer, model: g.model, mode: g.mode,
      name: `${prefix} ${suffix}`, address: g.addresses[i], channels: g.channels, kind: g.kind });
  }
}

const pars = fixtures.filter((f) => f.kind === "par");
const bars = fixtures.filter((f) => f.kind === "bar");
const heads = fixtures.filter((f) => f.kind === "head");

// ----------------------------------------------------------------------------
// Function model
// ----------------------------------------------------------------------------
type FixVal = { id: number; pairs: number[] }; // pairs = [ch,val,ch,val,...]
interface SceneDef { type: "Scene"; id: number; name: string; fadeIn: number; fadeOut: number; vals: FixVal[]; }
interface ChaserDef { type: "Chaser"; id: number; name: string; steps: number[]; hold: number; fade: number; direction: string; runOrder: string; }
interface MatrixDef { type: "RGBMatrix"; id: number; name: string; group: number; script: string; color: number; duration: number; direction: string; runOrder: string; }
type FuncDef = SceneDef | ChaserDef | MatrixDef;

const funcs: FuncDef[] = [];
const funcIdByName = new Map<string, number>();
let funcId = 0;

function addScene(name: string, vals: FixVal[], fadeIn = 120, fadeOut = 120): number {
  const id = funcId++;
  funcs.push({ type: "Scene", id, name, fadeIn, fadeOut, vals });
  funcIdByName.set(name, id);
  return id;
}
function addChaser(name: string, stepNames: string[], hold: number, fade = 0, direction = "Forward", runOrder = "Loop"): number {
  // A rig without the relevant fixture kind produces zero steps (e.g. "Bar Chase" with no
  // bars) — skip the chaser entirely; its pad is dropped too (see the funcIdByName filters).
  if (stepNames.length === 0) return -1;
  const id = funcId++;
  const steps = stepNames.map((n) => {
    const sid = funcIdByName.get(n);
    if (sid === undefined) throw new Error(`Chaser "${name}" references unknown scene "${n}"`);
    return sid;
  });
  funcs.push({ type: "Chaser", id, name, steps, hold, fade, direction, runOrder });
  funcIdByName.set(name, id);
  return id;
}
function addMatrix(name: string, group: number, script: string, color: number, duration: number, direction = "Forward", runOrder = "Loop"): number {
  const id = funcId++;
  funcs.push({ type: "RGBMatrix", id, name, group, script, color, duration, direction, runOrder });
  funcIdByName.set(name, id);
  return id;
}

// --- value builders ---------------------------------------------------------
// Every value builder drives the fixture's MASTER DIMMER to FULL (par ch0, bar ch12, head ch10) so
// each scene SELF-ILLUMINATES. The T3-BT bars (and the pars/heads) gate their RGB on that dimmer, so
// a scene that left it at 0 stayed dark — that was the bug where the bars never lit. The page-2
// Pars/Bars/Heads Dim faders are Level OVERRIDES on those same channels (default 255 = no change;
// pull one down to dim that group on page 2). Off builders zero the dimmer (blackout); head blackouts
// also use shutter=0. A few impact/auto looks set their dim via raw pairs (kept, now consistent).
function parVal(id: number, c: number[]): FixVal {
  // ch0 = master dimmer FULL, ch1 = strobe OFF; c = [r,g,b,w,a,uv] on ch2..7
  return { id, pairs: [0, 255, 1, 0, 2, c[0], 3, c[1], 4, c[2], 5, c[3], 6, c[4], 7, c[5], 8, 0] };
}
function parOff(id: number): FixVal {
  return { id, pairs: [0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8, 0] };
}
function barVal(id: number, rgb: number[]): FixVal {
  const [r, g, b] = rgb;
  // 3 RGB cells + ch12 master dimmer FULL (the T3-BT gates RGB on the dimmer); strobe/auto off
  return { id, pairs: [0, r, 1, g, 2, b, 3, r, 4, g, 5, b, 6, r, 7, g, 8, b, 9, 0, 10, 0, 12, 255] };
}
function barOff(id: number): FixVal {
  return { id, pairs: [0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8, 0, 12, 0] };
}
function headVal(id: number, h: { pan?: number; tilt?: number; color?: number; gobo?: number; goborot?: number; prism?: number; dim?: number; shutter?: number; focus?: number; zoom?: number }): FixVal {
  const p: number[] = [];
  const set = (ch: number, v: number | undefined) => { if (v !== undefined) p.push(ch, v); };
  set(0, h.pan); set(2, h.tilt); set(5, h.color); set(6, h.gobo); set(7, h.goborot);
  set(10, h.dim ?? 255); // ch10 master dimmer FULL by default (Park / Heads Blackout pass dim:0)
  set(8, h.prism); set(9, h.focus); set(11, h.shutter); set(14, h.zoom);
  return { id, pairs: p };
}

// ----------------------------------------------------------------------------
// DATA TABLES — looks. led = Launchpad feedback color value (profile color table)
// ----------------------------------------------------------------------------
// Launchpad color values: 10 red, 18 orange, 26 yellow, 42 green, 66 blue-green,
// 74 cyan, 82 blue, 94 dark-blue, 106 magenta, 114 pink, 6 white, 0 off.
interface Look { name: string; pad: number; led: number; bg: number; }
const looks: Look[] = []; // every look that gets a button, in pad order

// WASH colors  {par rgbwauv, bar rgb}
const COLORS: { name: string; par: number[]; bar: number[]; led: number; bg: number[] }[] = [
  { name: "Red", par: [255, 0, 0, 0, 0, 0], bar: [255, 0, 0], led: 10, bg: [255, 0, 0] },
  { name: "Amber", par: [0, 0, 0, 0, 255, 0], bar: [255, 80, 0], led: 18, bg: [255, 120, 0] },
  { name: "Yellow", par: [255, 255, 0, 0, 0, 0], bar: [255, 160, 0], led: 26, bg: [255, 220, 0] },
  { name: "Green", par: [0, 255, 0, 0, 0, 0], bar: [0, 255, 0], led: 42, bg: [0, 220, 0] },
  { name: "Cyan", par: [0, 255, 255, 0, 0, 0], bar: [0, 255, 255], led: 74, bg: [0, 220, 220] },
  { name: "Blue", par: [0, 0, 255, 0, 0, 0], bar: [0, 0, 255], led: 82, bg: [0, 60, 255] },
  { name: "Magenta", par: [255, 0, 255, 0, 0, 0], bar: [255, 0, 255], led: 106, bg: [255, 0, 200] },
  { name: "White", par: [0, 0, 0, 255, 0, 0], bar: [255, 255, 255], led: 6, bg: [255, 255, 255] },
];

// BAND looks — value fn applied per par index for splits
const BAND: { name: string; led: number; bg: number[]; build: () => FixVal[] }[] = [
  { name: "Warm Wash", led: 18, bg: [255, 90, 20], build: () => washVals([255, 30, 0, 40, 200, 0], [255, 70, 10]) },
  { name: "Cool Wash", led: 82, bg: [40, 80, 255], build: () => washVals([0, 40, 255, 60, 0, 0], [40, 80, 255]) },
  { name: "Red Blue Split", led: 106, bg: [180, 0, 120], build: () => splitVals([255, 0, 0, 0, 0, 0], [255, 0, 0], [0, 0, 255, 0, 0, 0], [0, 0, 255]) },
  { name: "UV Blacklight", led: 90, bg: [80, 0, 180], build: () => washVals([0, 0, 0, 0, 0, 255], [60, 0, 120]) },
  { name: "Magenta Cyan", led: 74, bg: [180, 0, 180], build: () => splitVals([255, 0, 255, 0, 0, 0], [255, 0, 255], [0, 255, 255, 0, 0, 0], [0, 255, 255]) },
  { name: "Sunset", led: 18, bg: [255, 40, 60], build: () => washVals([255, 20, 40, 0, 120, 0], [255, 40, 30]) },
  { name: "Deep Blue Verse", led: 90, bg: [0, 20, 160], build: () => washVals([0, 0, 200, 10, 0, 0], [0, 10, 160]) },
  { name: "White Static", led: 6, bg: [255, 255, 255], build: () => washVals([0, 0, 0, 255, 0, 0], [255, 255, 255]) },
];

function washVals(par: number[], bar: number[]): FixVal[] {
  return [...pars.map((f) => parVal(f.id, par)), ...bars.map((f) => barVal(f.id, bar))];
}
function splitVals(parA: number[], barA: number[], parB: number[], barB: number[]): FixVal[] {
  const v: FixVal[] = [];
  pars.forEach((f, i) => v.push(parVal(f.id, i % 2 === 0 ? parA : parB)));
  bars.forEach((f, i) => v.push(barVal(f.id, i % 2 === 0 ? barA : barB)));
  return v;
}

// ----------------------------------------------------------------------------
// STAGE GEOMETRY — moving-head aim, from the 2026-06-09 brainstorm (spec:
// docs/superpowers/specs/2026-06-09-mover-aimed-positions-design.md). Supersedes the
// 2026-06-08 measurements: trusses are now GROUND-STANDING at the front stage corners
// (heads on top, ~8.5 ft up, 20 ft apart), stage 20w x 10d with the deck at 2.5 ft,
// audience directly in front, and a roof close above the lights.
// Coordinates: origin = front-CENTRE of the stage at floor level. +X = audience-right,
// +Y = upstage (away from the crowd), +Z = up. Feet.
//   Band (audience POV): singer centre (0,3.3), guitar front-left (-5.6,2.7),
//   bass mid-right (5.2,4.8), drums back-right (7,7.5, seated).
// 375Z ranges: pan 0-255 = 540°, tilt 0-255 = 270°. The aim() convention (pan 128 = beam
// straight upstage, higher = audience-right; tilt 128 = centre-stage depression, higher =
// steeper/closer) is unchanged. ROOF GUARD: aim() throws if a target computes to a beam at
// or above horizontal. RIG-CALIBRATION KNOBS: if the rig comes up MIRRORED (beams hit the
// opposite side), negate the pan term in aim(); if beams sit globally high or low, nudge
// TILT_CENTRE_DEPR; AIM_Z / STAGE_DECK raise/lower where the beam centres on a body.
// ----------------------------------------------------------------------------
const STAGE_W = rig.stage.widthFt;
const STAGE_D = rig.stage.depthFt;
const HEAD_SEP = rig.stage.headSeparationFt ?? STAGE_W;
const HEAD_Z = rig.stage.headHeightFt;
const HEAD_XYZ = { L: { x: -HEAD_SEP / 2, y: 0, z: HEAD_Z }, R: { x: HEAD_SEP / 2, y: 0, z: HEAD_Z } };
const PAN_DMX_PER_DEG = 255 / (headGroup?.beam?.panRangeDeg ?? 540);    // 0.4722 on the 375Z
const TILT_DMX_PER_DEG = 255 / (headGroup?.beam?.tiltRangeDeg ?? 270);  // 0.9444 on the 375Z
const TILT_CENTRE_DEPR = headGroup?.beam?.tiltCentreDeprDeg ?? 37.5; // depression (° below horizontal) that reads tilt DMX 128
const STAGE_DECK = rig.stage.deckHeightFt;   // stage deck height above the floor (ft)
const AIM_Z = STAGE_DECK + 4;        // beam centres on a performer's chest/face (ft above floor)
const clampDmx = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

// Aim one head (L/R) at a floor/space target → [pan, tilt] DMX (0-255).
function aim(side: "L" | "R", tx: number, ty: number, tz = AIM_Z): [number, number] {
  const h = HEAD_XYZ[side];
  const dx = tx - h.x, dy = ty - h.y;
  const panDeg = (Math.atan2(dx, dy) * 180) / Math.PI;                          // 0 = upstage, + = aud-right
  const deprDeg = (Math.atan2(h.z - tz, Math.hypot(dx, dy)) * 180) / Math.PI;   // ° below horizontal
  if (deprDeg <= 0)
    throw new Error(`aim(${side}, ${tx}, ${ty}, ${tz}): beam at/above horizontal — roof violation`);
  return [clampDmx(128 + panDeg * PAN_DMX_PER_DEG),
          clampDmx(128 + (deprDeg - TILT_CENTRE_DEPR) * TILT_DMX_PER_DEG)];
}
// Aim BOTH heads at a common point — the motion chasers use this so the two beams
// converge and travel together.
function aimBoth(tx: number, ty: number, tz = AIM_Z): { l: [number, number]; r: [number, number] } {
  return { l: aim("L", tx, ty, tz), r: aim("R", tx, ty, tz) };
}
// Named aim points (resolved once, reused by positions + presets). Performer positions come
// from rig.performers when present; otherwise sensible defaults scaled to the stage size.
const P = {
  vox:    rig.performers?.vox    ?? { x: 0,               y: STAGE_D * 0.33 },
  guitar: rig.performers?.guitar ?? { x: -STAGE_W * 0.28, y: STAGE_D * 0.27 },
  bass:   rig.performers?.bass   ?? { x: STAGE_W * 0.26,  y: STAGE_D * 0.48 },
  drums:  rig.performers?.drums  ?? { x: STAGE_W * 0.35,  y: STAGE_D * 0.75, aimZ: STAGE_DECK + 3.5 },
};
const AIM = {
  singer:    aimBoth(P.vox.x, P.vox.y, P.vox.aimZ ?? AIM_Z),
  guitar:    aimBoth(P.guitar.x, P.guitar.y, P.guitar.aimZ ?? AIM_Z),
  bass:      aimBoth(P.bass.x, P.bass.y, P.bass.aimZ ?? AIM_Z),
  drums:     aimBoth(P.drums.x, P.drums.y, P.drums.aimZ ?? AIM_Z),
  crowdNear: aimBoth(0, -6, 5),                          // ~6 ft into the crowd, beams cross
  crowdDeep: aimBoth(0, -18, 5.5),                       // ~18 ft out
  // each head washes its own half / beams cross at centre (presets/zigzag)
  wash:  { l: aim("L", -STAGE_W / 4, STAGE_D / 2), r: aim("R", STAGE_W / 4, STAGE_D / 2) },
  cross: { l: aim("L", STAGE_W / 4, STAGE_D * 0.4),  r: aim("R", -STAGE_W / 4, STAGE_D * 0.4) },
};

// HEAD positions (pan/tilt per head) — aimed at the band and the crowd (2026-06-09 re-block).
// Colour/gobo deliberately NOT set, so the Heads colour pads keep control of the wheel.
const POSITIONS: { name: string; led: number; bg: number[]; l: number[]; r: number[]; zoom?: number }[] = [
  { name: "Singer",     led: 6,   bg: [230, 230, 230], l: AIM.singer.l,    r: AIM.singer.r,    zoom: 100 },
  { name: "Guitar",     led: 18,  bg: [255, 80, 0],    l: AIM.guitar.l,    r: AIM.guitar.r,    zoom: 60 },
  { name: "Bass",       led: 42,  bg: [0, 180, 0],     l: AIM.bass.l,      r: AIM.bass.r,      zoom: 60 },
  { name: "Drums",      led: 82,  bg: [0, 60, 200],    l: AIM.drums.l,     r: AIM.drums.r,     zoom: 100 },
  { name: "Crowd Near", led: 106, bg: [255, 0, 160],   l: AIM.crowdNear.l, r: AIM.crowdNear.r, zoom: 200 },
  { name: "Crowd Deep", led: 90,  bg: [120, 0, 220],   l: AIM.crowdDeep.l, r: AIM.crowdDeep.r, zoom: 200 },
  { name: "Stage Wash", led: 74,  bg: [0, 160, 160],   l: AIM.wash.l,      r: AIM.wash.r,      zoom: 230 },
  { name: "Park",       led: 6,   bg: [40, 40, 40],    l: [128, 0],        r: [128, 0] },
];

// HEAD beam/gobo looks (both heads, centered, beam open)
const BEAMS: { name: string; led: number; bg: number[]; h: any }[] = [
  { name: "Breakup Gobo", led: 26, bg: [200, 160, 0], h: { color: HEAD_COLOR.white, gobo: 8 } },
  { name: "Gobo Cycle", led: 42, bg: [0, 180, 80], h: { color: HEAD_COLOR.white, gobo: 150 } },
  { name: "Prism", led: 74, bg: [0, 160, 200], h: { color: HEAD_COLOR.white, gobo: 0, prism: 10 } },
  { name: "Color Cycle", led: 106, bg: [200, 0, 160], h: { color: 200, gobo: 0 } },
  { name: "Red Beam", led: 10, bg: [255, 0, 0], h: { color: HEAD_COLOR.red, gobo: 0 } },
  { name: "Blue Beam", led: 74, bg: [0, 120, 220], h: { color: HEAD_COLOR.cyan, gobo: 0 } },
  { name: "Open Spot", led: 6, bg: [230, 230, 230], h: { color: HEAD_COLOR.white, gobo: 0, prism: 0 } },
  { name: "Heads Blackout", led: 6, bg: [30, 30, 30], h: { dim: 0, shutter: 0 } },
];

// FX (momentary flash)
const FX: { name: string; led: number; bg: number[]; build: () => FixVal[] }[] = [
  { name: "Strobe All", led: 6, bg: [255, 255, 255], build: () => [
      ...pars.map((f) => ({ id: f.id, pairs: [0, 255, 5, 255, 1, 200] })),
      ...bars.map((f) => ({ id: f.id, pairs: [0, 255, 1, 255, 2, 255, 3, 255, 4, 255, 5, 255, 6, 255, 7, 255, 8, 255, 9, 220, 12, 255] })),
      ...heads.map((f) => headVal(f.id, { dim: 255, shutter: 90, color: HEAD_COLOR.white })) ] },
  { name: "Blinder", led: 6, bg: [255, 255, 255], build: () => [
      ...pars.map((f) => parVal(f.id, [0, 0, 0, 255, 0, 0])),
      ...bars.map((f) => barVal(f.id, [255, 255, 255])),
      ...heads.map((f) => headVal(f.id, { dim: 255, shutter: SHUTTER_OPEN, color: HEAD_COLOR.white, gobo: 0 })) ] },
  { name: "UV Pop", led: 90, bg: [120, 0, 220], build: () => pars.map((f) => parVal(f.id, [0, 0, 0, 0, 0, 255])) },
  { name: "Color Burst", led: 106, bg: [255, 0, 160], build: () => splitVals([255, 0, 255, 0, 0, 0], [255, 0, 255], [0, 0, 0, 0, 255, 0], [255, 120, 0]) },
];

// ----------------------------------------------------------------------------
// Build functions
// ----------------------------------------------------------------------------
// Wash colors
for (const c of COLORS) addScene(c.name, washVals(c.par, c.bar));
// Band looks
for (const b of BAND) addScene(b.name, b.build());
// Head positions
for (const p of POSITIONS)
  addScene(p.name, heads.map((f, i) =>
    headVal(f.id, { pan: (i % 2 === 0 ? p.l : p.r)[0], tilt: (i % 2 === 0 ? p.l : p.r)[1], dim: p.name === "Park" ? 0 : 255, shutter: SHUTTER_OPEN, focus: 128, zoom: p.zoom ?? 128 })));
// Head beams
for (const b of BEAMS)
  addScene(b.name, heads.map((f) =>
    headVal(f.id, { pan: 128, tilt: 128, dim: b.h.dim ?? 255, shutter: b.h.shutter ?? SHUTTER_OPEN, color: b.h.color, gobo: b.h.gobo, goborot: b.h.goborot, prism: b.h.prism ?? 0, focus: 128 })));

// Helper bar-only scenes for the pixel chase (one bar lit white at a time)
bars.forEach((f, i) => {
  const others = bars.filter((o) => o.id !== f.id).map((o) => barOff(o.id));
  addScene(`Bar Step ${i + 1}`, [barVal(f.id, [255, 255, 255]), ...others]);
});

// Chasers (reference scenes by name)
addChaser("Rainbow", ["Red", "Amber", "Yellow", "Green", "Cyan", "Blue", "Magenta"], 280);
addChaser("Police", ["Red", "Blue"], 140);
addChaser("Strobe Color", ["Red", "Blue", "Green", "White"], 90);
addChaser("Bar Chase", bars.map((_, i) => `Bar Step ${i + 1}`), 180);
addChaser("Bounce", ["Red", "Green", "Blue"], 220, 0, "Forward", "PingPong");
addChaser("Slow Cycle", ["Red", "Amber", "Green", "Cyan", "Blue", "Magenta"], 1800, 1500);
// Head sweeps
addChaser("Head Sweep Slow", ["Singer", "Guitar", "Bass", "Drums"], 1400, 1000);
addChaser("Head Sweep Fast", ["Singer", "Guitar", "Bass", "Crowd Near"], 380, 200);

// FX scenes
for (const fx of FX) addScene(fx.name, fx.build(), 0, 0);

// Master functions (Full On, Park All, Sound Active); Blackout/Panic are VC actions
addScene("Full On", [
  ...pars.map((f) => parVal(f.id, [0, 0, 0, 255, 0, 0])),
  ...bars.map((f) => barVal(f.id, [255, 255, 255])),
  ...heads.map((f) => headVal(f.id, { pan: 128, tilt: 128, dim: 255, shutter: SHUTTER_OPEN, color: HEAD_COLOR.white, gobo: 0, focus: 128 })) ], 0, 0);
addScene("Park All", [
  ...pars.map((f) => parOff(f.id)),
  ...bars.map((f) => barOff(f.id)),
  ...heads.map((f) => headVal(f.id, { pan: 128, tilt: 0, dim: 0, shutter: 0 })) ], 0, 600);
addScene("Sound Active", [
  ...bars.map((f) => ({ id: f.id, pairs: [10, 100, 11, 255, 12, 255] })),
  ...heads.map((f) => headVal(f.id, { dim: 255, shutter: SHUTTER_OPEN })),
  ...heads.map((f) => ({ id: f.id, pairs: [13, 152] })) ], 0, 0);

// ============================================================================
// NEW DYNAMIC LOOKS (2026-06-08) — spec: docs/superpowers/specs/2026-06-08-dynamic-scenes-chasers-design.md
// Existing Scene+Chaser engine, except Bar Scroll (RGBMatrix). Head pan/tilt are
// starting values — share the placeholder fate of the POSITIONS table.
// ============================================================================
function addHeadScene(name: string, l: [number, number], r: [number, number]) {
  addScene(name, heads.map((f, i) => headVal(f.id, {
    pan: (i % 2 === 0 ? l : r)[0], tilt: (i % 2 === 0 ? l : r)[1],
    dim: 255, shutter: SHUTTER_OPEN, color: HEAD_COLOR.white, gobo: 0, focus: 128, zoom: 128,
  })));
}
// Head Circle — band↔crowd orbit: guitar → singer → bass on stage, then back across the
// near crowd (z 5 = standing faces). Always below horizontal (roof guard enforces).
const CIRCLE_PTS: [number, number, number?][] = [
  [P.guitar.x, P.guitar.y], [P.vox.x, P.vox.y], [P.bass.x, P.bass.y],
  [6, -6, 5], [0, -6, 5], [-6, -6, 5],
];
CIRCLE_PTS.forEach((p, i) => { const a = aimBoth(p[0], p[1], p[2] ?? AIM_Z); addHeadScene(`hCirc ${i+1}`, a.l, a.r); });
addChaser("Head Circle", CIRCLE_PTS.map((_, i) => `hCirc ${i+1}`), 150, 600);
// Audience Sweep — heads sweep left↔right across the near crowd at face height.
// (A z=8 target can sit ABOVE the heads at distance — the roof guard would throw.)
const SWEEP_PTS: [number, number][] = [[-STAGE_W * 0.35, -6], [0, -6], [STAGE_W * 0.35, -6]];
SWEEP_PTS.forEach((p, i) => { const a = aimBoth(p[0], p[1], 5); addHeadScene(`hSweep ${i+1}`, a.l, a.r); });
addChaser("Audience Sweep", SWEEP_PTS.map((_, i) => `hSweep ${i+1}`), 100, 700, "Forward", "PingPong");
// Cross Zigzag — beams crossed (L→audience-right, R→audience-left), zig between back and front.
{ const a = { l: aim("L", 5, 7), r: aim("R", -5, 7) }; addHeadScene("hCrossUp", a.l, a.r); }
{ const a = { l: aim("L", 5, 3), r: aim("R", -5, 3) }; addHeadScene("hCrossDown", a.l, a.r); }
addChaser("Cross Zigzag", ["hCrossUp", "hCrossDown"], 280, 120);

// Self-animating auto scenes (firmware programs) — static in monitor, animate on the rig.
addScene("Pars Auto", pars.map((f) => ({ id: f.id, pairs: [0, 255, 8, 200, 9, 180] })), 0, 0);
addScene("Bars Auto", bars.map((f) => ({ id: f.id, pairs: [12, 255, 10, 100, 11, 200] })), 0, 0);
// Crossfade twins (animate everywhere)
const PAR_WASH: { name: string; c: number[] }[] = [
  { name: "Par Wash 1", c: [255,0,255,0,0,0] }, { name: "Par Wash 2", c: [0,255,255,0,0,0] },
  { name: "Par Wash 3", c: [0,0,0,0,255,0]   }, { name: "Par Wash 4", c: [0,255,0,0,0,0]   },
  { name: "Par Wash 5", c: [0,0,255,0,0,0]   }, { name: "Par Wash 6", c: [255,0,0,0,0,0]   },
];
PAR_WASH.forEach((w) => addScene(w.name, pars.map((f) => parVal(f.id, w.c))));
addChaser("Pars Morph", PAR_WASH.map((w) => w.name), 0, 1100);
const BAR_WASH: { name: string; c: number[] }[] = [
  { name: "Bar Wash 1", c: [255,0,255] }, { name: "Bar Wash 2", c: [0,255,255] },
  { name: "Bar Wash 3", c: [255,90,0]  }, { name: "Bar Wash 4", c: [0,255,0]   },
  { name: "Bar Wash 5", c: [0,0,255]   }, { name: "Bar Wash 6", c: [255,0,0]   },
];
BAR_WASH.forEach((w) => addScene(w.name, bars.map((f) => barVal(f.id, w.c))));
addChaser("Bars Morph", BAR_WASH.map((w) => w.name), 0, 950);

// Shared off + par-pixel step scenes (no pad)
const allOffVals = [...pars.map((f) => parOff(f.id)), ...bars.map((f) => barOff(f.id))];
addScene("PB Off", allOffVals, 0, 0);
const PX_RAINBOW: number[][] = [
  [255,0,0,0,0,0],[255,40,0,0,0,0],[255,160,0,0,0,0],[120,255,0,0,0,0],[0,255,0,0,0,0],
  [0,255,160,0,0,0],[0,80,255,0,0,0],[60,0,255,0,0,0],[160,0,255,0,0,0],[255,0,160,0,0,0],
];
pars.forEach((f, i) => {
  const others = pars.filter((o) => o.id !== f.id).map((o) => parOff(o.id));
  addScene(`Par Px ${i+1}`, [parVal(f.id, PX_RAINBOW[i % PX_RAINBOW.length]), ...others]);
});
addChaser("Par Run",      pars.map((_, i) => `Par Px ${i+1}`), 110);
addChaser("Pixel Bounce", pars.map((_, i) => `Par Px ${i+1}`), 80, 40, "Forward", "PingPong");
// Stabs
addScene("Stab Hit",  [...pars.map((f) => parVal(f.id, [255,0,255,0,0,0])), ...bars.map((f) => barVal(f.id, [255,0,255]))], 0, 0);
addScene("White Hit", [...pars.map((f) => parVal(f.id, [0,0,0,255,0,0])),   ...bars.map((f) => barVal(f.id, [255,255,255]))], 0, 0);
addChaser("Color Stab",  ["Stab Hit", "PB Off"], 140);
addChaser("Kill Strobe", ["White Hit", "PB Off"], 60);
// Alt Flash — odd/even pars
addScene("Pars Odd",  pars.map((f, i) => i % 2 === 0 ? parVal(f.id, [0,0,0,255,0,0]) : parOff(f.id)), 0, 0);
addScene("Pars Even", pars.map((f, i) => i % 2 === 1 ? parVal(f.id, [0,0,0,255,0,0]) : parOff(f.id)), 0, 0);
addChaser("Alt Flash", ["Pars Odd", "Pars Even"], 120);
// Build Drop — stack pars -> peak -> blackout. Steps scale with the par count
// (2/4/7/10 on a 10-par rig); skipped entirely on a rig with no pars.
if (pars.length > 0) {
  const buildN = (n: number) => pars.map((f, i) => i < n ? parVal(f.id, [255,0,0,0,0,0]) : parOff(f.id));
  const bldSteps = [0.2, 0.4, 0.7, 1].map((frac) => Math.max(1, Math.round(frac * pars.length)));
  bldSteps.forEach((n, i) => addScene(`Bld ${i + 1}`, buildN(n), 0, 0));
  addScene("Bld Peak", [...pars.map((f) => parVal(f.id, [0,0,0,255,0,0])), ...bars.map((f) => barVal(f.id, [255,255,255]))], 0, 0);
  addChaser("Build Drop", ["Bld 1","Bld 2","Bld 3","Bld 4","Bld Peak","PB Off"], 200);
}
// Bar Scroll — RGBMatrix "Stripes" magenta across the Bars group (id 0); needs bars to exist
if (bars.length > 0) addMatrix("Bar Scroll", 0, "Stripes", argb(255, 0, 255), 450);
// Bar Bounce — page-1 fill (r6 c7): ping-pong the bars (reuses Bar Step scenes)
addChaser("Bar Bounce", bars.map((_, i) => `Bar Step ${i + 1}`), 140, 0, "Forward", "PingPong");

// ============================================================================
// PAGE 2 LOOKS (2026-06-08) — per-group colour, head gobos, more movement/chases,
// song presets. spec: docs/superpowers/specs/2026-06-08-page2-multipage-sliders-design.md
// All pan/tilt/gobo are starting values (same placeholder status as POSITIONS).
// ============================================================================
// r0 PARS colour / r1 BARS colour — touch ONLY their group's channels (independent groups)
COLORS.forEach((c) => addScene(`Pars ${c.name}`, pars.map((f) => parVal(f.id, c.par))));
COLORS.forEach((c) => addScene(`Bars ${c.name}`, bars.map((f) => barVal(f.id, c.bar))));
// r2 HEADS colour — full centred open beam in each wheel colour (first 8 wheel slots from the rig)
const HCOL: [string, number][] = Object.entries(HEAD_COLOR)
  .slice(0, 8)
  .map(([k, v]) => [`Heads ${k.charAt(0).toUpperCase()}${k.slice(1)}`, v]);
HCOL.forEach(([n, col]) => addScene(n, heads.map((f, i) => {
  const a = i % 2 === 0 ? AIM.singer.l : AIM.singer.r;
  return headVal(f.id, { pan: a[0], tilt: a[1], color: col, gobo: 0, dim: 255, shutter: SHUTTER_OPEN, focus: 128, zoom: 128 });
})));
// r3 HEADS gobo — centred white beam through each gobo slot, plus prism (slots from the rig)
const GOBOZ: [string, number][] = (headGroup?.goboSlots ?? [11, 19, 27, 35, 43, 51, 59])
  .slice(0, 7)
  .map((g, i) => [`Gobo ${i + 1}`, g]);
GOBOZ.forEach(([n, g]) => addScene(n, heads.map((f, i) => {
  const a = i % 2 === 0 ? AIM.singer.l : AIM.singer.r;
  return headVal(f.id, { pan: a[0], tilt: a[1], color: HEAD_COLOR.white, gobo: g, prism: 0, dim: 255, shutter: SHUTTER_OPEN, focus: 128 });
})));
addScene("Prism", heads.map((f, i) => {
  const a = i % 2 === 0 ? AIM.singer.l : AIM.singer.r;
  return headVal(f.id, { pan: a[0], tilt: a[1], color: HEAD_COLOR.white, gobo: 0, prism: 10, dim: 255, shutter: SHUTTER_OPEN, focus: 128 });
}));
// r4 HEADS movement — 3 NEW chasers (the existing 5 are reused by the page-2 buttons)
// Figure 8 orbits the vocalist position (±2 ft x, ±1.5 ft y)
const FIG8_PTS: [number, number][] = [
  [P.vox.x - 2, P.vox.y + 1.5], [P.vox.x, P.vox.y], [P.vox.x + 2, P.vox.y - 1.5],
  [P.vox.x + 2, P.vox.y + 1.5], [P.vox.x, P.vox.y], [P.vox.x - 2, P.vox.y - 1.5],
];
FIG8_PTS.forEach((p, i) => { const a = aimBoth(p[0], p[1]); addHeadScene(`fig8 ${i+1}`, a.l, a.r); });
addChaser("Figure 8", FIG8_PTS.map((_, i) => `fig8 ${i+1}`), 180, 600);
const PANW_PTS: [number, number][] = [[-STAGE_W * 0.35, STAGE_D * 0.4], [0, STAGE_D * 0.4], [STAGE_W * 0.35, STAGE_D * 0.4]];
PANW_PTS.forEach((p, i) => { const a = aimBoth(p[0], p[1]); addHeadScene(`panw ${i+1}`, a.l, a.r); });
addChaser("Pan Wave", PANW_PTS.map((_, i) => `panw ${i+1}`), 220, 200, "Forward", "PingPong");
{ const a = aimBoth(0, STAGE_D * 0.8); addHeadScene("tiltd 1", a.l, a.r); }  // beams back (drum line)
{ const a = aimBoth(0, STAGE_D * 0.2); addHeadScene("tiltd 2", a.l, a.r); }  // beams front (singer line)
addChaser("Tilt Dip", ["tiltd 1", "tiltd 2"], 260, 200, "Forward", "PingPong");
// r5 CHASES 2 — new chasers over existing scenes (no new scenes)
addChaser("Rainbow Fast",   ["Red","Amber","Yellow","Green","Cyan","Blue","Magenta"], 140);
addChaser("Strobe Rainbow", ["Red","White","Blue","White","Green","White"], 90);
addChaser("Chase Up",       bars.map((_, i) => `Bar Step ${i + 1}`), 120);
addChaser("Chase Down",     bars.map((_, i) => `Bar Step ${i + 1}`).reverse(), 120);
addChaser("Two Tone",       ["Red Blue Split","Magenta Cyan"], 500);
// Par Sparkle — pixel scenes in a halves-interleave (1,6,2,7,... on a 10-par rig)
const sparkleOrder = pars.map((_, k) =>
  k % 2 === 0 ? k / 2 : Math.ceil(pars.length / 2) + (k - 1) / 2);
addChaser("Par Sparkle",    sparkleOrder.map((i) => `Par Px ${i + 1}`), 90);
addChaser("Color Pop",      ["Stab Hit","PB Off","White Hit","PB Off"], 130);
if (pars.length > 0)
  addChaser("Mega Build",   ["Bld 1","Bld 2","Bld 3","Bld 4","Bld Peak","PB Off"], 170);
// r6-r7 SONG presets — full-stage scenes (wash + heads), one song-look at a time
// Head aim per song-look references a named geometry point (see AIM above), so presets
// track the real stage too: center=band, drums=upstage hit, vox=downstage hit, wide/cross.
const PRESETS: { name: string; par: number[]; bar: number[]; hc: number; gobo: number; aim: keyof typeof AIM; led: number }[] = [
  { name: "Opener",       par: [0,0,0,255,0,0],    bar: [255,255,255], hc: 0,  gobo: 0,  aim: "singer", led: 6 },
  { name: "Verse Blue",   par: [0,0,255,0,0,0],    bar: [0,0,255],     hc: 24, gobo: 0,  aim: "drums",  led: 82 },
  { name: "Chorus Warm",  par: [0,0,0,40,255,0],   bar: [255,80,0],    hc: 8,  gobo: 0,  aim: "wash",   led: 18 },
  { name: "Breakdown UV", par: [0,0,0,0,0,255],    bar: [60,0,120],    hc: 50, gobo: 11, aim: "singer", led: 90 },
  { name: "Anthem",       par: [0,0,0,255,0,0],    bar: [255,255,255], hc: 0,  gobo: 0,  aim: "singer", led: 6 },
  { name: "Half Time",    par: [255,0,0,0,0,0],    bar: [255,0,0],     hc: 36, gobo: 0,  aim: "cross",  led: 10 },
  { name: "Green Room",   par: [0,255,0,0,0,0],    bar: [0,255,0],     hc: 44, gobo: 27, aim: "singer", led: 42 },
  { name: "Magenta Pop",  par: [255,0,255,0,0,0],  bar: [255,0,255],   hc: 50, gobo: 0,  aim: "wash",   led: 106 },
  { name: "Deep Verse",   par: [0,0,200,10,0,0],   bar: [0,10,160],    hc: 24, gobo: 0,  aim: "drums",  led: 90 },
  { name: "Sunset Jam",   par: [255,20,40,0,120,0],bar: [255,40,30],   hc: 60, gobo: 0,  aim: "wash",   led: 18 },
  { name: "Big Finish",   par: [255,0,0,255,0,0],  bar: [255,255,255], hc: 0,  gobo: 0,  aim: "singer", led: 6 },
  { name: "Cyan Wash",    par: [0,255,255,0,0,0],  bar: [0,255,255],   hc: 24, gobo: 0,  aim: "singer", led: 74 },
  { name: "Purple Haze",  par: [120,0,255,0,0,0],  bar: [120,0,200],   hc: 50, gobo: 19, aim: "singer", led: 90 },
  { name: "Gold Ballad",  par: [255,160,0,0,80,0], bar: [255,160,0],   hc: 60, gobo: 0,  aim: "singer", led: 26 },
  { name: "Punk Slam",    par: [255,0,0,0,0,0],    bar: [0,0,255],     hc: 36, gobo: 0,  aim: "cross",  led: 106 },
  // "Glow Out" dropped: its pad (R8C8, page 2) is the page-toggle. 15 presets fill r6 c0-7 + r7 c0-6.
];
PRESETS.forEach((p) => { const a = AIM[p.aim]; addScene(p.name, [
  ...washVals(p.par, p.bar),
  ...heads.map((f, i) => headVal(f.id, { pan: (i % 2 === 0 ? a.l : a.r)[0], tilt: (i % 2 === 0 ? a.l : a.r)[1], color: p.hc, gobo: p.gobo, dim: 255, shutter: SHUTTER_OPEN, focus: 128 })),
], 200, 200); });

// ----------------------------------------------------------------------------
// Virtual Console — frames + dual buttons
// ----------------------------------------------------------------------------
// First pad channel per row. The Launchpad Mini MK3 numbers its grid bottom-up
// (bottom row = notes 11..18 -> QLC+ ch 139.., top row = notes 81..88 -> ch 209..),
// so we list TOP row first to make the physical pad layout match the dashboard map
// (logical row 0 = colours = TOP physical row). Vertical flip only; columns (L->R) unchanged.
const PAD = { rows: [209, 199, 189, 179, 169, 159, 149, 139] }; // first pad channel per row (top row first)
const padCh = (row: number, col: number) => PAD.rows[row] + col; // row 0-7, col 0-7

interface BtnSpec {
  caption: string; funcName?: string; action: string; padRow: number; padCol: number;
  led: number; bg: number[]; frame: string; page?: number;
}
export interface Placed {
  row: number; col: number; caption: string; display: string; frame: string; osc: string;
  crc: number; pad: number; led: number; bg: number[]; action: string; funcName?: string;
  ftype: string; page: number; oscId: number; midiId: number;
}

let btnId = 100;
const placed: Placed[] = [];

// Pass 1 — record a look (reserve its two button IDs: OSC first, MIDI second). The XML is emitted
// later by renderButtons(), AFTER every look is placed, so each button can be positioned RELATIVE
// to its frame's bounding box. (QLC+ child <WindowState> X/Y are parent-relative, so absolute grid
// coords inside a bbox-positioned frame double-offset the button off-screen — vcframe.cpp:1035.)
// The caption carries the pad coordinate ("Red" r0c0 -> "Red R1C1"); the OSC path/name follow it.
function place(spec: BtnSpec) {
  if (spec.funcName !== undefined && funcIdByName.get(spec.funcName) === undefined)
    throw new Error(`Button "${spec.caption}" references unknown function`);
  const display = `${spec.caption} R${spec.padRow + 1}C${spec.padCol + 1}`;
  const osc = oscPath(display);
  const ftype = spec.funcName === undefined
    ? "Action"
    : funcs.find((f) => f.name === spec.funcName)?.type ?? "Scene";
  placed.push({
    row: spec.padRow, col: spec.padCol, caption: spec.caption, display, frame: spec.frame,
    osc, crc: crc16(osc), pad: padCh(spec.padRow, spec.padCol), led: spec.led, bg: spec.bg,
    action: spec.action, funcName: spec.funcName, ftype, page: spec.page ?? 0,
    oscId: btnId++, midiId: btnId++,
  });
}

// Pass 2 — emit a frame's <Button> XML, coords RELATIVE to the frame's bbox origin (min col/row),
// so buttons land on the true 8x8 grid and stay inside the frame (W90 H44 + 4px margin). The OSC
// button (Universe 0) is emitted before the MIDI one so widgets.json + the padCh test pick correctly.
function renderButtons(frameName: string, page: number): string[] {
  const items = placed.filter((p) => p.frame === frameName && p.page === page);
  if (items.length === 0) return [];
  const minCol = Math.min(...items.map((p) => p.col));
  const minRow = Math.min(...items.map((p) => p.row));
  const out: string[] = [];
  for (const p of items) {
    const x = 4 + (p.col - minCol) * 96;
    const y = 4 + (p.row - minRow) * 50;
    const bg = argb(p.bg[0], p.bg[1], p.bg[2]);
    const fIdAttr = p.funcName !== undefined ? `\n      <Function ID="${funcIdByName.get(p.funcName)}"/>` : "";
    const btn = (id: number, input: string) =>
`    <Button Caption="${esc(p.display)}" ID="${id}" Icon="">
      <WindowState Visible="True" X="${x}" Y="${y}" Width="90" Height="44"/>
      <Appearance>
       <FrameStyle>None</FrameStyle>
       <ForegroundColor>Default</ForegroundColor>
       <BackgroundColor>${bg}</BackgroundColor>
       <BackgroundImage>None</BackgroundImage>
       <Font>Default</Font>
      </Appearance>${fIdAttr}
      <Action>${p.action}</Action>
      ${input}
    </Button>`;
    out.push(btn(p.oscId, `<Input Universe="0" Channel="${p.crc}"/>`));
    out.push(btn(p.midiId, `<Input Universe="1" Channel="${p.pad}" LowerValue="${dimOf(p.led)}" UpperValue="${p.led}"/>`));
  }
  return out;
}

interface NavOpt { nextInput?: number; prevInput?: number; nextKey?: string; prevKey?: string; loop?: boolean; }
interface FrameOpts { page?: number; showHeader?: boolean; multipage?: number; currentPage?: number; nav?: NavOpt; }
function frame(tag: "SoloFrame" | "Frame", caption: string, id: number, x: number, y: number, w: number, h: number, inner: string[], opts: FrameOpts = {}): string {
  const pageAttr = opts.page !== undefined ? ` Page="${opts.page}"` : "";
  // Multipage + page-nav (vcframe.cpp loadXML / loadXMLSources). <Next>/<Previous> each take an
  // optional Launchpad <Input> (a grid-pad MIDI channel) AND/OR a keyboard <Key>. The Mini MK3's
  // top →/← arrows don't transmit on the Programmer port, so a real grid pad owns the switch;
  // PagesLoop=True lets that single Next pad wrap 2->1 (a one-pad toggle). vcframe's page-match
  // uses (page()<<16)|ch where page() is THIS frame's page in its parent (0 — the root's only
  // page), so the match is page-independent and the toggle works from either page.
  const multipage = opts.multipage ? `\n    <Multipage PagesNum="${opts.multipage}" CurrentPage="${opts.currentPage ?? 0}"/>` : "";
  const navSrc = (input?: number, key?: string) =>
    [input !== undefined ? `     <Input Universe="1" Channel="${input}"/>` : "",
     key ? `     <Key>${key}</Key>` : ""].filter(Boolean).join("\n");
  const nav = opts.nav
    ? `\n    <Next>\n${navSrc(opts.nav.nextInput, opts.nav.nextKey)}\n    </Next>\n    <Previous>\n${navSrc(opts.nav.prevInput, opts.nav.prevKey)}\n    </Previous>`
    : "";
  const pagesLoop = opts.multipage ? `\n    <PagesLoop>${opts.nav?.loop ? "True" : "False"}</PagesLoop>` : "";
  return `   <${tag} Caption="${esc(caption)}" ID="${id}"${pageAttr}>
    <Appearance>
     <FrameStyle>None</FrameStyle>
     <ForegroundColor>Default</ForegroundColor>
     <BackgroundColor>Default</BackgroundColor>
     <BackgroundImage>None</BackgroundImage>
     <Font>Default</Font>
    </Appearance>
    <WindowState Visible="True" X="${x}" Y="${y}" Width="${w}" Height="${h}"/>
    <AllowChildren>True</AllowChildren>
    <AllowResize>True</AllowResize>
    <ShowHeader>${opts.showHeader ? "True" : "False"}</ShowHeader>
    <ShowEnableButton>False</ShowEnableButton>
    <Collapsed>False</Collapsed>
    <Disabled>False</Disabled>${multipage}${nav}${pagesLoop}
${inner.join("\n")}
   </${tag}>`;
}

// VCSlider in Level mode — drives specific fixture channels. XML pinned from
// ui/src/virtualconsole/vcslider.cpp loadXML (SliderMode/Level/Channel/Playback).
function sliderXml(id: number, caption: string, x: number, chans: { fixture: number; ch: number }[], value: number, oscName: string): string {
  const channels = chans.map((c) => `     <Channel Fixture="${c.fixture}">${c.ch}</Channel>`).join("\n");
  return `    <Slider Caption="${esc(caption)}" ID="${id}" WidgetStyle="Slider" InvertedAppearance="false">
     <Appearance>
      <FrameStyle>None</FrameStyle>
      <ForegroundColor>Default</ForegroundColor>
      <BackgroundColor>Default</BackgroundColor>
      <BackgroundImage>None</BackgroundImage>
      <Font>Default</Font>
     </Appearance>
     <WindowState Visible="True" X="${x}" Y="16" Width="60" Height="320"/>
     <SliderMode ValueDisplayStyle="Exact" ClickAndGoType="None" Monitor="false">Level</SliderMode>
     <Level LowLimit="0" HighLimit="255" Value="${value}">
${channels}
     </Level>
     <Playback>
      <Function>4294967295</Function>
     </Playback>
     <Input Universe="0" Channel="${crc16(oscPath(oscName))}"/>
    </Slider>`;
}

// ============================================================================
// PAGE 1 — four NON-OVERLAPPING solo bands. QLC+ frames are opaque (can't be made
// transparent: QColor forces alpha opaque, vcwidget.cpp:883), so each solo group must own
// a CONTIGUOUS block of rows or the top frame hides the others. Layout (design plan):
//   rows 0-1 WASH-STATIC | rows 2-3 HEADS-STATIC | rows 4-6 DYNAMICS | row 7 CONTROL
// ============================================================================
// WASH-STATIC (solo): colours (r0) + band looks (r1) — pick one base wash
COLORS.forEach((c, i) => place({ caption: c.name, funcName: c.name, action: "Toggle", padRow: 0, padCol: i, led: c.led, bg: c.bg, frame: "WASH-STATIC" }));
BAND.forEach((b, i) => place({ caption: b.name, funcName: b.name, action: "Toggle", padRow: 1, padCol: i, led: b.led, bg: b.bg, frame: "WASH-STATIC" }));
// HEADS-STATIC (solo): positions (r2) + beams/gobo (r3) — pick one head look
POSITIONS.forEach((p, i) => place({ caption: p.name, funcName: p.name, action: "Toggle", padRow: 2, padCol: i, led: p.led, bg: p.bg, frame: "HEADS-STATIC" }));
BEAMS.forEach((b, i) => place({ caption: b.name, funcName: b.name, action: "Toggle", padRow: 3, padCol: i, led: b.led, bg: b.bg, frame: "HEADS-STATIC" }));
// DYNAMICS (solo, ONE effect at a time): chases (r4) / autos+stabs+pixel (r5) / builds+head-moves+park (r6)
const DYN: { n: string; led: number; bg: number[] }[][] = [
  [ // r4 — chases + bar effects
    { n: "Rainbow", led: 42, bg: [80, 40, 160] }, { n: "Police", led: 42, bg: [80, 40, 160] },
    { n: "Strobe Color", led: 42, bg: [80, 40, 160] }, { n: "Bar Chase", led: 42, bg: [80, 40, 160] },
    { n: "Bounce", led: 42, bg: [80, 40, 160] }, { n: "Slow Cycle", led: 42, bg: [80, 40, 160] },
    { n: "Bar Scroll", led: 74, bg: [0, 200, 200] }, { n: "Bar Bounce", led: 66, bg: [0, 200, 120] },
  ],
  [ // r5 — wash dynamics: autos, morphs, stabs, pixel
    { n: "Pars Auto", led: 42, bg: [0, 200, 0] }, { n: "Bars Auto", led: 26, bg: [220, 200, 0] },
    { n: "Pars Morph", led: 42, bg: [0, 160, 0] }, { n: "Bars Morph", led: 26, bg: [180, 160, 0] },
    { n: "Color Stab", led: 106, bg: [255, 0, 200] }, { n: "Kill Strobe", led: 6, bg: [255, 255, 255] },
    { n: "Par Run", led: 114, bg: [255, 0, 160] }, { n: "Pixel Bounce", led: 114, bg: [255, 0, 160] },
  ],
  [ // r6 — builds + song presets + head movement + park
    { n: "Alt Flash", led: 18, bg: [255, 120, 0] }, { n: "Build Drop", led: 10, bg: [255, 0, 0] },
    // Item B (2026-06-09): 3 one-tap song presets surfaced onto page 1 (distracted-operator safety net),
    // replacing Head Sweep Slow/Fast + Head Circle — those 3 still live on page-2 HEADS2, so no loss.
    // They reuse the page-2 PRESET scenes (extra duplicate OSC path each, cosmetic, like the head dups).
    { n: "Opener", led: 6, bg: [255, 255, 255] }, { n: "Chorus Warm", led: 18, bg: [255, 80, 0] },
    { n: "Breakdown UV", led: 90, bg: [60, 0, 120] }, { n: "Audience Sweep", led: 82, bg: [0, 60, 200] },
    { n: "Cross Zigzag", led: 106, bg: [200, 0, 160] }, { n: "Park All", led: 18, bg: [120, 80, 0] },
  ],
];
// Skip pads whose function was conditionally dropped (no bars -> no Bar Chase, etc.);
// the original column index is kept so the grid layout stays stable with gaps.
DYN.forEach((row, ri) => row.forEach((d, i) => {
  if (!funcIdByName.has(d.n)) return;
  place({ caption: d.n, funcName: d.n, action: "Toggle", padRow: 4 + ri, padCol: i, led: d.led, bg: d.bg, frame: "DYNAMICS" });
}));
// CONTROL (non-solo, row 7): FX flash (c0-3) + Full On / Sound Active / Blackout (c4-6).
// c7 (R8C8) carries NO look — it is the page-flip pad (the "Pages" frame's Next input, ch 146).
place({ caption: "Strobe All",   funcName: "Strobe All",   action: "Flash",    padRow: 7, padCol: 0, led: 6,   bg: [255, 255, 255], frame: "CONTROL" });
place({ caption: "Blinder",      funcName: "Blinder",      action: "Flash",    padRow: 7, padCol: 1, led: 6,   bg: [255, 255, 255], frame: "CONTROL" });
place({ caption: "UV Pop",       funcName: "UV Pop",       action: "Flash",    padRow: 7, padCol: 2, led: 90,  bg: [120, 0, 220],   frame: "CONTROL" });
place({ caption: "Color Burst",  funcName: "Color Burst",  action: "Flash",    padRow: 7, padCol: 3, led: 106, bg: [255, 0, 160],   frame: "CONTROL" });
place({ caption: "Full On",      funcName: "Full On",      action: "Toggle",   padRow: 7, padCol: 4, led: 6,   bg: [255, 255, 255], frame: "CONTROL" });
place({ caption: "Sound Active", funcName: "Sound Active", action: "Toggle",   padRow: 7, padCol: 5, led: 26,  bg: [200, 200, 0],   frame: "CONTROL" });
place({ caption: "Blackout",                               action: "Blackout", padRow: 7, padCol: 6, led: 10,  bg: [40, 40, 40],    frame: "CONTROL" });

// ============================================================================
// PAGE 2 — 5 solo bands (already row-contiguous = non-overlapping) + the FADERS frame.
// Reuses the same 64 pad channels; multipage isolation keeps page-1/page-2 pads apart.
//   r0 PARS | r1 BARS | r2-4 HEADS2 | r5 CHASE2 | r6-7 PRESETS
// ============================================================================
// r0 PARS colour / r1 BARS colour — independent per-group solo frames
COLORS.forEach((c, i) => place({ caption: `Pars ${c.name}`, funcName: `Pars ${c.name}`, action: "Toggle", padRow: 0, padCol: i, led: c.led, bg: c.bg, frame: "PARS", page: 1 }));
COLORS.forEach((c, i) => place({ caption: `Bars ${c.name}`, funcName: `Bars ${c.name}`, action: "Toggle", padRow: 1, padCol: i, led: c.led, bg: c.bg, frame: "BARS", page: 1 }));

// r2 HEADS colour / r3 HEADS gobo / r4 HEADS movement — all one HEADS2 solo frame (one head look)
const HEAD_LED = [6, 18, 42, 74, 10, 42, 106, 26];
const HEAD_BG: number[][] = [[230,230,230],[255,140,0],[120,255,0],[0,220,220],[255,0,0],[0,220,0],[255,0,200],[255,220,0]];
HCOL.forEach(([n], i) => place({ caption: n, funcName: n, action: "Toggle", padRow: 2, padCol: i, led: HEAD_LED[i], bg: HEAD_BG[i], frame: "HEADS2", page: 1 }));
const GOBO_BTN = [...GOBOZ.map(([n]) => n), "Prism"];
GOBO_BTN.forEach((n, i) => place({ caption: n, funcName: n, action: "Toggle", padRow: 3, padCol: i, led: 74, bg: [0, 160, 200], frame: "HEADS2", page: 1 }));
const MOVE = ["Head Circle", "Audience Sweep", "Cross Zigzag", "Head Sweep Slow", "Head Sweep Fast", "Figure 8", "Pan Wave", "Tilt Dip"];
MOVE.forEach((n, i) => place({ caption: n, funcName: n, action: "Toggle", padRow: 4, padCol: i, led: 82, bg: [0, 120, 220], frame: "HEADS2", page: 1 }));

// r5 CHASES 2 — own solo frame
const CH2 = ["Rainbow Fast", "Strobe Rainbow", "Chase Up", "Chase Down", "Two Tone", "Par Sparkle", "Color Pop", "Mega Build"];
CH2.forEach((n, i) => {
  if (!funcIdByName.has(n)) return; // dropped with its fixture kind (e.g. no bars -> no Chase Up)
  place({ caption: n, funcName: n, action: "Toggle", padRow: 5, padCol: i, led: 42, bg: [120, 40, 160], frame: "CHASE2", page: 1 });
});

// r6-r7 SONG presets — full-stage, solo (one song look)
PRESETS.forEach((p, i) => place({ caption: p.name, funcName: p.name, action: "Toggle", padRow: 6 + Math.floor(i / 8), padCol: i % 8, led: p.led, bg: p.bar, frame: "PRESETS", page: 1 }));

// ============================================================================
// SIMPLE PAGE (page index 2) — the "get through the show" page. The show BOOTS here
// (CurrentPage=2); the R8C8 pad then cycles SIMPLE -> page1 -> page2 -> SIMPLE. It reuses
// existing functions ONLY (PRESET scenes, COLORS washes, MOVE chasers) — no new looks, and
// pages 0/1 are untouched. Each button reuses a function but gets its own pad + OSC path;
// multipage isolation gates the shared pad channels (same trick the page1/page2 reuse uses).
//   r0-1 PRESETS (home base) | r3 WASH colour | r5 MOVE | r7 utility (+ R8C8 page-flip)
// ============================================================================
PRESETS.forEach((p, i) => place({ caption: p.name, funcName: p.name, action: "Toggle", padRow: Math.floor(i / 8), padCol: i % 8, led: p.led, bg: p.bar, frame: "SIMPLE-PRESETS", page: 2 }));
COLORS.forEach((c, i) => place({ caption: c.name, funcName: c.name, action: "Toggle", padRow: 3, padCol: i, led: c.led, bg: c.bg, frame: "SIMPLE-WASH", page: 2 }));
MOVE.forEach((n, i) => place({ caption: n, funcName: n, action: "Toggle", padRow: 5, padCol: i, led: 82, bg: [0, 120, 220], frame: "SIMPLE-MOVE", page: 2 }));
// utility (row 7, non-solo): big strobe hit, full-on, blackout. c7 is the page-flip pad (no look).
place({ caption: "Strobe All", funcName: "Strobe All", action: "Flash",    padRow: 7, padCol: 0, led: 6,  bg: [255, 255, 255], frame: "SIMPLE-CONTROL", page: 2 });
place({ caption: "Full On",    funcName: "Full On",    action: "Toggle",   padRow: 7, padCol: 4, led: 6,  bg: [255, 255, 255], frame: "SIMPLE-CONTROL", page: 2 });
place({ caption: "Blackout",                           action: "Blackout", padRow: 7, padCol: 6, led: 10, bg: [40, 40, 40],    frame: "SIMPLE-CONTROL", page: 2 });

// ----------------------------------------------------------------------------
// Assemble XML
// ----------------------------------------------------------------------------
// Fixture group: the bars as a (bars*3)-pixel horizontal canvas (each T3-BT exposes 3 heads).
interface FixGroup { id: number; name: string; size: [number, number]; heads: { x: number; y: number; fixture: number; head: number }[]; }
const fixtureGroups: FixGroup[] = [];
if (bars.length > 0) {
  const gh: FixGroup["heads"] = [];
  bars.forEach((f, bi) => { for (let h = 0; h < 3; h++) gh.push({ x: bi * 3 + h, y: 0, fixture: f.id, head: h }); });
  fixtureGroups.push({ id: 0, name: "Bars", size: [bars.length * 3, 1], heads: gh });
}
function fixtureGroupXml(g: FixGroup): string {
  const heads = g.heads.map((h) => `   <Head X="${h.x}" Y="${h.y}" Fixture="${h.fixture}">${h.head}</Head>`).join("\n");
  return `  <FixtureGroup ID="${g.id}">
   <Name>${esc(g.name)}</Name>
   <Size X="${g.size[0]}" Y="${g.size[1]}"/>
${heads}
  </FixtureGroup>`;
}
function fixtureXml(f: Fixture): string {
  return `  <Fixture>
   <Manufacturer>${esc(f.manuf)}</Manufacturer>
   <Model>${esc(f.model)}</Model>
   <Mode>${esc(f.mode)}</Mode>
   <ID>${f.id}</ID>
   <Name>${esc(f.name)}</Name>
   <Universe>0</Universe>
   <Address>${f.address}</Address>
   <Channels>${f.channels}</Channels>
  </Fixture>`;
}

function funcXml(fn: FuncDef): string {
  if (fn.type === "RGBMatrix") {
    return `  <Function ID="${fn.id}" Type="RGBMatrix" Name="${esc(fn.name)}">
   <Speed FadeIn="0" FadeOut="0" Duration="${fn.duration}"/>
   <Direction>${fn.direction}</Direction>
   <RunOrder>${fn.runOrder}</RunOrder>
   <Algorithm Type="Script">${esc(fn.script)}</Algorithm>
   <Color Index="0">${fn.color >>> 0}</Color>
   <ControlMode>RGB</ControlMode>
   <FixtureGroup>${fn.group}</FixtureGroup>
  </Function>`;
  }
  if (fn.type === "Scene") {
    const fv = fn.vals
      .filter((v) => v.pairs.length > 0)
      .map((v) => `   <FixtureVal ID="${v.id}">${v.pairs.join(",")}</FixtureVal>`)
      .join("\n");
    return `  <Function ID="${fn.id}" Type="Scene" Name="${esc(fn.name)}">
   <Speed FadeIn="${fn.fadeIn}" FadeOut="${fn.fadeOut}" Duration="0"/>
${fv}
  </Function>`;
  }
  const steps = fn.steps
    .map((sid, i) => `   <Step Number="${i}" FadeIn="${fn.fade}" Hold="${fn.hold}" FadeOut="${fn.fade}">${sid}</Step>`)
    .join("\n");
  return `  <Function ID="${fn.id}" Type="Chaser" Name="${esc(fn.name)}">
   <Speed FadeIn="${fn.fade}" FadeOut="${fn.fade}" Duration="${fn.hold}"/>
   <Direction>${fn.direction}</Direction>
   <RunOrder>${fn.runOrder}</RunOrder>
   <SpeedModes FadeIn="Common" FadeOut="Common" Duration="Common"/>
${steps}
  </Function>`;
}

// Each frame is sized to the tight bounding box of its looks. On a given page the frames are
// NON-OVERLAPPING row-bands (QLC+ frames are opaque — overlap would hide buttons), and buttons are
// positioned RELATIVE to their frame (renderButtons), so the 8x8 grid renders cleanly and matches
// the Launchpad/dashboard. Page-1 and page-2 frames share screen space but never show together
// (multipage hides the off-page frames).
function frameBBox(name: string) {
  const ps = placed.filter((p) => p.frame === name);
  if (ps.length === 0)
    throw new Error(`Frame "${name}" has no buttons — this rig dropped every look in it; remove the frame or add fixtures`);
  const cols = ps.map((p) => p.col), rows = ps.map((p) => p.row);
  return {
    x: 10 + Math.min(...cols) * 96 - 4,
    y: 12 + Math.min(...rows) * 50 - 4,
    w: (Math.max(...cols) - Math.min(...cols)) * 96 + 98,
    h: (Math.max(...rows) - Math.min(...rows)) * 50 + 52,
  };
}
// Page-1 bands
const bWS = frameBBox("WASH-STATIC"), bHS = frameBBox("HEADS-STATIC"), bDyn = frameBBox("DYNAMICS"), bCtl = frameBBox("CONTROL");
// Page-2 bands
const bPars = frameBBox("PARS"), bBars = frameBBox("BARS"), bH2 = frameBBox("HEADS2"),
      bCh2 = frameBBox("CHASE2"), bPre = frameBBox("PRESETS");
// SIMPLE-page bands (page index 2)
const bSPre = frameBBox("SIMPLE-PRESETS"), bSWash = frameBBox("SIMPLE-WASH"),
      bSMove = frameBBox("SIMPLE-MOVE"), bSCtl = frameBBox("SIMPLE-CONTROL");
// FADERS (page 2): per-group Dim masters (own the dimmer channels the builders no longer set;
// default 255 = full) + Strobe Rate + Heads Zoom. Master Dim = the built-in GrandMaster (global,
// Properties below). The frame sits to the RIGHT of the grid; slider X is relative to the frame.
const strobeChans = [
  ...pars.map((f) => ({ fixture: f.id, ch: 1 })),
  ...bars.map((f) => ({ fixture: f.id, ch: 9 })),
  ...heads.map((f) => ({ fixture: f.id, ch: 11 })),
];
// One fader slot (72px) per group that exists on this rig; X positions reflow left-to-right.
const faderDefs: { id: number; caption: string; chans: { fixture: number; ch: number }[]; value: number; osc: string }[] = [];
if (pars.length)  faderDefs.push({ id: 900, caption: "Pars Dim",  chans: pars.map((f) => ({ fixture: f.id, ch: 0 })),  value: 255, osc: "/pars_dim" });
if (bars.length)  faderDefs.push({ id: 901, caption: "Bars Dim",  chans: bars.map((f) => ({ fixture: f.id, ch: 12 })), value: 255, osc: "/bars_dim" });
if (heads.length) faderDefs.push({ id: 902, caption: "Heads Dim", chans: heads.map((f) => ({ fixture: f.id, ch: 10 })), value: 255, osc: "/heads_dim" });
faderDefs.push({ id: 903, caption: "Strobe Rate", chans: strobeChans, value: 0, osc: "/strobe_rate" });
if (heads.length) faderDefs.push({ id: 904, caption: "Heads Zoom", chans: heads.map((f) => ({ fixture: f.id, ch: 14 })), value: 128, osc: "/heads_zoom" });
const faderBtns = faderDefs.map((d, i) => sliderXml(d.id, d.caption, 12 + i * 72, d.chans, d.value, d.osc));

// All sub-frames live inside ONE multipage GRID frame — NOT the root frame. The root VC frame is
// built with no header (m_hbox == NULL); setMultipageMode() dereferences that header layout ->
// QLC+ 4.14.4 segfaults on load. A normal child frame has header infra even with ShowHeader=False,
// so multipage is safe there. GRID sits at (0,0); page switch = the bottom-right pad (R8C8 = ch146).
const gridInner = [
  frame("SoloFrame", "WASH (colours)", 0, bWS.x, bWS.y, bWS.w, bWS.h, renderButtons("WASH-STATIC", 0), { page: 0 }),
  frame("SoloFrame", "HEADS (static)", 1, bHS.x, bHS.y, bHS.w, bHS.h, renderButtons("HEADS-STATIC", 0), { page: 0 }),
  frame("SoloFrame", "DYNAMICS", 2, bDyn.x, bDyn.y, bDyn.w, bDyn.h, renderButtons("DYNAMICS", 0), { page: 0 }),
  frame("Frame", "CONTROL", 3, bCtl.x, bCtl.y, bCtl.w, bCtl.h, renderButtons("CONTROL", 0), { page: 0 }),
  frame("SoloFrame", "PARS", 4, bPars.x, bPars.y, bPars.w, bPars.h, renderButtons("PARS", 1), { page: 1 }),
  frame("SoloFrame", "BARS", 5, bBars.x, bBars.y, bBars.w, bBars.h, renderButtons("BARS", 1), { page: 1 }),
  frame("SoloFrame", "HEADS2", 6, bH2.x, bH2.y, bH2.w, bH2.h, renderButtons("HEADS2", 1), { page: 1 }),
  frame("SoloFrame", "CHASE2", 7, bCh2.x, bCh2.y, bCh2.w, bCh2.h, renderButtons("CHASE2", 1), { page: 1 }),
  frame("SoloFrame", "PRESETS", 8, bPre.x, bPre.y, bPre.w, bPre.h, renderButtons("PRESETS", 1), { page: 1 }),
  frame("Frame", "FADERS", 9, 800, 8, 12 + faderDefs.length * 72, 360, faderBtns, { page: 1 }),
  // SIMPLE page (index 2) — boots first; reuses existing functions, four row-bands
  frame("SoloFrame", "PRESETS (songs)", 11, bSPre.x, bSPre.y, bSPre.w, bSPre.h, renderButtons("SIMPLE-PRESETS", 2), { page: 2 }),
  frame("SoloFrame", "WASH (colour)", 12, bSWash.x, bSWash.y, bSWash.w, bSWash.h, renderButtons("SIMPLE-WASH", 2), { page: 2 }),
  frame("SoloFrame", "MOVE", 13, bSMove.x, bSMove.y, bSMove.w, bSMove.h, renderButtons("SIMPLE-MOVE", 2), { page: 2 }),
  frame("Frame", "CONTROL", 14, bSCtl.x, bSCtl.y, bSCtl.w, bSCtl.h, renderButtons("SIMPLE-CONTROL", 2), { page: 2 }),
];
// Page switch: the bottom-right grid pad (R8C8 = MIDI ch 146) toggles pages from the Launchpad
// (PagesLoop wraps 2->1, so one pad cycles), plus PgDn/PgUp on the computer keyboard as a backup.
// That pad fires no look on either page (Panic / Glow Out were dropped to free it).
const grid = frame("Frame", "Pages", 10, 0, 0, 1180, 460, gridInner,
  { multipage: 3, currentPage: 2, nav: { nextInput: 146, nextKey: "PgDown", prevKey: "PgUp", loop: true } });

const vc = `<VirtualConsole>
 <Frame Caption="">
  <Appearance>
   <FrameStyle>None</FrameStyle>
   <ForegroundColor>Default</ForegroundColor>
   <BackgroundColor>Default</BackgroundColor>
   <BackgroundImage>None</BackgroundImage>
   <Font>Default</Font>
  </Appearance>
${grid}
 </Frame>
 <Properties>
  <Size Width="1180" Height="470"/>
  <GrandMaster ChannelMode="Intensity" ValueMode="Reduce" SliderMode="Normal"/>
 </Properties>
</VirtualConsole>`;

// Local MIDI device binding for the Launchpad (rig.controller). QLC+'s Win32 MIDI plugin
// uses the winmm device INDEX as the UID (see plugins/midi/src/win32 extractUID). If a
// replug/reboot reorders MIDI devices, update the rig's UIDs/lines (or remap in QLC+
// Inputs/Outputs). On a Mini MK3, use the SECOND MIDI port (MIDIIN2 / MIDIOUT2) — the
// dedicated Programmer-mode port pads transmit on (and that QLC+ must use for pad LEDs).
const LP = rig.controller ?? { launchpad: false, inputUid: "None", inputLine: "0", outputUid: "None", outputLine: "0" };
const LP_IN_UID = LP.launchpad ? LP.inputUid : "None", LP_IN_LINE = LP.launchpad ? LP.inputLine : "0";
const LP_OUT_UID = LP.launchpad ? LP.outputUid : "None", LP_OUT_LINE = LP.launchpad ? LP.outputLine : "0";
const LP_PROFILE = LP.launchpad ? (LP.profile ?? "Novation Launchpad Mini MK3") : null;

// 2D Monitor stage layout (positions in mm on a 5x5m grid) so the Fixture Monitor's
// 2D view shows the rig laid out: pars front row, bars mid, heads upstage — each kind
// spread evenly. Element/attr names per engine/src/monitorproperties.cpp (DisplayMode 1 = 2D).
function spread(i: number, n: number): number {
  return Math.round((5000 * (i + 0.5)) / Math.max(1, n));
}
function fxPos(f: Fixture): { x: number; y: number } {
  if (f.kind === "par") return { x: spread(pars.indexOf(f), pars.length), y: 3800 };
  if (f.kind === "bar") return { x: spread(bars.indexOf(f), bars.length), y: 2400 };
  return { x: spread(heads.indexOf(f), heads.length), y: 900 };
}
const monitorXml = `  <Monitor DisplayMode="1" ShowLabels="1">
   <Grid Width="5" Height="4" Depth="4" Units="0"/>
${fixtures
  .map((f) => { const p = fxPos(f); return `   <FxItem ID="${f.id}" XPos="${p.x}" YPos="${p.y}" ZPos="0"/>`; })
  .join("\n")}
  </Monitor>`;

const dmxOut = rig.dmxOutput ?? { plugin: "ArtNet", universe: 0, transmitMode: "Standard", outputIp: null };
const outputIpAttr = dmxOut.outputIp ? ` outputIP="${esc(dmxOut.outputIp)}"` : "";
const dmxNote = dmxOut.notes ? `<!-- ${esc(dmxOut.notes)} -->` : `<!-- no outputIP -> broadcast -->`;
const launchpadUniverse = LP.launchpad
  ? `   <Universe Name="Launchpad" ID="1" Profile="${esc(LP_PROFILE!)}">
    <Input Plugin="MIDI" UID="${LP_IN_UID}" Line="${LP_IN_LINE}"/>
    <Feedback Plugin="MIDI" UID="${LP_OUT_UID}" Line="${LP_OUT_LINE}"/>
   </Universe>`
  : `   <Universe Name="Controller" ID="1"/>`;
const qxw = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE Workspace>
<Workspace xmlns="http://www.qlcplus.org/Workspace" CurrentWindow="VirtualConsole">
 <Creator>
  <Name>Q Light Controller Plus</Name>
  <Version>4.14.3</Version>
  <Author>${esc(rig.meta.author ?? "QLCPlus-MCP")}</Author>
 </Creator>
 <Engine>
  <InputOutputMap>
   <BeatGenerator BeatType="Disabled" BPM="0"/>
   <Universe Name="Stage" ID="0">
    <Input Plugin="OSC" UID="None" Line="0"/>
    <Output Plugin="${esc(dmxOut.plugin)}" UID="None" Line="0">
     <PluginParameters outputUni="${dmxOut.universe}" transmitMode="${esc(dmxOut.transmitMode)}"${outputIpAttr}/>
    </Output>${dmxNote}
    <Feedback Plugin="OSC" UID="None" Line="0"/>
   </Universe>
${launchpadUniverse}
  </InputOutputMap>
${fixtures.map(fixtureXml).join("\n")}
${fixtureGroups.map(fixtureGroupXml).join("\n")}
${funcs.map(funcXml).join("\n")}
${monitorXml}
 </Engine>
 ${vc}
</Workspace>
`;

// Write the show, then write-PROTECT it: QLC+ re-serializes (and CLOBBERS) the project on Save,
// which once overwrote this generated file with a stale build. Read-only stops that — edit
// build-show.ts and regenerate to change the show; don't Save inside QLC+. (Clear RO before writing
// so a re-run can overwrite.)
const qxwPath = path.join(OUT, QXW_FILE);
if (existsSync(qxwPath)) { try { chmodSync(qxwPath, 0o666); } catch { /* not RO yet */ } }
writeFileSync(qxwPath, qxw, "utf8");
try { chmodSync(qxwPath, 0o444); } catch { /* best-effort write-protect */ }

// ----------------------------------------------------------------------------
// PATCH-CHART.md (ASCII)
// ----------------------------------------------------------------------------
function patchRows(): string {
  return fixtures
    .map((f) => {
      const start = f.address + 1; // 1-based for the operator
      const end = f.address + f.channels;
      return `  ${String(start).padStart(3)}-${String(end).padStart(3)}  ${f.name.padEnd(14)} ${f.model} (${f.mode})`;
    })
    .join("\n");
}
function gridAscii(page: number): string {
  const cell = (r: number, c: number) => {
    const g = placed.find((x) => x.row === r && x.col === c && x.page === page);
    return (g ? g.caption : "").slice(0, 12).padEnd(12);
  };
  const lines: string[] = [];
  for (let r = 0; r < 8; r++) {
    lines.push("  | " + Array.from({ length: 8 }, (_, c) => cell(r, c)).join(" | ") + " |");
  }
  return lines.join("\n  " + "-".repeat(8 * 15) + "\n");
}
// Per-look lookup table (locate / update): name -> page, R/C pad coord, Launchpad channel, OSC path.
// Sorted page -> row -> col. caption here is the BASE name; the on-button caption appends the R/C.
function lookIndex(): string {
  const head = "| Look | Pg | R/C | Pad | OSC |\n|------|----|-----|-----|-----|";
  const rows = [...placed]
    .sort((a, b) => a.page - b.page || a.row - b.row || a.col - b.col)
    .map((g) => `| ${g.caption} | ${g.page + 1} | R${g.row + 1}C${g.col + 1} | ${g.pad} | \`${g.osc}\` |`)
    .join("\n");
  return `${head}\n${rows}`;
}

const chart = `# ${rig.meta.name} — Patch Chart & Launchpad Map

Generated by scripts/build-show.ts from ${path.basename(rigPath)}. Output: ${dmxOut.plugin}
**Universe ${dmxOut.universe}** (one DMX universe,
${fixtures.reduce((a, f) => Math.max(a, f.address + f.channels), 0)} of 512 channels used).

## DMX patch — set each light to its START address

\`\`\`
  ADDR     FIXTURE         MODEL (MODE)
${patchRows()}
\`\`\`

Leave headroom between fixture addresses where you can, so a mode change won't force a
re-patch. All fixtures on one universe.

## Launchpad Mini MK3 — 8x8 grid (Programmer Mode)

Three pages. The show **boots on the SIMPLE page**. **Press the bottom-right pad (R8C8) to cycle
pages** — SIMPLE → Page 1 → Page 2 → SIMPLE. That corner pad is the page-toggle on every page and
fires no look. (The Mini MK3's top →/← arrows don't transmit on the Programmer port, so a real grid
pad owns the switch.) On the computer keyboard, **PgDn / PgUp** also switch pages.

### SIMPLE — the show boots here (presets + one colour + one movement)
\`\`\`
${gridAscii(2)}
\`\`\`

### Page 1 (cycle with the R8C8 pad)
\`\`\`
${gridAscii(0)}
\`\`\`

### Page 2 (cycle with the R8C8 pad)
\`\`\`
${gridAscii(1)}
\`\`\`

Pads light in their look color when active (LED feedback). On Page 2 the console shows five faders
(Pars Dim, Bars Dim, Heads Dim, Strobe Rate, Heads Zoom), all default full; Master Dim is the
built-in GrandMaster (top-right of the console) and dims everything globally.

## Look index — every pad (locate / update)

Sorted by page, then row, then column. **R/C** = the 8×8 pad coordinate (1-indexed, top-left =
R1C1); **Pad** = the Launchpad MIDI channel; **OSC** = the dashboard path. Each on-screen button's
caption shows its R/C after the name (e.g. \`Red R1C1\`). The **Pg** column is the internal page
index — **Pg 3 = the SIMPLE page**, which the show boots on (cycle order: SIMPLE → 1 → 2).

${lookIndex()}

## Control surfaces

- **Launchpad** (MIDI): the 8x8 grid above. Requires Programmer Mode — see SHOW-SETUP.md.
- **MCP / dashboard** (OSC): every look has an OSC path = \`/\` + lowercase name, spaces -> \`_\`
  (e.g. "Red" -> \`/red\`, "Strobe Color" -> \`/strobe_color\`). Fire via the dashboard or
  \`qlc_button_press\`. Bindings are pre-baked (CRC-16 of the path); no Auto-Detect needed.
`;

writeFileSync(path.join(OUT, "PATCH-CHART.md"), chart, "utf8");

// ----------------------------------------------------------------------------
// SETUP-MANUAL.html (self-contained user manual)
// ----------------------------------------------------------------------------
const maxCh = fixtures.reduce((a, f) => Math.max(a, f.address + f.channels), 0);
writeFileSync(
  path.join(OUT, "SETUP-MANUAL.html"),
  renderManual({
    placed,
    fixtures: fixtures.map((f) => ({
      name: f.name, model: f.model, mode: f.mode, channels: f.channels, start: f.address + 1, end: f.address + f.channels,
    })),
    maxCh,
    counts: { fixtures: fixtures.length, functions: funcs.length, looks: placed.length },
    showName: rig.meta.name,
    qxwFile: QXW_FILE,
    qxfFiles: rig.fixtures.map((g) => g.qxfFile).filter((p): p is string => !!p),
  }),
  "utf8",
);

console.log(`OK  crc16 check passed (0x906e); crc16("/rainbow")=${crc16("/rainbow")}`);
console.log(`    rig=${path.basename(rigPath)}  fixtures=${fixtures.length}  functions=${funcs.length}  buttons=${btnId - 100}`);
console.log(`    wrote ${QXW_FILE}, PATCH-CHART.md, SETUP-MANUAL.html`);
