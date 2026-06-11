# Dynamic Scenes, Chasers & Pixel Looks — Design Spec

- **Date:** 2026-06-08
- **Show:** punk/alt-rock rig (`punk-rock-show.qxw`) — 10× Rainbow Smart 2 Pro, 4× COLORband T3-BT, 2× Intimidator 375Z
- **Status:** Approved — 14 looks (the 12 + Pars/Bars crossfade twins) — pending spec review → implementation plan
- **Generator:** all changes land in `scripts/build-show.ts` data tables + emitters, then `npx tsx scripts/build-show.ts` → `npm run generate:widgets`

## 1. Goal

Add **14 new live looks** to the existing show: 7 dynamic scenes (incl. 2 crossfade twins), 5 chasers, 2 pixel looks.
Everything fires from the Launchpad (MIDI + LED) and the MCP/dashboard (OSC) via the existing
**dual-button** model. Nothing existing is moved or changed; only free pads are used.

## 1a. Deltas from the chat-approved outline

- **Bar Pixel Run → Alt Flash** (chaser #9): the original "Bar Pixel Run" duplicated **Bar Scroll**
  (same 12 bar cells). Swapped for "Alt Flash" before sign-off — already shown when you approved.
- **Pixel Bounce scoped to the 10 pars** (was "ricochet across all 22 cells"): the 12 bar cells are
  now owned by **Bar Scroll** (RGBMatrix), so Pixel Bounce takes the par strip only. Cleaner split
  (Pixel Bounce = pars, Bar Scroll = bars). *Assumed accepted; say the word to restore the full 22.*
- **Auto looks = "both"** (per review): keep **Pars Auto** + **Bars Auto** (firmware programs, for the
  night) **and** add crossfade twins **Pars Morph** + **Bars Morph** (animate in virtual rehearsal).
  Dynamic-scene group grows 5 → 7; total 12 → 14; +2 pads (r6c3, r6c4).

## 2. Approach

Reuse the existing **Scene + Chaser** engine for 11 of 12 looks — they become new entries in the
`build-show.ts` data tables plus `addScene`/`addChaser`/`emitDualButton` calls. No new code paths,
so they ride the same generator that already load-tested clean.

**One deliberate exception:** the **Bar Scroll** pixel look needs QLC+'s **RGBMatrix** function type
+ a **FixtureGroup**. This is the only new XML emitter and gets its own load-test. EFX is explicitly
**not** used (head movement is done as crossfaded position chasers — smooth enough at distance, zero
new function type).

Channel maps (0-indexed within each fixture, from `build-show.ts`):
- **Rainbow par (10ch):** 0 Dim, 1 R, 2 G, 3 B, 4 W, 5 A, 6 UV, 7 Strobe, 8 Macro, 9 Speed
- **T3-BT bar (13ch):** 0–8 = 3 RGB cells, 9 Strobe, 10 AutoProg, 11 Speed, 12 Dim
- **375Z head (15ch):** 0 Pan, 2 Tilt, 5 Color, 6 Gobo, 7 GoboRot, 8 Prism, 9 Focus, 10 Dim, 11 Shutter, 14 Zoom
- Helpers reused: `parVal`, `parOff`, `barVal`, `barOff`, `headVal`, `washVals`, `splitVals`, `addScene`, `addChaser`, `emitDualButton`, `padCh`. Constants: `SHUTTER_OPEN=255`, `HEAD_COLOR.white=0`.

## 3. The 12 looks

| # | Group | Name | Type | Frame (solo) | Pad | LED | Fires |
|---|-------|------|------|------|-----|-----|-------|
| 1 | Dynamic | **Head Circle** | Chaser | HEADS | r7c0 | cyan | both heads glide a synced circle |
| 2 | Dynamic | **Audience Sweep** | Chaser | HEADS | r7c1 | blue | heads pan wide L↔R, tilt up, ping-pong |
| 3 | Dynamic | **Cross Zigzag** | Chaser | HEADS | r7c2 | magenta | heads crossed, zigzag fast |
| 4 | Dynamic | **Pars Auto** ⚠️ | Scene | WASH | r7c3 | green | 10 pars run built-in color program |
| 5 | Dynamic | **Bars Auto** ⚠️ | Scene | WASH | r7c4 | yellow | 4 bars run built-in chase program |
| 6 | Chaser | **Color Stab** | Chaser | WASH | r7c5 | magenta | full pars+bars hit → black, ~140ms |
| 7 | Chaser | **Kill Strobe** | Chaser | WASH | r7c6 | white | white burst pars+bars, ~60ms |
| 8 | Chaser | **Par Run L→R** | Chaser | WASH | r7c7 | pink | rainbow pixel wipes across 10 pars |
| 9 | Chaser | **Alt Flash** | Chaser | WASH | r4c6 | orange | odd pars / even pars alternate, ~120ms |
| 10 | Chaser | **Build & Drop** | Chaser | WASH | r4c7 | red | stack pars→peak→blackout drop |
| 11 | Pixel | **Pixel Bounce** | Chaser | WASH | r5c2 | pink | rainbow pixel ricochets across 10 pars (ping-pong) |
| 12 | Pixel | **Bar Scroll** | **RGBMatrix** | WASH | r5c3 | cyan | color scroll across the 12 bar cells |
| 13 | Dynamic | **Pars Morph** | Chaser | WASH | r6c3 | green | 10 pars crossfade through 6 colors (rehearsal twin of Pars Auto) |
| 14 | Dynamic | **Bars Morph** | Chaser | WASH | r6c4 | yellow | 4 bars crossfade through 6 colors (rehearsal twin of Bars Auto) |

All buttons use **Action = Toggle** (latching), like the existing chasers. Head looks live in the
**HEADS** SoloFrame (selecting one cancels a static head position); the rest in **WASH**.
⚠️ = hardware/rehearsal caveat — see §8.

## 4. Internal helper scenes (no pad, chaser fodder)

These are added via `addScene` but get **no button** — they only feed the chasers above.

**Head motion** (both heads unless noted; each lit `dim 255, shutter SHUTTER_OPEN, color HEAD_COLOR.white, gobo 0, focus 128, zoom 128`; pan/tilt are starting values, tuned live like the existing positions):
- `hCirc 1..6` — circle points (pan,tilt): (178,128) (153,171) (103,171) (78,128) (103,85) (153,85)
- `hSweep 1..3` — (pan,tilt): (70,95) (128,95) (186,95)
- `hCrossUp` — L(pan 175,tilt 105) R(pan 80,tilt 105); `hCrossDown` — L(175,150) R(80,150)

**Par pixels** `Par Px 1..10` — `parVal(parN, rainbow[N])`, all other pars `parOff`. `rainbow[N]` = 10-step
HSV→RGB sweep `[r,g,b,0,0,0]` (red→orange→yellow→green→cyan→blue→indigo→violet→magenta→pink). Shared by
**Par Run** (Forward) and **Pixel Bounce** (PingPong).

**Alt flash** `Pars Odd` — pars idx 0,2,4,6,8 = white `[0,0,0,255,0,0]`, rest off; `Pars Even` — idx 1,3,5,7,9 white, rest off.

**Stab/strobe/build:**
- `Stab Hit` — all pars `[255,0,255,0,0,0]` + all bars `[255,0,255]`
- `White Hit` — all pars `[0,0,0,255,0,0]` + all bars `[255,255,255]`
- `Bld 1..4` — pars 0–1 / 0–3 / 0–6 / 0–9 lit red `[255,0,0,0,0,0]`, rest off; `Bld Peak` — all pars white + all bars white
- `PB Off` — all pars `parOff` + all bars `barOff`, **fade 0** (the shared "black"/drop step; pars+bars only, leaves heads alone — distinct from `Park All`, which parks heads and fades 600)

**Color morph (crossfade twins):**
- `Par Wash 1..6` — all 10 pars `parVal(color)`, no bars. Palette `[r,g,b,w,a,uv]`: Magenta `[255,0,255,0,0,0]`, Cyan `[0,255,255,0,0,0]`, Amber `[0,0,0,0,255,0]`, Green `[0,255,0,0,0,0]`, Blue `[0,0,255,0,0,0]`, Red `[255,0,0,0,0,0]`.
- `Bar Wash 1..6` — all 4 bars `barVal(rgb)`, pars untouched. Palette `[r,g,b]`: `[255,0,255] [0,255,255] [255,90,0] [0,255,0] [0,0,255] [255,0,0]`.

## 5. Chaser definitions (`addChaser(name, stepNames, hold, fade, direction, runOrder)`)

| Top-level | Steps | hold | fade | dir | runOrder |
|---|---|---|---|---|---|
| Head Circle | hCirc 1..6 | 150 | 600 | Forward | Loop |
| Audience Sweep | hSweep 1,2,3 | 100 | 700 | Forward | PingPong |
| Cross Zigzag | hCrossUp, hCrossDown | 280 | 120 | Forward | Loop |
| Par Run L→R | Par Px 1..10 | 110 | 0 | Forward | Loop |
| Pixel Bounce | Par Px 1..10 | 80 | 40 | Forward | PingPong |
| Alt Flash | Pars Odd, Pars Even | 120 | 0 | Forward | Loop |
| Color Stab | Stab Hit, PB Off | 140 | 0 | Forward | Loop |
| Kill Strobe | White Hit, PB Off | 60 | 0 | Forward | Loop |
| Build & Drop | Bld 1,2,3,4, Bld Peak, PB Off | 200 | 0 | Forward | Loop |
| Pars Morph | Par Wash 1..6 | 0 | 1100 | Forward | Loop |
| Bars Morph | Bar Wash 1..6 | 0 | 950 | Forward | Loop |

## 6. Scene definitions for the 2 auto looks

- **Pars Auto** — all pars: `ch0=255` (dim), `ch8=200` (Macro/program ⚠️), `ch9=180` (Speed ⚠️). Pars only.
- **Bars Auto** — all bars: `ch12=255` (dim), `ch10=100` (AutoProg ⚠️), `ch11=200` (Speed ⚠️). Bars only.

⚠️ program/speed values are first-guesses; confirm against each light's menu on first plug-in (§8).

The **crossfade twins** (Pars Morph / Bars Morph, §5) are the rehearsal-safe counterparts — they
animate in QLC+'s Monitor with no hardware. Per the "both" call, the auto scene **and** its twin ship.

## 7. Bar Scroll — RGBMatrix + FixtureGroup (the one new emitter)

Add to `build-show.ts`:

1. **`<FixtureGroup>`** element in the Engine section — the 4 bars as a horizontal pixel canvas.
   - Each T3-BT exposes 3 cells. Place left→right: bar1 cells, bar2 cells, …
   - Grid `Size X=12 Y=1` if the fixture def gives **3 heads**; otherwise `X=4 Y=1` (4 px, one per bar).
2. **`<Function Type="RGBMatrix">`** referencing that group: a scrolling/stripe built-in algorithm,
   start/end colors, `Speed Duration≈400`, `Direction=Forward`, `RunOrder=Loop`. Register it in
   `funcIdByName` so its dual button resolves.
3. Dual button (pad r5c3, frame WASH, Toggle) via the existing `emitDualButton` — unchanged path.

**Pin exact tag names at build time** from `qlcplus/engine/src/rgbmatrix.cpp` (`saveXML`) and
`fixturegroup.cpp` (`saveXML`) — element/attr spelling (`<Algorithm Type=…>`, `<MonoColor>` vs
`<StartColor>/<EndColor>`, `<Head X= Y= Fixture= Head=>`, `<FixtureGroup>` id reference) must match
the 4.x loader, not be guessed.

## 8. Hardware & rehearsal caveats

- **Pars Auto / Bars Auto won't animate in virtual rehearsal.** Built-in auto programs live in the
  fixture firmware; QLC+'s Monitor/virtual rig has none, so these two look **static** until the real
  lights are connected, and their `Macro/AutoProg/Speed` values (§6) are unverified. **Covered:** the
  crossfade twins **Pars Morph / Bars Morph** (§5) animate everywhere, so rehearsal isn't blocked; the
  auto scenes still ship for the night.
- **Bar Scroll pixel count** depends on `Chauvet-COLORband-T3-BT.qxf` exposing **3 `<Head>`** entries.
  Verify; if it exposes none, the matrix is 4 px (one per bar) until the def gains heads — note in
  `SHOW-SETUP.md`, do not block on it.
- Head pan/tilt values share the existing **placeholder** fate — fine-tuned once stage geometry / the
  real rig is present (`STAGE-SETUP.html`).

## 9. Verification

1. **CRC golden test** — generator still asserts `crc16("123456789")==0x906E`.
2. **Generator runs clean** — `npx tsx scripts/build-show.ts` writes the 3 artifacts with no throw
   (chaser step-name resolver catches typos).
3. **Parse round-trip** — `npm run generate:widgets` → `config/widgets.json` grows **49 → 63** looks
   (14 new OSC buttons); `npm test` green.
4. **Dashboard** — `qlc_list_widgets` returns 63; the 14 new looks appear in the Control grid.
5. **Load test (QLC+ 4.14.4)** — open `punk-rock-show.qxw`; confirm each of the 14 fires from its
   pad and OSC button, LED glows, HEADS looks solo against static positions. **Extra attention on
   Bar Scroll** (RGBMatrix + FixtureGroup render) and the head-motion smoothness.

## 10. Out of scope

- No EFX/Collection function types (head motion is crossfaded chasers).
- No change to existing 49 looks, the I/O map, fixtures, or the dual-button/CRC model.
- No new MCP tools, transport, or dashboard logic — new looks are picked up automatically.
- Real-hardware tuning (auto-program values, head aim, node IP) handled in `SHOW-SETUP.md`, not here.
