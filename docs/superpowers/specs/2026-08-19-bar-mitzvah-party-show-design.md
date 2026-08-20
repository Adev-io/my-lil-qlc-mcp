# Bar Mitzvah Dance Party Show — Design

**Date:** 2026-08-19 · **Event:** Saturday 2026-08-22 · **Status:** approved in brainstorm, pending spec review

A second generated show on the existing QLC+ stack: dance-party bar mitzvah with a
5-page Launchpad layout, dashboard fader panel, audio reactivity, and the same 3D
monitor / day-of head-plot workflow as the punk show. Punk show remains untouched.

## Hardware decisions (settled by test, 2026-08-19)

- **Onyx NX Touch: OUT.** Enumerates as `USB\VID_11BE&PID_E808` with `Status: Error`,
  no driver, no MIDI endpoint — proprietary Onyx-only surface. QLC+ cannot see it.
  Physical faders replaced by a dashboard slider panel (any phone/tablet/laptop).
- **Launchpad Mini MK3: IN.** MIDIIN2/MIDIOUT2 verified present; same ports and
  LED-feedback mechanism as the punk show.
- **Audio:** PreSonus AudioBox USB96 as QLC+ audio input. Feed decided day-of:
  DJ/PA line out (preferred) or a microphone near a speaker — both documented.

## Rig

`rigs/bar-mitzvah.rig.json` (new; root `rig.json` swapped to it to generate this show).

| Fixtures | Def | Addresses | Placement |
|---|---|---|---|
| 10x Rainbow Smart 2 Pro RGBWA+UV, 10ch | reused verbatim from punk rig | 0–90 (step 10) | Floor along back wall behind 28ft stage, uplighting the wall: 5 left group + 5 right group, ~2ft spacing |
| 4x Chauvet Intimidator Spot 375Z IRC, 15ch | reused verbatim (roles, beam, color wheel, gobo slots) | 100 / 115 / 130 / 145 | 2 on 8ft truss flanking stage (`trussL`/`trussR`); 2 on floor aimed up at the banner (`floorL`/`floorR`) |

- New per-head `mount` field: `trussL | trussR | floorL | floorR`.
- New `banner` block: `{ widthFt: 12, heightFt: 8, centerX: 0 }` — upstage center
  behind the stage; consumed by aim math and the 3D monitor.
- No bars this show.
- `dmxOutput` and `controller` blocks copied from the punk rig (same Pknight
  Art-Net node, same Launchpad ports).
- Theme palette: **gold + blue + UV** (family picked; reference picture pending —
  refines COLORS table values only, nothing structural).

## Generation plumbing

- `scripts/build-party.ts` — fork of `build-show.ts` with party look tables and
  party geometry. Deliberate duplication: look code is show-specific by design;
  parameterizing the generator was rejected as a pre-show-week refactor.
- Root `rig.json` gets `meta.builder: "party"`; the generate pipeline dispatches
  on it (absent/`"punk"` → existing `build-show.ts`). Swapping root rig.json back
  regenerates the punk show bit-identically.
- All existing outputs regenerate per show: `.qxw`, `PATCH-CHART.md`,
  `SETUP-MANUAL.html`, `SHOW-SETUP.md`, monitor `fixtures.json`,
  `config/widgets.json`, `config/launchpad-leds.json`.

## Geometry & safety

- **Truss heads (8ft):** above targets again — punk `aim()` math applies for
  dance-floor and speaker targets in front of the stage. Roof guard stays.
- **Floor heads:** aim UP at the banner — beams travel upstage, away from people.
  New `aimBanner()` helper (inverted-elevation case); targets clamped to the
  banner rectangle.
- **Movement-macro ban stays (ch13 ≠ 0 throws):** firmware auto pan/tilt ignores
  every fence and could rake the dance floor at face height.
- **Sound-active mode is pars-only.** Heads are never audio- or sound-driven.
- **Day-of authority:** designed `aim()` values are pre-viz defaults. Saturday:
  card-sweep each head, capture real DMX with `capture-head.mjs` into
  `movingHeadSettings`, regenerate. Same drill as the punk 2026-06-13 re-block.
  `headSafety` fences recorded then; `coverGuard` enforces them in every emitted
  scene.

## Launchpad layout — 5 pages, chronological

Same multipage-frame + LED-feedback system as punk (idle pads glow look color dim,
active look full). Page prev/next pads walk the event in order. Every page shares
the same bottom utility row: **blackout · all-white panic · banner on/off · page
indicator**.

| # | Page | Looks (~6–10) |
|---|------|---------------|
| 1 | INTRO | doors-open soft blue · slow blue/gold build chase · ENTRANCE (full bright, movers sweeping) · strobe hit (momentary) · banner blast · blackout |
| 2 | DINNER | static only: gold wall · blue wall · gold/blue alternating · soft amber · warm white · low UV accent · banner soft · blackout |
| 3 | SPEECHES | banner bright (floor heads gold/white) · wall low gold · speaker front-light (truss heads, aimed day-of) · off-but-banner · house bright white · blackout |
| 4 | HORA | saturated gold+blue full · movers circling floor · fast gold/blue chase · white burst · strobe hit · blackout |
| 5 | PARTY | gold/blue/UV theme chases · rainbow chases · UV blacklight · 2–3 mover sweep patterns · strobe momentaries · audio-react ON/OFF pad · par sound-mode fallback pad · blackout |

Target scale: ~40 looks total (punk had 160 — this show is deliberately simpler).

## Dashboard slider panel (NX Touch replacement)

Six faders, visible on all pages (outside the multipage frame, same placement
pattern punk uses), mirrored on the web dashboard automatically via `widgets.json`:

- **Level-mode VC sliders (drive channels):** par intensity · truss-head
  intensity · banner intensity (floor-head dimmers only) · UV level · par strobe
  rate.
- **Chase speed:** not a DMX channel — a VCSpeedDial bound to the chasers. If
  the dial's OSC/dashboard mapping is awkward, fallback is slow/fast variants of
  each chase as separate pads and the dial is dropped.

## Audio reactivity

**Primary — QLC+ VC Audio Triggers widget**, generator-emitted:

- Input device: AudioBox USB96 (mic or line jack, chosen at soundcheck).
- Bass band → fires a par "pulse" flash scene (intensity bump on the beat;
  authored theme colors preserved).
- Volume bar → small floor-head dimmer ride ("banner shimmer").
- PARTY-page pad enables/disables the widget. Sensitivity = QLC+ UI knob at
  soundcheck, not code.
- **Go/no-go gate (first implementation task):** emit minimal AudioTriggers XML,
  confirm QLC+ 4.14 loads it and reacts to the AudioBox. Decision by end of
  first build session. **Fallback if it fights us:** drop the widget; par
  sound-mode pad + chase-speed slider carry reactivity.

**Backup — fixture sound mode (pars only):** one pad sets par macro (ch8) to the
sound-active program + speed (ch9). Colors go auto while engaged — accepted;
it's the break-glass mode and the feed-died fallback.

## 3D monitor

Existing Three.js monitor, new layout from the rig: 10 back-wall uplights (beams
up the wall), 2 truss heads at 8ft, 2 floor heads angled up at a plain 12x8
colored quad for the banner (no texture — just enough to judge floor-head aim).
Live from Art-Net as before.

## Day-of runbook (regenerated SHOW-SETUP)

1. Patch fixtures to PATCH-CHART addresses on their menus.
2. `./start-show.ps1`.
3. Head plot: card-sweep all 4 heads → `capture-head.mjs` → `movingHeadSettings`
   (+ `headSafety` fences) → `npm run generate` → reload show. Truss heads:
   dance-floor sweep window + speaker front-light. Floor heads: frame the banner.
4. Audio: plug feed into AudioBox, select it in QLC+ audio input, play music,
   set trigger sensitivity until the pulse look breathes with the kick.
5. Fire one look per page end-to-end (pad → light → monitor) before doors.

## Testing

- New vitest file for the party build: patch/address math, look + pad counts per
  page, coverGuard throws on fence/macro violations, widgets.json paths resolve,
  shared bottom row present on all 5 pages.
- Existing punk tests must still pass with root rig.json swapped back (fork
  isolation proof).
- Dry-run OSC fire of one look per page; audio-trigger load test per the
  go/no-go gate.

## Out of scope

- NX Touch in any form (incl. ShowCockpit bridge) — rejected 4 days pre-event.
- Parameterized/data-driven look generator — future refactor, not this week.
- Banner texture/graphics in the monitor — plain quad only.
- Head audio reactivity or head sound mode — safety.
