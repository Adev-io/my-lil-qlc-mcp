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
type Chaser = { id: number; type: "Chaser"; name: string; steps: number[]; fade: number; hold: number };
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
const headPairs = (on: boolean, pan = 128, tilt = 128): number[] => [
  0, pan, 1, 0, 2, tilt, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8, 0, 9, 128,
  10, on ? 255 : 0, 11, on ? 255 : 0, 12, 0, 13, 0, 14, 128,
];
const off = (fixture: Fixture): FixtureValue => ({
  id: fixture.id,
  pairs: fixture.kind === "panel" ? panelPairs([0, 0, 0]) : headPairs(false),
});

const functions: FunctionDef[] = [];
const routingScenes: Scene[] = [];
function addScene(name: string, values: FixtureValue[], fadeIn = 0, fadeOut = 0): number {
  const id = functions.length;
  functions.push({ id, type: "Scene", name, values, fadeIn, fadeOut });
  return id;
}
function addChaser(name: string, steps: number[], fade: number, hold: number): number {
  const id = functions.length;
  functions.push({ id, type: "Chaser", name, steps, fade, hold });
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
const centerOut = [[5, 6], [4, 7], [3, 8], [2, 9], [1, 10], [0, 11]];
const outsideIn = [...centerOut].reverse();
const trussStep = (rig.cuepix?.trusses ?? [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]])
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
for (const head of heads) {
  addRoutingScene(`${head.name} Open White`, new Map([[head.id, headPairs(true)]]));
  addRoutingScene(`${head.name} Pan Center`, new Map([[head.id, headPairs(true, 128, 64)]]));
  addRoutingScene(`${head.name} Tilt Center`, new Map([[head.id, headPairs(true, 64, 128)]]));
  addRoutingScene(`${head.name} Blackout`, new Map([[head.id, headPairs(false)]]));
}
for (const universe of [0, 1]) {
  addRoutingScene(
    `Universe ${universe} Panels White`,
    new Map(panels.filter((panel) => panel.universe === universe).map((panel) => [panel.id, panelPairs([255, 255, 255])])),
  );
}
addRoutingScene("Both 375ZX Open White", new Map(heads.map((head) => [head.id, headPairs(true)])));
addRoutingScene("All Blackout", new Map());

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
   <RunOrder>Loop</RunOrder>
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

const moverRows = [
  ["HEAD AMBER", "HEAD BLUE", "HEAD WHT", "HEAD PURP", "HEAD GRN", "HEAD RED", "GOBO", "PRISM"],
  ["CENTER", "POSITION A", "POSITION B", "POSITION C", "SWEEP", "CROSS", "CIRCLE", "HEAD STOP"],
  ["L HEAD", "R HEAD", "BOTH", "OPEN", "DIM25", "DIM50", "DIM75", "HEAD STR"],
];
moverRows.forEach((labels, rowIndex) => labels.forEach((label, col) => place({
  label, row: rowIndex + 2, col, page: 1, frame: "MOVERS-P2", led: LED.gray, bg: [65, 65, 72], enabled: Boolean(rig.cuepix?.moversCalibrated),
})));

for (const page of [0, 1]) {
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
for (const page of [0, 1]) {
  for (const name of [`BASE-P${page + 1}`, `FX-P${page + 1}`, `MOVERS-P${page + 1}`, `LEVEL-P${page + 1}`, `SPEED-P${page + 1}`, `UTILITY-P${page + 1}`]) {
    const buttons = placed.filter((button) => button.page === page && button.frame === name);
    if (buttons.length) performanceFrames.push(frameXml(name.startsWith("BASE") || name.startsWith("FX") || name.startsWith("LEVEL") ? "SoloFrame" : "Frame", name, frameId++, page, buttons));
  }
}

const chaserIds = functions.filter((fn) => fn.type === "Chaser" && !fn.name.startsWith("TEST ·")).map((fn) => fn.id);
const speedFunctionsXml = chaserIds.map((id) => `     <Function FadeIn="0" FadeOut="0" Duration="6">${id}</Function>`).join("\n");
const speedDial = `   <Frame Caption="FX SPEED" ID="40">
    ${appearance([32, 34, 39])}
    <WindowState Visible="True" X="790" Y="8" Width="196" Height="142"/>
    <AllowChildren>True</AllowChildren><AllowResize>True</AllowResize><ShowHeader>True</ShowHeader><ShowEnableButton>False</ShowEnableButton><Collapsed>False</Collapsed><Disabled>False</Disabled>
    <SpeedDial Caption="FX Speed" ID="900">
     ${appearance([52, 56, 65], argb(245, 245, 245))}
     <WindowState Visible="True" X="8" Y="8" Width="180" Height="120"/>
     <AbsoluteValue Minimum="100" Maximum="4000"><Input Universe="0" Channel="${crc16(oscPath("FX Speed"))}"/></AbsoluteValue>
     <Tap><Input Universe="2" Channel="156"/></Tap><Time>500</Time>
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
const routingFrame = `  <SoloFrame Caption="SETUP · ROUTING TESTS" ID="50">
   ${appearance([35, 36, 41], argb(245, 245, 245))}<WindowState Visible="True" X="8" Y="430" Width="960" Height="${routingHeight}"/>
   <AllowChildren>True</AllowChildren><AllowResize>True</AllowResize><ShowHeader>True</ShowHeader><ShowEnableButton>False</ShowEnableButton><Collapsed>True</Collapsed><Disabled>False</Disabled>
${routingButtons}
  </SoloFrame>`;

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
${universesXml}
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
    <Multipage PagesNum="2" CurrentPage="0"/>
    <Next><Input Universe="2" Channel="146"/><Key>PgDown</Key></Next><Previous><Key>PgUp</Key></Previous><PagesLoop>True</PagesLoop>
${performanceFrames.join("\n")}
   </Frame>
${speedDial}
${routingFrame}
  </Frame>
  <Properties><Size Width="1000" Height="470"/><GrandMaster ChannelMode="Intensity" ValueMode="Reduce" SliderMode="Normal"/></Properties>
 </VirtualConsole>
</Workspace>
`;

const patchRows = fixtures.map((fixture) =>
  `| ${fixture.name} | ${fixture.model} | ${fixture.universe} | ${fixture.address + 1} | ${fixture.address + fixture.channels} | ${fixture.channels} |`,
).join("\n");
const patchChart = `# Cuepix rig patch chart

QLC+ stores addresses zero-based internally. Table shows fixture-display DMX addresses.

| Fixture | Model | Art-Net universe | Start | End | Channels |
|---|---|---:|---:|---:|---:|
${patchRows}

CR011R DMX output handles Universe 0 only. Universe 1 goes directly by Art-Net to Cuepix 7–12.
`;
const setupGuide = `# Cuepix + QLC+ show setup

## Rig and physical order

- Truss 1: Cuepix 1-3, left to right.
- Truss 2: Cuepix 4-6, left to right.
- Truss 3: Cuepix 7-9, left to right.
- Truss 4: Cuepix 10-12, left to right.
- 375ZX L mounts on outside-left truss. 375ZX R mounts on outside-right truss.
- All Cuepix panels use 79-channel mode. Both 375ZX fixtures use 15-channel mode.
- Keep production mover controls locked until physical mover calibration is recorded and the show is regenerated.

## Lighting LAN

- Use a dedicated unmanaged Ethernet switch. Connect QLC+ computer, CR011R, and all 12 Cuepix panels.
- Computer lighting NIC: static \`10.201.6.1\`, mask \`255.255.255.0\`, no gateway. Disable sharing and bridging.
- Pknight CR011R: \`10.201.6.100\`; Art-Net Universe 0 to its DMX output.
- Cuepix 1-6 receive Art-Net Universe 0. Cuepix 7-12 receive Art-Net Universe 1.
- Set panel addresses from \`CUEPIX-PATCH-CHART.md\`.
- CR011R DMX OUT → 375ZX L at 481 → 375ZX R at 496 → DMX terminator.
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
- Page 2: compact Cuepix controls plus locked 375ZX pad labels. Mover pads do nothing before calibration.
- R7C1-R7C4: 25%, 50%, 75%, Full. R7C5-R7C7: Slow, Medium, Fast. R7C8: Tap.
- R8C1: Blackout. R8C2: Stop FX. R8C3: White. R8C5: Flash. R8C8: Page.
- Use visible \`FX Speed\` dial for exact speed. Use QLC+ Grand Master for overall output.
- No Cuepix dimmer or strobe DMX Level slider exists. Such sliders would seize channels from scenes and pads.

## Test gate — routing before performance

1. Expand collapsed \`SETUP · ROUTING TESTS\` in Virtual Console.
2. Power one Cuepix only. Test its Red, Green, Blue, White, and Blackout buttons.
3. Repeat for Cuepix 1-12, one fixture at a time.
4. Test Universe 0 Panels White, Universe 1 Panels White, then All Blackout.
5. Test 375ZX L and R one at a time through CR011R. Keep production mover page locked.
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
console.log(`Built ${path.basename(rigPath)}: ${fixtures.length} fixtures, ${routingScenes.length} routing tests, ${functions.length - routingScenes.length} performance functions, ${placed.length} console pads, Art-Net ${outputUniverses.join(", ")}`);
