import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("Cuepix 3D monitor fixture map", () => {
  it("builds 12 pixel panels and two heads across universes 0 and 1", () => {
    const out = mkdtempSync(path.join(os.tmpdir(), "cuepix-monitor-"));
    execSync("npx tsx scripts/build-monitor.ts rigs/cuepix-panel.rig.json", {
      cwd: ROOT,
      env: { ...process.env, QLC_BUILD_OUT: out },
      stdio: "pipe",
    });
    const map = JSON.parse(readFileSync(path.join(out, "monitor", "fixtures.json"), "utf8"));
    expect(map.meta.universes).toEqual([0, 1]);
    expect(map.fixtures).toHaveLength(14);
    expect(map.fixtures.map((fixture: any) => fixture.universe)).toEqual([
      0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0,
    ]);
    const panels = map.fixtures.filter((fixture: any) => fixture.kind === "panel");
    expect(panels.map((fixture: any) => fixture.name)).toEqual(
      Array.from({ length: 12 }, (_, index) => `Cuepix ${index + 1}`),
    );
    expect(panels.every((fixture: any) => fixture.roles.pixels.length === 25)).toBe(true);
    const centers = [[0, 1], [2, 3, 4, 5], [6, 7, 8, 9], [10, 11]].map((ids) =>
      ids.reduce((sum, id) => sum + panels[id].pos[0], 0) / ids.length,
    );
    expect(centers).toEqual([-6, -2, 2, 6]);
    expect(panels.map((fixture: any) => fixture.pos)).toEqual([
      [-6, 10, 1.1], [-6, 10, 3.3],
      [-2, 10, 1.1], [-2, 10, 3.3], [-2, 10, 5.5], [-2, 10, 7.7],
      [2, 10, 1.1], [2, 10, 3.3], [2, 10, 5.5], [2, 10, 7.7],
      [6, 10, 1.1], [6, 10, 3.3],
    ]);
    const heads = map.fixtures.filter((fixture: any) => fixture.kind === "head");
    expect(heads.map((fixture: any) => fixture.pos)).toEqual([[-6, 10, 8], [6, 10, 8]]);
  });

  it("ships a renderer and launcher that select fixture universes", () => {
    const app = readFileSync(path.join(ROOT, "monitor", "public", "app.js"), "utf8");
    expect(app).toContain('frames[fx.def.universe]');
    expect(app).toContain('def.kind === "panel"');
    expect(existsSync(path.join(ROOT, "start-cuepix-monitor.ps1"))).toBe(true);
  });
});
