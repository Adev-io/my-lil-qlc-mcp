import { describe, expect, it } from "vitest";
import { RigSchema } from "../scripts/rig.js";
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
