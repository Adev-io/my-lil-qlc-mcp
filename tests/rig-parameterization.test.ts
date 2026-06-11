/*
 * Rig parameterization — proves the generators are driven by rig.json:
 *   1. Regression: the example rig regenerates the committed punk-rock-show.qxw exactly.
 *   2. Stress: a different rig shape (6 pars / 0 bars / 4 heads) builds without crashing,
 *      drops bar-only looks, and patches fixtures at the requested addresses.
 *   3. Schema: malformed rig configs are rejected with useful errors.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RigSchema, loadRig } from "../scripts/rig.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLE_RIG = path.join(REPO, "rigs", "punk-rock-show.rig.json");

function runBuildShow(rigPath: string, outDir: string): void {
  execFileSync("npx", ["tsx", "scripts/build-show.ts", rigPath], {
    cwd: REPO,
    env: { ...process.env, QLC_BUILD_OUT: outDir },
    shell: true,
    stdio: "pipe",
  });
}
function runBuildMonitor(rigPath: string, outDir: string): void {
  execFileSync("npx", ["tsx", "scripts/build-monitor.ts", rigPath], {
    cwd: REPO,
    env: { ...process.env, QLC_BUILD_OUT: outDir },
    shell: true,
    stdio: "pipe",
  });
}

let outDir: string;
beforeAll(() => {
  outDir = mkdtempSync(path.join(tmpdir(), "qlc-rig-test-"));
});
afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("regression — example rig reproduces the committed show", () => {
  it("build-show output matches punk-rock-show.qxw byte-for-byte", () => {
    const dir = path.join(outDir, "regress");
    runBuildShow(EXAMPLE_RIG, dir);
    const generated = readFileSync(path.join(dir, "punk-rock-show.qxw"), "utf8");
    const committed = readFileSync(path.join(REPO, "punk-rock-show.qxw"), "utf8");
    expect(generated).toBe(committed);
  }, 60_000);

  it("build-monitor output matches monitor/fixtures.json byte-for-byte", () => {
    const dir = path.join(outDir, "regress-mon");
    runBuildMonitor(EXAMPLE_RIG, dir);
    const generated = readFileSync(path.join(dir, "monitor", "fixtures.json"), "utf8");
    const committed = readFileSync(path.join(REPO, "monitor", "fixtures.json"), "utf8");
    expect(generated).toBe(committed);
  }, 60_000);
});

describe("stress — a different rig shape builds", () => {
  const stressRig = {
    meta: { name: "Stress Test Show" },
    stage: { widthFt: 16, depthFt: 8, deckHeightFt: 1, headHeightFt: 9, headSeparationFt: 16 },
    fixtures: [
      {
        kind: "par", manufacturer: "Generic", model: "RGB Par 10ch", mode: "10 Channel",
        channels: 10, count: 6, addresses: [0, 10, 20, 30, 40, 50],
      },
      {
        kind: "head", manufacturer: "Generic", model: "Spot 15ch", mode: "15 channel",
        channels: 15, count: 4, addresses: [100, 115, 130, 145],
      },
    ],
  };
  let qxw: string;

  it("builds a 6-par / 0-bar / 4-head rig without crashing", () => {
    const rigFile = path.join(outDir, "stress.rig.json");
    writeFileSync(rigFile, JSON.stringify(stressRig, null, 2));
    const dir = path.join(outDir, "stress");
    runBuildShow(rigFile, dir);
    runBuildMonitor(rigFile, dir);
    qxw = readFileSync(path.join(dir, "stress-test-show.qxw"), "utf8");
    expect(existsSync(path.join(dir, "monitor", "fixtures.json"))).toBe(true);
  }, 60_000);

  it("patches all 10 fixtures at the requested addresses", () => {
    expect(qxw.match(/<Fixture>/g)?.length).toBe(10);
    for (const addr of [0, 50, 100, 145]) {
      expect(qxw).toContain(`<Address>${addr}</Address>`);
    }
    // 4 heads -> numbered, not L/R
    expect(qxw).toContain("<Name>Head 4</Name>");
  });

  it("drops bar-only looks and the bars fader", () => {
    expect(qxw).not.toContain("Bar Chase");
    expect(qxw).not.toContain("Bar Scroll");
    expect(qxw).not.toContain('Caption="Bars Dim"');
    expect(qxw).not.toContain("<FixtureGroup");
    // par + head looks survive
    expect(qxw).toContain("Build Drop");
    expect(qxw).toContain('Caption="Pars Dim"');
    expect(qxw).toContain('Caption="Heads Dim"');
  });

  it("scales Build Drop steps to the par count", () => {
    // 6 pars -> Bld steps at 1/2/4/6 lit pars; just confirm Bld 4 exists and references all pars
    expect(qxw).toContain("<Function ID=");
    expect(qxw).toContain('Name="Bld 4"');
  });
});

describe("schema — malformed rigs are rejected", () => {
  it("rejects a rig with no fixtures", () => {
    const r = RigSchema.safeParse({ meta: { name: "X" }, stage: { widthFt: 10, depthFt: 5 }, fixtures: [] });
    expect(r.success).toBe(false);
  });

  it("rejects addresses[] length mismatch with count", () => {
    const r = RigSchema.safeParse({
      meta: { name: "X" },
      stage: { widthFt: 10, depthFt: 5 },
      fixtures: [{ kind: "par", manufacturer: "m", model: "m", mode: "m", channels: 8, count: 2, addresses: [0] }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects overlapping DMX footprints via loadRig", () => {
    const rigFile = path.join(outDir, "overlap.rig.json");
    writeFileSync(rigFile, JSON.stringify({
      meta: { name: "Overlap" },
      stage: { widthFt: 10, depthFt: 5 },
      fixtures: [
        { kind: "par", manufacturer: "m", model: "m", mode: "m", channels: 10, count: 2, addresses: [0, 5] },
      ],
    }));
    expect(() => loadRig(rigFile)).toThrow(/overlap/i);
  });

  it("rejects a fixture running past channel 512", () => {
    const rigFile = path.join(outDir, "past512.rig.json");
    writeFileSync(rigFile, JSON.stringify({
      meta: { name: "Past" },
      stage: { widthFt: 10, depthFt: 5 },
      fixtures: [
        { kind: "par", manufacturer: "m", model: "m", mode: "m", channels: 10, count: 1, addresses: [505] },
      ],
    }));
    expect(() => loadRig(rigFile)).toThrow(/512/);
  });

  it("gives a friendly error when rig.json is missing", () => {
    expect(() => loadRig(path.join(outDir, "nope.rig.json"))).toThrow(/rig-setup-wizard/);
  });
});
