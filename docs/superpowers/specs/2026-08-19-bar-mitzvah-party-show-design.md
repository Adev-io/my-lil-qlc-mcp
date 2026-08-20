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
| 10x Rainbow Smart 2 Pro RGBWA+UV, 10ch | reused verbatim from punk rig | 0–90 (step 10) | Floor along back wall behind the 30ft x 4ft stage (1.5ft deck, measured 2026-08-20; dance-floor centre 12ft off the front edge), uplighting the wall: 5 left group + 5 right group, ~2ft spacing |
| 4x Chauvet Intimidator Spot 375Z IRC, 15ch | reused verbatim (roles, beam, color wheel, gobo slots) | 100 / 115 / 130 / 145 | 2 on 8ft truss flanking stage (`trussL`/`trussR`); 2 on floor **directly below the truss positions**, aimed up+inward at the banner (`floorL`/`floorR`) — cross-shot X beams |

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
- **Floor heads:** sit directly below the truss positions (stage sides), aim UP
  and INWARD at the banner — cross-shot X beams, still traveling upstage away
  from people. New `aimBanner()` helper (inverted-elevation case); targets
  clamped to the banner rectangle; per-side pan mirroring.
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
active look full; R1C1 = top-left, R8 = bottom row). Pages ordered by event
chronology; **R8C8 cycles pages** (punk grammar: 1→2→3→4→5→1), PgUp/PgDn on the
keyboard too. Look pads live in solo frames — one look at a time, pressing a new
look stops the old (this is also why blackout works: it stops the running look).

**Rows R7–R8 are identical on every page** (muscle memory in the dark):

| Pad | R8 (utility) | Pad | R7 (dim + tempo) |
|-----|--------------|-----|-------------------|
| R8C1 | **BLACKOUT** | R7C1 | **DIM 25%** |
| R8C2 | PANIC (all white full) | R7C2 | **DIM 50%** |
| R8C3 | Banner on/off | R7C3 | **DIM 75%** |
| R8C4 | **TAP TEMPO** | R7C4 | **DIM FULL** (autostarts at boot) |
| R8C5 | **STROBE (hold)** — momentary, full-rate, release = off | R7C5 | **SYNC STROBE** — toggle, strobe-chaser at tapped tempo |
| R8C6 | Audio-react ON/OFF | R7C6 | reserved |
| R8C7 | Par sound-mode (fallback) | R7C7 | reserved |
| R8C8 | PAGE CYCLE | R7C8 | reserved |

- **Dim pads (R7C1–C4):** solo group of scenes writing ONLY the dim channels
  (pars ch0, heads ch10). Looks never write dim (punk rule kept). DIM FULL is
  the .qxw autostart function so the show boots lit. Dim faders default 0 —
  HTP means fader can push above the pad preset, pad can't pull below a raised
  fader; operating rule documented: drive with pads, ride faders only on purpose.
- **TAP TEMPO (R8C4):** external tap input of a VCSpeedDial bound to every chase
  AND the sync-strobe chaser — tap on the beat, all movement + sync strobe
  follow.
- **STROBE hold (R8C5):** flash-mode button, pars ch1 + heads ch11 full-rate
  while held. SYNC STROBE (R7C5) is the tempo-locked alternative.

**Rows R1–R6 = the page's looks** (top rows first):

| # | Page | Looks |
|---|------|---------------|
| 1 | INTRO | doors-open soft blue · slow blue/gold build chase · ENTRANCE (full bright, movers sweeping) · banner blast |
| 2 | DINNER | static only: gold wall · blue wall · gold/blue alternating · soft amber · warm white · low UV accent · banner soft |
| 3 | SPEECHES | banner bright (floor heads gold/white) · wall low gold · speaker front-light (truss heads, aimed day-of) · banner-only · house bright white |
| 4 | HORA | saturated gold+blue full · movers circling floor · fast gold/blue chase · white burst |
| 5 | PARTY | gold/blue chase · blue/UV chase · gold/UV chase · rainbow chase · rainbow fast · UV blacklight · sweep wide · sweep cross · sweep punch |

Blackout/strobe/audio pads are NOT duplicated per page — the shared R7/R8 rows
carry them. Target scale: ~30 looks + ~14 shared-control functions (punk had
160 — this show is deliberately simpler).

## Dashboard slider panel (NX Touch replacement)

Faders visible on all pages (outside the multipage frame, same placement pattern
punk uses), mirrored on the web dashboard automatically via `widgets.json`:

- **Level-mode VC sliders (drive channels), default 0** so the R7 dim pads own
  brightness at boot: Pars Dim (ch0) · Truss Dim (2 truss heads ch10) · Banner
  Dim (2 floor heads ch10) · UV Level (pars ch7) · Strobe Rate (pars ch1 + heads
  ch11) · Heads Zoom (ch14, day-of framing aid).
- **Tempo:** the VCSpeedDial (tap = Launchpad R8C4) is the tempo authority for
  all chases + sync strobe. If the dial's OSC/dashboard mirroring turns out
  awkward, fallback is slow/fast chase variants as pads; the tap pad stays
  either way.
- **Implementation-verify item:** confirm in QLC+ 4.14 that dim-pad scenes +
  faders-at-0 + DIM FULL autostart behave as designed (HTP interplay), before
  look tables are finalized.

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
