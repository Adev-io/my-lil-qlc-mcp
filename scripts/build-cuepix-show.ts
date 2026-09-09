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
type Scene = { id: number; name: string; values: FixtureValue[] };

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
const headPairs = (on: boolean, pan = 128, tilt = 128): number[] => [
  0, pan, 1, 0, 2, tilt, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8, 0, 9, 128,
  10, on ? 255 : 0, 11, on ? 255 : 0, 12, 0, 13, 0, 14, 128,
];
const off = (fixture: Fixture): FixtureValue => ({
  id: fixture.id,
  pairs: fixture.kind === "panel" ? panelPairs([0, 0, 0]) : headPairs(false),
});

const scenes: Scene[] = [];
function addScene(name: string, active: Map<number, number[]>): void {
  scenes.push({
    id: scenes.length,
    name: `TEST · ${name}`,
    values: fixtures.map((fixture) => ({ id: fixture.id, pairs: active.get(fixture.id) ?? off(fixture).pairs })),
  });
}

const colors: [string, [number, number, number]][] = [
  ["Red", [255, 0, 0]],
  ["Green", [0, 255, 0]],
  ["Blue", [0, 0, 255]],
  ["White", [255, 255, 255]],
  ["Blackout", [0, 0, 0]],
];
for (const panel of panels) {
  for (const [label, rgb] of colors) addScene(`${panel.name} ${label}`, new Map([[panel.id, panelPairs(rgb)]]));
}
for (const head of heads) {
  addScene(`${head.name} Open White`, new Map([[head.id, headPairs(true)]]));
  addScene(`${head.name} Pan Center`, new Map([[head.id, headPairs(true, 128, 64)]]));
  addScene(`${head.name} Tilt Center`, new Map([[head.id, headPairs(true, 64, 128)]]));
  addScene(`${head.name} Blackout`, new Map([[head.id, headPairs(false)]]));
}
for (const universe of [0, 1]) {
  addScene(
    `Universe ${universe} Panels White`,
    new Map(panels.filter((panel) => panel.universe === universe).map((panel) => [panel.id, panelPairs([255, 255, 255])])),
  );
}
addScene("Both 375ZX Open White", new Map(heads.map((head) => [head.id, headPairs(true)])));
addScene("All Blackout", new Map());

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
const scenesXml = scenes.map((scene) => `  <Function ID="${scene.id}" Type="Scene" Name="${esc(scene.name)}">
   <Speed FadeIn="0" FadeOut="0" Duration="0"/>
${scene.values.map((value) => `   <FixtureVal ID="${value.id}">${value.pairs.join(",")}</FixtureVal>`).join("\n")}
  </Function>`).join("\n");

const buttonWidth = 138;
const buttonHeight = 48;
const columns = 8;
const buttonsXml = scenes.map((scene, index) => {
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
const rows = Math.ceil(scenes.length / columns);
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
${scenesXml}
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
console.log(`Built ${path.basename(rigPath)}: ${fixtures.length} fixtures, ${scenes.length} routing tests, Art-Net ${outputUniverses.join(", ")}`);
