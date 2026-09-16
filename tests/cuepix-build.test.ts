import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseStringPromise } from "xml2js";
import { loadRig, RigSchema } from "../scripts/rig.js";
import { parseQxwFile } from "../src/qlc/qxwParser.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RIG = path.join(ROOT, "rigs", "cuepix-panel.rig.json");

function functionBlock(qxw: string, type: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = qxw.match(new RegExp(`<Function[^>]*Type="${type}"[^>]*Name="${escaped}"[^>]*>([\\s\\S]*?)<\\/Function>`));
  if (!match) throw new Error(`Missing ${type} function: ${name}`);
  return match[1];
}

function fixtureChannels(block: string): { ids: number[]; channels: number[] } {
  const ids: number[] = [];
  const channels = new Set<number>();
  for (const match of block.matchAll(/<FixtureVal ID="(\d+)">([^<]*)<\/FixtureVal>/g)) {
    ids.push(Number(match[1]));
    const values = match[2].split(",").map(Number);
    for (let index = 0; index < values.length; index += 2) channels.add(values[index]);
  }
  return { ids, channels: [...channels].sort((a, b) => a - b) };
}

function chaserFixtureOrder(qxw: string, name: string): number[][] {
  const chaser = functionBlock(qxw, "Chaser", name);
  return [...chaser.matchAll(/<Step[^>]*>(\d+)<\/Step>/g)].map((step) => {
    const scene = qxw.match(new RegExp(`<Function ID="${step[1]}" Type="Scene"[^>]*>([\\s\\S]*?)<\\/Function>`));
    if (!scene) throw new Error(`Missing step scene ${step[1]} for ${name}`);
    return fixtureChannels(scene[1]).ids;
  });
}

function buttonBlock(qxw: string, caption: string): string {
  const escaped = caption.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = qxw.match(new RegExp(`<Button Caption="${escaped}"[\\s\\S]*?<\\/Button>`));
  if (!match) throw new Error(`Missing button: ${caption}`);
  return match[0];
}

describe("Cuepix routing workspace", () => {
  it("loads the Cuepix patch without overlaps", () => {
    const { rig } = loadRig(RIG);
    const panelGroups = rig.fixtures.filter((g) => g.kind === "panel");
    expect(panelGroups).toHaveLength(2);
    expect(panelGroups.map((g) => ({ universe: g.universe, addresses: g.addresses }))).toEqual([
      { universe: 0, addresses: [0, 79, 158, 237] },
      { universe: 1, addresses: [0, 79, 158, 237] },
    ]);
    expect(rig.fixtures.filter((g) => g.kind === "head").flatMap((g) => g.addresses)).toEqual([316, 330, 344, 359]);
  });

  it("defines four left-to-right trusses", () => {
    const { rig } = loadRig(RIG);
    expect((rig as any).cuepix?.trusses).toEqual([[], [1, 2, 3, 4], [5, 6, 7, 8], []]);
  });

  it("rejects duplicate Cuepix panel placement", () => {
    const raw = JSON.parse(readFileSync(RIG, "utf8"));
    raw.cuepix = {
      trusses: [[], [1, 2, 3, 4], [5, 6, 7, 7], []],
      moversCalibrated: false,
    };
    expect(RigSchema.safeParse(raw).success).toBe(false);
  });

  it("builds the two-universe routing workspace", async () => {
    const out = mkdtempSync(path.join(os.tmpdir(), "cuepix-build-"));
    execSync("npx tsx scripts/build-cuepix-show.ts rigs/cuepix-panel.rig.json", {
      cwd: ROOT,
      env: { ...process.env, QLC_BUILD_OUT: out },
      stdio: "pipe",
    });
    const qxw = readFileSync(path.join(out, "cuepix-panel-show.qxw"), "utf8");
    await expect(parseStringPromise(qxw)).resolves.toBeTruthy();
    expect((qxw.match(/<Fixture>/g) ?? [])).toHaveLength(12);
    expect(qxw).toContain('<Output Plugin="ArtNet" UID="None" Line="0">');
    expect(qxw).toContain('outputUni="0"');
    expect(qxw).toContain('outputUni="1"');
    expect(qxw).toContain('<Name>Cuepix 8</Name>');
    expect(qxw).toContain('<Name>Beam L</Name>');
    expect(qxw).toContain('<Name>Beam R</Name>');
    expect(qxw).toContain('<Name>375ZX L</Name>');
    expect(qxw).toContain('<Name>375ZX R</Name>');
    expect(qxw).toContain('<Address>359</Address>');
    expect(qxw).toContain('Name="TEST · Cuepix 1 Red"');
    const sceneNames = [...qxw.matchAll(/<Function[^>]*Type="Scene"[^>]*Name="([^"]+)"/g)].map((match) => match[1]);
    const routingSceneNames = sceneNames.filter((name) => name.startsWith("TEST · "));
    expect(routingSceneNames).toHaveLength(60);
    expect(routingSceneNames.every((name) => name.startsWith("TEST · "))).toBe(true);
    expect(existsSync(path.join(out, "CUEPIX-PATCH-CHART.md"))).toBe(true);
    expect(existsSync(path.join(out, "CUEPIX-SETUP.md"))).toBe(true);
    const patch = readFileSync(path.join(out, "CUEPIX-PATCH-CHART.md"), "utf8");
    for (const text of [
      "| Cuepix 1 | CUEPIX Panel | 0 | 1 | 79 | 79 |",
      "| Cuepix 4 | CUEPIX Panel | 0 | 238 | 316 | 79 |",
      "| Cuepix 5 | CUEPIX Panel | 1 | 1 | 79 | 79 |",
      "| Cuepix 8 | CUEPIX Panel | 1 | 238 | 316 | 79 |",
      "| Beam L | Intimidator Beam 140SR V2 | 0 | 317 | 330 | 14 |",
      "| Beam R | Intimidator Beam 140SR V2 | 0 | 331 | 344 | 14 |",
      "| 375ZX L | Intimidator Spot 375ZX | 0 | 345 | 359 | 15 |",
      "| 375ZX R | Intimidator Spot 375ZX | 0 | 360 | 374 | 15 |",
    ]) expect(patch).toContain(text);
    const setup = readFileSync(path.join(out, "CUEPIX-SETUP.md"), "utf8");
    for (const text of [
      "Truss 2: Cuepix 1-4, bottom to top.",
      "Truss 3: Cuepix 5-8, bottom to top.",
      "Beam L at 317 → Beam R at 331 → 375ZX L at 345 → 375ZX R at 360",
      "Minilab3 MIDI",
      "Maximum 4 panels per Elation rigging bar; each panel gets an independent safety cable; never daisy-chain safety cables.",
      "Maximum 2 Cuepix panels power-linked at 120 V.",
      "Panels: Service PIN `050`, Network Switch `ON`, Protocol `ArtNet` (per-panel menu).",
      "Launchpad Mini MK3", "MIDIIN2 (LPMiniMK3 MIDI)",
      "http://127.0.0.1:8788/dashboard", "http://127.0.0.1:7800",
      "mover calibration", "SETUP · ROUTING TESTS",
    ]) expect(setup).toContain(text);
  });

  it("generates grouped Cuepix functions with isolated channel layers", () => {
    const out = mkdtempSync(path.join(os.tmpdir(), "cuepix-functions-"));
    execSync("npx tsx scripts/build-cuepix-show.ts rigs/cuepix-panel.rig.json", {
      cwd: ROOT,
      env: { ...process.env, QLC_BUILD_OUT: out },
      stdio: "pipe",
    });
    const qxw = readFileSync(path.join(out, "cuepix-panel-show.qxw"), "utf8");
    const sceneNames = [...qxw.matchAll(/<Function[^>]*Type="Scene"[^>]*Name="([^"]+)"/g)].map((match) => match[1]);
    const chaserNames = [...qxw.matchAll(/<Function[^>]*Type="Chaser"[^>]*Name="([^"]+)"/g)].map((match) => match[1]);

    expect(sceneNames).toContain("BASE · Red");
    expect(sceneNames).toContain("BASE · Rainbow");
    expect(sceneNames).toContain("LEVEL · 25%");
    expect(sceneNames).toContain("FX · Strobe Slow");
    expect(chaserNames).toEqual(expect.arrayContaining([
      "FX · Left to Right", "FX · Right to Left", "FX · Center Out", "FX · Outside In",
      "FX · Truss Step", "FX · Bounce", "FX · Snake", "FX · Rainbow Chase",
    ]));
    expect(sceneNames.some((name) => name === "Cuepix 1 Red")).toBe(false);

    const expectedPanels = Array.from({ length: 8 }, (_, index) => index);
    for (const name of sceneNames.filter((name) => name.startsWith("BASE · "))) {
      expect(fixtureChannels(functionBlock(qxw, "Scene", name)).ids).toEqual(expectedPanels);
    }
    const base = fixtureChannels(functionBlock(qxw, "Scene", "BASE · Red"));
    expect(base.ids).toEqual(expectedPanels);
    expect(base.channels).toEqual([...Array.from({ length: 76 }, (_, index) => index), 78]);

    const level = fixtureChannels(functionBlock(qxw, "Scene", "LEVEL · 25%"));
    expect(level.ids).toEqual(expectedPanels);
    expect(level.channels).toEqual([76]);

    const strobe = fixtureChannels(functionBlock(qxw, "Scene", "FX · Strobe Slow"));
    expect(strobe.ids).toEqual(expectedPanels);
    expect(strobe.channels).toEqual([77]);

    expect(chaserFixtureOrder(qxw, "FX · Left to Right")).toEqual(expectedPanels.map((id) => [id]));
    expect(chaserFixtureOrder(qxw, "FX · Center Out")).toEqual([[3, 4], [2, 5], [1, 6], [0, 7]]);
    expect(chaserFixtureOrder(qxw, "FX · Truss Step")).toEqual([[0, 1, 2, 3], [4, 5, 6, 7]]);
    expect(chaserFixtureOrder(qxw, "FX · Bounce")).toEqual([
      [0], [1], [2], [3], [4], [5], [6], [7],
      [6], [5], [4], [3], [2], [1],
    ]);
  });

  it("builds two performance pages with Launchpad and OSC twins", async () => {
    const out = mkdtempSync(path.join(os.tmpdir(), "cuepix-console-"));
    execSync("npx tsx scripts/build-cuepix-show.ts rigs/cuepix-panel.rig.json", {
      cwd: ROOT,
      env: { ...process.env, QLC_BUILD_OUT: out },
      stdio: "pipe",
    });
    const qxwPath = path.join(out, "cuepix-panel-show.qxw");
    const qxw = readFileSync(qxwPath, "utf8");

    expect(qxw).toContain('<Universe Name="Launchpad" ID="2"');
    expect(qxw).toContain('<Input Plugin="MIDI" UID="2" Line="2"/>');
    expect(qxw).toContain('<Feedback Plugin="MIDI" UID="3" Line="3"/>');
    expect(qxw).toContain('<Multipage PagesNum="2" CurrentPage="0"/>');
    expect(qxw).toContain('<GrandMaster ChannelMode="All" ValueMode="Reduce" SliderMode="Normal"/>');
    expect(qxw).not.toContain('<GrandMaster ChannelMode="Intensity"');
    expect(qxw).toContain('<Input Universe="2" Channel="146"/>');
    expect(qxw).toContain('Caption="RED P1 R1C1"');
    expect(qxw).toContain('Caption="RAINBOW P1 R2C1"');
    expect(qxw).toContain('Caption="PAGE P1 R8C8"');
    // No Level slider may own a panel channel — it would seize that channel from every scene and
    // pad. Every <Level> channel in the show belongs to a head (fixture ids 8-11).
    const levelChannelFixtures = [...qxw.matchAll(/<Level\b[^>]*>\s*<Channel Fixture="(\d+)">/g)].map((match) => Number(match[1]));
    expect(levelChannelFixtures.length).toBeGreaterThan(0);
    expect(levelChannelFixtures.every((id) => id >= 8)).toBe(true);
    expect(qxw).toContain('<AbsoluteValue Minimum="1199" Maximum="1200"><Input Universe="2" Channel="153"/></AbsoluteValue>');
    expect(qxw).toContain('<AbsoluteValue Minimum="599" Maximum="600"><Input Universe="2" Channel="154"/></AbsoluteValue>');
    expect(qxw).toContain('<AbsoluteValue Minimum="249" Maximum="250"><Input Universe="2" Channel="155"/></AbsoluteValue>');

    for (const page of ["P1", "P2"]) {
      const channels = [...qxw.matchAll(/<Button\b[\s\S]*?<\/Button>/g)]
        .map((match) => match[0])
        .filter((block) => block.includes(` ${page} R`))
        .map((block) => block.match(/<Input Universe="2" Channel="(\d+)"/)?.[1])
        .filter((channel): channel is string => channel !== undefined)
        .map(Number);
      expect(channels.length).toBeGreaterThan(0);
      expect(new Set(channels).size).toBe(channels.length);
    }

    // Enabled pads are emitted as an OSC twin + a Launchpad twin; buttonBlock() returns the first.
    const homePad = buttonBlock(qxw, "HOME P2 R4C1");
    expect(homePad).toContain("<Function");
    expect(homePad).toContain('<Input Universe="0"');
    const homeTwins = [...qxw.matchAll(/<Button Caption="HOME P2 R4C1"[\s\S]*?<\/Button>/g)].map((match) => match[0]);
    expect(homeTwins).toHaveLength(2);
    expect(homeTwins.every((twin) => twin.includes("<Function"))).toBe(true);
    expect(homeTwins.some((twin) => twin.includes('<Input Universe="2"'))).toBe(true);
    expect(qxw).toContain('<Universe Name="MiniLab" ID="3">');
    expect(qxw).toContain('<Slider Caption="Tilt1SL"');
    expect(qxw).toContain('<Slider Caption="Pan2BL"');
    expect(qxw).toMatch(/Name="HEAD · Home Go">[\s\S]*?<RunOrder>SingleShot<\/RunOrder>/);

    // headSafety fences the MiniLab knobs: tilt stops at 92 (≈horizontal), pan runs the full range.
    // Every knob ships at Value="0" so a future non-zero tiltMin cannot seize pan/tilt at load.
    expect(qxw).toMatch(/Caption="Tilt1SL"[\s\S]*?<Level LowLimit="0" HighLimit="92" Value="0">/);
    for (const caption of ["Tilt1SL", "Tilt2BL", "Tilt3BR", "Tilt4SR"]) {
      expect(qxw).toMatch(new RegExp(`<Slider Caption="${caption}"[\\s\\S]*?<Level LowLimit="0" HighLimit="92" Value="0"`));
    }
    for (const caption of ["Pan1SL", "Pan2BL", "Pan3BR", "Pan4SR"]) {
      expect(qxw).toMatch(new RegExp(`<Slider Caption="${caption}"[\\s\\S]*?<Level LowLimit="0" HighLimit="255" Value="0"`));
    }

    // The three MiniLab faders drive their own _FADER copies. A Playback slider at 0 STOPS its
    // function, so sharing a function with a pad would let a parked fader kill the pad's look.
    expect(functionBlock(qxw, "Scene", "_FADER · Beams")).toContain('<FixtureVal ID="8">9,255,10,255</FixtureVal>');
    expect(functionBlock(qxw, "Scene", "_FADER · Spots")).toContain('<FixtureVal ID="10">10,255,11,255</FixtureVal>');
    expect(functionBlock(qxw, "Scene", "_FADER · Panels")).toContain('<FixtureVal ID="0">76,255</FixtureVal>');
    const faderBeamsId = qxw.match(/<Function ID="(\d+)" Type="Scene" Name="_FADER · Beams">/)![1];
    const headBeamsId = qxw.match(/<Function ID="(\d+)" Type="Scene" Name="HEAD · Beams Full">/)![1];
    const beamsSlider = qxw.match(/<Slider Caption="Beams"[\s\S]*?<\/Slider>/)![0];
    expect(beamsSlider).toContain(`<Playback><Function>${faderBeamsId}</Function></Playback>`);
    expect(beamsSlider).not.toContain(`<Playback><Function>${headBeamsId}</Function></Playback>`);

    // Per-model head channels: Beam L is fixture 8 (140SR, 14ch), 375ZX L is fixture 10 (15ch).
    const aimHome = functionBlock(qxw, "Scene", "_AIM · Home");
    expect(aimHome.match(/<FixtureVal ID="8">([^<]*)</)![1]).toBe("0,128,2,64,4,0,10,255");
    expect(aimHome.match(/<FixtureVal ID="10">([^<]*)</)![1]).toBe("0,128,2,64,4,0,11,255");
    // Crowd sits ≈5° ABOVE horizontal, never in faces. Crossed pans the L heads right (148) and the
    // R heads left (108) so the beams actually cross.
    const aimCrowd = functionBlock(qxw, "Scene", "_AIM · Crowd");
    expect(aimCrowd.match(/<FixtureVal ID="8">([^<]*)</)![1]).toBe("0,128,2,88,4,0,10,255");
    expect(aimCrowd.match(/<FixtureVal ID="10">([^<]*)</)![1]).toBe("0,128,2,88,4,0,11,255");
    const aimCrossed = functionBlock(qxw, "Scene", "_AIM · Crossed");
    expect(aimCrossed.match(/<FixtureVal ID="8">([^<]*)</)![1]).toBe("0,148,2,80,4,0,10,255");
    expect(aimCrossed.match(/<FixtureVal ID="9">([^<]*)</)![1]).toBe("0,108,2,80,4,0,10,255");
    expect(aimCrossed.match(/<FixtureVal ID="10">([^<]*)</)![1]).toBe("0,148,2,80,4,0,11,255");
    // Every pre-plot aim stays inside the headSafety tilt fence, so none of them points below
    // horizontal, and every aim addresses a head rather than a panel.
    const aimSceneNames = [...qxw.matchAll(/<Function[^>]*Type="Scene"[^>]*Name="(_AIM · [^"]+)"/g)].map((match) => match[1]);
    expect(aimSceneNames).toHaveLength(4);
    for (const name of aimSceneNames) {
      for (const value of functionBlock(qxw, "Scene", name).matchAll(/<FixtureVal ID="(\d+)">([^<]*)</g)) {
        expect(Number(value[1])).toBeGreaterThanOrEqual(8);
        const pairs = value[2].split(",").map(Number);
        const tiltIndex = pairs.findIndex((entry, index) => index % 2 === 0 && entry === 2);
        expect(tiltIndex).toBeGreaterThanOrEqual(0);
        expect(pairs[tiltIndex + 1]).toBeLessThanOrEqual(92);
      }
    }
    expect(functionBlock(qxw, "Scene", "HEAD · Beams Full")).toContain('<FixtureVal ID="8">9,255,10,255</FixtureVal>');
    expect(functionBlock(qxw, "Scene", "HEAD · Spots Full")).toContain('<FixtureVal ID="10">10,255,11,255</FixtureVal>');
    const headRed = functionBlock(qxw, "Scene", "HEAD · Red");
    expect(headRed).toContain('<FixtureVal ID="8">5,5,10,255</FixtureVal>');
    expect(headRed).toContain('<FixtureVal ID="10">5,11,11,255</FixtureVal>');
    const headStrobe = functionBlock(qxw, "Scene", "HEAD · Strobe");
    expect(headStrobe).toContain('<FixtureVal ID="8">10,90</FixtureVal>');
    expect(headStrobe).toContain('<FixtureVal ID="10">11,90</FixtureVal>');

    const mapPath = path.join(out, "config", "cuepix-widgets.json");
    expect(existsSync(mapPath)).toBe(true);
    const widgetMap = JSON.parse(readFileSync(mapPath, "utf8"));
    const parsed = await parseQxwFile(qxwPath);
    expect(parsed.errors).toEqual([]);
    expect(widgetMap.widgets.some((widget: { name: string }) => widget.name === "FX Speed")).toBe(true);
    expect(widgetMap.widgets.some((widget: { name: string }) => widget.name.startsWith("TEST ·"))).toBe(false);
    // The MiniLab knobs and faders live on input universe 3, so they carry no OSC path and must
    // never reach the dashboard's widget map.
    expect(widgetMap.widgets.some((widget: { name: string }) => /^(Tilt|Pan)\d/.test(widget.name))).toBe(false);
    expect(widgetMap.widgets.some((widget: { name: string }) => ["Panels", "Beams", "Spots"].includes(widget.name))).toBe(false);
  });
});
