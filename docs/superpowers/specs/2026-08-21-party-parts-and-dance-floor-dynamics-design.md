# Party parts, page defaults, and truss dynamics under the 11-ft rule

**Date:** 2026-08-21 · **Show:** bar-mitzvah-party (Saturday 2026-08-22) · **Status:** approved design, spec for planning
**Depends on:** `2026-08-21-minilab-pads-and-knobs-design.md` (amends its Gobo Spin / Prism decision — §3)

## Goal

1. One Launchpad page per **part of the party**, in running order, scrolled with the frame's arrows/dropdown or the
   Launchpad page pad. Landing on a page turns that part's **default look on** — no second press.
2. More scenes and chasers, designed per moment: entrance/candle lighting, speeches, hora, slow dance, kids'
   free-for-all, party.
3. More visible dynamics on the dance floor from the truss movers **without relaxing the beam rule: centre line
   ≥ 11 ft over the dance floor, ≥ 8 ft over the tables, everywhere, every page** (operator decision 2026-08-21).

## 1. Pages — one per part, in running order

| # | Page | Default look (fires on landing) | Blurb |
|---|---|---|---|
| 1 | ENTRANCE | `Candle Ceremony` | doors, candle lighting, grand entrance |
| 2 | DINNER | `Gold Wall` | static ambient, zero motion |
| 3 | SPEECHES | `Podium` | calm, banner featured, speaker lit |
| 4 | HORA | `Gold Blue Full` + `Ceiling Step` | lift the chairs |
| 5 | SLOW DANCE | `Slow Blue` | couples, drift |
| 6 | KIDS | `Rainbow Chase` + `Ceiling Circle Fast` | free-for-all |
| 7 | PARTY | `Chase Gold Blue` + `Diamond` | the dance floor |

Row grammar is unchanged and now complete: R1 static · R2 chases · R3 head motion · R4 banner · R5 specials ·
**R6 MOMENT (new, this spec)** · R7 brightness · R8 utility. Existing INTRO looks move to ENTRANCE; existing PARTY
looks split between KIDS and PARTY by energy (rainbow/strobe/chaos → KIDS; gold-blue/UV/beam → PARTY). A default
is a **Collection** named `Default <PAGE>` so it can bundle a colour look with a motion look; every default also
sits on its page at R1C1 so the operator can see and re-press it.

### Landing fires the default — mechanism

QLC+ has no page-change hook. Two layers:

- **Primary (MCP server):** when a multipage frame shows a page, QLC+ re-sends feedback for that page's widgets so a
  controller can relight. The OSC twins are on universe 0, whose feedback plugin is OSC → the MCP's `:9000` listener
  sees a burst of feedback for paths unique to the new page (each page has at least one path no other page has —
  its `Default <PAGE>` button, e.g. `/default_hora_r1c1`). `src/launchpad/leds.ts` already infers page from path
  tokens; this generalises it: a new `src/qlc/pageTracker.ts` maps unique path → page, debounces the burst (150 ms),
  and on a page change fires `Default <PAGE>` over OSC exactly once. The dashboard shows the current part and gets a
  **part dropdown + ◀ ▶** that sends the frame's page inputs (see below) — this is the page-aware dashboard.
- **Fallback (if pre-check 1 fails):** a **DEFAULT pad at R1C1** on every page, lit white; the operator presses it
  after paging. The MCP still shows the current part when it can.

Frame page inputs: a VCFrame has two external inputs, next and previous, one source each. **Next = Launchpad R8C8
(MIDI, as today). Previous = Launchpad R8C7 (MIDI, was empty).** The dashboard pages through the MCP's tracked
page with N "next" presses over OSC — impossible while both sources are MIDI. So the dashboard's ◀ ▶ drive QLC+
via the frame's **keyboard shortcuts** (`PageDown` / `PageUp`, set on the frame; QLC+ accepts key sequences
independently of the input sources) sent with `scripts/qlc-window.ps1 -Keys` — only when pre-check 2 shows it
reliable with QLC+ behind the browser; otherwise the dashboard shows the part and its default button but does not
page (the Launchpad and the QLC+ header do).

## 2. Truss dynamics that stay legal — and visible with no haze

No haze: the crowd sees where a beam **lands** and the lens flash, never the beam. Motion therefore goes on
surfaces the floor faces. Geometry from 8-ft towers at x = ±15: any beam toward the floor centre is ~9.3 ft high
at the floor's edge — illegal — so nothing crosses the floor; everything below is reachable without it.

| Look | Type | What it does | Legal because |
|---|---|---|---|
| `Wall Sweep` | EFX Line, mirrored L/R, 6 s | each head sweeps its **own side wall** (x = ±25) from y = −4 to y = −24, landing 9–11 ft up | never enters x ∈ [−10, 10]; ≥ 8 ft over the tables the whole way |
| `Wall Chase` | Chaser, 4 steps per head, tempo | same wall, snapped to 4 points on the beat | same line, same guard per step |
| `Ceiling Step` | Chaser, 6 ceiling positions per head, tempo-locked | snaps between points in each tower's ceiling cone | every step through `aim()`; the cone is today's safe ceiling set |
| `Ceiling Drift` | EFX Circle 20 s | slow-dance drift on the ceiling | today's Ceiling Circle geometry, slower |
| `Beam Flicker` | Scene + Sync Strobe on heads | shutter strobe + prism while parked at ceiling home | no movement |
| `Starlight` | Scene, gobo rotation slow on the ceiling | operator sets K3 to the dot gobo; look spins it | home position |

Tempo dial additions: `Ceiling Step`, `Wall Chase`, `Diamond` (×8), `Ceiling Circle Fast` (×4) — motion and chases
share the tapped beat.

Wall geometry constants go in `scripts/party-geometry.ts` (`WALL = { x: 25, yNear: -4, yFar: -24, zLo: 9, zHi: 11 }`)
so `beamSafe` and the tests use one source. `rayTarget` already stops at the room bounds (x = ±25).

## 3. Free the prism and gobo rotation for looks (amends spec 1)

A Level slider owns its channel; while `Gobo Spin` (ch7) and `Prism` (ch8) are sliders no look can animate them.
Spec 1 kept them as dashboard-only sliders; **this spec removes both widgets**. Looks drive ch7/ch8 (`Disco`,
`Beam Flicker`, `Starlight`, `Banner Swirl` may already). `BEAM_CLEAR` becomes `[7, 0, 8, 0, 13, 0]` on truss heads
and `FLOOR_CLEAR` adds `7, 0, 8, 0` on the floor pair so nothing latches (LTP RECLAIM rule). K3 Gobo (ch6) stays a
knob — the operator chooses the pattern, looks spin it.

## 4. Moment looks — R6 on every page

All pars unless stated; every scene clears sound macros; every head position through `aim()`.

- **ENTRANCE:** `Candle Ceremony` (pars 20 % amber, heads gold on `Ceiling Drift`, `Banner Soft`) · `Candle Flicker`
  (random-order amber chaser, 400–900 ms steps, fade 300) · `Entrance Hit` (chaser **Single Shot**: blackout 500 ms →
  `White Burst` 300 ms → `All Gold` hold) · `Drumroll` (gold/blue chaser with step durations 800 → 100 ms, strictly
  decreasing, 12 steps) · `Reveal Gold` (fade-up 3 s from dark to `All Gold`).
- **DINNER:** `Candle` (exists) · `Amber Drift` (very slow amber/warm-white crossfade, 12 s steps).
- **SPEECHES:** `Podium` (Collection: `Speaker Light` + `Half Warm`) · `Toast` (gold shimmer: 4-step gold/amber
  chaser 1.5 s, fade 1 s) · `Applause` (Single Shot: `White Burst` → `All Gold` 2 s → back to `Podium`).
- **HORA:** `Hora Circle` (pars chase around the room L → back → R → L, 8 steps on tempo) · `Hora Lift` (`All Gold` +
  `Beam Flicker`) · `Hora Build` (accelerating gold/blue, 16 steps 600 → 120 ms) · `Halves` (gold/blue alternate room
  halves on the beat) · `Ceiling Step`.
- **SLOW DANCE:** `Slow Blue` (deep blue 40 % + UV 30 %, `Ceiling Drift`) · `Slow Amber` (amber 35 %, banner soft) ·
  `Starlight` · `Banner Wave` (exists).
- **KIDS:** `Rainbow Strobe` (Rainbow Fast + Sync Strobe on pars) · `Pixel Chaos` (random colour per par, 150 ms) ·
  `Bounce` (L/R ping-pong wash on tempo) · `Disco` (prism + gobo spin + `Diamond`) · `Ceiling Circle Fast`.
- **PARTY:** `Wall Sweep` · `Wall Chase` · `Beam Flicker` · `Disco` · `Gold Pulse` (exists) · `Beam Punch` (exists).

Chaser speeds that should follow the beat join `tempoFuncIds`; drifts and candles deliberately do not.

## 5. Generator / server / docs

- `scripts/build-party.ts`: `PAGES` → 7 entries with `defaultFn`; `place()` emits a `Default <PAGE>` button at R1C1
  of each page; R8C7 = frame previous-page input; new scene/chaser/EFX builders per §2/§4; `addChaser` gains
  `runOrder` (`Loop` | `SingleShot` | `Random`) and per-step durations; `BEAM_CLEAR`/`FLOOR_CLEAR` per §3; Tempo
  dial list per §2. Console: the Pages frame is already 7-page capable (multipage); MINILAB frame drops two
  sliders (§3).
- `src/qlc/pageTracker.ts` (new, pure: unique-path map + debounce, unit-tested) and its wiring in `src/index.ts`
  behind `PAGE_DEFAULTS=1` in `config/.env` (default on for this show); the dashboard's part dropdown/◀ ▶ in
  `src/dashboard/` reading `GET /dashboard/api/page` and posting `/dashboard/api/page/next|prev`.
- `config/launchpad-leds.json` gains `defaultFn` per page (generator output) for the dashboard; `PATCH-CHART.md`
  and the roadmap operator guide list the 7 pages with their defaults.

## 6. Tests

1. THE RULE: every truss pan/tilt (scenes, chaser steps, EFX centre + 16 perimeter points) passes `panTiltSafe` —
   existing test, now covering Wall Sweep/Chase and Ceiling Step automatically.
2. Wall looks never produce a target with |x| < 10 (explicit, in case the wall constants drift).
3. Single-shot chasers carry `RunOrder=SingleShot`; accelerating chasers have strictly decreasing step durations.
4. Every look clears ch7, ch8, ch13 on truss heads (LTP RECLAIM extended); no Level slider exists on ch7/ch8.
5. Seven pages, each with exactly one `Default <PAGE>` Collection at R1C1 whose path is unique across pages; the
   R8C7/R8C8 frame inputs are distinct MIDI channels.
6. `pageTracker`: burst of feedback for page-N-unique paths → one `Default <PAGE N>` fire; a repeat burst for the
   same page fires nothing; shared paths (e.g. `/truss_home`) never change the page.
7. Orphan test (every function on a pad) stays green with the new functions.

## 7. Bench pre-checks (before Task 1)

1. **Page-change feedback:** flip the Launchpad page with R8C8 while `osc-sniff` watches `:9000`. Pass = feedback
   for the new page's unique path arrives within 200 ms. Fail → fallback DEFAULT pad, `pageTracker` reduced to
   "show current part when seen".
2. **Keyboard paging:** `qlc-window.ps1 -Keys "{PGDN}"` flips the page with the browser in front, 10/10. Fail →
   dashboard shows the part but does not page.
3. **EFX on the Tempo dial:** attaching `Diamond` to the SpeedDial with ×8 changes its cycle on tap. Fail → Diamond
   stays fixed-speed; `Ceiling Step`/`Wall Chase` (chasers) still follow tempo.

## 8. Verification (done = all of these)

- `npx vitest run` green, `tsc` clean, `npm run generate`; punk show byte-identical.
- Rig: page to HORA → `Gold Blue Full` + `Ceiling Step` come on by themselves (or one DEFAULT press on fallback);
  `Wall Sweep` lands on the side walls only (watch the room, and the wire: truss pan never points into x ∈ [−10,10]
  per the fence script); `Entrance Hit` runs once and stops; `Drumroll` audibly accelerates; prism/gobo-spin return
  to 0 after any look.
- Dashboard shows the current part; ◀ ▶ page QLC+ if pre-check 2 passed.
- Console screenshot: 7-page frame, MINILAB at 8 sliders, nothing overlapped.

## Out of scope

Theme-colour picture tuning (F3); day-of head plot; raising the towers.
