/* Build a routing-test-only QLC+ workspace for the Cuepix rig. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
const universesXml = outputUniverses.map((universe) => `   <Universe Name="Lighting U${universe}" ID="${universe}">
    <Output Plugin="ArtNet" UID="None" Line="0">
     <PluginParameters outputUni="${universe}" transmitMode="Standard"/>
    </Output>
   </Universe>`).join("\n");
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

const buttonWidth = 138;
const buttonHeight = 48;
const columns = 8;
const buttonsXml = routingScenes.map((scene, index) => {
  const x = 8 + (index % columns) * (buttonWidth + 6);
  const y = 8 + Math.floor(index / columns) * (buttonHeight + 6);
  return `   <Button Caption="${esc(scene.name.replace("TEST · ", ""))}" ID="${100 + index}" Icon="">
    <WindowState Visible="True" X="${x}" Y="${y}" Width="${buttonWidth}" Height="${buttonHeight}"/>
    <Appearance>
     <FrameStyle>None</FrameStyle><ForegroundColor>Default</ForegroundColor><BackgroundColor>Default</BackgroundColor><BackgroundImage>None</BackgroundImage><Font>Default</Font>
    </Appearance>
    <Function ID="${scene.id}"/><Action>Toggle</Action>
   </Button>`;
}).join("\n");
const rows = Math.ceil(routingScenes.length / columns);
const consoleHeight = 24 + rows * (buttonHeight + 6);

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
 </Engine>
 <VirtualConsole>
  <Frame Caption=""><Appearance><FrameStyle>None</FrameStyle><ForegroundColor>Default</ForegroundColor><BackgroundColor>Default</BackgroundColor><BackgroundImage>None</BackgroundImage><Font>Default</Font></Appearance>
   <SoloFrame Caption="ROUTING TESTS — one active button at a time" ID="10">
    <Appearance><FrameStyle>None</FrameStyle><ForegroundColor>Default</ForegroundColor><BackgroundColor>Default</BackgroundColor><BackgroundImage>None</BackgroundImage><Font>Default</Font></Appearance>
    <WindowState Visible="True" X="0" Y="0" Width="1165" Height="${consoleHeight}"/>
    <AllowChildren>True</AllowChildren><AllowResize>True</AllowResize><ShowHeader>True</ShowHeader><ShowEnableButton>False</ShowEnableButton><Collapsed>False</Collapsed><Disabled>False</Disabled>
${buttonsXml}
   </SoloFrame>
  </Frame>
  <Properties><Size Width="1180" Height="${consoleHeight + 20}"/><GrandMaster ChannelMode="Intensity" ValueMode="Reduce" SliderMode="Normal"/></Properties>
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
const setupGuide = `# Cuepix + QLC+ routing setup

## Network

- Lighting LAN only. Disable Wi-Fi sharing/bridging on lighting NIC.
- Computer lighting NIC: static \`10.201.6.1\`, mask \`255.255.255.0\`, no gateway.
- Pknight CR011R: \`10.201.6.100\`, Art-Net Universe 0 to DMX output.
- Cuepix 1–6: Art-Net Universe 0. Cuepix 7–12: Art-Net Universe 1.
- All Cuepix panels: 79-channel mode; addresses from CUEPIX-PATCH-CHART.md.
- 375ZX fixtures: 15-channel mode; DMX addresses 481 and 496.

## Install and open

1. Close QLC+.
2. Copy both files from \`fixtures/\` into \`%USERPROFILE%\\QLC+\\Fixtures\`.
3. Start QLC+ once, then close it so fixture cache refreshes.
4. Open \`cuepix-panel-show.qxw\`.
5. In Inputs/Outputs, confirm ArtNet output enabled for QLC+ Universe 1 and 2. Plugin parameters must map to Art-Net 0 and 1.
6. Open Virtual Console. Use only ROUTING TESTS until every fixture passes.

## Cable order

- Ethernet switch: QLC+ computer, CR011R, all 12 Cuepix panels.
- CR011R DMX OUT → 375ZX at address 481 → 375ZX at address 496 → DMX terminator.
- Do not put Cuepix panels in this DMX chain; their addresses occupy Art-Net space but they receive Ethernet directly.

## Test order

1. Power one Cuepix only. Press its Red, Green, Blue, White, Blackout buttons.
2. Repeat for Cuepix 1–12, one powered fixture at a time.
3. Test each 375ZX Open White, Pan Center, Tilt Center, Blackout.
4. Press Universe 0 Panels White, Universe 1 Panels White, Both 375ZX Open White, All Blackout.
5. If wrong fixture responds, stop. Fix panel universe/address or DMX address before scenes.

## Art-Net numbering warning

This workspace maps QLC+ Universe ID 0 → Art-Net universe 0 and QLC+ Universe ID 1 → Art-Net universe 1. Some device screens label these 1 and 2. Match wire universe values, not display wording.
`;

writeFileSync(path.join(OUT, "cuepix-panel-show.qxw"), qxw, "utf8");
writeFileSync(path.join(OUT, "CUEPIX-PATCH-CHART.md"), patchChart, "utf8");
writeFileSync(path.join(OUT, "CUEPIX-SETUP.md"), setupGuide, "utf8");
console.log(`Built ${path.basename(rigPath)}: ${fixtures.length} fixtures, ${routingScenes.length} routing tests, ${functions.length - routingScenes.length} performance functions, Art-Net ${outputUniverses.join(", ")}`);
