import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("Cuepix 3D monitor fixture map", () => {
  it("builds eight pixel panels on two towers with Beams above and spots on the outer trusses", () => {
    const out = mkdtempSync(path.join(os.tmpdir(), "cuepix-monitor-"));
    execSync("npx tsx scripts/build-monitor.ts rigs/cuepix-panel.rig.json", {
      cwd: ROOT,
      env: { ...process.env, QLC_BUILD_OUT: out },
      stdio: "pipe",
    });
    const map = JSON.parse(readFileSync(path.join(out, "monitor", "fixtures.json"), "utf8"));
    expect(map.meta.universes).toEqual([0, 1]);
    expect(map.fixtures).toHaveLength(12);
    expect(map.fixtures.map((f: any) => f.universe)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0]);
    const panels = map.fixtures.filter((f: any) => f.kind === "panel");
    expect(panels.map((f: any) => f.name)).toEqual(Array.from({ length: 8 }, (_, i) => `Cuepix ${i + 1}`));
    expect(panels.map((f: any) => f.pos)).toEqual([
      [-3, 10, 1.1], [-3, 10, 3.3], [-3, 10, 5.5], [-3, 10, 7.7],
      [3, 10, 1.1], [3, 10, 3.3], [3, 10, 5.5], [3, 10, 7.7],
    ]);
    const heads = map.fixtures.filter((f: any) => f.kind === "head");
    expect(heads.map((f: any) => [f.name, f.pos])).toEqual([
      ["Beam L", [-3, 10, 9.9]], ["Beam R", [3, 10, 9.9]], ["375ZX L", [-9, 10, 8]], ["375ZX R", [9, 10, 8]],
    ]);
    expect(heads.find((f: any) => f.name === "Beam L").roles).toMatchObject({ pan: 0, tilt: 2, dim: 9, shutter: 10 });
    expect(heads.find((f: any) => f.name === "375ZX L").roles).toMatchObject({ dim: 10, shutter: 11, zoom: 14 });
  });

  it("ships a renderer and launcher that select fixture universes", () => {
    const app = readFileSync(path.join(ROOT, "monitor", "public", "app.js"), "utf8");
    expect(app).toContain('frames[fx.def.universe]');
    expect(app).toContain('def.kind === "panel"');
    expect(existsSync(path.join(ROOT, "start-cuepix-monitor.ps1"))).toBe(true);
  });
});
