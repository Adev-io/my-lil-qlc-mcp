import { describe, expect, it } from "vitest";
import { aimAt, rayTarget, beamSafe, panTiltSafe, HEAD, ZONES, type Vec3 } from "../scripts/party-geometry";

const L: Vec3 = { x: -15, y: 0, z: 8 };

describe("party geometry — aim and its inverse", () => {
  it("rayTarget(aimAt(p)) lands back on p for ceiling and wall targets", () => {
    for (const p of [
      { x: -15, y: -5, z: 12 },   // ceiling directly in front of the left tower
      { x: 0, y: 4, z: 8 },       // banner centre on the back wall at same height as lens
      { x: 5, y: 4, z: 10 },      // scrim on the back wall, stage-right, elevated
    ]) {
      const [pan, tilt] = aimAt(L, p);
      const hit = rayTarget(L, pan, tilt);
      expect(hit, JSON.stringify(p)).not.toBeNull();
      expect(Math.abs(hit!.x - p.x), `x error for ${JSON.stringify(p)}`).toBeLessThan(1.0);
      expect(Math.abs(hit!.y - p.y), `y error for ${JSON.stringify(p)}`).toBeLessThan(1.0);
      expect(Math.abs(hit!.z - p.z), `z error for ${JSON.stringify(p)}`).toBeLessThan(1.0);
    }
  });

  it("exposes the measured room", () => {
    expect(HEAD.z).toBe(8);
    expect(ZONES.floor).toEqual({ xMin: -10, xMax: 10, yMin: -24, yMax: -4 });
    expect(ZONES.stage).toEqual({ xMin: -16, xMax: 16, yMin: 0, yMax: 4 });
    expect(ZONES.ceilingZ).toBe(12);
  });
});

describe("party geometry — beamSafe, the rule", () => {
  it("refuses every floor target from a tower at the stage end (the 5 ft table strip)", () => {
    for (const p of [{ x: -8, y: -6, z: 0 }, { x: 0, y: -14, z: 0 }, { x: 8, y: -14, z: 0 }, { x: 9, y: -23, z: 0 }])
      expect(beamSafe(L, p), JSON.stringify(p)).toMatch(/tables|dance floor/);
  });

  it("accepts ceiling, banner, stage and above-the-door targets", () => {
    for (const p of [
      { x: -15, y: -5, z: 12 }, { x: -10, y: -8, z: 12 },
      { x: 0, y: 4, z: 8 }, { x: 6, y: 4, z: 10 },
      { x: 0, y: 2, z: 6.5 },
      { x: -15, y: -21, z: 9 },
    ]) expect(beamSafe(L, p), JSON.stringify(p)).toBeNull();
  });

  it("refuses the door HEADER itself — the beam dips below 8 ft over the side tables on the way", () => {
    expect(beamSafe(L, { x: -15, y: -21, z: 7 })).toMatch(/tables/);
  });

  it("over the dance floor the bar is 11 ft: a shallow ceiling shot that crosses the floor low fails", () => {
    // From (-15,0,8) to the ceiling at (5,-20,12): passes over the floor edge ~9 ft up.
    expect(beamSafe(L, { x: 5, y: -20, z: 12 })).toMatch(/dance floor/);
  });

  it("panTiltSafe agrees with beamSafe through the inverse", () => {
    const [p1, t1] = aimAt(L, { x: -15, y: -5, z: 12 });
    expect(panTiltSafe(L, p1, t1)).toBeNull();
    const [p2, t2] = aimAt(L, { x: 0, y: -14, z: 0 });
    expect(panTiltSafe(L, p2, t2)).toMatch(/tables|dance floor/);
  });
});
