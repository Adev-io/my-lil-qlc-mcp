# Mover Aimed Positions — Design

Date: 2026-06-09 (rev 2 — implementation retargeted to `scripts/build-show.ts` after discovering the show file is generated, not hand-edited)
Show file: `punk-rock-show.qxw` — **a build artifact** produced by `scripts/build-show.ts`
Fixtures: Head L (ID 12), Head R (ID 13) — Chauvet Intimidator Spot 375Z IRC, 15-channel mode

## Problem

The two moving heads aim from stale geometry (measured 2026-06-08: heads 12 ft apart at 10 ft trim on a front truss over a 20×12 stage; band blocked left-of-centre). The real venue: heads on **ground-standing trusses at the front stage corners** (~8.5 ft up, 20 ft apart), stage **20×10**, deck at 2.5 ft, **roof close above the lights**, band re-blocked (drums back-right, singer centre, bass mid-right, guitar front-left), audience directly in front. Positions must interact with the band and the crowd, and every beam must stay below horizontal.

## Decisions (approved in brainstorm)

1. **Approach A** — replace the row-3 generic position pads with 8 aimed pads. No new Launchpad page.
2. Position pads: Singer, Guitar, Bass, Drums, Crowd Near, Crowd Deep, Stage Wash, Park.
3. Position scenes stop forcing color white + gobo open, so the Heads colour pads keep control.
4. All mover motion (sweeps, circle, fig-8, etc.) re-aimed to band/crowd, below horizontal.
5. Truss mounting confirmed: ground-standing, head sits on top (~8.5 ft above ground, ~6 ft above deck).

## Geometry (builder coordinates)

Builder convention (existing): origin = front-**centre** of stage at floor level, +X = audience-right, +Y = upstage, +Z = up, feet.

| Constant | Old | New |
|---|---|---|
| Stage | 20w × 12d | 20w × 10d |
| `HEAD_XYZ.L` | (−6, 1, 10) | (−10, 0, 8.5) |
| `HEAD_XYZ.R` | (6, 1, 10) | (10, 0, 8.5) |
| `STAGE_DECK` | — (not modelled) | 2.5 |
| `AIM_Z` (default beam height) | 4 | `STAGE_DECK + 4` = 6.5 (performer chest above deck) |

### Targets

| Pad | Target (x, y, z) | Zoom (ch14) |
|---|---|---|
| Singer | (0, 3.3, 6.5) | 100 |
| Guitar | (−5.6, 2.7, 6.5) | 60 (tight) |
| Bass | (5.2, 4.8, 6.5) | 60 (tight) |
| Drums | (7, 7.5, 6.0 = deck+3.5 seated) | 100 |
| Crowd Near | (0, −6, 5.0) | 200 (wide) |
| Crowd Deep | (0, −18, 5.5) | 200 (wide) |
| Stage Wash | L→(−5, 5, 6.5), R→(5, 5, 6.5) | 230 (widest) |
| Park | raw DMX pan 128 / tilt 0, dimmer 0 (unchanged) | — |

All computed down-angles fall between ~7° and ~21° below horizontal — roof-safe by construction.

## Pan/tilt math (existing `aim()` convention, unchanged)

`aim()` in `build-show.ts` already converts a floor target to DMX: pan 128 = beam straight upstage, +DMX = audience-right (0.4722 DMX/°, 540° range); tilt 128 = `TILT_CENTRE_DEPR` (37.5°) below horizontal (0.9444 DMX/°, 270° range). Only the inputs change (head positions, targets). **New: a safety guard in `aim()` throws at build time if any target computes to a beam at or above horizontal.** Horizontal ≈ tilt DMX 92.6, so every generated aimed scene must carry tilt ≥ 93.

### Rig calibration knobs (existing, documented in builder)

| Symptom on real rig | Knob |
|---|---|
| Beams mirrored left/right | negate the pan term in `aim()` |
| All beams globally high/low | nudge `TILT_CENTRE_DEPR` |
| Beams hit feet/over heads | nudge `AIM_Z` / `STAGE_DECK` |

One on-site pass expected; rebuild + reload after.

## Builder changes (`scripts/build-show.ts`)

1. **Constants:** new `HEAD_XYZ`, add `STAGE_DECK = 2.5`, `AIM_Z = STAGE_DECK + 4`; update geometry comment block; add roof guard to `aim()`.
2. **`AIM` table** → `{ singer, guitar, bass, drums, crowdNear, crowdDeep, wash, cross }`. Consumers remap: `center` → `singer` (HCOL, GOBOZ, Prism, presets), `vox` → `singer`, `wide` → `wash`; `drums`/`cross` keep keys.
3. **`POSITIONS` table** → 8 new entries per the target table (Park unchanged). The position-scene loop drops `color`/`gobo` so colour pads retain control.
4. **Chasers:** Head Sweep Slow = Singer→Guitar→Bass→Drums; Head Sweep Fast = Singer→Guitar→Bass→Crowd Near (step lists by name).
5. **Motion waypoints:** `CIRCLE_PTS` = band↔crowd orbit (3 band pts, 3 near-crowd pts at z 5); `SWEEP_PTS` = crowd line (±7, −6) at z 5 (old version aimed at z 8 — above the new heads, would now violate the roof guard); `FIG8_PTS` recentred on singer; `PANW_PTS` on band line; `tiltd` recentred to x 0. `hCrossUp/Down` recompute automatically.
6. **`stage-inputs.json`** updated as the measurement record (depth 10, heads 20 apart at 8.5, ground trusses, deck 2.5, band re-block note).

## Captions / VC

Generated automatically by the builder's `place()` pass — `POSITIONS` row lands on pad row 3 (R3C1–R3C8) on both the OSC and Launchpad button sets, captions stamped `<name> R3C#`.

## Tests (`tests/build-show.test.ts`)

- Update `padChOf("Center")` → `padChOf("Singer")` (same pad 189).
- Rewrite the "aims the heads" test for new names + computed DMX (e.g. Singer L = pan 162 / tilt 103, R = pan 94 / tilt 103).
- New: all 8 position pads present; all 7 old position names absent.
- New roof-safety regression: every aimed scene (positions + hCirc + hSweep) has tilt DMX ≥ 93 on both heads.
- Widget count stays 131 (8 positions before and after).

## After build

`npx tsx scripts/build-show.ts` (tests do this in `beforeAll`), then `npm run generate:widgets` to refresh `config/widgets.json` for the MCP. QLC+ must reload the show file.

## Risks

- Real rig clocking/mirroring unknown until on-site → absorbed by the documented calibration knobs; one calibration pass required.
- Old generic looks (Center/Wide/Cross X/Downstage/Upstage/Tight Center/Wide Open) disappear — accepted in Approach A. `cross` aim survives internally for presets/zigzag.
- Crowd Near aims ~5 ft at standing faces — punk-appropriate, but nudge `tz` up if eye comfort matters.
