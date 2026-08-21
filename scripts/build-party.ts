/*
 * build-party.ts — generates the BAR MITZVAH PARTY show (<show>.qxw + PATCH-CHART.md +
 * SETUP-MANUAL.html + config/launchpad-leds.json) from a rig whose meta.builder is "party".
 *
 * Fork of build-show.ts (the punk/band builder). The INFRASTRUCTURE is identical — CRC-16 OSC
 * hashes, the dual OSC+MIDI button model, frames, sliders, the read-only .qxw write. What differs
 * is the SHOW DESIGN:
 *
 *   - 5 chronological Launchpad pages (INTRO / DINNER / SPEECHES / HORA / PARTY), not 3 energy tiers.
 *   - Rows R7 (brightness) and R8 (utility) are IDENTICAL on every page — muscle memory in the dark.
 *   - LOOKS NEVER WRITE A DIMMER. Brightness belongs to the R7 dim pads + the faders. The two
 *     deliberate exceptions are marked inline (Panic, Strobe Burst, Speaker Light) — break-glass
 *     buttons that must light the room whatever else is set.
 *   - Two head groups: "Truss" (2 on 8ft truss, dance-floor sweeps + speaker light) and "Floor"
 *     (2 on the floor directly below them, cross-shooting the backdrop banner).
 *   - Tap tempo (VCSpeedDial) drives every chaser; audio triggers pulse the pars off the beat.
 *
 * Run:  npx tsx scripts/build-party.ts [path/to/rig.json]
 * then: npm run generate:widgets ./<show>.qxw config/widgets.json
 * (or just `npm run generate`, which dispatches here on rig.meta.builder — generate-all-helpers.ts)
 *
 * XML shapes mirror QLC+ 4.14.3's own saveXML/loadXML. The SpeedDial + AudioTriggers contracts are
 * pinned from source in docs/qlc-xml-notes.md — read that before touching either emitter.
 * Spec: docs/superpowers/specs/2026-08-19-bar-mitzvah-party-show-design.md
 */

import { writeFileSync, chmodSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { renderManual } from "./manual.js";
import { loadRig, slugify } from "./rig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");

const { rig, rigPath } = loadRig(process.argv[2]);
if (rig.meta.builder !== "party")
  throw new Error(
    `build-party.ts requires meta.builder="party" (got "${rig.meta.builder ?? "none"}") — ` +
      `band/punk rigs build with scripts/build-show.ts`,
  );

const SHOW_SLUG = slugify(rig.meta.name);
const QXW_FILE = `${SHOW_SLUG}.qxw`;
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

// Mirror of src/qlc/qxwParser.ts getWidgetPath so OSC paths match.
function oscPath(name: string): string {
  return `/${name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ /g, "_")}`;
}

const check = crc16("123456789");
if (check !== 0x906e)
  throw new Error(`CRC algorithm wrong: crc16("123456789")=0x${check.toString(16)}, expected 0x906e`);

// ----------------------------------------------------------------------------
// XML helpers
// ----------------------------------------------------------------------------
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function argb(r: number, g: number, b: number): number {
  return ((0xff << 24) | (r << 16) | (g << 8) | b) >>> 0;
}
// Mini MK3 palette: the 30% variant of a 100% value V is V+4 (white 100%=6 -> 30%=2; 0 stays off).
function dimOf(v: number): number {
  return v <= 0 ? 0 : v === 6 ? 2 : v + 4;
}

// ----------------------------------------------------------------------------
// Fixtures — par 10ch (0 Dim 1 Strobe 2 R 3 G 4 B 5 W 6 A 7 UV 8 Macro 9 Speed),
// head 15ch (0 Pan 1 PanF 2 Tilt 3 TiltF 4 PTSpeed 5 Color 6 Gobo 7 GoboRot 8 Prism
// 9 Focus 10 Dim 11 Shutter 12 Ctrl 13 Mov 14 Zoom). Counts/addresses/names from rig.json.
// ----------------------------------------------------------------------------
const headGroup = rig.fixtures.find((g) => g.kind === "head");
const SHUTTER_OPEN = headGroup?.beam?.shutterOpen ?? 255;
const HEAD_COLOR: Record<string, number> = {
  white: 0, orange: 8, lime: 16, cyan: 24, red: 36, green: 44, magenta: 50, yellow: 60,
  ...(headGroup?.colorWheel ?? {}),
};

// Beam channels on the Chauvet 375Z IRC, straight from its QLC+ fixture definition.
//   ch6 "Gobo":          0-7 open · seven gobos in 8-wide bands from 8 · 64-119 the same gobos
//                        shaking · 128-189 CYCLE gobos slow->fast · 194-255 reverse cycle.
//   ch7 "Gobo Rotation": 1-63 indexed (hold an angle) · 64-145 rotate slow->fast · 146-149 stop
//                        · 150-231 reverse · 232-255 bounce.
//   ch8 "Prism":         4-6 six-facet in · 7-65 six-facet rotating slow->fast · 132-134 five-facet.
// Gobo slots come from rig.json when the fixture disagrees; these are the band midpoints.
const GOBO_SLOTS: number[] = headGroup?.goboSlots ?? [11, 19, 27, 35, 43, 51, 59];
const GOBO = {
  open: 0,
  slot: (i: number) => GOBO_SLOTS[i % GOBO_SLOTS.length],
  shake: 100,        // mid of the shake bands — a gobo that vibrates on the beat
  cycleSlow: 140,
  cycleFast: 178,
};
const GROT = { off: 0, hold: 32, slow: 80, mid: 110, fast: 140, reverse: 190, bounce: 240 };
const PRISM = { off: 0, on: 5, spinSlow: 20, spinFast: 55 };

interface Fixture {
  id: number; manuf: string; model: string; mode: string; name: string;
  address: number; channels: number; kind: "par" | "bar" | "head";
}

const fixtures: Fixture[] = [];
let fxId = 0;
for (const g of rig.fixtures) {
  const prefix = g.namePrefix ?? g.kind.charAt(0).toUpperCase() + g.kind.slice(1);
  for (let i = 0; i < g.count; i++) {
    const suffix = g.kind === "head" && g.count === 2 ? (i === 0 ? "L" : "R") : `${i + 1}`;
    fixtures.push({ id: fxId++, manuf: g.manufacturer, model: g.model, mode: g.mode,
      name: `${prefix} ${suffix}`, address: g.addresses[i], channels: g.channels, kind: g.kind });
  }
}

const pars = fixtures.filter((f) => f.kind === "par");
const heads = fixtures.filter((f) => f.kind === "head");
// Two head ROLES, split by their rig group's namePrefix. Truss heads move over the dance floor;
// floor heads sit below them and only ever point upstage at the banner (beams away from people).
const trussHeads = heads.filter((f) => f.name.startsWith("Truss"));
const floorHeads = heads.filter((f) => f.name.startsWith("Floor"));
if (trussHeads.length !== 2 || floorHeads.length !== 2)
  throw new Error(
    `party build expects 2 "Truss" + 2 "Floor" heads (got ${trussHeads.length}/${floorHeads.length}) — ` +
      `check the head groups' namePrefix in ${path.basename(rigPath)}`,
  );

const HEAD_SAFETY: Record<string, { panMin: number; panMax: number; tiltMin: number; tiltMax: number }> =
  (rig as any).headSafety ?? {};
const headAddr = new Map<number, number>(heads.map((f) => [f.id, f.address]));
const fenceFor = (id: number) => HEAD_SAFETY[String(headAddr.get(id))];
const clampDmx = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

// ----------------------------------------------------------------------------
// Function model
// ----------------------------------------------------------------------------
type FixVal = { id: number; pairs: number[] };
interface SceneDef { type: "Scene"; id: number; name: string; fadeIn: number; fadeOut: number; vals: FixVal[]; }
interface ChaserDef { type: "Chaser"; id: number; name: string; steps: number[]; hold: number; fade: number; direction: string; runOrder: string; }
type FuncDef = SceneDef | ChaserDef;

const funcs: FuncDef[] = [];
const funcIdByName = new Map<string, number>();
let funcId = 0;

// SAFETY GUARD. Firmware movement macros (head ch13) are banned: their auto pan/tilt ignores every
// limit here and could rake the dance floor at face height. Once day-of capture writes
// rig.headSafety (per-head fence by DMX address), pan/tilt are bounds-checked too.
//
// ONE exception, by name: SOUND_SCENE puts the TRUSS pair into a sound-active program on purpose
// (the show's audio reactivity comes from the fixtures' own mics, not a feed into QLC+). It is
// truss-only — those heads are 8ft up over the dance floor where sweeping is the point — and the
// guard still refuses it on any other head, so the floor pair aimed at the banner can never
// inherit it. scripts/floor-head-tilt.mjs carries the matching exemption at launch time.
const SOUND_SCENE = "Truss Sound";
function coverGuard(scene: string, v: FixVal): void {
  if (!heads.some((h) => h.id === v.id)) return;
  const soundOk = scene === SOUND_SCENE && trussHeads.some((h) => h.id === v.id);
  const fence = fenceFor(v.id);
  for (let k = 0; k + 1 < v.pairs.length; k += 2) {
    const ch = v.pairs[k], val = v.pairs[k + 1];
    if (ch === 13 && val !== 0 && !soundOk)
      throw new Error(`Scene "${scene}" head ${v.id}: movement macro ${val} banned (firmware pan/tilt ignores eye-safe limits)`);
    if (ch === 13 && soundOk && val < 136)
      throw new Error(`Scene "${scene}" head ${v.id}: macro ${val} is an AUTO program — only sound-active (136-255) is allowed here`);
    if (!fence) continue;
    if (ch === 0 && (val < fence.panMin || val > fence.panMax))
      throw new Error(`Scene "${scene}" head ${v.id}: pan ${val} outside eye-safe fence [${fence.panMin}..${fence.panMax}]`);
    if (ch === 2 && (val < fence.tiltMin || val > fence.tiltMax))
      throw new Error(`Scene "${scene}" head ${v.id}: tilt ${val} outside eye-safe fence [${fence.tiltMin}..${fence.tiltMax}]`);
  }
}

function addScene(name: string, vals: FixVal[], fadeIn = 120, fadeOut = 120): number {
  for (const v of vals) coverGuard(name, v);
  const id = funcId++;
  funcs.push({ type: "Scene", id, name, fadeIn, fadeOut, vals });
  funcIdByName.set(name, id);
  return id;
}
function addChaser(name: string, stepNames: string[], hold: number, fade = 0, direction = "Forward", runOrder = "Loop"): number {
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

// ----------------------------------------------------------------------------
// STAGE GEOMETRY (measured 2026-08-20)
// Origin = front-CENTRE of the stage at floor level. +X audience-right, +Y upstage, +Z up. Feet.
// Stage 30w x 4d, deck 1.5. Truss heads on 8ft towers at the stage ends; floor heads DIRECTLY
// BELOW them. The dance floor is DOWNSTAGE (negative Y): its centre measures 14ft from stage
// centre = 12ft off the front edge.
// Every number here is a PRE-VIZ estimate. Saturday's card-sweep capture writes real DMX into
// rig.movingHeadSettings, which overrides all of it (see trussPos/floorPos below).
// ----------------------------------------------------------------------------
const STAGE_W = rig.stage.widthFt;
const STAGE_D = rig.stage.depthFt;
const HEAD_SEP = rig.stage.headSeparationFt ?? STAGE_W;
const HEAD_Z = rig.stage.headHeightFt;
const STAGE_DECK = rig.stage.deckHeightFt;
const HEAD_XYZ = { L: { x: -HEAD_SEP / 2, y: 0, z: HEAD_Z }, R: { x: HEAD_SEP / 2, y: 0, z: HEAD_Z } };
const PAN_DMX_PER_DEG = 255 / (headGroup?.beam?.panRangeDeg ?? 540);
const TILT_DMX_PER_DEG = 255 / (headGroup?.beam?.tiltRangeDeg ?? 270);
const TILT_CENTRE_DEPR = headGroup?.beam?.tiltCentreDeprDeg ?? 37.5;
const BANNER = rig.banner ?? { widthFt: 12, heightFt: 8, centerX: 0, centerHeightFt: 8 };
const WALL_Y = STAGE_D;      // the banner hangs on the back wall, just upstage of the deck
const FLOOR_HEAD_Z = 1;      // floor heads sit on their bases, lens ~1ft up
const DF_CENTER_Y = -12;     // dance-floor centre: 14ft from stage centre, stage is 4ft deep
const DF_W = 20;             // dance-floor width — PLACEHOLDER, day-of plot sheet refines

// Truss head aim: target a point, get [pan, tilt]. No front-obstruction guard here (unlike the
// band builder) — the dance floor is legitimately downstage. The roof guard stays: a beam at or
// above horizontal would fire into the room at head height instead of down onto the floor.
function aim(side: "L" | "R", tx: number, ty: number, tz = 0): [number, number] {
  const h = HEAD_XYZ[side];
  const dx = tx - h.x, dy = ty - h.y;
  const panDeg = (Math.atan2(dx, dy) * 180) / Math.PI;                          // 0 = upstage, + = aud-right
  const deprDeg = (Math.atan2(h.z - tz, Math.hypot(dx, dy)) * 180) / Math.PI;   // ° below horizontal
  if (deprDeg <= 0)
    throw new Error(`aim(${side}, ${tx}, ${ty}, ${tz}): beam at/above horizontal — roof violation`);
  return [clampDmx(128 + panDeg * PAN_DMX_PER_DEG),
          clampDmx(128 + (deprDeg - TILT_CENTRE_DEPR) * TILT_DMX_PER_DEG)];
}

// Floor head aim: the inverted case — the head sits BELOW its target, so elevation is above
// horizontal and the tilt term flips sign. Targets are clamped into the banner rectangle, so a
// bad number can only ever move the beam somewhere else on the banner.
function aimBanner(side: "L" | "R", tx: number, tz: number): [number, number] {
  const halfW = BANNER.widthFt / 2, halfH = BANNER.heightFt / 2;
  const cx = Math.max(BANNER.centerX - halfW, Math.min(BANNER.centerX + halfW, tx));
  const cz = Math.max(BANNER.centerHeightFt - halfH, Math.min(BANNER.centerHeightFt + halfH, tz));
  const h = { x: side === "L" ? -HEAD_SEP / 2 : HEAD_SEP / 2, y: 0, z: FLOOR_HEAD_Z };
  const dx = cx - h.x, dy = WALL_Y - h.y;
  const panDeg = (Math.atan2(dx, dy) * 180) / Math.PI;
  const elevDeg = (Math.atan2(cz - h.z, Math.hypot(dx, dy)) * 180) / Math.PI;   // ° ABOVE horizontal
  return [clampDmx(128 + panDeg * PAN_DMX_PER_DEG),
          clampDmx(128 - (elevDeg + TILT_CENTRE_DEPR) * TILT_DMX_PER_DEG)];
}

// Day-of captured positions win over the computed estimates above. Shape (written Saturday):
//   movingHeadSettings: { trussL: { home: {pan,tilt}, speaker: {...} }, floorL: { banner: {...} }, ... }
const PMH: any = (rig as any).movingHeadSettings ?? {};
const trussKey = (f: Fixture) => (f.id === trussHeads[0].id ? "trussL" : "trussR");
const floorKey = (f: Fixture) => (f.id === floorHeads[0].id ? "floorL" : "floorR");
function trussPos(which: "home" | "speaker", f: Fixture, computed: [number, number]): [number, number] {
  const m = PMH[trussKey(f)]?.[which];
  return m && m.pan !== undefined && m.tilt !== undefined ? [m.pan, m.tilt] : computed;
}
function floorPos(f: Fixture): [number, number] {
  const m = PMH[floorKey(f)]?.banner;
  if (m && m.pan !== undefined && m.tilt !== undefined) return [m.pan, m.tilt];
  return aimBanner(f.id === floorHeads[0].id ? "L" : "R", BANNER.centerX, BANNER.centerHeightFt);
}

// ----------------------------------------------------------------------------
// VALUE BUILDERS — the dim rule
// A LOOK sets colour, not brightness: pars get ch2..7 (and strobe/macro forced off) but NEVER
// ch0; truss heads get the colour wheel but never ch10. Brightness comes from the R7 dim pads
// and the faders. Floor heads are the exception by role: banner scenes are their own layer and
// carry their own dim (the Banner Dim fader rides them).
// ----------------------------------------------------------------------------
//
// LTP RECLAIM (verified on the rig 2026-08-20). QLC+ is HTP only for Intensity-group channels;
// EVERY other channel is LTP and KEEPS ITS LAST VALUE after the function that set it stops. So a
// sound-active mode cannot be switched off by re-pressing its own pad — nothing writes the
// channel back. A look therefore has to zero the sound channels itself: par ch9 "Sound active"
// and head ch13 "Movement Macros". With these in place the operator rule is one sentence:
// **any look press takes the fixtures back from their microphones.**
function pParVal(id: number, c: number[]): FixVal {
  return { id, pairs: [1, 0, 2, c[0], 3, c[1], 4, c[2], 5, c[3], 6, c[4], 7, c[5], 8, 0, 9, 0] };
}
// Gobo, gobo-rotation and prism are LTP exactly like the sound macro, so a plain colour look has
// to CLEAR them or the first gobo look of the night textures every look that follows it for the
// rest of the party. Same rule, same reason as ch13 — see the LTP RECLAIM note above.
// The split with the MiniLab knobs: a LOOK owns ch6, WHICH gobo is in the beam. The knobs own
// ch7 gobo rotation and ch8 prism — how the beam MOVES — because those are the live "scroll"
// controls, and a Level slider owns its channel outright, so the two cannot both have them.
// Scenes therefore never write ch7 or ch8: a value there would be silently ignored.
const BEAM_CLEAR = [6, GOBO.open, 13, 0];
const trussColor = (color: number): FixVal[] =>
  trussHeads.map((f) => ({ id: f.id, pairs: [5, color, ...BEAM_CLEAR] }));
// A beam look: colour plus a gobo. Rotation and prism come from the knobs.
const trussBeam = (color: number, gobo: number): FixVal[] =>
  trussHeads.map((f) => ({ id: f.id, pairs: [5, color, 6, gobo, 13, 0] }));
const floorVal = (dim: number, color: number): FixVal[] =>
  floorHeads.map((f) => ({ id: f.id, pairs: [5, color, 10, dim, 11, SHUTTER_OPEN, ...BEAM_CLEAR] }));
// Banner texture: the floor pair projects a gobo onto the banner instead of a flat wash.
const floorBeam = (dim: number, color: number, gobo: number): FixVal[] =>
  floorHeads.map((f) => ({ id: f.id, pairs: [5, color, 6, gobo, 10, dim, 11, SHUTTER_OPEN, 13, 0] }));
const floorOff = (): FixVal[] => floorHeads.map((f) => ({ id: f.id, pairs: [10, 0] }));

// THEME palette — gold / blue / UV. [r,g,b,w,a,uv] on par ch2..7.
const GOLD  = [255, 120, 0, 0, 180, 0];
const BLUE  = [0, 40, 255, 0, 0, 0];
const UVC   = [0, 0, 40, 0, 0, 255];
const AMBER = [255, 60, 0, 0, 220, 0];
const WWHT  = [255, 140, 40, 200, 120, 0];
const PWHT  = [0, 0, 0, 255, 0, 0];
const OFF6  = [0, 0, 0, 0, 0, 0];
const RAINBOW6 = [[255,0,0,0,0,0], GOLD, [0,255,0,0,0,0], [0,200,255,0,0,0], BLUE, [255,0,255,0,0,0]];
const RAINBOW_WHEEL = [HEAD_COLOR.red, HEAD_COLOR.orange, HEAD_COLOR.green, HEAD_COLOR.cyan, HEAD_COLOR.magenta, HEAD_COLOR.yellow];

const wall = (c: number[]) => pars.map((f) => pParVal(f.id, c));
const wallAlt = (a: number[], b: number[]) => pars.map((f, i) => pParVal(f.id, i % 2 === 0 ? a : b));
const wallDim = (c: number[], scale: number) => pars.map((f) => pParVal(f.id, c.map((v) => Math.round(v * scale))));

// --- static wall looks (DINNER / SPEECHES / INTRO) ---------------------------
addScene("Gold Wall",     [...wall(GOLD),  ...trussColor(HEAD_COLOR.orange)], 300, 300);
addScene("Blue Wall",     [...wall(BLUE),  ...trussColor(HEAD_COLOR.cyan)], 300, 300);
addScene("Gold Blue Alt", [...wallAlt(GOLD, BLUE), ...trussColor(HEAD_COLOR.orange)], 300, 300);
addScene("Soft Amber",    [...wallDim(AMBER, 0.7), ...trussColor(HEAD_COLOR.orange)], 300, 300);
addScene("Warm White",    [...wall(WWHT),  ...trussColor(HEAD_COLOR.white)], 300, 300);
addScene("UV Accent",     [...wallDim(UVC, 0.5), ...trussColor(HEAD_COLOR.magenta)], 300, 300);
addScene("Doors Blue",    [...wallDim(BLUE, 0.6), ...trussColor(HEAD_COLOR.cyan)], 300, 300);
addScene("Wall Low Gold", [...wallDim(GOLD, 0.35), ...trussColor(HEAD_COLOR.orange)], 300, 300);
addScene("House Bright",  [...wall(PWHT),  ...trussColor(HEAD_COLOR.white)], 300, 300);
addScene("Banner Only",   [...pars.map((f) => pParVal(f.id, OFF6)), ...floorVal(255, HEAD_COLOR.orange)], 300, 300);

// --- banner layer (floor heads only; overlays whatever wall look runs) -------
addScene("Banner Soft",   floorVal(110, HEAD_COLOR.orange));
addScene("Banner Bright", floorVal(255, HEAD_COLOR.orange));
addScene("Banner On",     floorVal(200, HEAD_COLOR.orange));
addScene("Banner Off",    floorOff());
addScene("Banner Blast",  floorVal(255, HEAD_COLOR.orange), 60, 60);

// DIM-RULE EXCEPTION #1 — Panic writes every dimmer itself. It is the break-glass "light the
// room NOW" pad; it must work with the dim row at 25% or a fader pulled to zero.
addScene("Panic White", [
  // The 9,0 / 13,0 are the LTP reclaim (see pParVal): Panic is the one button that must recover
  // the room from ANY state, and that includes taking the fixtures back off their own mics.
  ...pars.map((f) => ({ id: f.id, pairs: [0, 255, 1, 0, 2, 0, 3, 0, 4, 0, 5, 255, 6, 0, 7, 0, 8, 0, 9, 0] })),
  ...trussHeads.map((f) => ({ id: f.id, pairs: [5, HEAD_COLOR.white, 10, 255, 11, SHUTTER_OPEN, ...BEAM_CLEAR] })),
  ...floorVal(255, HEAD_COLOR.white),
]);

// --- R7 brightness row -------------------------------------------------------
// Dim presets write ONLY dimmers (pars ch0 + truss ch10). They share a SoloFrame with Sync Strobe,
// so exactly one of them ever drives those channels — that is what makes stepping DOWN work under
// HTP (a solo sibling is stopped, not merely outvoted). Floor heads are excluded: the banner is
// its own layer with its own fader.
function dimScene(name: string, level: number): void {
  addScene(name, [
    ...pars.map((f) => ({ id: f.id, pairs: [0, level] })),
    ...trussHeads.map((f) => ({ id: f.id, pairs: [10, level] })),
  ], 200, 200);
}
dimScene("Dim 25", 64);
dimScene("Dim 50", 128);
dimScene("Dim 75", 191);
dimScene("Dim Full", 255);

// Sync Strobe = the pulsing member of the brightness row. Blinking the DIMMER (not colour) means
// the running look keeps its colour and simply pulses at the tapped tempo. Tempo comes from the
// SpeedDial (R8C4 tap), which owns this chaser's step duration.
addScene("Blink On", [
  ...pars.map((f) => ({ id: f.id, pairs: [0, 255] })),
  ...trussHeads.map((f) => ({ id: f.id, pairs: [10, 255] })),
], 0, 0);
addScene("Blink Off", [
  ...pars.map((f) => ({ id: f.id, pairs: [0, 0] })),
  ...trussHeads.map((f) => ({ id: f.id, pairs: [10, 0] })),
], 0, 0);
addChaser("Sync Strobe", ["Blink On", "Blink Off"], 120);

// DIM-RULE EXCEPTION #2 — Strobe Burst is the R8C5 hold pad. Momentary, must punch through
// whatever the dim row is set to. Par strobe ch1=200 and head shutter ch11=90 are the values the
// band show's "Strobe All" uses on these same fixtures.
addScene("Strobe Burst", [
  ...pars.map((f) => ({ id: f.id, pairs: [0, 255, 1, 200, 2, 255, 3, 255, 4, 255, 5, 255] })),
  ...trussHeads.map((f) => ({ id: f.id, pairs: [10, 255, 11, 90] })),
], 0, 0);

// --- chases ------------------------------------------------------------------
// Steps are colour-only scenes (the dim rule), so a chase is visible exactly as bright as the
// brightness row says. Hold 500ms is the boot tempo; the SpeedDial overrides it live.
function chaseSteps(prefix: string, colors: number[][], wheel: number[]): string[] {
  return colors.map((c, i) => {
    const n = `${prefix} S${i + 1}`;
    addScene(n, [...wall(c), ...trussColor(wheel[i % wheel.length])], 80, 80);
    return n;
  });
}
addChaser("Chase Gold Blue", chaseSteps("CGB", [GOLD, BLUE], [HEAD_COLOR.orange, HEAD_COLOR.cyan]), 500);
addChaser("Chase Blue UV",   chaseSteps("CBU", [BLUE, UVC],  [HEAD_COLOR.cyan, HEAD_COLOR.magenta]), 500);
addChaser("Chase Gold UV",   chaseSteps("CGU", [GOLD, UVC],  [HEAD_COLOR.orange, HEAD_COLOR.magenta]), 500);
addChaser("Rainbow Chase",   chaseSteps("RBW", RAINBOW6, RAINBOW_WHEEL), 500);
addChaser("Rainbow Fast",    chaseSteps("RBF", RAINBOW6, RAINBOW_WHEEL), 180);
addChaser("Fast Gold Blue",  chaseSteps("FGB", [GOLD, BLUE, GOLD, BLUE], [HEAD_COLOR.orange, HEAD_COLOR.cyan]), 200);
addChaser("Build Chase",     chaseSteps("BLD", [BLUE, OFF6, GOLD, OFF6], [HEAD_COLOR.cyan, HEAD_COLOR.orange]), 700);

addScene("UV Blacklight",  [...wall(UVC), ...trussColor(HEAD_COLOR.magenta), ...floorVal(140, HEAD_COLOR.magenta)]);
addScene("Gold Blue Full", [...wallAlt(GOLD, BLUE), ...trussColor(HEAD_COLOR.orange), ...floorVal(255, HEAD_COLOR.orange)]);
addScene("White Burst",    [...wall(PWHT), ...trussColor(HEAD_COLOR.white)], 60, 400);
addScene("Entrance",       [...wallAlt(GOLD, BLUE), ...trussColor(HEAD_COLOR.orange), ...floorVal(255, HEAD_COLOR.orange)], 60);

// --- truss head positions + sweeps -------------------------------------------
// Doors: where the guests come in. Optional in rig.json — without it there is no door look.
// downstageFt is measured from the FRONT edge of the stage, so it is negative on the y axis.
const DOORS: { x: number; y: number } | null = (rig as any).doors
  ? { x: (rig as any).doors.xFt, y: -Math.abs((rig as any).doors.downstageFt) }
  : null;
const dfC = { x: 0, y: DF_CENTER_Y };
const dfL = { x: -DF_W / 2 + 2, y: DF_CENTER_Y }, dfR = { x: DF_W / 2 - 2, y: DF_CENTER_Y };

addScene("Truss Home", trussHeads.map((f, i) => {
  const [p, t] = trussPos("home", f, aim(i === 0 ? "L" : "R", dfC.x, dfC.y));
  // Full LTP reclaim: Truss Home is the "put the heads back to normal" button, so it clears the
  // beam channels too. Sweeps deliberately do NOT — a gobo sweeping across the floor is a look.
  return { id: f.id, pairs: [0, p, 2, t, 11, SHUTTER_OPEN, ...BEAM_CLEAR] };
}));
// DIM-RULE EXCEPTION #3 — Speaker Light carries its own dim + white. "Get light on the person
// talking" has to work on one press during a speech, whatever the brightness row is doing.
addScene("Speaker Light", trussHeads.map((f, i) => {
  const [p, t] = trussPos("speaker", f, aim(i === 0 ? "L" : "R", 0, 2, STAGE_DECK + 5));
  return { id: f.id, pairs: [0, p, 2, t, 5, HEAD_COLOR.white, 10, 255, 11, SHUTTER_OPEN, 13, 0] };
}));
addScene("Banner Home", floorHeads.map((f) => {
  const [p, t] = floorPos(f);
  return { id: f.id, pairs: [0, p, 2, t, 11, SHUTTER_OPEN] };
}));

function sweepScene(n: string, l: [number, number], r: [number, number]): string {
  addScene(n, [
    { id: trussHeads[0].id, pairs: [0, l[0], 2, l[1], 11, SHUTTER_OPEN, 13, 0] }, // 13,0 = LTP reclaim
    { id: trussHeads[1].id, pairs: [0, r[0], 2, r[1], 11, SHUTTER_OPEN, 13, 0] },
  ], 800, 800);
  return n;
}
addChaser("Sweep Wide", [
  sweepScene("SwW A", aim("L", dfL.x, dfL.y), aim("R", dfR.x, dfR.y)),
  sweepScene("SwW B", aim("L", dfR.x, dfR.y), aim("R", dfL.x, dfL.y)),
], 1600, 800);
addChaser("Sweep Cross", [
  sweepScene("SwX A", aim("L", dfR.x, dfC.y + 3), aim("R", dfL.x, dfC.y + 3)),
  sweepScene("SwX B", aim("L", dfL.x, dfC.y - 3), aim("R", dfR.x, dfC.y - 3)),
], 1600, 800);
addChaser("Sweep Punch", [
  sweepScene("SwP A", aim("L", dfC.x, dfC.y), aim("R", dfC.x, dfC.y)),
  sweepScene("SwP B", aim("L", dfC.x, dfC.y + 5), aim("R", dfC.x, dfC.y + 5)),
], 900, 300);
addChaser("Circles", [
  sweepScene("Cir A", aim("L", dfC.x - 4, dfC.y - 4), aim("R", dfC.x + 4, dfC.y - 4)),
  sweepScene("Cir B", aim("L", dfC.x - 4, dfC.y + 4), aim("R", dfC.x + 4, dfC.y + 4)),
  sweepScene("Cir C", aim("L", dfC.x + 4, dfC.y + 4), aim("R", dfC.x - 4, dfC.y + 4)),
  sweepScene("Cir D", aim("L", dfC.x + 4, dfC.y - 4), aim("R", dfC.x - 4, dfC.y - 4)),
], 1200, 900);

// --- the doorway ---------------------------------------------------------------
// Both truss heads put a beam on the doors for arrivals and the grand entrance. Only built when
// rig.doors exists, so a rig without a measured doorway simply has no door look rather than a
// pad that aims somewhere invented. The floor pair stays on the banner throughout.
if (DOORS) {
  addScene("Door Spot", [
    ...wallDim(BLUE, 0.35),
    ...trussHeads.map((f, i) => {
      const [p, t] = aim(i === 0 ? "L" : "R", DOORS.x, DOORS.y);
      return { id: f.id, pairs: [0, p, 2, t, 5, HEAD_COLOR.white, 10, 255, 11, SHUTTER_OPEN, ...BEAM_CLEAR] };
    }),
  ], 400, 400);
  addScene("Door Gobo", [
    ...wallDim(GOLD, 0.3),
    ...trussHeads.map((f, i) => {
      const [p, t] = aim(i === 0 ? "L" : "R", DOORS.x, DOORS.y);
      return { id: f.id, pairs: [0, p, 2, t, 5, HEAD_COLOR.orange, 6, GOBO.slot(2), 10, 255, 11, SHUTTER_OPEN, 13, 0] };
    }),
  ], 400, 400);
}

// --- beam looks: gobo wheel, gobo rotation, prism -----------------------------
// Colour looks clear these (BEAM_CLEAR); the ones below deliberately texture the beam. Gobos only
// read as gobos where a beam lands on something — the truss pair on the dance floor and the walls,
// the floor pair on the banner — so that is where they are used.
addScene("Doors Gobo",   [...wallDim(BLUE, 0.5), ...trussBeam(HEAD_COLOR.cyan, GOBO.slot(0))], 300, 300);
addScene("Banner Gobo",  [...wallDim(GOLD, 0.3), ...floorBeam(220, HEAD_COLOR.orange, GOBO.slot(2))], 300, 300);
addScene("Banner Swirl", [...wallDim(UVC, 0.4), ...floorBeam(220, HEAD_COLOR.magenta, GOBO.slot(4))], 300, 300);
addScene("Gobo Beam",    [...wall(GOLD), ...trussBeam(HEAD_COLOR.orange, GOBO.slot(1))]);
addScene("Gobo Cycle",   [...wall(BLUE), ...trussBeam(HEAD_COLOR.cyan, GOBO.cycleSlow)]);
addScene("Gobo Shake",   [...wall(UVC), ...trussBeam(HEAD_COLOR.magenta, GOBO.shake)]);
addScene("Gobo Wide",    [...wall(GOLD), ...trussBeam(HEAD_COLOR.orange, GOBO.slot(3))]);

// --- more static looks per part of the night ---------------------------------
addScene("All Gold",  [...wall(GOLD), ...trussColor(HEAD_COLOR.orange), ...floorVal(255, HEAD_COLOR.orange)]);
addScene("Half Warm", [...wallDim(WWHT, 0.5), ...trussColor(HEAD_COLOR.white)], 300, 300);
addScene("Blue Low",  [...wallDim(BLUE, 0.35), ...trussColor(HEAD_COLOR.cyan)], 300, 300);

// --- more chases --------------------------------------------------------------
// Candle — dinner drift. Long crossfades and no head movement: it should read as the room
// breathing, not as a light cue.
addScene("CDL S1", [...wallDim(WWHT, 0.55), ...trussColor(HEAD_COLOR.white)], 900, 900);
addScene("CDL S2", [...wallDim(AMBER, 0.45), ...trussColor(HEAD_COLOR.orange)], 900, 900);
addChaser("Candle", ["CDL S1", "CDL S2"], 2200, 900);

// Slow Build — the doors-open ramp: low blue up through gold to full, over about six seconds.
addScene("SBD S1", [...wallDim(BLUE, 0.25), ...trussColor(HEAD_COLOR.cyan)], 600, 600);
addScene("SBD S2", [...wallDim(BLUE, 0.6), ...trussColor(HEAD_COLOR.cyan)], 600, 600);
addScene("SBD S3", [...wallDim(GOLD, 0.6), ...trussColor(HEAD_COLOR.orange)], 600, 600);
addScene("SBD S4", [...wall(GOLD), ...trussColor(HEAD_COLOR.orange)], 600, 600);
addChaser("Slow Build", ["SBD S1", "SBD S2", "SBD S3", "SBD S4"], 1400, 600);

// Gold Pulse — hora. Full gold punching against a dark beat, gobo spinning throughout so the
// heads keep moving while the wall blinks.
addScene("GPL S1", [...wall(GOLD), ...trussBeam(HEAD_COLOR.orange, GOBO.slot(1))], 0, 0);
addScene("GPL S2", [...wall(OFF6), ...trussBeam(HEAD_COLOR.orange, GOBO.slot(1))], 0, 0);
addChaser("Gold Pulse", ["GPL S1", "GPL S2"], 400);

// Beam Punch — party. The gobo and prism hold while colour and wheel jump on the beat.
addScene("BPN S1", [...wall(GOLD), ...trussBeam(HEAD_COLOR.orange, GOBO.slot(5))], 0, 0);
addScene("BPN S2", [...wall(BLUE), ...trussBeam(HEAD_COLOR.cyan, GOBO.slot(5))], 0, 0);
addScene("BPN S3", [...wall(UVC), ...trussBeam(HEAD_COLOR.magenta, GOBO.slot(5))], 0, 0);
addChaser("Beam Punch", ["BPN S1", "BPN S2", "BPN S3"], 300);

// --- audio fallback + beat pulse ---------------------------------------------
// Par sound-active mode (R8C7): the fixture's own mic drives its own program. Values from the
// Rainbow Smart 2 Pro definition — ch8 220-255 "Sound active color", ch9 251-255 "Sound active".
addScene("Par Sound Mode", pars.map((f) => ({ id: f.id, pairs: [0, 255, 8, 240, 9, 253] })), 0, 0);

// Truss sound-active mode (R8C6): the heads' own mics drive their firmware program. Chauvet
// Intimidator Spot 375Z IRC, 15-channel mode, ch13 "Movement Macros": 136-255 is eight
// Sound-Active programs in 16-wide bands (136 p1, 152 p2, 168 p3, 184 p4, 200 p5, 216 p6,
// 232 p7, 248 p8). 144 sits mid-band on program 1 — change this one number to try another.
//
// TRUSS ONLY, and that is a safety decision, not a stylistic one. A head running a firmware
// program IGNORES DMX pan/tilt, so scripts/floor-head-tilt.mjs cannot fence where the beam goes.
// The truss pair is 8ft up over the dance floor, where sweeping is the whole point. The FLOOR
// pair sits at ankle height pointed at the banner — turning those loose would rake the beam
// across guests' eyes at close range, so they stay under DMX aim on the banner.
const SOUND_PROGRAM = 144;
addScene(SOUND_SCENE, trussHeads.map((f) => ({ id: f.id, pairs: [10, 255, 11, SHUTTER_OPEN, 13, SOUND_PROGRAM] })), 0, 0);
// Beat Pulse — what the audio-trigger bass bar fires. Dimmer-only bump: HTP lifts the pars above
// whatever the brightness row holds, then releases back. The look's colours are untouched.
addScene("Beat Pulse", pars.map((f) => ({ id: f.id, pairs: [0, 255] })), 0, 180);

// ============================================================================
// LAUNCHPAD PLACEMENT — 5 chronological pages, one grammar.
// R1-R2 looks (SoloFrame) · R7 brightness (SoloFrame) · R8 utility (Frame, overlays).
// R7/R8 are identical on every page; their captions carry " P<n>" so each page's OSC path
// stays unique. R8C4 (tap tempo) and R8C8 (page cycle) fire no button — they are the
// SpeedDial's tap input and the multipage nav input respectively.
// ============================================================================
const PAD = { rows: [209, 199, 189, 179, 169, 159, 149, 139] }; // first pad channel per row (top row first)
const padCh = (row: number, col: number) => PAD.rows[row] + col;

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

function place(spec: BtnSpec) {
  if (spec.funcName !== undefined && funcIdByName.get(spec.funcName) === undefined)
    throw new Error(`Button "${spec.caption}" references unknown function "${spec.funcName}"`);
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

const LED = { gold: 18, blue: 82, uv: 90, white: 6, cyan: 74, red: 10, green: 42, amber: 26, magenta: 106 };

interface PageLook { cap: string; fn: string; row: number; col: number; led: number; bg: number[]; action?: string; }
const PAGES: { name: string; blurb: string; looks: PageLook[] }[] = [
  { name: "INTRO", blurb: "doors, build, grand entrance", looks: [
    { cap: "Doors",        fn: "Doors Blue",   row: 0, col: 0, led: LED.blue,  bg: [40, 80, 220] },
    { cap: "Build",        fn: "Build Chase",  row: 0, col: 1, led: LED.amber, bg: [200, 140, 40] },
    // No punctuation in captions: the caption becomes the OSC path, and "Entrance!" shipped a
    // literal "!" in "/entrance!_r1c3" — legal but a trap for anything driving the show by path.
    { cap: "Entrance",     fn: "Entrance",     row: 0, col: 2, led: LED.gold,  bg: [255, 180, 0] },
    { cap: "Banner Blast", fn: "Banner Blast", row: 0, col: 3, led: LED.uv,    bg: [150, 80, 255] },
    { cap: "Slow Build",   fn: "Slow Build",   row: 1, col: 0, led: LED.blue,  bg: [60, 90, 200] },
    { cap: "Doors Gobo",   fn: "Doors Gobo",   row: 1, col: 1, led: LED.cyan,  bg: [0, 160, 210] },
    { cap: "Banner Gobo",  fn: "Banner Gobo",  row: 1, col: 2, led: LED.gold,  bg: [230, 170, 60] },
    // Only when rig.doors is measured — no doorway, no door pads.
    ...(DOORS ? [
      { cap: "Door Spot", fn: "Door Spot", row: 1, col: 3, led: LED.white, bg: [245, 245, 235] },
      { cap: "Door Gobo", fn: "Door Gobo", row: 1, col: 4, led: LED.gold,  bg: [255, 190, 70] },
    ] : []),
  ]},
  { name: "DINNER", blurb: "static ambient, zero motion", looks: [
    { cap: "Gold Wall",   fn: "Gold Wall",     row: 0, col: 0, led: LED.gold,  bg: [255, 170, 0] },
    { cap: "Blue Wall",   fn: "Blue Wall",     row: 0, col: 1, led: LED.blue,  bg: [0, 60, 255] },
    { cap: "Gold Blue",   fn: "Gold Blue Alt", row: 0, col: 2, led: LED.amber, bg: [220, 130, 60] },
    { cap: "Soft Amber",  fn: "Soft Amber",    row: 0, col: 3, led: LED.amber, bg: [255, 120, 30] },
    { cap: "Warm White",  fn: "Warm White",    row: 0, col: 4, led: LED.white, bg: [255, 230, 200] },
    { cap: "UV Accent",   fn: "UV Accent",     row: 0, col: 5, led: LED.uv,    bg: [120, 60, 220] },
    { cap: "Banner Soft", fn: "Banner Soft",   row: 0, col: 6, led: LED.uv,    bg: [170, 120, 255] },
    { cap: "Candle",      fn: "Candle",        row: 1, col: 0, led: LED.amber, bg: [230, 150, 70] },
    { cap: "Blue Low",    fn: "Blue Low",      row: 1, col: 1, led: LED.blue,  bg: [30, 60, 170] },
    { cap: "Half Warm",   fn: "Half Warm",     row: 1, col: 2, led: LED.white, bg: [230, 210, 180] },
    { cap: "Banner Swirl", fn: "Banner Swirl", row: 1, col: 3, led: LED.uv,    bg: [190, 120, 255] },
  ]},
  { name: "SPEECHES", blurb: "calm, banner featured", looks: [
    { cap: "Banner Bright", fn: "Banner Bright", row: 0, col: 0, led: LED.gold,  bg: [255, 190, 60] },
    { cap: "Wall Low",      fn: "Wall Low Gold", row: 0, col: 1, led: LED.amber, bg: [180, 120, 40] },
    { cap: "Speaker",       fn: "Speaker Light", row: 0, col: 2, led: LED.white, bg: [240, 240, 240] },
    { cap: "Banner Only",   fn: "Banner Only",   row: 0, col: 3, led: LED.uv,    bg: [150, 100, 255] },
    { cap: "House Bright",  fn: "House Bright",  row: 0, col: 4, led: LED.white, bg: [255, 255, 255] },
    { cap: "Warm Low",      fn: "Half Warm",     row: 1, col: 0, led: LED.white, bg: [220, 200, 170] },
    { cap: "Banner Spin",   fn: "Banner Swirl",  row: 1, col: 1, led: LED.uv,    bg: [180, 110, 240] },
  ]},
  { name: "HORA", blurb: "lift the chairs", looks: [
    { cap: "Gold Blue Full", fn: "Gold Blue Full", row: 0, col: 0, led: LED.gold,  bg: [255, 170, 30] },
    { cap: "Circles",        fn: "Circles",        row: 0, col: 1, led: LED.blue,  bg: [60, 110, 255] },
    { cap: "Fast Chase",     fn: "Fast Gold Blue", row: 0, col: 2, led: LED.amber, bg: [230, 150, 50] },
    { cap: "White Burst",    fn: "White Burst",    row: 0, col: 3, led: LED.white, bg: [255, 255, 255], action: "Flash" },
    { cap: "All Gold",       fn: "All Gold",       row: 1, col: 0, led: LED.gold,  bg: [255, 185, 40] },
    { cap: "Gold Pulse",     fn: "Gold Pulse",     row: 1, col: 1, led: LED.amber, bg: [255, 140, 20] },
    { cap: "Gobo Beam",      fn: "Gobo Beam",      row: 1, col: 2, led: LED.gold,  bg: [235, 165, 55] },
  ]},
  { name: "PARTY", blurb: "the dance floor", looks: [
    { cap: "GB Chase",     fn: "Chase Gold Blue", row: 0, col: 0, led: LED.gold,    bg: [255, 160, 20] },
    { cap: "Blue UV",      fn: "Chase Blue UV",   row: 0, col: 1, led: LED.blue,    bg: [70, 60, 255] },
    { cap: "Gold UV",      fn: "Chase Gold UV",   row: 0, col: 2, led: LED.uv,      bg: [200, 120, 255] },
    { cap: "Rainbow",      fn: "Rainbow Chase",   row: 0, col: 3, led: LED.green,   bg: [0, 220, 100] },
    { cap: "Rainbow Fast", fn: "Rainbow Fast",    row: 0, col: 4, led: LED.magenta, bg: [255, 0, 180] },
    { cap: "UV Black",     fn: "UV Blacklight",   row: 0, col: 5, led: LED.uv,      bg: [110, 40, 255] },
    { cap: "Sweep Wide",   fn: "Sweep Wide",      row: 1, col: 0, led: LED.cyan,    bg: [0, 200, 230] },
    { cap: "Sweep Cross",  fn: "Sweep Cross",     row: 1, col: 1, led: LED.cyan,    bg: [0, 170, 210] },
    { cap: "Sweep Punch",  fn: "Sweep Punch",     row: 1, col: 2, led: LED.cyan,    bg: [0, 140, 190] },
    { cap: "Gobo Cycle",   fn: "Gobo Cycle",      row: 1, col: 3, led: LED.blue,    bg: [40, 120, 255] },
    { cap: "Gobo Shake",   fn: "Gobo Shake",      row: 1, col: 4, led: LED.uv,      bg: [170, 70, 255] },
    { cap: "Gobo Wide",    fn: "Gobo Wide",       row: 1, col: 5, led: LED.gold,    bg: [255, 175, 45] },
    { cap: "Beam Punch",   fn: "Beam Punch",      row: 1, col: 6, led: LED.magenta, bg: [255, 40, 170] },
  ]},
];

// R7 — brightness (four static levels + the tempo-locked pulse). Solo: exactly one drives dimmers.
const DIM_ROW: { cap: string; fn: string; col: number; led: number; bg: number[] }[] = [
  { cap: "Dim 25",      fn: "Dim 25",      col: 0, led: LED.amber, bg: [120, 70, 20] },
  { cap: "Dim 50",      fn: "Dim 50",      col: 1, led: LED.amber, bg: [170, 100, 30] },
  { cap: "Dim 75",      fn: "Dim 75",      col: 2, led: LED.amber, bg: [220, 140, 40] },
  { cap: "Dim Full",    fn: "Dim Full",    col: 3, led: LED.gold,  bg: [255, 180, 40] },
  { cap: "Sync Strobe", fn: "Sync Strobe", col: 4, led: LED.white, bg: [230, 230, 230] },
];
// R8 — utility, overlays whatever runs. C4 = SpeedDial tap and C8 = page cycle are INPUTS on
// other widgets, so they place no button here. C6 used to arm the QLC+ audio-trigger widget;
// with the reactivity now coming from the fixtures' own mics (no AudioBox), it drives the heads.
const UTIL_ROW: { cap: string; fn?: string; action: string; col: number; led: number; bg: number[] }[] = [
  { cap: "Blackout",  action: "Blackout", col: 0, led: LED.red,   bg: [40, 40, 40] },
  { cap: "Panic",     fn: "Panic White",    action: "Toggle", col: 1, led: LED.white,   bg: [255, 255, 255] },
  { cap: "Banner",    fn: "Banner On",      action: "Toggle", col: 2, led: LED.uv,      bg: [160, 100, 255] },
  { cap: "Strobe",    fn: "Strobe Burst",   action: "Flash",  col: 4, led: LED.white,   bg: [220, 220, 220] },
  { cap: "Truss Sound", fn: "Truss Sound",  action: "Toggle", col: 5, led: LED.magenta, bg: [255, 80, 200] },
  { cap: "Par Sound", fn: "Par Sound Mode", action: "Toggle", col: 6, led: LED.amber,   bg: [255, 140, 60] },
];

PAGES.forEach((pg, pi) => {
  const P = `P${pi + 1}`;
  for (const l of pg.looks)
    place({ caption: l.cap, funcName: l.fn, action: l.action ?? "Toggle", padRow: l.row, padCol: l.col,
            led: l.led, bg: l.bg, frame: `LOOKS-${P}`, page: pi });
  for (const d of DIM_ROW)
    place({ caption: `${d.cap} ${P}`, funcName: d.fn, action: "Toggle", padRow: 6, padCol: d.col,
            led: d.led, bg: d.bg, frame: `DIM-${P}`, page: pi });
  for (const u of UTIL_ROW)
    place({ caption: `${u.cap} ${P}`, funcName: u.fn, action: u.action, padRow: 7, padCol: u.col,
            led: u.led, bg: u.bg, frame: `UTIL-${P}`, page: pi });
});

// ----------------------------------------------------------------------------
// Virtual Console
// ----------------------------------------------------------------------------
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
    // Black label text except on the near-black Blackout pad, which keeps white.
    const fg = p.row === 7 && p.col === 0 ? argb(255, 255, 255) : argb(0, 0, 0);
    const fIdAttr = p.funcName !== undefined ? `\n      <Function ID="${funcIdByName.get(p.funcName)}"/>` : "";
    const btn = (id: number, input: string) =>
`    <Button Caption="${esc(p.display)}" ID="${id}" Icon="">
      <WindowState Visible="True" X="${x}" Y="${y}" Width="90" Height="44"/>
      <Appearance>
       <FrameStyle>None</FrameStyle>
       <ForegroundColor>${fg}</ForegroundColor>
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

// VCSlider in Level mode (ui/src/virtualconsole/vcslider.cpp loadXML).
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
     <Input Universe="0" Channel="${crc16(oscName)}"/>
    </Slider>`;
}

// Playback-mode slider: runs one function at the slider's intensity. Unlike Level mode it does
// not own any channel — at 0 the function is simply not running.
function playbackSliderXml(id: number, caption: string, x: number, funcId: number, oscName: string): string {
  return `    <Slider Caption="${esc(caption)}" ID="${id}" WidgetStyle="Slider" InvertedAppearance="false">
     <Appearance>
      <FrameStyle>None</FrameStyle>
      <ForegroundColor>Default</ForegroundColor>
      <BackgroundColor>Default</BackgroundColor>
      <BackgroundImage>None</BackgroundImage>
      <Font>Default</Font>
     </Appearance>
     <WindowState Visible="True" X="${x}" Y="16" Width="60" Height="320"/>
     <SliderMode ValueDisplayStyle="Percentage" ClickAndGoType="None" Monitor="false">Playback</SliderMode>
     <Level LowLimit="0" HighLimit="255" Value="0"/>
     <Playback>
      <Function>${funcId}</Function>
     </Playback>
     <Input Universe="0" Channel="${crc16(oscName)}"/>
    </Slider>`;
}

// VCSpeedDial — tap tempo. XML pinned from QLC+ 4.14.3 vcspeeddial.cpp + vcspeeddialfunction.cpp;
// see docs/qlc-xml-notes.md. Function multipliers are INDEXES into speedMultiplierNames:
// 0 = "(Not Sent)", 6 = "1" (dial time applied as-is). So FadeIn/FadeOut untouched, Duration = the
// tapped time -> every chaser's step length follows the tap.
const SPEED_MULT_ONE = 6;
const SPEED_MULT_NOT_SENT = 0;
function speedDialXml(id: number, caption: string, x: number, y: number, tapPad: number, functionIds: number[], timeMs: number): string {
  const fns = functionIds
    .map((fid) => `     <Function FadeIn="${SPEED_MULT_NOT_SENT}" FadeOut="${SPEED_MULT_NOT_SENT}" Duration="${SPEED_MULT_ONE}">${fid}</Function>`)
    .join("\n");
  return `    <SpeedDial Caption="${esc(caption)}" ID="${id}">
     <Appearance>
      <FrameStyle>None</FrameStyle>
      <ForegroundColor>Default</ForegroundColor>
      <BackgroundColor>Default</BackgroundColor>
      <BackgroundImage>None</BackgroundImage>
      <Font>Default</Font>
     </Appearance>
     <WindowState Visible="True" X="${x}" Y="${y}" Width="180" Height="120"/>
     <AbsoluteValue Minimum="100" Maximum="4000"/>
     <Tap>
      <Input Universe="1" Channel="${tapPad}"/>
     </Tap>
     <Time>${timeMs}</Time>
${fns}
    </SpeedDial>`;
}

// VCAudioTriggers — bass band pulses the pars. XML pinned from vcaudiotriggers.cpp + audiobar.cpp
// (docs/qlc-xml-notes.md). Bar Type 2 = FunctionBar; thresholds are the QLC+ defaults (51/204),
// tuned at soundcheck in the QLC+ UI. The AUDIO INPUT DEVICE is a per-machine QLC+ preference,
// NOT part of this file — selecting the AudioBox is a SHOW-SETUP step.
function audioTriggersXml(id: number, caption: string, x: number, y: number, togglePad: number | null, pulseFuncId: number, bars = 16): string {
  return `    <AudioTriggers Caption="${esc(caption)}" ID="${id}" BarsNumber="${bars}">
     <Appearance>
      <FrameStyle>None</FrameStyle>
      <ForegroundColor>Default</ForegroundColor>
      <BackgroundColor>Default</BackgroundColor>
      <BackgroundImage>None</BackgroundImage>
      <Font>Default</Font>
     </Appearance>
     <WindowState Visible="True" X="${x}" Y="${y}" Width="180" Height="160"/>
${togglePad === null ? "" : `     <Input Universe="1" Channel="${togglePad}"/>\n`}     <SpectrumBar Name="Bass" Type="2" MinThreshold="51" MaxThreshold="204" Divisor="1" Index="0" FunctionID="${pulseFuncId}"/>
    </AudioTriggers>`;
}

// FADERS — deliberately minimal, and this is load-bearing.
//
// VERIFIED ON THE RIG 2026-08-20: a QLC+ VCSlider in Level mode does NOT contribute to HTP — it
// OWNS every channel it lists and forces its own value out, always. The first cut of this show
// shipped Pars/Truss/Banner Dim faders defaulting to 0 on the theory that the R7 dim pads would
// win on HTP; instead those faders pinned every dimmer to 0 and the whole rig stayed dark while
// "Dim Full" showed as running. Head colour wheel and shutter still passed through, which is what
// gave the game away: only fader-covered channels were dead.
//
// So: any channel a look or a pad needs to drive must NOT appear on a Level fader. That rules out
// dimmers (R7 pads), par UV (UV looks), and strobe (the R8C5 hold pad). Zoom is the one channel no
// function touches, so it is the one fader that can safely exist.
//
// Continuous master dimming is the built-in GRAND MASTER (top-left of the console, Intensity /
// Reduce) — it scales intensity channels without owning them, which is exactly the semantic the
// dim faders were reaching for.
// EFFECT SCROLLS — the MiniLab's knobs. Level mode is CORRECT here, and only here: every one of
// these channels is one no scene writes, so owning it outright is exactly what we want. Gobo
// rotation and prism were deliberately taken out of the looks to make that true (see BEAM_CLEAR);
// pan/tilt speed and focus were never used by anything.
const faderDefs: { id: number; caption: string; chans: { fixture: number; ch: number }[]; value: number }[] = [
  { id: 905, caption: "Heads Zoom", chans: heads.map((f) => ({ fixture: f.id, ch: 14 })), value: 128 },
  { id: 906, caption: "Gobo Spin", chans: heads.map((f) => ({ fixture: f.id, ch: 7 })), value: GROT.off },
  { id: 907, caption: "Prism", chans: trussHeads.map((f) => ({ fixture: f.id, ch: 8 })), value: PRISM.off },
  { id: 908, caption: "Focus", chans: heads.map((f) => ({ fixture: f.id, ch: 9 })), value: 128 },
  { id: 909, caption: "Move Speed", chans: heads.map((f) => ({ fixture: f.id, ch: 4 })), value: 0 },
];
// GROUP INTENSITY FADERS — Playback mode, and that choice is the whole point.
//
// A Level slider OWNS its channels (verified on the rig, see the fader note above), so four Level
// faders on the group dimmers would kill the R7 brightness row stone dead and pin the rig at
// whatever the faders happened to be sitting at. A PLAYBACK slider instead runs a function at the
// slider's intensity: at 0 it contributes nothing and the pads rule, raised it blends on HTP and
// pushes that group brighter. That is a fader that adds rather than one that takes over.
//
// Consequence worth knowing at the desk: these push a group UP, they cannot pull it below what
// the R7 row is holding. Stepped-down brightness stays on the pads; the console's Grand Master is
// still the one control that brings everything down together.
const parsL = pars.slice(0, Math.ceil(pars.length / 2));
const parsR = pars.slice(Math.ceil(pars.length / 2));
addScene("Pars L Full", parsL.map((f) => ({ id: f.id, pairs: [0, 255] })), 0, 0);
addScene("Pars R Full", parsR.map((f) => ({ id: f.id, pairs: [0, 255] })), 0, 0);
addScene("Truss Full", trussHeads.map((f) => ({ id: f.id, pairs: [10, 255, 11, SHUTTER_OPEN] })), 0, 0);
addScene("Banner Full", floorHeads.map((f) => ({ id: f.id, pairs: [10, 255, 11, SHUTTER_OPEN] })), 0, 0);

// The OSC path is DERIVED from the caption, never hand-written. generate:widgets re-derives it
// the same way when it parses the .qxw, so any hand-chosen name silently disagrees with the map
// the dashboard uses — caught exactly that way: the sliders answered "/fader_pars_l" while
// widgets.json advertised "/pars_l".
const groupFaderDefs = [
  { id: 910, caption: "Pars L", fn: "Pars L Full" },
  { id: 911, caption: "Pars R", fn: "Pars R Full" },
  { id: 912, caption: "Truss", fn: "Truss Full" },
  { id: 913, caption: "Banner", fn: "Banner Full" },
].filter((d) => funcIdByName.has(d.fn));

const TAP_PAD = padCh(7, 3);    // R8C4 — SpeedDial tap
const PAGE_PAD = padCh(7, 7);   // R8C8 — multipage next
const tempoFuncIds = ["Sync Strobe", "Chase Gold Blue", "Chase Blue UV", "Chase Gold UV", "Rainbow Chase",
  "Rainbow Fast", "Fast Gold Blue", "Build Chase", "Sweep Wide", "Sweep Cross", "Sweep Punch", "Circles",
  // Beat-driven additions. "Candle" and "Slow Build" are deliberately NOT here — they are drifts,
  // and locking them to the tapped tempo would turn them into blinks.
  "Gold Pulse", "Beam Punch"]
  .map((n) => funcIdByName.get(n))
  .filter((v): v is number => v !== undefined);

// Audio triggers are the one feature with a pre-agreed kill switch (spec: audio go/no-go), and the
// switch is now OFF: the AudioBox is out for this show and reactivity comes from the fixtures' own
// microphones (R8C6 Truss Sound, R8C7 Par Sound) plus tap tempo. That is not just a preference —
// QLC+ stores the capture device as an APPLICATION preference, so a widget with no device chosen
// listens to the machine's DEFAULT input. On this laptop that is the built-in mic, which would
// drive the beat pulse off room noise and read as the show flickering on its own.
//
// PARTY_AUDIO=1 builds the widget back in, for the day an AudioBox is plugged in. It carries no
// Launchpad input then — R8C6 belongs to the heads now — so arm it in the Virtual Console.
const AUDIO_TRIGGERS = process.env.PARTY_AUDIO === "1";
const allFaders = groupFaderDefs.length + faderDefs.length;
const fadersInner = [
  ...groupFaderDefs.map((d, i) => playbackSliderXml(d.id, d.caption, 12 + i * 72, funcIdByName.get(d.fn)!, oscPath(d.caption))),
  ...faderDefs.map((d, i) => sliderXml(d.id, d.caption, 12 + (groupFaderDefs.length + i) * 72, d.chans, d.value, oscPath(d.caption))),
  speedDialXml(920, "Tempo", 12, 348, TAP_PAD, tempoFuncIds, 500),
  ...(AUDIO_TRIGGERS ? [audioTriggersXml(930, "Audio", 204, 348, null, funcIdByName.get("Beat Pulse")!)] : []),
];
const fadersFrame = frame("Frame", "FADERS", 9, 805, 8, 12 + allFaders * 72, 520, fadersInner);

// HEAD SETTINGS — dashboard/MCP buttons, off the Launchpad grid. Truss positions are mutually
// exclusive (SoloFrame); the banner pair overlays whatever position is active.
const headPosDefs = [
  { id: 950, caption: "Truss Home", fn: "Truss Home" },
  { id: 951, caption: "Speaker Light", fn: "Speaker Light" },
].filter((b) => funcIdByName.has(b.fn));
const headBeamDefs = [
  { id: 955, caption: "Banner Home", fn: "Banner Home" },
  { id: 956, caption: "Banner Off", fn: "Banner Off" },
].filter((b) => funcIdByName.has(b.fn));
const headBtnXml = (defs: { id: number; caption: string; fn: string }[]) => defs.map((b, i) =>
`    <Button Caption="${esc(b.caption)}" ID="${b.id}" Icon="">
      <WindowState Visible="True" X="12" Y="${16 + i * 44}" Width="128" Height="36"/>
      <Appearance>
       <FrameStyle>None</FrameStyle>
       <ForegroundColor>Default</ForegroundColor>
       <BackgroundColor>Default</BackgroundColor>
       <BackgroundImage>None</BackgroundImage>
       <Font>Default</Font>
      </Appearance>
      <Function ID="${funcIdByName.get(b.fn)}"/>
      <Action>Toggle</Action>
      <Input Universe="0" Channel="${crc16(oscPath(b.caption))}"/>
    </Button>`);
const headPosFrame = frame("SoloFrame", "TRUSS POSITION", 8, 805, 540, 156, 28 + headPosDefs.length * 44, headBtnXml(headPosDefs));
const headBeamFrame = frame("Frame", "BANNER", 7, 968, 540, 156, 28 + headBeamDefs.length * 44, headBtnXml(headBeamDefs));

// Frames are sized to the tight bounding box of their buttons. Per page the three frames are
// non-overlapping row bands (rows 0-1 / 6 / 7) — QLC+ frames are opaque, so overlap hides pads.
function frameBBox(name: string) {
  const ps = placed.filter((p) => p.frame === name);
  if (ps.length === 0) throw new Error(`Frame "${name}" has no buttons`);
  const cols = ps.map((p) => p.col), rows = ps.map((p) => p.row);
  return {
    x: 10 + Math.min(...cols) * 96 - 4,
    y: 12 + Math.min(...rows) * 50 - 4,
    w: (Math.max(...cols) - Math.min(...cols)) * 96 + 98,
    h: (Math.max(...rows) - Math.min(...rows)) * 50 + 52,
  };
}

// The 15 sub-frames live inside ONE multipage GRID frame, never the root frame: the root is built
// with no header (m_hbox == NULL) and setMultipageMode() dereferences that header layout, which
// segfaults QLC+ 4.14.4 on load. Boots on page 1; R8C8 cycles 1->..->5->1 (PagesLoop wraps).
const gridInner: string[] = [];
PAGES.forEach((pg, pi) => {
  const P = `P${pi + 1}`;
  const fL = `LOOKS-${P}`, fD = `DIM-${P}`, fU = `UTIL-${P}`;
  const bL = frameBBox(fL), bD = frameBBox(fD), bU = frameBBox(fU);
  const id = 20 + pi * 3;
  gridInner.push(
    frame("SoloFrame", `${pg.name} ${P}`, id,     bL.x, bL.y, bL.w, bL.h, renderButtons(fL, pi), { page: pi }),
    frame("SoloFrame", `BRIGHT ${P}`,     id + 1, bD.x, bD.y, bD.w, bD.h, renderButtons(fD, pi), { page: pi }),
    frame("Frame",     `UTIL ${P}`,       id + 2, bU.x, bU.y, bU.w, bU.h, renderButtons(fU, pi), { page: pi }),
  );
});
const grid = frame("Frame", "Pages", 10, 0, 0, 800, 460, gridInner,
  { multipage: PAGES.length, currentPage: 0, nav: { nextInput: PAGE_PAD, nextKey: "PgDown", prevKey: "PgUp", loop: true } });

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
${fadersFrame}
${headPosFrame}
${headBeamFrame}
 </Frame>
 <Properties>
  <Size Width="1190" Height="820"/>
  <GrandMaster ChannelMode="Intensity" ValueMode="Reduce" SliderMode="Normal"/>
 </Properties>
</VirtualConsole>`;

// ----------------------------------------------------------------------------
// Assemble the workspace
// ----------------------------------------------------------------------------
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

// 2D Monitor layout (mm on a 5x5m grid): pars upstage along the wall, truss heads mid, floor heads
// downstage of them so the 2D view reads like the room.
function spread(i: number, n: number): number {
  return Math.round((5000 * (i + 0.5)) / Math.max(1, n));
}
function fxPos(f: Fixture): { x: number; y: number } {
  if (f.kind === "par") return { x: spread(pars.indexOf(f), pars.length), y: 900 };
  if (f.name.startsWith("Truss")) return { x: spread(trussHeads.indexOf(f), trussHeads.length), y: 2600 };
  return { x: spread(floorHeads.indexOf(f), floorHeads.length), y: 3800 };
}
const monitorXml = `  <Monitor DisplayMode="1" ShowLabels="1">
   <Grid Width="5" Height="4" Depth="4" Units="0"/>
${fixtures.map((f) => { const p = fxPos(f); return `   <FxItem ID="${f.id}" XPos="${p.x}" YPos="${p.y}" ZPos="0"/>`; }).join("\n")}
  </Monitor>`;

const dmxOut = rig.dmxOutput ?? { plugin: "ArtNet", universe: 0, transmitMode: "Standard", outputIp: null };
const outputIpAttr = dmxOut.outputIp ? ` outputIP="${esc(dmxOut.outputIp)}"` : "";
const dmxNote = dmxOut.notes ? `<!-- ${esc(dmxOut.notes)} -->` : `<!-- no outputIP -> broadcast -->`;

const LP = rig.controller ?? { launchpad: false, inputUid: "None", inputLine: "0", outputUid: "None", outputLine: "0" };
const LP_IN_UID = LP.launchpad ? LP.inputUid : "None", LP_IN_LINE = LP.launchpad ? LP.inputLine : "0";
const LP_OUT_UID = LP.launchpad ? LP.outputUid : "None", LP_OUT_LINE = LP.launchpad ? LP.outputLine : "0";
const LP_PROFILE = LP.launchpad ? (LP.profile ?? "Novation Launchpad Mini MK3") : null;
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
${funcs.map(funcXml).join("\n")}
${monitorXml}
 </Engine>
 ${vc}
</Workspace>
`;

// Write, then write-PROTECT: QLC+ re-serializes the project on Save and would clobber this
// generated file. Edit build-party.ts and regenerate instead of saving inside QLC+.
const qxwPath = path.join(OUT, QXW_FILE);
if (existsSync(qxwPath)) { try { chmodSync(qxwPath, 0o666); } catch { /* not RO yet */ } }
writeFileSync(qxwPath, qxw, "utf8");
try { chmodSync(qxwPath, 0o444); } catch { /* best-effort */ }

// ----------------------------------------------------------------------------
// config/launchpad-leds.json — the map the MCP server's launchpad module drives over RGB SysEx.
// ----------------------------------------------------------------------------
if (LP.launchpad) {
  const pads = placed.map((p) => ({
    note: p.pad - 128,
    crc: p.crc,
    path: p.osc,
    page: p.page,
    rgb: [p.bg[0], p.bg[1], p.bg[2]],
    momentary: p.action === "Flash",
  }));
  const cfgDir = path.join(OUT, "config");
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(
    path.join(cfgDir, "launchpad-leds.json"),
    JSON.stringify({ note: "note = QLC+ universe-1 pad channel - 128 (Mini MK3 programmer-mode note); rgb 0-255", pads }, null, 2) + "\n",
    "utf8",
  );
}

// ----------------------------------------------------------------------------
// PATCH-CHART.md
// ----------------------------------------------------------------------------
function patchRows(): string {
  return fixtures
    .map((f) => {
      const start = f.address + 1;
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
  for (let r = 0; r < 8; r++)
    lines.push("  | " + Array.from({ length: 8 }, (_, c) => cell(r, c)).join(" | ") + " |");
  return lines.join("\n  " + "-".repeat(8 * 15) + "\n");
}
function lookIndex(): string {
  const head = "| Look | Pg | R/C | Pad | OSC |\n|------|----|-----|-----|-----|";
  const rows = [...placed]
    .sort((a, b) => a.page - b.page || a.row - b.row || a.col - b.col)
    .map((g) => `| ${g.caption} | ${g.page + 1} | R${g.row + 1}C${g.col + 1} | ${g.pad} | \`${g.osc}\` |`)
    .join("\n");
  return `${head}\n${rows}`;
}

const pageSections = PAGES.map((pg, pi) => `### Page ${pi + 1} — ${pg.name} · ${pg.blurb}
\`\`\`
${gridAscii(pi)}
\`\`\`
`).join("\n");

const chart = `# ${rig.meta.name} — Patch Chart & Launchpad Map

Generated by scripts/build-party.ts from ${path.basename(rigPath)}. Output: ${dmxOut.plugin}
**Universe ${dmxOut.universe}** (one DMX universe,
${fixtures.reduce((a, f) => Math.max(a, f.address + f.channels), 0)} of 512 channels used).

Stage ${STAGE_W}ft x ${STAGE_D}ft, deck ${STAGE_DECK}ft. Dance-floor centre ${Math.abs(DF_CENTER_Y)}ft
downstage of the front edge. Banner ${BANNER.widthFt}ft x ${BANNER.heightFt}ft on the back wall.

## DMX patch — set each light to its START address

\`\`\`
  ADDR     FIXTURE         MODEL (MODE)
${patchRows()}
\`\`\`

Pars uplight the back wall (5 each side of the stage). **Truss** heads sit on the 8ft towers at the
stage ends and work the dance floor; **Floor** heads sit directly below them and only ever point
upstage at the banner.

## Launchpad Mini MK3 — 8x8 grid (Programmer Mode)

**Five pages, in the order the night happens:** INTRO → DINNER → SPEECHES → HORA → PARTY. The show
**boots on page 1**. **Press the bottom-right pad (R8C8) to advance** — it cycles 1 → 2 → 3 → 4 → 5 → 1
and fires no look. On the keyboard, **PgDn / PgUp** also switch pages.

**Rows R7 and R8 are identical on every page** — muscle memory in the dark:

- **R7 = brightness.** Dim 25 / 50 / 75 / Full, plus **Sync Strobe** (pulses at the tapped tempo).
  These are the only functions that touch dimmers; looks set colour only. One at a time.
- **R8 = utility.** Blackout · Panic (all white, full, ignores the dim row) · Banner on/off ·
  **R8C4 TAP TEMPO** (sets every chaser + Sync Strobe) · Strobe (HOLD, releases off) ·
  **R8C6 Truss Sound** · **R8C7 Par Sound** · **R8C8 page**. C4 and C8 fire no look: they are
  inputs on the tempo dial and the page frame.

**Audio reactivity is the fixtures' own microphones**, not a feed into QLC+. **R8C7 Par Sound**
hands the pars to their internal mic; **R8C6 Truss Sound** puts the two truss heads into
Sound-Active program 1 (ch13 = ${SOUND_PROGRAM}). Tap tempo still drives every chase, so a tapped
beat and the mics can run together.

> **To take a fixture back, press a look — not the sound pad again.** QLC+ is HTP only on
> intensity channels; every other channel is LTP and keeps its last value after the function that
> set it stops, so re-pressing R8C6 or R8C7 leaves the fixture on its microphone. Every look
> writes the sound channels back to zero (par ch9, head ch13), and so do **Panic**, **Truss Home**
> and every sweep. One rule: **any look press takes the fixtures back.**

> **Truss heads only, and that is deliberate.** A head running a firmware program ignores DMX
> pan/tilt, so nothing can fence where its beam lands. The truss pair is 8ft up over the dance
> floor where sweeping is the point. The floor pair is at ankle height aimed at the banner —
> loose, it would rake guests' eyes at close range — so it stays under DMX aim.

${pageSections}
Pads glow at ~30% in their look colour when idle and jump to 100% while running. To the right of the
grid: the **Heads Zoom** fader and the **Tempo** dial.

> **Why only one fader.** A QLC+ Level slider does not blend with scenes — it owns its channels and
> forces its value out. Dim / UV / strobe faders therefore fought the pads and won, pinning the rig
> dark. Brightness is the R7 pad row; **continuous master dimming is the Grand Master** (top-left of
> the console). Zoom is the only channel no look touches, so it is the only safe fader.

## Look index — every pad (locate / update)

Sorted by page, then row, then column. **R/C** = the 8x8 pad coordinate (1-indexed, top-left =
R1C1); **Pad** = the Launchpad MIDI channel; **OSC** = the dashboard path.

${lookIndex()}

## Control surfaces

- **Launchpad** (MIDI): the 8x8 grid above. Requires Programmer Mode — see SHOW-SETUP.md.
- **MCP / dashboard** (OSC): every look has an OSC path = \`/\` + lowercase name, spaces -> \`_\`.
  Bindings are pre-baked (CRC-16 of the path); no Auto-Detect needed.
- **No audio feed into QLC+ for this show.** Reactivity comes from the fixtures' built-in mics
  (R8C6 / R8C7). The QLC+ audio-trigger widget is deliberately not built: its capture device is a
  **QLC+ preference, not part of this file**, so with none chosen it listens to the machine's
  default input — the laptop mic — and pulses the pars off room noise. To bring it back the day an
  AudioBox USB96 is patched in: \`PARTY_AUDIO=1 npm run generate\`, then select the AudioBox in
  QLC+ and arm the widget in the Virtual Console (it has no Launchpad pad; R8C6 is the heads).
`;

writeFileSync(path.join(OUT, "PATCH-CHART.md"), chart, "utf8");

// ----------------------------------------------------------------------------
// SETUP-MANUAL.html
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

console.log(`OK  crc16 check passed (0x906e)`);
console.log(`    rig=${path.basename(rigPath)}  fixtures=${fixtures.length}  functions=${funcs.length}  buttons=${btnId - 100}  pages=${PAGES.length}`);
console.log(`    wrote ${QXW_FILE}, PATCH-CHART.md, SETUP-MANUAL.html${LP.launchpad ? ", config/launchpad-leds.json" : ""}`);
