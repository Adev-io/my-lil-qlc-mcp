import { describe, expect, it } from "vitest";
import { RigSchema, loadRig } from "../scripts/rig.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const punk = JSON.parse(readFileSync(path.join(ROOT, "rigs", "punk-rock-show.rig.json"), "utf8"));

describe("rig schema — party additions", () => {
  it("accepts meta.builder 'party' and a banner block", () => {
    const rig = {
      ...punk,
      meta: { ...punk.meta, builder: "party" },
      banner: { widthFt: 12, heightFt: 8, centerX: 0, centerHeightFt: 8 },
    };
    const r = RigSchema.safeParse(rig);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.meta.builder).toBe("party");
      expect(r.data.banner?.widthFt).toBe(12);
    }
  });

  it("still accepts the punk rig unchanged (no builder -> undefined)", () => {
    const r = RigSchema.safeParse(punk);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.meta.builder).toBeUndefined();
  });

  it("rejects an unknown builder", () => {
    const r = RigSchema.safeParse({ ...punk, meta: { ...punk.meta, builder: "techno" } });
    expect(r.success).toBe(false);
  });
});

describe("builder dispatch", () => {
  it("routes party rigs to build-party.ts and everything else to build-show.ts", async () => {
    const { builderScript } = await import("../scripts/generate-all-helpers.js");
    expect(builderScript("party")).toBe("scripts/build-party.ts");
    expect(builderScript("punk")).toBe("scripts/build-show.ts");
    expect(builderScript(undefined)).toBe("scripts/build-show.ts");
  });
});

describe("bar-mitzvah rig file", () => {
  it("loads, validates, and has the party shape", () => {
    const { rig } = loadRig(path.join(ROOT, "rigs", "bar-mitzvah.rig.json"));
    expect(rig.meta.builder).toBe("party");
    expect(rig.banner?.widthFt).toBe(12);
    const heads = rig.fixtures.filter((g) => g.kind === "head");
    expect(heads.map((g) => g.namePrefix)).toEqual(["Truss", "Floor"]);
    expect(heads.flatMap((g) => g.addresses)).toEqual([100, 115, 130, 145]);
    expect(rig.fixtures.find((g) => g.kind === "par")?.count).toBe(10);
    expect(rig.fixtures.some((g) => g.kind === "bar")).toBe(false);
  });
});
