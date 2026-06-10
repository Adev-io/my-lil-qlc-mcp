// Generate monitor/fixtures.json for the 3D monitor.
//
// Single source of truth, like everything else in this repo: addresses + channel roles
// mirror scripts/build-show.ts (same rig), positions come from stage-inputs.json. The
// monitor reads this file to know what to draw and which DMX channels drive each fixture.
// Re-run after any rig change:  npx tsx scripts/build-monitor.ts
//
// Channel roles are 0-indexed offsets into a fixture's footprint. A fixture at `address`
// (0-indexed within Universe 0) occupies Art-Net data[address .. address+channels-1].
//
//   Rainbow Smart 2 Pro 10ch: 0 Dim 1 Strobe 2 R 3 G 4 B 5 W 6 A 7 UV 8 Macro 9 Speed
//   COLORband T3-BT 13ch:     0..8 = 3 RGB cells, 9 Strobe, 10 AutoProg, 11 Speed, 12 Dim
//   Intimidator 375Z 15ch:    0 Pan 2 Tilt 5 Color 6 Gobo 10 Dim 11 Shutter 14 Zoom
//
// Coordinates (builder convention, feet): origin = front-CENTRE of the stage at floor
// level. +X = audience-right, +Y = upstage (away from crowd), +Z = up.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const stage = JSON.parse(await readFile(path.join(ROOT, "stage-inputs.json"), "utf8"));
const W = Number(stage.stage_width) || 20; // stage width (ft)
const D = Number(stage.stage_depth) || 10; // stage depth (ft)
const DECK = Number(stage.stage_height) || 2.5; // deck height above floor (ft)
const HZ = Number(stage.head_height) || 8.5; // head/truss height (ft)
const HAP = Number(stage.head_apart) || 20; // distance between the two heads (ft)

type Vec3 = [number, number, number];

interface MonitorFixture {
  id: number;
  name: string;
  kind: "par" | "bar" | "head";
  address: number; // 0-indexed start channel in Universe 0
  channels: number;
  roles: Record<string, number | number[][]>;
  pos: Vec3; // default position (builder coords, ft) — overridable via monitor/layout.json
  point?: Vec3; // static beam direction (builder unit vec) for par/bar; heads aim via pan/tilt
}

const fixtures: MonitorFixture[] = [];

// 10 Rainbow pars @ addr 0,10,..,90 — ON THE FLOOR, pointing straight UP (uplight).
// Real rig: a row of floor cans across the stage. (Drag in the monitor to re-space.)
const PAR_Y = Math.max(1, D - 1.5); // upstage floor row (backdrop uplight)
const parXs = Array.from({ length: 10 }, (_, i) => -(W / 2 - 1) + (i * (W - 2)) / 9);
for (let i = 0; i < 10; i++) {
  fixtures.push({
    id: i,
    name: `Par ${i + 1}`,
    kind: "par",
    address: i * 10,
    channels: 10,
    roles: { dim: 0, strobe: 1, r: 2, g: 3, b: 4, w: 5, a: 6, uv: 7 },
    pos: [round(parXs[i]), PAR_Y, 0.1], // on the floor
    point: [0, 0, 1], // beam straight up
  });
}

// 2 COLORband bars @ addr 100,113 — UP HIGH (>10 ft), one each side, angled 45° down-and-inward.
const barAddr = [100, 113];
const BAR_Z = 11; // above 10 ft
const D45 = Math.SQRT1_2; // cos/sin 45°
// left bar throws toward audience-right + down; right bar mirrors (toward audience-left + down).
const bars = [
  { x: -W / 2, point: [D45, 0, -D45] as Vec3 },
  { x: W / 2, point: [-D45, 0, -D45] as Vec3 },
];
for (let i = 0; i < barAddr.length; i++) {
  fixtures.push({
    id: 10 + i,
    name: `Bar ${i + 1}`,
    kind: "bar",
    address: barAddr[i],
    channels: 13,
    roles: {
      cells: [
        [0, 1, 2],
        [3, 4, 5],
        [6, 7, 8],
      ],
      dim: 12,
    },
    pos: [round(bars[i].x), 0.5, BAR_Z],
    point: [round(bars[i].point[0]), 0, round(bars[i].point[2])],
  });
}

// 2 Intimidator 375Z heads @ addr 152,167 — ground trusses at the front corners.
const headAddr = [152, 167];
const headXs = [-HAP / 2, HAP / 2];
for (let i = 0; i < 2; i++) {
  fixtures.push({
    id: 12 + i,
    name: `Head ${i === 0 ? "L" : "R"}`,
    kind: "head",
    address: headAddr[i],
    channels: 15,
    roles: { pan: 0, tilt: 2, color: 5, gobo: 6, dim: 10, shutter: 11, zoom: 14 },
    pos: [headXs[i], 0, HZ],
  });
}

const out = {
  meta: {
    universe: 0,
    units: "ft",
    coords: "origin=front-centre floor; +X audience-right, +Y upstage, +Z up",
    stage: { width: W, depth: D, deck: DECK },
    // 375Z aim convention — must match aim() in build-show.ts so beams point where the cues aim them.
    head: { panRange: 540, tiltRange: 270, tiltCentreDepr: 37.5, panCentreUpstage: true },
    shutterOpenMin: 216, // 375Z 216-255 = shutter open
    generatedFrom: "scripts/build-monitor.ts",
  },
  fixtures,
};

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

const dir = path.join(ROOT, "monitor");
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, "fixtures.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(`Wrote monitor/fixtures.json — ${fixtures.length} fixtures (universe 0).`);
