import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseStringPromise } from "xml2js";
import { loadRig, RigSchema } from "../scripts/rig.js";

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

describe("Cuepix routing workspace", () => {
  it("loads the Cuepix patch without overlaps", () => {
    const { rig } = loadRig(RIG);
    expect(rig.fixtures.filter((g) => g.kind === "panel")).toHaveLength(2);
    expect(rig.fixtures.filter((g) => g.kind === "panel").map((g) => g.universe)).toEqual([0, 1]);
    expect(rig.fixtures.filter((g) => g.kind === "head").flatMap((g) => g.addresses)).toEqual([480, 495]);
  });

  it("defines four left-to-right trusses and keeps movers locked", () => {
    const { rig } = loadRig(RIG);
    expect((rig as any).cuepix?.trusses).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]]);
    expect((rig as any).cuepix?.moversCalibrated).toBe(false);
  });

  it("rejects duplicate Cuepix panel placement", () => {
    const raw = JSON.parse(readFileSync(RIG, "utf8"));
    raw.cuepix = {
      trusses: [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 11]],
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
    const routingSceneNames = sceneNames.filter((name) => name.startsWith("TEST · "));
    expect(routingSceneNames).toHaveLength(72);
    expect(routingSceneNames.every((name) => name.startsWith("TEST · "))).toBe(true);
    expect(existsSync(path.join(out, "CUEPIX-PATCH-CHART.md"))).toBe(true);
    expect(existsSync(path.join(out, "CUEPIX-SETUP.md"))).toBe(true);
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

    const expectedPanels = Array.from({ length: 12 }, (_, index) => index);
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
    expect(chaserFixtureOrder(qxw, "FX · Center Out")).toEqual([[5, 6], [4, 7], [3, 8], [2, 9], [1, 10], [0, 11]]);
    expect(chaserFixtureOrder(qxw, "FX · Truss Step")).toEqual([[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11]]);
    expect(chaserFixtureOrder(qxw, "FX · Bounce")).toEqual([
      [0], [1], [2], [3], [4], [5], [6], [7], [8], [9], [10], [11],
      [10], [9], [8], [7], [6], [5], [4], [3], [2], [1],
    ]);
  });
});
