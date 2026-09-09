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
});
