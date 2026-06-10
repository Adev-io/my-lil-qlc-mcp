# Mover Aimed Positions — Design

Date: 2026-06-09
Show file: `punk-rock-show.qxw`
Fixtures: Head L (ID 12, DMX 152), Head R (ID 13, DMX 167) — Chauvet Intimidator Spot 375Z IRC, 15-channel mode

## Problem

The two moving heads use generic positions (Center / Wide / Cross X / Downstage / Upstage) that aim upward. At the real venue a roof sits close above the 8 ft trusses, so up-pointing beams are wasted or blocked. The movers should interact with the band and the audience: every pad aims at a person or a crowd zone, and every beam lands below horizontal.

## Decisions (approved in brainstorm)

1. **Approach A** — replace the row-3 generic position pads with 8 aimed pads. No new Launchpad page.
2. Existing function IDs are reused (rename + re-aim) so button and chaser wiring stays intact.
3. Position scenes stop forcing color white + gobo open, so the Heads color pads keep control.
4. Sweep/circle waypoint scenes get re-aimed too — all mover movement stays below horizontal.

## Physical model

Units: feet. Origin: stage front-left corner at ground level (audience view).
X = across stage (0 left … 20 right), Y = depth (0 front edge … 10 back), Z = height. Negative Y = into audience.

| Item | Position |
|---|---|
| Stage deck | 20 × 10 ft, top at Z = 2.5 |
| Head L | (0, 0, 8.5) — ground-standing truss at front-left corner, head on top |
| Head R | (20, 0, 8.5) |
| Roof | just above heads (~9.5+) — hard constraint: no beam above horizontal |

### Targets

| # | Pad | Target (X, Y, Z) | Notes |
|---|---|---|---|
| 1 | Singer | (10, 3.3, 6.5) | center stage, chest height |
| 2 | Guitar | (4.4, 2.7, 6.5) | front left |
| 3 | Bass | (15.2, 4.8, 6.5) | mid right |
| 4 | Drums | (17, 7.5, 6.0) | back right, seated height |
| 5 | Crowd Near | (10, −6, 5.0) | ~6 ft out, beams cross |
| 6 | Crowd Deep | (10, −18, 5.5) | ~18 ft out |
| 7 | Stage Wash | L→(5, 5, 6.5), R→(15, 5, 6.5) | each head washes its half, widest zoom |
| 8 | Park | unchanged (existing scene 23) | dimmer 0, head rest |

All computed down-tilts fall between 7° and 21° below horizontal — roof-safe by construction.

## Pan/tilt math

Fixture (from official QLC+ definition `Chauvet-Intimidator-Spot-375Z-IRC.qxf`): pan range 540°, tilt range 270°.
DMX per degree: pan 255/540 = 0.4722, tilt 255/270 = 0.9444 (coarse channel).

For a head at H and target T:
- azimuth θ = atan2(Ty−Hy, Tx−Hx) (horizontal plane)
- elevation ε = atan((Hz−Tz) / horizontalDistance(H,T)) (down-angle from horizontal)

DMX is anchored to a calibrated reference (the Singer target):

```
panDMX(T)  = PAN_DMX_AT_SINGER  + PAN_SIGN  × (θ(T) − θ(Singer)) × 0.4722 × (180/π)
tiltDMX(T) = TILT_DMX_AT_SINGER + TILT_SIGN × (ε(T) − ε(Singer)) × 0.9444 × (180/π)
```

This is valid because the heads sit upright (pan axis vertical), so azimuth maps linearly to pan DMX and elevation to tilt DMX.

### Calibration constants (per head)

| Constant | Seed value (from old "Center" scene) | How to fix on-site |
|---|---|---|
| `PAN_DMX_AT_SINGER` L / R | 145 / 97 | aim head at singer manually, read pan DMX |
| `TILT_DMX_AT_SINGER` L / R | 140 / 122 | same, read tilt DMX |
| `PAN_SIGN` L / R | +1 / +1 | if computed Guitar pad swings the wrong way, flip to −1 |
| `TILT_SIGN` L / R | +1 / +1 | if computed Crowd pad tilts up instead of down, flip to −1 |

On-site procedure: park heads → aim each head at the singer position using QLC+ (or the dashboard pan/tilt control) → write the 4 observed DMX values into the generator constants → re-run generator → reload show file. One reference point per head is enough; trig produces every other target.

## Scene changes (function IDs reused)

| ID | Old name | New name | Zoom (ch14) |
|---|---|---|---|
| 16 | Center | Singer | 100 |
| 17 | Wide | Guitar | 60 (tight) |
| 18 | Cross X | Bass | 60 (tight) |
| 19 | Downstage | Drums | 100 |
| 20 | Upstage | Crowd Near | 200 (wide) |
| 21 | Tight Center | Crowd Deep | 200 (wide) |
| 22 | Wide Open | Stage Wash | 230 (widest) |
| 23 | Park | Park | unchanged |

Channel policy for scenes 16–22 (both fixtures): pan (0), pan fine (1), tilt (2), tilt fine (3), focus (9) = 128, dimmer (10) = 255, shutter (11) = 255, zoom (14) per table. **No color (5) / gobo (6)** — color pads retain control. Park (23) untouched.

### Waypoint scenes (movement chasers)

- `hCirc 1–6` (IDs 49–54): re-aimed as a flat 6-point loop — 3 waypoints across the band line, 3 across the near crowd. Circle becomes a band↔crowd orbit, always below horizontal.
- `hSweep 1–3+` (IDs 56–58, plus any further hSweep scenes found at implementation time): re-aimed as a left↔right sweep across the near-crowd zone.
- Chasers themselves (Head Sweep Slow 40, Head Sweep Fast 41, Head Circle 55) keep their step lists — they pick up the new aims for free. Sweep Slow becomes Singer→Guitar→Bass→Drums; Sweep Fast becomes Singer→Guitar→Bass→Crowd Near.

## Button caption changes

Each renamed scene has two VC buttons (OSC page + Launchpad page). Captions update to match: e.g. `Center R3C1` → `Singer R3C1`, `Wide R3C2` → `Guitar R3C2`, … `Wide Open R3C7` → `Stage Wash R3C7`. Pad grid position (R3C1–R3C8) unchanged.

## Implementation shape

**Generator script** `scripts/generateMoverPositions.mjs` (Node, no new deps):
- All geometry, targets, calibration constants, and zoom values as named constants at the top.
- Computes pan/tilt DMX for both heads for scenes 16–22, 49–54, 56–58.
- Edits `punk-rock-show.qxw` in place via targeted string replacement (function name, `FixtureVal` lines, button captions). No full-XML round-trip — keeps diffs minimal.
- Writes `punk-rock-show.qxw.bak` backup before first modification.
- Prints a summary table of all computed DMX values, flags any tilt that would land above horizontal and aborts.

**After generation:**
- `npm run generate:widgets` — refresh the MCP widget map with new captions.
- Vitest: existing parser tests must pass; add assertions that the new widget names (Singer, Guitar, Bass, Drums, Crowd Near, Crowd Deep, Stage Wash) resolve.

**Operational note:** QLC+ must be closed (or the file reloaded) when the .qxw is rewritten. The autosave file is left alone.

## Risks

- Real truss placement / pan home direction will differ from the model → absorbed by the 8 calibration constants; one on-site pass required.
- `Sound Active` (48) sets movement macro ch12/13 = 255 on the bars only — movers unaffected; no macro channel is touched by this design.
- Old generic looks (Tight Center / Wide Open zoom presets) disappear — accepted in Approach A.
