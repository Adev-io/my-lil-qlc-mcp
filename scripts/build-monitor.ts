// Generate monitor/fixtures.json for the 3D monitor.
//
// Single source of truth, like everything else in this repo: fixtures, addresses,
// channel roles AND stage geometry all come from rig.json (see scripts/rig.ts) —
// the same file scripts/build-show.ts reads, so the monitor can never drift from
// the show. Re-run after any rig change:  npx tsx scripts/build-monitor.ts [rig.json]
//
// Channel roles are 0-indexed offsets into a fixture's footprint. A fixture at `address`
// (0-indexed within Universe 0) occupies Art-Net data[address .. address+channels-1].
//
// Coordinates (builder convention, feet): origin = front-CENTRE of the stage at floor
// level. +X = audience-right, +Y = upstage (away from crowd), +Z = up.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRig } from "./rig.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { rig, rigPath } = loadRig(process.argv[2]);
const W = rig.stage.widthFt; // stage width (ft)
const D = rig.stage.depthFt; // stage depth (ft)
const DECK = rig.stage.deckHeightFt; // deck height above floor (ft)
const HZ = rig.stage.headHeightFt; // head/truss height (ft)
const HAP = rig.stage.headSeparationFt ?? W; // distance between the outer heads (ft)

type Vec3 = [number, number, number];

interface MonitorFixture {
  id: number;
  name: string;
  kind: "par" | "bar" | "head" | "panel";
  universe: number;
  address: number; // 0-indexed start channel in the fixture's universe
  channels: number;
  roles: Record<string, number | number[][]>;
  pos: Vec3; // default position (builder coords, ft) — overridable via monitor/layout.json
  point?: Vec3; // static beam direction (builder unit vec) for par/bar; heads aim via pan/tilt
}

// Keep only the roles the renderer (monitor/public/app.js) knows per kind.
const ROLE_KEYS: Record<string, string[]> = {
  par: ["dim", "strobe", "r", "g", "b", "w", "a", "uv"],
  bar: ["cells", "dim"],
  head: ["pan", "tilt", "color", "gobo", "dim", "shutter", "zoom"],
  panel: ["pixels", "dim", "strobe", "macro", "curve"],
};
function pickRoles(kind: string, roles: Record<string, number | number[][]> | undefined) {
  const out: Record<string, number | number[][]> = {};
  for (const k of ROLE_KEYS[kind]) {
    const v = roles?.[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

const fixtures: MonitorFixture[] = [];
let fxId = 0;
let panelNumber = 0;
let panelRow = 0;

for (const g of rig.fixtures) {
  if (g.kind === "par") {
    // Pars: a row ON THE FLOOR upstage, pointing straight UP (backdrop uplight).
    // (Drag in the monitor to re-space.)
    const PAR_Y = Math.max(1, D - 1.5);
    const parXs = Array.from({ length: g.count }, (_, i) =>
      g.count === 1 ? 0 : -(W / 2 - 1) + (i * (W - 2)) / (g.count - 1),
    );
    for (let i = 0; i < g.count; i++) {
      fixtures.push({
        id: fxId++,
        name: `Par ${i + 1}`,
        kind: "par",
        universe: g.universe,
        address: g.addresses[i],
        channels: g.channels,
        roles: pickRoles("par", g.roles),
        pos: [round(parXs[i]), PAR_Y, 0.1], // on the floor
        point: [0, 0, 1], // beam straight up
      });
    }
  } else if (g.kind === "bar") {
    // Bars: high at the BACK corners, BEHIND the band (10 ft up), angled 45° down-and-inward.
    const BAR_Z = 10; // 10 ft up
    const BAR_Y = D; // back of the stage, upstage of the band
    const D45 = Math.SQRT1_2; // cos/sin 45°
    // left bar throws toward audience-right + down; right bar mirrors.
    const sides = [
      { x: -W / 2, point: [D45, 0, -D45] as Vec3 },
      { x: W / 2, point: [-D45, 0, -D45] as Vec3 },
    ];
    for (let i = 0; i < g.count; i++) {
      const s = sides[i % 2];
      fixtures.push({
        id: fxId++,
        name: `Bar ${i + 1}`,
        kind: "bar",
        universe: g.universe,
        address: g.addresses[i],
        channels: g.channels,
        roles: pickRoles("bar", g.roles),
        pos: [round(s.x), BAR_Y, BAR_Z],
        point: [round(s.point[0]), 0, round(s.point[2])],
      });
    }
  } else if (g.kind === "panel") {
    const prefix = g.namePrefix ?? "Panel";
    const panelXs = Array.from({ length: g.count }, (_, i) =>
      g.count === 1 ? 0 : -(W / 2 - 2) + (i * (W - 4)) / (g.count - 1),
    );
    for (let i = 0; i < g.count; i++) {
      fixtures.push({
        id: fxId++,
        name: `${prefix} ${++panelNumber}`,
        kind: "panel",
        universe: g.universe,
        address: g.addresses[i],
        channels: g.channels,
        roles: pickRoles("panel", g.roles),
        pos: [round(panelXs[i]), D, DECK + 2.5 + panelRow * 2.2],
        point: [0, -1, 0],
      });
    }
    panelRow++;
  } else if (g.kind === "head") {
    // Heads: front trusses, spread across headSeparationFt (the classic pair lands at ±HAP/2).
    // A group whose namePrefix says "Floor" mounts on the DECK instead of the truss — the party
    // rig stands two heads directly below the truss pair to cross-shoot the backdrop banner, so
    // they share the truss X and differ only in height.
    const prefix = g.namePrefix ?? "Head";
    const isFloor = /floor/i.test(prefix);
    const headXs = Array.from({ length: g.count }, (_, i) =>
      g.count === 1 ? 0 : -HAP / 2 + (i * HAP) / (g.count - 1),
    );
    for (let i = 0; i < g.count; i++) {
      fixtures.push({
        id: fxId++,
        name: `${prefix} ${g.count === 2 ? (i === 0 ? "L" : "R") : i + 1}`,
        kind: "head",
        universe: g.universe,
        address: g.addresses[i],
        channels: g.channels,
        roles: pickRoles("head", g.roles),
        pos: [round(headXs[i]), 0, isFloor ? 0.5 : HZ],
      });
    }
  }
}

const headGroup = rig.fixtures.find((g) => g.kind === "head");
const beam = headGroup?.beam;

const out = {
  meta: {
    universe: rig.dmxOutput?.universe ?? 0,
    universes: [...new Set(fixtures.map((fixture) => fixture.universe))].sort((a, b) => a - b),
    units: "ft",
    coords: "origin=front-centre floor; +X audience-right, +Y upstage, +Z up",
    stage: { width: W, depth: D, deck: DECK },
    // Head aim convention — must match aim() in build-show.ts so beams point where the cues aim them.
    head: {
      panRange: beam?.panRangeDeg ?? 540,
      tiltRange: beam?.tiltRangeDeg ?? 270,
      tiltCentreDepr: beam?.tiltCentreDeprDeg ?? 37.5,
      panCentreUpstage: true,
    },
    shutterOpenMin: beam?.shutterOpenMin ?? 216,
    // Backdrop banner (party rigs) — the renderer may draw it as a plain quad on the back wall so
    // floor-head aim is judgeable. The key is OMITTED on rigs without one, so a bannerless rig's
    // output is unchanged by this feature.
    ...(rig.banner ? { banner: rig.banner } : {}),
    generatedFrom: "scripts/build-monitor.ts",
  },
  fixtures,
};

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// Tests (and CI) can redirect output away from the repo root.
const OUT = process.env.QLC_BUILD_OUT ? path.resolve(process.env.QLC_BUILD_OUT) : ROOT;
const dir = path.join(OUT, "monitor");
const fixtureFile = path.basename(process.env.MONITOR_FIXTURES_FILE || "fixtures.json");
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, fixtureFile), JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(`Wrote monitor/${fixtureFile} — ${fixtures.length} fixtures (rig: ${path.basename(rigPath)}).`);
