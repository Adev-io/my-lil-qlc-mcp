# Console Layout + Show Runbook — Design

Bar mitzvah show, Saturday 2026-08-22. Builder: `scripts/build-party.ts`. Approved in-session 2026-08-21.

## Problem

On the show laptop (1536×960) the QLC+ Virtual Console runs off the screen: the `Move Speed`
slider sits at x≈1177 (cut at the right edge) and the whole MINILAB frame is at y 680–1040 /
x 805–1537 (below and right of the screen). Two twin buttons (OSC + MIDI) render on one spot and
the Blackout pair shows as a doubled label. Separately, the operator could not find head motion
because QLC+ was on the DINNER page (no motion by design) and only the visible page's pads — on the
Launchpad AND on the web dashboard — respond to input. Nothing documents that.

## 1. Layout (Virtual Console coordinates; target canvas 1500×820)

| Frame | X | Y | W | H | Contents |
|---|---|---|---|---|---|
| Pages (multipage grid) | 0 | 0 | 800 | 460 | unchanged: R1–R5 looks, R7 brightness (y 308), R8 utility (y 358) |
| FADERS | 805 | 8 | 444 | 380 | Pars L · Pars R · Truss · Banner (Playback) · Focus · Move Speed (Level), sliders **220** tall at y 16; Tempo dial (12, 248) and Fade dial (204, 248), 180×120 |
| TRUSS POSITION | 805 | 400 | 156 | 116 | Truss Home · Speaker Light |
| BANNER | 968 | 400 | 156 | 116 | Banner Home · Banner Off |
| MINILAB | 0 | 470 | 732 | 260 | F1–F4 twins · Gobo · Gobo Spin · Prism · Zoom · UV Wash · Warm Wash, sliders 220 tall at y 16, x = 12 + i·72 |

Max extent: x 1249, y 730. Slider height is one constant (`SLIDER_H = 220`) used by both slider
emitters; dial Y derives from it (`16 + SLIDER_H + 12`).

Twins: the MIDI twin of every pad is emitted with the same caption, X, Y, W, H, colours and font as
its OSC twin, so the pair renders as one button. (Both widgets stay — a QLC+ widget has one input
source.) If the Blackout pair still differs after that, the cause is found in the XML and fixed
there; the twin is never hidden (`Visible="False"` would stop it receiving input).

Tests (`tests/build-party.test.ts`): every top-level frame's `X+W ≤ 1500` and `Y+H ≤ 820`; no two
top-level frames overlap; every slider's `Y + Height ≤` its frame height; every OSC/MIDI twin
pair has identical `WindowState` geometry.

## 2. Verification by automation

A PowerShell helper `scripts/qlc-window.ps1` (Win32 `ShowWindow` + `SetForegroundWindow`, find by
process name `qlcplus`) restores and fronts the QLC+ window and can send a key chord. Steps the
controller runs after regenerating and relaunching:

1. Front QLC+, screenshot → `C:\Users\Arikl\Desktop\screenshots\vc-<ts>.png`; read it; confirm
   the FADERS/MINILAB/TRUSS/BANNER frames and all 16 sliders are visible, nothing clipped.
2. `Ctrl+F12` (Design mode), click the **Inputs/Outputs** tab by screen coordinate, screenshot the
   universe list showing universe 2 = `Minilab3`; `Ctrl+F12` back to Operate. If the tab cannot be
   reached by automation after two attempts, stop and ask the operator to check by hand (rabbit-hole
   rule).
3. MiniLab data path: ask the operator to move **F1** (Pars L) and **K3** (Gobo); sample the
   Art-Net wire (`raw-probe.mjs`) for par 1 ch0 rising above the dim row and truss ch6 changing.
   If nothing arrives: close QLC+, `./scripts/midi-learn.ps1 -Port Minilab3 -Seconds 45`, put the
   printed CCs into `rig.json` + `rigs/bar-mitzvah.rig.json` `controller2.cc`, regenerate, relaunch.
4. Dashboard: with Chrome tools open http://127.0.0.1:8788/dashboard, press a pad that belongs to
   the **visible** page and one that does not; confirm on the wire that only the first fires.

## 3. Report: "Running the show"

New section in the roadmap artifact (same URL), above the operator guide:

- **Start**: plug Launchpad + MiniLab first → `./start-show.ps1` → read the three launcher lines
  (`Launchpad MIDI index check OK`, `MiniLab MIDI index in=N`, `boot lit`) → Dim Full is lit, heads
  at ceiling home.
- **Pages**: R8C8 cycles INTRO → DINNER → SPEECHES → HORA → PARTY → INTRO; PgDn/PgUp on the keyboard
  do the same. **Only the visible page's pads answer — on the Launchpad and on the dashboard.**
  DINNER has no motion by design; head motion is row 3 on HORA and PARTY.
- **Rows**: R1 colours · R2 chases · R3 motion · R4 banner · R5 specials · R7 brightness · R8
  utility (Blackout, Panic, Banner, Tap, Strobe, —, Par Sound, Page).
- **MiniLab**: F1–F4 group intensity (push up only; Grand Master pulls down) · K1 Fade · K2 Speed ·
  K3 Gobo · K4 Spin · K5 Prism · K6 Zoom · K7 UV Wash · K8 Warm Wash.
- **Trouble**: pads dark → reseat Launchpad, rerun launcher; a control dead → `midi-learn`; rig
  possessed → launcher index lines; anything wrong → **Panic R8C2**, then **Blackout R8C1**.
- **Saturday**: measure doors `xFt` → `rig.json` → `npm run generate`; plot sheet →
  `movingHeadSettings` → regenerate (guard re-runs) → fire one look per page.

F14 evidence gains the wire reading from step 3 and flips from "hands-on check in progress" to
done; a new **F15** (console layout) is added and closed with the screenshot as evidence.

## Out of scope

A page-aware web dashboard (show only the visible page's pads, or switch page from the dashboard).
Real fix for the confusion; after Saturday.
