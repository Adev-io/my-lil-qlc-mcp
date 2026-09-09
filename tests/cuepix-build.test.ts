import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseStringPromise } from "xml2js";
import { loadRig } from "../scripts/rig.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RIG = path.join(ROOT, "rigs", "cuepix-panel.rig.json");

describe("Cuepix routing workspace", () => {
  it("loads the Cuepix patch without overlaps", () => {
    const { rig } = loadRig(RIG);
    expect(rig.fixtures.filter((g) => g.kind === "panel")).toHaveLength(2);
    expect(rig.fixtures.filter((g) => g.kind === "panel").map((g) => g.universe)).toEqual([0, 1]);
    expect(rig.fixtures.filter((g) => g.kind === "head").flatMap((g) => g.addresses)).toEqual([480, 495]);
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
    expect((qxw.match(/<Fixture>/g) ?? [])).toHaveLength(14);
    expect(qxw).toContain('<Output Plugin="ArtNet" UID="None" Line="0">');
    expect(qxw).toContain('outputUni="0"');
    expect(qxw).toContain('outputUni="1"');
    expect(qxw).toContain('<Name>Cuepix 12</Name>');
    expect(qxw).toContain('<Name>375ZX L</Name>');
    expect(qxw).toContain('<Name>375ZX R</Name>');
    expect(qxw).toContain('<Address>495</Address>');
    expect(qxw).toContain('Name="TEST · Cuepix 1 Red"');
    const sceneNames = [...qxw.matchAll(/<Function[^>]*Type="Scene"[^>]*Name="([^"]+)"/g)].map((match) => match[1]);
    expect(sceneNames).toHaveLength(72);
    expect(sceneNames.every((name) => name.startsWith("TEST · "))).toBe(true);
    expect(existsSync(path.join(out, "CUEPIX-PATCH-CHART.md"))).toBe(true);
    expect(existsSync(path.join(out, "CUEPIX-SETUP.md"))).toBe(true);
  });
});
