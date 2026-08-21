# Safe Head Motion + MiniLab 3 — Design

Bar mitzvah show, Saturday 2026-08-22. Builder: `scripts/build-party.ts`. Approved in-session 2026-08-20.

## The rule

**A moving-head beam never lands on, or passes at head height over, a guest at a table.** Tables sit on three sides of the dance floor (U shape). Towers stay at the stage ends. No haze.

## Room model (builder coords: x = ft from stage centre, + house right; y = ft, 0 = stage front edge, − = downstage; z = ft up)

| Thing | Extent |
|---|---|
| Stage deck | x ±15, y 0..4, z 1.5 |
| Truss heads | (±15, 0, 8) — `headSeparationFt` 30, `headHeightFt` 8 |
| Floor heads | (±15, 0, 1), banner-only, unchanged |
| Dance floor | x ±10, y −4..−24 (centre 14 ft out — **corrected from 12**, `DF_CENTER_Y = -14`, 20×20) |
| Ceiling | z 12 |
| Back wall / banner | y 4, banner 12×8 centred z 8 |
| Doors | (−15, −21), header z 7 |
| Tables | everything else at floor level |

## Clearance

Beam **centre line** must satisfy, at every point along its travel:

- over the **stage** rectangle: no minimum (performers are lit on purpose)
- over the **dance floor**: z ≥ 10 ft + 1 ft margin = **11 ft** (hora chair lift ≈ 9.5 ft)
- **anywhere else**: z ≥ 7 ft + 1 ft margin = **8 ft**

Consequence, from a head at 8 ft and x = ±15: the 5 ft table strip under each tower makes every floor target illegal (to clear 8 ft over the strip the target would have to be 25 ft past the far stage end). Truss beams therefore go to **ceiling, back wall/banner, stage deck, door header** — nothing on the floor.

## Guard (build time, the authority)

`beamSafe(head, target)` in build-party.ts: walk the head→target segment in 0.5 ft steps, apply the table above, `throw` on the first violation. Called by `aim()` for every truss target, so the build fails and names the scene. Also applied to:

- **chaser transitions**: for each consecutive step pair, interpolate pan/tilt linearly in DMX (what QLC+ does during a fade), invert to a ray, intersect with ceiling/floor/walls, check the landing point and the segment.
- **EFX boxes**: sample the box perimeter + centre (16 points), invert, check.

`rayTarget(head, pan, tilt)` = inverse of `aim()`; unit-tested round-trip.

`ponytail:` runtime enforcer (`floor-head-tilt.mjs`) stays scene-only and unchanged; the generated file is read-only and the guard is the authority. Revisit if anyone hand-edits the .qxw.

## Looks that change

| Look | Before | After |
|---|---|---|
| Truss Home | floor centre | ceiling 5 ft in front of each tower |
| Sweep Wide / Cross / Punch, Circles | floor sweeps | **deleted** (replaced by EFX) |
| Door Spot / Door Gobo | floor at doors | door **header** z 7 → stays ≥ 8 ft over the side tables |
| Speaker Light | stage, z 6.5 | unchanged (stage zone) |
| Truss Sound (R8C6) | firmware sound program, unfenced | **deleted** — pad empty |
| Par Sound (R8C7) | — | unchanged |

## New looks

**EFX** (QLC+ native `Type="EFX"`, fixtures in Position mode, pan/tilt only — colour/gobo/dim come from the lit look). Box per head centred on the ceiling point 5 ft in front of the tower, sized so the whole perimeter passes the guard.

| Pad | Algorithm | Speed |
|---|---|---|
| Ceiling Circle | Circle | 8 s |
| Ceiling Circle Fast | Circle | 3 s |
| Figure 8 | Eight | 6 s |
| Ceiling Line | Line, heads counter-phased | 4 s |
| Diamond | Diamond | 5 s |
| Banner Wave | Line across the banner face (banner top = ceiling, so "above it" is nothing), heads counter-phased | 6 s |

**Static**: Ceiling Gobo Gold (slot 1, orange), Ceiling Gobo Blue (slot 3, cyan), Banner Beams (truss on the banner, white, gobo open).

Placement: row 3 (index 2) on HORA and PARTY; Banner Beams on SPEECHES row 2. Move Speed knob (ch4) damps all of it.

## MiniLab 3

QLC+ 4 = one input device per universe. Universe 1 = Launchpad (exists). **Universe 2 = MiniLab**, input line resolved by the launcher by name (`Minilab3`, first port) and repaired in place like the Launchpad.

Arturia factory CC map, MIDI ch 1 (verify with `./scripts/midi-learn.ps1` — a relearned map just changes these numbers in rig.json `controller2.cc`):

| Control | CC | QLC+ input ch (128 + CC) | Binds |
|---|---|---|---|
| Fader 1–4 | 82 83 85 17 | 210 211 213 145 | Pars L · Pars R · Truss · Banner (Playback, existing) |
| Knob 1 | 74 | 202 | Truss Zoom (ch14, truss) |
| Knob 2 | 71 | 199 | Banner Zoom (ch14, floor) |
| Knob 3 | 76 | 204 | Truss Focus (ch9, truss) |
| Knob 4 | 77 | 205 | Banner Focus (ch9, floor) |
| Knob 5 | 93 | 221 | Gobo Spin (ch7, all heads) |
| Knob 6 | 18 | 146 | Prism (ch8, all heads) |
| Knob 7 | 19 | 147 | Move Speed (ch4, all heads) |
| Knob 8 | 16 | 144 | UV Wash — Playback slider on a new `UV Full` scene (pars ch7 255), HTP blend |

Existing `Heads Zoom`/`Focus` split into truss/banner pairs. Fader rule holds: no Level knob touches a channel any scene writes (ch4/7/8/9/14 are knob-owned; UV is Playback).

rig.json gains `controller2: { model, inputUid, inputLine, cc: { f1..f4, k1..k8 } }`. `rigs/bar-mitzvah.rig.json` mirrors it.

## Tests

- guard: a deliberate table target throws; every shipped truss target passes; chaser transitions and EFX perimeters pass
- `rayTarget(aim(p)) ≈ p` round-trip
- no scene writes head ch13 (sound macro) — existing test tightened (no exception now)
- every EFX box fixture is a truss head; no floor head in any EFX
- widget map: every MiniLab control's `<Input Universe="1" Channel="n">` matches the CC table; faders/knobs still answer their caption OSC paths
- launcher: parses under PS 5.1, BOM intact, repairs universe 2 line

## Saturday

Plot sheet → `movingHeadSettings` → `npm run generate` (guard re-runs on captured positions) → 47-look wire sweep → MiniLab sweep (`midi-learn`) if any control is dead.
