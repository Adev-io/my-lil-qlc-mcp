import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("Cuepix launcher", () => {
  it("installs and verifies both custom fixture definitions", () => {
    const fixtureDir = mkdtempSync(path.join(os.tmpdir(), "cuepix-fixtures-"));
    execFileSync("powershell.exe", [
      "-NoProfile", "-File", path.join(ROOT, "start-cuepix.ps1"),
      "-InstallOnly", "-FixtureDirectory", fixtureDir,
    ], { cwd: ROOT, stdio: "pipe" });
    for (const name of ["Elation-Cuepix-Panel-79CH.qxf", "Chauvet-Intimidator-Spot-375ZX-15CH.qxf"]) {
      expect(readFileSync(path.join(fixtureDir, name), "utf8"))
        .toBe(readFileSync(path.join(ROOT, "fixtures", name), "utf8"));
    }
  });

  it("prepares a controller-disabled runtime copy without changing source", () => {
    // Runs Art-Net on loopback (-ArtNetLoopback) so this test does not depend on the
    // lighting Ethernet NIC being present on the machine running it.
    const runtime = mkdtempSync(path.join(os.tmpdir(), "cuepix-runtime-"));
    const source = path.join(ROOT, "cuepix-panel-show.qxw");
    const before = readFileSync(source, "utf8");
    execFileSync("powershell.exe", [
      "-NoProfile", "-File", path.join(ROOT, "start-cuepix.ps1"),
      "-PrepareRuntimeOnly", "-DisableLaunchpad", "-DisableMiniLab", "-ArtNetLoopback", "-RuntimeDirectory", runtime,
    ], { cwd: ROOT, stdio: "pipe" });

    const prepared = readFileSync(path.join(runtime, "cuepix-panel-show.runtime.qxw"), "utf8");
    expect(prepared).toContain('<Universe Name="Launchpad" ID="2"');
    expect(prepared).not.toContain('<Input Plugin="MIDI"');
    expect(prepared).not.toContain('<Feedback Plugin="MIDI"');
    expect(prepared).not.toContain('<Universe Name="MiniLab"');
    // Universes follow the generated show (8 panels = U0+U1, Huntley's 4 = U0 only), each on the
    // lighting line the launcher resolved.
    const universes = [...new Set([...before.matchAll(/outputUni="(\d+)"/g)].map((m) => m[1]))];
    expect(universes).toContain("0");
    for (const u of universes) expect(prepared).toContain(`outputUni="${u}"`);
    expect(new Set([...prepared.matchAll(/<Output Plugin="ArtNet" UID="None" Line="(\d+)">/g)].map((m) => m[1])).size).toBe(1);
    expect(readFileSync(source, "utf8")).toBe(before);
  });

  it("starts MCP with the dedicated Cuepix widget map", () => {
    const launcher = readFileSync(path.join(ROOT, "start-cuepix.ps1"), "utf8");
    for (const setting of [
      "$env:QLC_WIDGETS_FILE = $widgetMap",
      "$env:MCP_TRANSPORT = 'http'",
      "$env:HTTP_PORT = '8788'",
      "$env:LAUNCHPAD_LEDS = '0'",
    ]) expect(launcher).toContain(setting);
  });
});
