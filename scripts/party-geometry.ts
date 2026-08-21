// Room model + beam maths for the party show. PURE: no rig file, no I/O, so the tests can pin
// every number. Axes: x ft from stage centre (+ house right), y ft (0 = stage front edge, − =
// downstage), z ft up. All numbers MEASURED 2026-08-20 unless marked estimate.

export type Vec3 = { x: number; y: number; z: number };
export type Rect = { xMin: number; xMax: number; yMin: number; yMax: number };

export const HEAD = { sep: 30, z: 8 };                // truss towers at x = ±15, lens 8 ft up
export const ZONES = {
  stage: { xMin: -16, xMax: 16, yMin: 0, yMax: 4 } as Rect,     // deck + 1 ft of back wall either side: the far tower's speaker beam overshoots the deck edge by ~0.7 ft; no seating there
  floor: { xMin: -10, xMax: 10, yMin: -24, yMax: -4 } as Rect,  // 20×20, centre 14 ft off the front edge
  ceilingZ: 12,
  backWallY: 4,
  room: { xMin: -25, xMax: 25, yMin: -30, yMax: 4 } as Rect,    // estimate — only bounds the ray walk
};
// Beam CENTRE-LINE clearance. Tables sit on three sides of the floor, so everything that is not
// stage or floor is a table. 7 ft seated/standing + 1 ft for the cone; 10 ft hora chair + 1 ft.
export const CLEAR = { table: 8, floor: 11 };

// Chauvet 375Z IRC: 540° pan, 270° tilt, tilt DMX 128 = 37.5° below horizontal (aim() in the
// band builder was calibrated on the rig with these).
const PAN_DEG = 540 / 255, TILT_DEG = 270 / 255, TILT_CENTRE_DEPR = 37.5;
const clampDmx = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const inRect = (r: Rect, x: number, y: number) => x >= r.xMin && x <= r.xMax && y >= r.yMin && y <= r.yMax;

// [pan, tilt] DMX that points head h at target t. Same formula as build-party aim(), minus the
// roof guard: beams UP are the whole point now.
export function aimAt(h: Vec3, t: Vec3): [number, number] {
  const dx = t.x - h.x, dy = t.y - h.y;
  const panDeg = (Math.atan2(dx, dy) * 180) / Math.PI;                       // 0 = upstage, + = house right
  const deprDeg = (Math.atan2(h.z - t.z, Math.hypot(dx, dy)) * 180) / Math.PI; // + = below horizontal
  return [clampDmx(128 + panDeg / PAN_DEG), clampDmx(128 + (deprDeg - TILT_CENTRE_DEPR) / TILT_DEG)];
}

// Inverse of aimAt: where does the centre line from h at this pan/tilt first hit ceiling,
// floor, back wall or the room bounds? null only if the ray is exactly horizontal and never
// leaves the room box, which the box makes impossible.
export function rayTarget(h: Vec3, pan: number, tilt: number): Vec3 | null {
  const panRad = ((pan - 128) * PAN_DEG * Math.PI) / 180;
  const deprRad = (((tilt - 128) * TILT_DEG + TILT_CENTRE_DEPR) * Math.PI) / 180;
  const d = { x: Math.sin(panRad) * Math.cos(deprRad), y: Math.cos(panRad) * Math.cos(deprRad), z: -Math.sin(deprRad) };
  const ts: number[] = [];
  const plane = (num: number, den: number) => { if (Math.abs(den) > 1e-9) { const t = num / den; if (t > 1e-6) ts.push(t); } };
  plane(ZONES.ceilingZ - h.z, d.z);
  plane(0 - h.z, d.z);
  plane(ZONES.backWallY - h.y, d.y);
  plane(ZONES.room.yMin - h.y, d.y);
  plane(ZONES.room.xMin - h.x, d.x);
  plane(ZONES.room.xMax - h.x, d.x);
  if (ts.length === 0) return null;
  const t = Math.min(...ts);
  return { x: h.x + d.x * t, y: h.y + d.y * t, z: h.z + d.z * t };
}

// Walk the centre line head→target in 0.5 ft steps. Returns the first violation as text, or
// null when the whole segment is clear. Stage: anything goes. Floor: ≥ CLEAR.floor. Else table.
export function beamSafe(h: Vec3, t: Vec3): string | null {
  const len = Math.hypot(t.x - h.x, t.y - h.y, t.z - h.z);
  const n = Math.max(1, Math.ceil(len / 0.5));
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const x = h.x + (t.x - h.x) * k, y = h.y + (t.y - h.y) * k, z = h.z + (t.z - h.z) * k;
    if (inRect(ZONES.stage, x, y)) continue;
    const need = inRect(ZONES.floor, x, y) ? CLEAR.floor : CLEAR.table;
    if (z < need - 1e-6)
      return `beam at (${x.toFixed(1)}, ${y.toFixed(1)}) is ${z.toFixed(1)} ft up, needs ${need} (${inRect(ZONES.floor, x, y) ? "dance floor" : "tables"})`;
  }
  return null;
}

// Convenience: is this pan/tilt safe from head h? Resolves the landing point then walks to it.
export function panTiltSafe(h: Vec3, pan: number, tilt: number): string | null {
  const hit = rayTarget(h, pan, tilt);
  if (!hit) return "ray never lands";
  return beamSafe(h, hit);
}
