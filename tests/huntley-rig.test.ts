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

  it("hangs the stacks from 10 ft with the Beams on top and the 375ZX at 8 ft", () => {
    const monitor = JSON.parse(readFileSync(path.join(out, "monitor", "cuepix-fixtures.json"), "utf8"));
    const z = Object.fromEntries(monitor.fixtures.map((f: { name: string; pos: number[] }) => [f.name, f.pos[2]]));
    expect([z["Cuepix 2"], z["Cuepix 3"]]).toEqual([8.9, 8.9]);   // tops: centre 1.1 ft under 10 ft
    expect([z["Cuepix 1"], z["Cuepix 4"]]).toEqual([6.7, 6.7]);
    expect([z["Beam L"], z["Beam R"]]).toEqual([10, 10]);
    expect([z["375ZX L"], z["375ZX R"]]).toEqual([8, 8]);
  });
});
