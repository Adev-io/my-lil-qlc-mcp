# Mover Aimed Positions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-aim the two moving heads at the band and the crowd (8 aimed Launchpad pads, roof-safe) by updating the show generator's stage geometry.

**Architecture:** `punk-rock-show.qxw` is a build artifact of `scripts/build-show.ts`. All changes go into the builder (geometry constants, `AIM` table, `POSITIONS` table, motion waypoints) plus its test file. Tests regenerate the show file in `beforeAll`, so TDD = update test expectations first (RED), then the builder (GREEN). Spec: `docs/superpowers/specs/2026-06-09-mover-aimed-positions-design.md`.

**Tech Stack:** TypeScript (tsx), vitest, QLC+ .qxw XML.

**Key context for a zero-context engineer:**
- Builder coordinates: origin = front-centre of stage at floor level, +X = audience-right, +Y = upstage, +Z = up, in feet. The audience is at negative Y.
- `aim(side, tx, ty, tz)` converts a target point to `[pan, tilt]` DMX. Convention: pan 128 = beam straight upstage, higher = audience-right; tilt 128 = 37.5° below horizontal (`TILT_CENTRE_DEPR`), higher = steeper down. Horizontal ≈ tilt DMX 92.6 — any aimed tilt below 93 would hit the roof.
- New rig truth (brainstorm 2026-06-09): stage 20w×10d, deck 2.5 ft, heads on ground-standing trusses at the front corners — (±10, 0, 8.5) — audience directly in front. Band (audience POV): singer centre (0, 3.3), guitar front-left (−5.6, 2.7), bass mid-right (5.2, 4.8), drums back-right (7, 7.5, seated).
- Run all commands from `C:\Users\Arikl\dev\qlcplus-mcp\QLCPlus-MCP`.
- Do NOT hand-edit `punk-rock-show.qxw` — it gets overwritten on every test run.

---

### Task 1: Update test expectations (RED)

**Files:**
- Modify: `tests/build-show.test.ts`

- [ ] **Step 1: Update the pad-layout expectation (line ~76)**

Replace:
```ts
    expect(padChOf("Center")).toBe(189);     // HEADS-STATIC r2 c0
```
with:
```ts
    expect(padChOf("Singer")).toBe(189);     // HEADS-STATIC r2 c0
```

- [ ] **Step 2: Replace the "aims the heads" test (lines ~152-165)**

Replace the entire `it("aims the heads from the measured stage geometry (not 128/128 placeholders)", ...)` block with:

```ts
  it("aims the heads at the band from the 2026-06-09 stage geometry", () => {
    // Heads are fixtures 12 (L) and 13 (R). aim() turns a floor target (ft) into pan(ch0)/tilt(ch2)
    // DMX; values come from the 20x10 stage, ground trusses at the front corners (±10, 0, 8.5).
    const hv = (scene: string, id: 12 | 13): string =>
      raw.match(new RegExp(`Name="${scene}">[^]*?<FixtureVal ID="${id}">([^<]*)<`))?.[1] || "";
    // Singer → stage centre (0,3.3): the two heads converge symmetrically.
    expect(hv("Singer", 12).startsWith("0,162,2,103")).toBe(true);
    expect(hv("Singer", 13).startsWith("0,94,2,103")).toBe(true);
    // Guitar is front-left → near for L (steep), far for R (shallow).
    expect(hv("Guitar", 12).startsWith("0,156,2,113")).toBe(true);
    expect(hv("Guitar", 13).startsWith("0,90,2,99")).toBe(true);
    // Drums back-right; Crowd Near is downstage of the heads (pan swings past 128/across).
    expect(hv("Drums", 12).startsWith("0,159,2,100")).toBe(true);
    expect(hv("Crowd Near", 12).startsWith("0,185,2,108")).toBe(true);
    expect(hv("Crowd Near", 13).startsWith("0,71,2,108")).toBe(true);
    // The dead-centre 128/128 placeholder is gone from the position scenes.
    expect(hv("Singer", 12).startsWith("0,128,2,128")).toBe(false);
  });
```

- [ ] **Step 3: Add the new pad-set test (after the test from Step 2)**

```ts
  it("replaces the generic position pads with the 8 aimed pads (Approach A)", () => {
    expect(baseNames).toEqual(expect.arrayContaining(
      ["Singer", "Guitar", "Bass", "Drums", "Crowd Near", "Crowd Deep", "Stage Wash", "Park"]));
    for (const old of ["Center", "Wide", "Cross X", "Downstage", "Upstage", "Tight Center", "Wide Open"])
      expect(baseNames).not.toContain(old);
    // positions no longer force colour/gobo — colour pads keep control
    const singerL = raw.match(/Name="Singer">[^]*?<FixtureVal ID="12">([^<]*)</)?.[1] || "";
    expect(singerL).not.toContain("5,0");
    expect(singerL).not.toContain("6,0");
  });
```

- [ ] **Step 4: Add the roof-safety regression test (after the test from Step 3)**

```ts
  it("keeps every aimed beam below horizontal (roof-safe)", () => {
    // tilt DMX 128 = 37.5° below horizontal at 0.9444 DMX/°; horizontal ≈ 92.6 → require ≥ 93.
    const SCENES = ["Singer", "Guitar", "Bass", "Drums", "Crowd Near", "Crowd Deep", "Stage Wash",
      "hCirc 1", "hCirc 2", "hCirc 3", "hCirc 4", "hCirc 5", "hCirc 6",
      "hSweep 1", "hSweep 2", "hSweep 3"];
    for (const s of SCENES) {
      for (const id of [12, 13]) {
        const fv = raw.match(new RegExp(`Name="${s}">[^]*?<FixtureVal ID="${id}">([^<]*)<`))?.[1] || "";
        const pairs = fv.split(",").map(Number);
        let tilt = -1;
        for (let k = 0; k < pairs.length; k += 2) if (pairs[k] === 2) tilt = pairs[k + 1];
        expect(tilt, `${s} fixture ${id} tilt`).toBeGreaterThanOrEqual(93);
      }
    }
  });
```

- [ ] **Step 5: Run the suite to verify the new tests FAIL (old builder still active)**

Run: `npx vitest run tests/build-show.test.ts`
Expected: FAIL — `padChOf("Singer")` is null, `Singer` scenes missing, old names still present. (The pre-existing tests still pass.)

- [ ] **Step 6: Commit the red tests**

```bash
git add tests/build-show.test.ts
git commit -m "test: expect aimed mover positions from 2026-06-09 stage geometry"
```

---

### Task 2: Builder geometry, roof guard, and AIM table

**Files:**
- Modify: `scripts/build-show.ts:230-275` (geometry block), `scripts/build-show.ts:458,466,470` (AIM.center consumers), `scripts/build-show.ts:495-512` (PRESETS aim keys)

- [ ] **Step 1: Replace the geometry comment + constants (lines ~230-251)**

Replace the comment block and constants from `// STAGE GEOMETRY ...` down to (and including) the `const AIM_Z = 4;` line with:

```ts
// ----------------------------------------------------------------------------
// STAGE GEOMETRY — moving-head aim, from the 2026-06-09 brainstorm (spec:
// docs/superpowers/specs/2026-06-09-mover-aimed-positions-design.md). Supersedes the
// 2026-06-08 measurements: trusses are now GROUND-STANDING at the front stage corners
// (heads on top, ~8.5 ft up, 20 ft apart), stage 20w x 10d with the deck at 2.5 ft,
// audience directly in front, and a roof close above the lights.
// Coordinates: origin = front-CENTRE of the stage at floor level. +X = audience-right,
// +Y = upstage (away from the crowd), +Z = up. Feet.
//   Band (audience POV): singer centre (0,3.3), guitar front-left (-5.6,2.7),
//   bass mid-right (5.2,4.8), drums back-right (7,7.5, seated).
// 375Z ranges: pan 0-255 = 540°, tilt 0-255 = 270°. The aim() convention (pan 128 = beam
// straight upstage, higher = audience-right; tilt 128 = centre-stage depression, higher =
// steeper/closer) is unchanged. ROOF GUARD: aim() throws if a target computes to a beam at
// or above horizontal. RIG-CALIBRATION KNOBS: if the rig comes up MIRRORED (beams hit the
// opposite side), negate the pan term in aim(); if beams sit globally high or low, nudge
// TILT_CENTRE_DEPR; AIM_Z / STAGE_DECK raise/lower where the beam centres on a body.
// ----------------------------------------------------------------------------
const HEAD_XYZ = { L: { x: -10, y: 0, z: 8.5 }, R: { x: 10, y: 0, z: 8.5 } };
const PAN_DMX_PER_DEG = 255 / 540;   // 0.4722
const TILT_DMX_PER_DEG = 255 / 270;  // 0.9444
const TILT_CENTRE_DEPR = 37.5;       // depression (° below horizontal) that reads tilt DMX 128
const STAGE_DECK = 2.5;              // stage deck height above the floor (ft)
const AIM_Z = STAGE_DECK + 4;        // beam centres on a performer's chest/face (ft above floor)
```

- [ ] **Step 2: Add the roof guard inside `aim()` (function at ~line 255)**

In `aim()`, after the `const deprDeg = ...` line, insert:

```ts
  if (deprDeg < 0)
    throw new Error(`aim(${side}, ${tx}, ${ty}, ${tz}): beam at/above horizontal — roof violation`);
```

- [ ] **Step 3: Replace the `AIM` table (lines ~268-275)**

Replace the whole `const AIM = { ... };` block with:

```ts
// Named aim points from the 2026-06-09 stage truth (resolved once, reused by positions + presets).
const AIM = {
  singer:    aimBoth(0, 3.3),                            // vocalist, centre stage
  guitar:    aimBoth(-5.6, 2.7),                         // front left
  bass:      aimBoth(5.2, 4.8),                          // mid right
  drums:     aimBoth(7, 7.5, STAGE_DECK + 3.5),          // back right, seated height
  crowdNear: aimBoth(0, -6, 5),                          // ~6 ft into the crowd, beams cross
  crowdDeep: aimBoth(0, -18, 5.5),                       // ~18 ft out
  wash:  { l: aim("L", -5, 5), r: aim("R", 5, 5) },      // each head washes its own half
  cross: { l: aim("L", 5, 4),  r: aim("R", -5, 4) },     // beams cross at centre (presets/zigzag)
};
```

- [ ] **Step 4: Remap the `AIM.center` consumers**

Three call sites use `AIM.center` (HCOL ~line 458, GOBOZ ~line 466, Prism ~line 470). In each, replace:
```ts
  const a = i === 0 ? AIM.center.l : AIM.center.r;
```
with:
```ts
  const a = i === 0 ? AIM.singer.l : AIM.singer.r;
```
(For the Prism scene the same pattern appears inline — same replacement.)

- [ ] **Step 5: Remap the `PRESETS` aim keys (lines ~495-512)**

In the `PRESETS` table, apply these key substitutions on the `aim:` field only (15 rows):
- `aim: "center"` → `aim: "singer"` (Opener, Breakdown UV, Green Room, Cyan Wash, Purple Haze, Gold Ballad)
- `aim: "vox"` → `aim: "singer"` (Anthem, Big Finish)
- `aim: "wide"` → `aim: "wash"` (Chorus Warm, Magenta Pop, Sunset Jam)
- `aim: "drums"` and `aim: "cross"` stay as-is.

- [ ] **Step 6: Type-check the builder (it will not fully pass tests yet)**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: errors ONLY about `POSITIONS` referencing `AIM.center`/`AIM.vox`/`AIM.wide` (fixed in Task 3). If other errors appear, fix them before moving on.

---

### Task 3: POSITIONS, chaser steps, and motion waypoints

**Files:**
- Modify: `scripts/build-show.ts:279-288` (POSITIONS), `:324-326` (position-scene loop), `:346-347` (sweep chasers), `:377-388` (CIRCLE/SWEEP pts), `:474-482` (FIG8/PANW/tiltd)

- [ ] **Step 1: Replace the `POSITIONS` table (lines ~279-288)**

```ts
// HEAD positions (pan/tilt per head) — aimed at the band and the crowd (2026-06-09 re-block).
// Colour/gobo deliberately NOT set, so the Heads colour pads keep control of the wheel.
const POSITIONS: { name: string; led: number; bg: number[]; l: number[]; r: number[]; zoom?: number }[] = [
  { name: "Singer",     led: 6,   bg: [230, 230, 230], l: AIM.singer.l,    r: AIM.singer.r,    zoom: 100 },
  { name: "Guitar",     led: 18,  bg: [255, 80, 0],    l: AIM.guitar.l,    r: AIM.guitar.r,    zoom: 60 },
  { name: "Bass",       led: 42,  bg: [0, 180, 0],     l: AIM.bass.l,      r: AIM.bass.r,      zoom: 60 },
  { name: "Drums",      led: 82,  bg: [0, 60, 200],    l: AIM.drums.l,     r: AIM.drums.r,     zoom: 100 },
  { name: "Crowd Near", led: 106, bg: [255, 0, 160],   l: AIM.crowdNear.l, r: AIM.crowdNear.r, zoom: 200 },
  { name: "Crowd Deep", led: 90,  bg: [120, 0, 220],   l: AIM.crowdDeep.l, r: AIM.crowdDeep.r, zoom: 200 },
  { name: "Stage Wash", led: 74,  bg: [0, 160, 160],   l: AIM.wash.l,      r: AIM.wash.r,      zoom: 230 },
  { name: "Park",       led: 6,   bg: [40, 40, 40],    l: [128, 0],        r: [128, 0] },
];
```

- [ ] **Step 2: Drop colour/gobo from the position-scene loop (lines ~324-326)**

Replace:
```ts
for (const p of POSITIONS)
  addScene(p.name, heads.map((f, i) =>
    headVal(f.id, { pan: (i === 0 ? p.l : p.r)[0], tilt: (i === 0 ? p.l : p.r)[1], dim: p.name === "Park" ? 0 : 255, shutter: SHUTTER_OPEN, color: HEAD_COLOR.white, gobo: 0, focus: 128, zoom: p.zoom ?? 128 })));
```
with:
```ts
for (const p of POSITIONS)
  addScene(p.name, heads.map((f, i) =>
    headVal(f.id, { pan: (i === 0 ? p.l : p.r)[0], tilt: (i === 0 ? p.l : p.r)[1], dim: p.name === "Park" ? 0 : 255, shutter: SHUTTER_OPEN, focus: 128, zoom: p.zoom ?? 128 })));
```

- [ ] **Step 3: Repoint the sweep chasers (lines ~346-347)**

Replace:
```ts
addChaser("Head Sweep Slow", ["Center", "Wide", "Cross X", "Downstage"], 1400, 1000);
addChaser("Head Sweep Fast", ["Center", "Wide", "Cross X", "Upstage"], 380, 200);
```
with:
```ts
addChaser("Head Sweep Slow", ["Singer", "Guitar", "Bass", "Drums"], 1400, 1000);
addChaser("Head Sweep Fast", ["Singer", "Guitar", "Bass", "Crowd Near"], 380, 200);
```

- [ ] **Step 4: Re-aim Head Circle as a band↔crowd orbit (lines ~377-380)**

Replace the `CIRCLE_PTS` block (comment + const + forEach) with:

```ts
// Head Circle — band↔crowd orbit: guitar → singer → bass on stage, then back across the
// near crowd (z 5 = standing faces). Always below horizontal (roof guard enforces).
const CIRCLE_PTS: [number, number, number?][] = [
  [-5.6, 2.7], [0, 3.3], [5.2, 4.8], [6, -6, 5], [0, -6, 5], [-6, -6, 5],
];
CIRCLE_PTS.forEach((p, i) => { const a = aimBoth(p[0], p[1], p[2] ?? AIM_Z); addHeadScene(`hCirc ${i+1}`, a.l, a.r); });
```
(The `addChaser("Head Circle", ...)` line below it is unchanged.)

- [ ] **Step 5: Re-aim Audience Sweep into the crowd (lines ~381-383)**

Replace:
```ts
// Audience Sweep — heads spin downstage and sweep out over the crowd (beams up at 8ft).
const SWEEP_PTS: [number, number][] = [[-6,-4],[0,-4],[6,-4]];
SWEEP_PTS.forEach((p, i) => { const a = aimBoth(p[0], p[1], 8); addHeadScene(`hSweep ${i+1}`, a.l, a.r); });
```
with:
```ts
// Audience Sweep — heads sweep left↔right across the near crowd at face height.
// (Old z=8 target is ABOVE the new 8.5 ft heads at distance — the roof guard would throw.)
const SWEEP_PTS: [number, number][] = [[-7,-6],[0,-6],[7,-6]];
SWEEP_PTS.forEach((p, i) => { const a = aimBoth(p[0], p[1], 5); addHeadScene(`hSweep ${i+1}`, a.l, a.r); });
```

- [ ] **Step 6: Recentre Figure 8, Pan Wave, Tilt Dip on the new band block (lines ~474-482)**

Replace:
```ts
const FIG8_PTS: [number, number][] = [[-5,6.5],[-3,5],[-1,3.5],[-1,6.5],[-3,5],[-5,3.5]];
```
with:
```ts
const FIG8_PTS: [number, number][] = [[-2,4.8],[0,3.3],[2,1.8],[2,4.8],[0,3.3],[-2,1.8]];
```
Replace:
```ts
const PANW_PTS: [number, number][] = [[-7,5],[0,5],[7,5]];
```
with:
```ts
const PANW_PTS: [number, number][] = [[-7,4],[0,4],[7,4]];
```
Replace the two `tiltd` lines:
```ts
{ const a = aimBoth(-3, 8); addHeadScene("tiltd 1", a.l, a.r); }  // beams back (upstage)
{ const a = aimBoth(-3, 2); addHeadScene("tiltd 2", a.l, a.r); }  // beams front (downstage)
```
with:
```ts
{ const a = aimBoth(0, 8); addHeadScene("tiltd 1", a.l, a.r); }  // beams back (drum line)
{ const a = aimBoth(0, 2); addHeadScene("tiltd 2", a.l, a.r); }  // beams front (singer line)
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean (no errors).

---

### Task 4: Verify GREEN and commit the builder

- [ ] **Step 1: Run the builder suite**

Run: `npx vitest run tests/build-show.test.ts`
Expected: ALL PASS (the `beforeAll` regenerates `punk-rock-show.qxw` from the modified builder; new DMX expectations match; roof-safety test passes; widget count still 131).

If a DMX expectation is off by 1, the builder is right and the plan's hand-computed value is wrong — verify with a quick `node -e` recomputation of `128 + Math.atan2(dx,dy)*180/Math.PI * 255/540` before touching anything, then fix the **test** value.

- [ ] **Step 2: Run the full test suite (regression)**

Run: `npx vitest run`
Expected: ALL PASS (osc, qxwParser, schemaNullOptional untouched and green).

- [ ] **Step 3: Commit**

```bash
git add scripts/build-show.ts tests/build-show.test.ts
git commit -m "feat: aim movers at band + crowd from 2026-06-09 stage geometry (roof-safe)"
```
Note: `punk-rock-show.qxw` is untracked (build artifact) — do not add it.

---

### Task 5: Measurement record + MCP widget map

**Files:**
- Modify: `stage-inputs.json`
- Regenerate: `config/widgets.json`

- [ ] **Step 1: Update `stage-inputs.json` to record the new measurements**

Replace the file contents with:

```json
{
  "stage_width": "20",
  "stage_depth": "10",
  "stage_height": "2.5",
  "trim_height": "8.5",
  "head_mount": "Ground-standing trusses at the front stage corners, heads on top",
  "head_height": "8.5",
  "head_apart": "20",
  "head_upstage": "0",
  "vox_up": "3.3",
  "vox_off": "0 (centre)",
  "drum_up": "7.5",
  "drum_off": "+7 (audience-right)",
  "sl_up": "2.7",
  "sl_off": "-5.6 (guitar, audience-left)",
  "sr_up": "4.8",
  "sr_off": "+5.2 (bass, audience-right)",
  "aud_dist": "infront",
  "bars_order_note": "",
  "pars_order_note": "",
  "strobe_cap": "100",
  "notes": "2026-06-09 re-block: roof close above the 8.5ft corner trusses — all aims below horizontal. Offsets are from stage centre (builder coords), audience POV. See docs/superpowers/specs/2026-06-09-mover-aimed-positions-design.md",
  "units": "ft",
  "head_orient": "upright",
  "head_persp": "audience",
  "bars_order": "yes",
  "pars_order": "yes",
  "haze": "yes"
}
```

- [ ] **Step 2: Regenerate the MCP widget map**

Run: `npm run generate:widgets`
Expected: exits 0, rewrites `config/widgets.json`.

- [ ] **Step 3: Verify the new widget names landed**

Run: `node -e "const w=require('./config/widgets.json'); const n=JSON.stringify(w); for (const s of ['Singer R3C1','Guitar R3C2','Bass R3C3','Drums R3C4','Crowd Near R3C5','Crowd Deep R3C6','Stage Wash R3C7','Park R3C8']) if(!n.includes(s)) { console.error('MISSING '+s); process.exit(1); } console.log('all 8 aimed pads present')"`
Expected: `all 8 aimed pads present`

- [ ] **Step 4: Commit**

```bash
git add stage-inputs.json config/widgets.json
git commit -m "chore: record 2026-06-09 stage measurements + regenerate widget map"
```

---

### Task 6: On-rig calibration note (no code)

After the next load-in, run the calibration pass from the spec (§ Rig calibration knobs):
1. Load the rebuilt `punk-rock-show.qxw` in QLC+ (close QLC+ before rebuilding, reopen after).
2. Hit the **Singer** pad. If beams land mirrored left/right → negate the pan term in `aim()`. If both beams sit high/low → nudge `TILT_CENTRE_DEPR` (±1° ≈ ±1 DMX). If beams hit feet/over heads → nudge `AIM_Z`/`STAGE_DECK`.
3. Rebuild (`npx tsx scripts/build-show.ts`), regenerate widgets, reload, re-check Singer, then spot-check Drums + Crowd Near.
