import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRig } from "../scripts/rig.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RIG = "rigs/huntley-homecoming.rig.json";

// Huntley HS homecoming: 4 Cuepix stacked 2-high on the inside 10 ft towers, Beams on top, 375ZX on
// the 8 ft outer trusses — an upside-down V. One Art-Net universe, and a new room to plot.
describe("Huntley homecoming rig", () => {
  const out = mkdtempSync(path.join(os.tmpdir(), "huntley-"));
  const env = { ...process.env, QLC_BUILD_OUT: out, MONITOR_FIXTURES_FILE: "cuepix-fixtures.json" };
  execSync(`npx tsx scripts/build-cuepix-show.ts ${RIG}`, { cwd: ROOT, env, stdio: "pipe" });
  execSync(`npx tsx scripts/build-monitor.ts ${RIG}`, { cwd: ROOT, env, stdio: "pipe" });
  const qxw = readFileSync(path.join(out, "cuepix-panel-show.qxw"), "utf8");

  it("keeps the keys the schema used to strip", () => {
    const { rig } = loadRig(path.join(ROOT, RIG));
    expect((rig as any).controller2.plotMode).toBe(true);
    expect(rig.cuepix?.stackTopFt).toBe(10);
    expect((rig as any).headPlot.beamL).toBeDefined();
  });

  it("drives four panels on Art-Net universe 0 only", () => {
    expect(qxw).toContain("<Name>Cuepix 4</Name>");
    expect(qxw).not.toContain("<Name>Cuepix 5</Name>");
    expect([...qxw.matchAll(/outputUni="(\d+)"/g)].map((m) => m[1])).toEqual(["0"]);
  });

  it("emits the pan/tilt plot knobs while plotMode is on", () => {
    expect(qxw).toContain('<Slider Caption="Tilt1SL"');
    expect(qxw).toContain('<Slider Caption="Pan4SR"');
  });

  it("orders the panels round the V: Center Out lights the two tops first", () => {
    const fixtureId = (name: string) => qxw.match(new RegExp(`<ID>(\\d+)</ID>\\s*<Name>${name}</Name>`))![1];
    const chaser = qxw.match(/Type="Chaser" Name="FX · Center Out">([\s\S]*?)<\/Function>/)![1];
    const firstStep = chaser.match(/<Step[^>]*>(\d+)<\/Step>/)![1];
    const scene = qxw.match(new RegExp(`<Function ID="${firstStep}" Type="Scene"[^>]*>([\\s\\S]*?)</Function>`))![1];
    const lit = [...scene.matchAll(/<FixtureVal ID="(\d+)">/g)].map((m) => m[1]).sort();
    expect(lit).toEqual([fixtureId("Cuepix 2"), fixtureId("Cuepix 3")].sort());
  });

  // 2026-09-22 looks review (Huntley Looks Review artifact): merge near-duplicates, fix two looks,
  // add gobo/prism/hit layers and a mover speed dial, and give the panels real pixel effects.
  const button = (caption: string) => qxw.match(new RegExp(`<Button Caption="${caption}"[\\s\\S]*?</Button>`))?.[0] ?? "";
  const frameOf = (caption: string) => {
    const at = qxw.indexOf(`<Button Caption="${caption}"`);
    const open = [...qxw.slice(0, at).matchAll(/<(SoloFrame|Frame) Caption="([^"]*)"/g)].pop()!;
    return { solo: open[1] === "SoloFrame", name: open[2] };
  };
  const fnBlock = (name: string) => qxw.match(new RegExp(`<Function ID="\\d+" Type="\\w+" Name="${name}">([\\s\\S]*?)</Function>`))?.[1];

  it("merges the near-duplicate mover looks and fixes Scatter", () => {
    for (const gone of ["FLOOR · Sweep", "FLOOR · X", "CEIL · Sweep"]) expect(fnBlock(gone)).toBeUndefined();
    expect(fnBlock("FLOOR · Scatter")).toMatch(/<Step Number="0" FadeIn="180"/);
  });

  it("layers gobo, prism and beat hits on page 3 without stopping the running look", () => {
    for (const pad of ["GOBO OPEN", "GOBO A", "GOBO B"]) expect(frameOf(`${pad} P3 R6C${pad === "GOBO OPEN" ? 1 : pad === "GOBO A" ? 2 : 3}`)).toEqual({ solo: true, name: "GOBO-P3" });
    expect(frameOf("PRISM P3 R6C4").name).not.toBe("MOVE-P3");
    // HITs are TOGGLES in the mover solo frame: a running chaser rewrites pan/tilt every step, so a
    // held scene outside the frame, or a Flash inside it, never won (loopback 2026-09-22). A toggle
    // makes the frame stop the look; the heads stay on the hit until the next look is pressed.
    for (const pad of ["HIT FLOOR P3 R4C5", "HIT UP P3 R4C6"]) {
      expect(frameOf(pad)).toEqual({ solo: true, name: "MOVE-P3" });
      expect(button(pad)).toContain("<Action>Toggle</Action>");
    }
    // A gobo pad touches only gobo, gobo rotation and prism: 140SR ch 6-7, 375ZX ch 6-8.
    const beamIds = ["Beam L", "Beam R"].map((n) => qxw.match(new RegExp(`<ID>(\\d+)</ID>\\s*<Name>${n}</Name>`))![1]);
    for (const name of ["HEAD · Gobo Open", "HEAD · Gobo A", "HEAD · Gobo B", "HEAD · Prism"]) {
      for (const [, id, pairs] of fnBlock(name)!.matchAll(/<FixtureVal ID="(\d+)">([^<]*)</g)) {
        const channels = pairs.split(",").map(Number).filter((_, i) => i % 2 === 0);
        expect(channels.every((ch) => (beamIds.includes(id) ? [6, 7] : [6, 7, 8]).includes(ch))).toBe(true);
      }
    }
  });

  // OSC paths map to QLC+ input channels by CRC16, so two captions can collide: "GAP BAR P1 R6C5"
  // and "AMBER P1 R1C2" both hashed to 34401 and one dashboard press fired both (loopback 2026-09-22).
  it("gives every pad its own OSC input channel", () => {
    const seen = new Map<string, string>();
    for (const [, caption, channel] of qxw.matchAll(/<Button Caption="([^"]+)" ID="\d+" Icon="">(?:(?!<\/Button>)[\s\S])*?<Input Universe="0" Channel="(\d+)"\/>/g)) {
      expect(seen.get(channel) ?? caption).toBe(caption);
      seen.set(channel, caption);
    }
    expect(seen.size).toBeGreaterThan(100);
  });

  it("gives the movers their own speed dial", () => {
    const dial = (caption: string) => new Set([...qxw.match(new RegExp(`<SpeedDial Caption="${caption}"[\\s\\S]*?</SpeedDial>`))![0]
      .matchAll(/Duration="6">(\d+)</g)].map((m) => m[1]));
    const idOf = (name: string) => qxw.match(new RegExp(`<Function ID="(\\d+)" Type="\\w+" Name="${name}">`))![1];
    const panelsDial = dial("FX Speed"), moversDial = dial("Mover Speed");
    expect(moversDial.has(idOf("FLOOR · Figure 8"))).toBe(true);
    expect(panelsDial.has(idOf("FLOOR · Figure 8"))).toBe(false);
    expect(panelsDial.has(idOf("FX · Left to Right"))).toBe(true);
    expect([...moversDial].some((id) => panelsDial.has(id))).toBe(false);
  });

  it("maps the 100 panel pixels as the V and runs pixel effects on them", () => {
    const qxf = readFileSync(path.join(ROOT, "fixtures", "Elation-Cuepix-Panel-79CH.qxf"), "utf8");
    const heads = [...qxf.matchAll(/<Head>([\s\S]*?)<\/Head>/g)].map((m) => [...m[1].matchAll(/<Channel>(\d+)<\/Channel>/g)].map((c) => Number(c[1])));
    expect(heads).toHaveLength(25);
    expect(heads[0]).toEqual([0, 1, 2]);
    expect(heads[24]).toEqual([72, 73, 74]);

    const group = qxw.match(/<FixtureGroup ID="(\d+)">\s*<Name>Cuepix V<\/Name>\s*<Size X="20" Y="10"\/>([\s\S]*?)<\/FixtureGroup>/)!;
    const cells = [...group[2].matchAll(/<Head X="(\d+)" Y="(\d+)" Fixture="(\d+)">(\d+)<\/Head>/g)].map((m) => m.slice(1).map(Number));
    expect(cells).toHaveLength(100);
    const fixtureId = (name: string) => Number(qxw.match(new RegExp(`<ID>(\\d+)</ID>\\s*<Name>${name}</Name>`))![1]);
    const p3 = cells.filter(([, , f]) => f === fixtureId("Cuepix 3"));   // top of the right tower
    expect(Math.min(...p3.map(([x]) => x))).toBe(15);
    expect(Math.max(...p3.map(([, y]) => y))).toBe(4);
    const p1 = cells.filter(([, , f]) => f === fixtureId("Cuepix 1"));   // bottom of the left tower
    expect(Math.max(...p1.map(([x]) => x))).toBe(4);
    expect(Math.min(...p1.map(([, y]) => y))).toBe(5);

    const matrices = [...qxw.matchAll(/Type="RGBMatrix" Name="([^"]+)">[\s\S]*?<Algorithm Type="Script">([^<]+)<\/Algorithm>[\s\S]*?<FixtureGroup>(\d+)<\/FixtureGroup>/g)];
    expect(matrices.map((m) => m[2]).sort()).toEqual(["3D Starfield", "Fill Unfill", "Plasma", "Stripes", "Vertical fall"]);
    expect(matrices.every((m) => m[3] === group[1])).toBe(true);
    // Fill Drain fills the towers floor to apex: Vertical fills top-down, so it runs Backward
    // (seen on loopback 2026-09-22: the default filled column by column, left tower first).
    const fill = fnBlock("PIX · Fill Drain")!;
    expect(fill).toContain("<Direction>Backward</Direction>");
    expect(fill).toContain('<Property Name="orientation" Value="Vertical"/>');
    for (const pad of ["FILL DRAIN P1 R6C1", "V COMET P1 R6C6", "FIRE P1 R5C8"]) expect(frameOf(pad)).toEqual({ solo: true, name: "FX-P1" });
    // Custom pixel steps write panel RGB channels only (0-74), never the panel dimmer or strobe.
    const comet = fnBlock("PIX · V Comet")!;
    const stepId = comet.match(/<Step[^>]*>(\d+)<\/Step>/)![1];
    const step = qxw.match(new RegExp(`<Function ID="${stepId}" Type="Scene"[^>]*>([\\s\\S]*?)</Function>`))![1];
    for (const [, , pairs] of step.matchAll(/<FixtureVal ID="(\d+)">([^<]*)</g)) {
      expect(pairs.split(",").map(Number).filter((_, i) => i % 2 === 0).every((ch) => ch <= 74)).toBe(true);
    }
  });

  it("hangs the stacks from 10 ft with the Beams on top and the 375ZX at 8 ft", () => {
    const monitor = JSON.parse(readFileSync(path.join(out, "monitor", "cuepix-fixtures.json"), "utf8"));
    const z = Object.fromEntries(monitor.fixtures.map((f: { name: string; pos: number[] }) => [f.name, f.pos[2]]));
    expect([z["Cuepix 2"], z["Cuepix 3"]]).toEqual([8.9, 8.9]);   // tops: centre 1.1 ft under 10 ft
    expect([z["Cuepix 1"], z["Cuepix 4"]]).toEqual([6.7, 6.7]);
    expect([z["Beam L"], z["Beam R"]]).toEqual([10, 10]);
    expect([z["375ZX L"], z["375ZX R"]]).toEqual([8, 8]);
  });
});
