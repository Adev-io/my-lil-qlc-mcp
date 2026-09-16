# Two-Show Weekend — Bar Mitzvah (Fri 2026-09-18) + Homecoming (Sat 2026-09-19)

Design approved 2026-09-15. Two QLC+ 4.14 shows prepared in parallel, in two git worktrees,
with no merge before the weekend. Both run through the QLCPlus-MCP stack (OSC MCP server,
dashboard, Three.js 3D monitor from Art-Net), Launchpad Mini MK3 for looks, Arturia MiniLab 3
for movement.

## 0. Ground rules

- **Never lose work.** Every branch gets a WIP snapshot commit before any edit. Timestamped zips
  of all three worktrees already exist at `~/dev/qlcplus-mcp/_backups/20260915-212525/`.
- **The show is generated.** Edit `rig.json` / the generator, run the generator. Never hand-edit
  a `.qxw` or save over it in QLC+.
- **QLC+ 4.14.x only.** Stock fixture library at `C:\QLC+4\Fixtures`. User fixtures at
  `C:\Users\Arikl\QLC+\Fixtures`.
- **One stack at a time.** Both worktrees use ports 8788 / 7800 / 9000 / 9999. Stop one show
  before launching the other.
- **Show runs from the worktree you launch from.** Desktop shortcuts must point at the right one.

## 1. Branch layout

| Show | Worktree | Branch | Forked from | Launcher |
|---|---|---|---|---|
| Fri bar mitzvah | `QLCPlus-MCP/.claude/worktrees/barmitzvah-0918` (new) | `feat/barmitzvah-0918` | `feat/party-pads-pages` @ its WIP snapshot | `start-show.ps1` |
| Sat homecoming | `QLCPlus-MCP/.claude/worktrees/cuepix-setup` (existing) | `feat/cuepix-qlcplus` | — | `start-cuepix.ps1` |

Snapshot commits, in order, before anything else:
1. `party-pads-pages`: commit the uncommitted 8/29 plot-night edits (`bar-mitzvah-party.qxw`,
   `build-party.ts`, tests, manual, patch chart, widgets) as `chore: snapshot 2026-08-29 plot-night state`.
2. `cuepix-setup`: commit the uncommitted 9/9 edits (four-truss monitor, speed presets, Grand
   Master all-channels, launcher) as `chore: snapshot 2026-09-09 cuepix test-night state`.
3. Fork `feat/barmitzvah-0918` from the `party-pads-pages` snapshot into a new worktree.

The stale `.bak` / `.midibak` / `.floorbak` files stay untracked and untouched.

## 2. Friday — bar mitzvah rig

One DMX universe out of the Pknight CR011R (Art-Net U0 → DMX). No Art-Net panels.

| Group | Model | Mode | DMX | Physical |
|---|---|---|---|---|
| Rainbow Par 1-10 | Rainbow Lights Smart 2 Pro RGBWA+UV | 10ch | 1, 11, 21 … 91 | floor, uplighting back wall behind stage |
| Truss L / R | Chauvet Intimidator Spot 375ZX | 15ch | 101, 116 | top of inside trusses 2 and 3 |
| Outer L / R | Chauvet Intimidator Beam 140SR V2 | 14ch | 131, 145 | top of outside trusses 1 and 4 |

Trusses: four 8 ft trusses in a line along the back of the stage, 32 ft total, centred.
Head x positions at truss centres: Outer L −12, Truss L −4, Truss R +4, Outer R +12 ft.
Head lens height 8 ft (`stage.headHeightFt`). Plot night corrects x and z per head.

### rig.json changes (Friday worktree)
- `fixtures[Truss]`: model `Intimidator Spot 375ZX`, addresses `[100, 115]` (0-based). Unchanged
  otherwise, including the ZX colour-wheel override.
- `fixtures[Floor]` → renamed `Outer`, model `Intimidator Beam 140SR V2`, mode `14 Channel`,
  channels 14, addresses `[130, 144]`, `mount: "truss"`, x offsets ±12. Its `beam` block uses the
  140SR pan 540° / tilt 270° ranges; `colorWheel` from the Beam 140SR manual (white 0, red 8,
  yellow 16, green 24, blue 32, amber 40, cyan 48, magenta 56, rainbow 190+ — verify on site).
- `headSafety`: wide defaults (pan 0–255, tilt 0–128) keyed by the new addresses. Captured on
  site by `capture-head.mjs`, then regenerated.
- `controller2` (MiniLab 3, port `Minilab3 MIDI`) unchanged: K1-K4 tilt, K5-K8 pan, one knob
  pair per head, order Outer L, Truss L, Truss R, Outer R.
- `doors`, `banner`, room rects: keep, mark as "re-measure Friday".

### build-party.ts changes
- Second head group is selected by `namePrefix` `Outer` (was `Floor`). Same code path: own
  knobs, own aims, own fences.
- Outer pair geometry: truss-mounted at `stage.headHeightFt`, not floor cross-shoot. Floor-only
  aim logic (banner cross-shoot) is dropped for this rig, not deleted from the generator.
- One per-model channel map, chosen by fixture model:

  | role | 375ZX 15ch | Beam 140SR 14ch |
  |---|---|---|
  | pan / tilt | 0 / 2 | 0 / 2 |
  | pt speed | 4 | 4 |
  | colour | 5 | 5 |
  | gobo | 6 | 6 |
  | gobo rot | 7 | — |
  | prism | 8 | 7 |
  | focus | 9 | 8 |
  | dim | 10 | 9 |
  | shutter | 11 | 10 |
  | frost | — | 11 |
  | zoom | 14 | — |

  Value builders (`headVal` / the outer-pair builder) write through the map. Knobs and sliders
  for roles a model lacks (zoom, gobo rot on 140SR) are omitted for that fixture, never mapped to
  a wrong channel.
- Shutter-open and dimmer-full values for the 140SR from its manual.
- Everything else (7 party pages, colour pads, Reset pad R5C6, Launchpad row grammar, MiniLab
  faders/pads/keys) unchanged.

### Fixture definitions
- 375ZX and Rainbow par: already installed in `C:\Users\Arikl\QLC+\Fixtures`. The installed
  Rainbow par def (2,106 B, 2026-06-09) is older than the worktree copy (2,157 B). Diff, install
  the worktree copy if it differs materially.
- Beam 140SR V2: stock `C:\QLC+4\Fixtures\Chauvet\Chauvet-Intimidator-Beam-140SR-V2.qxf`. No
  custom file.

## 3. Saturday — homecoming rig

Applies the revision approved in the 9/10 Codex session (bookmark
`Desktop\Road Map\.codex\bookmarks\20260910-180620-cuepix-rig-revision.json`).

| Fixture | Mode | Universe | DMX (1-based) | Physical |
|---|---|---|---|---|
| Cuepix 1-4 | 79ch (units report 75; addressing unaffected) | Art-Net U0 (Ethernet direct) | 1, 80, 159, 238 | truss 2, stacked bottom→top |
| Cuepix 5-8 | 79ch | Art-Net U1 (Ethernet direct) | 1, 80, 159, 238 | truss 3, stacked bottom→top |
| Beam 140SR 1 / 2 | 14ch | U0 via CR011R DMX OUT | 317, 331 | above truss 2 / truss 3 |
| 375ZX L / R | 15ch | U0 via CR011R DMX OUT | 345, 360 | top of 4 ft trusses 1 / 4 |

Trusses L→R: 4 ft · 8 ft · 8 ft · 4 ft. DMX chain: CR011R OUT → 140SR 1 → 140SR 2 → 375ZX L →
375ZX R → terminator. Panels on Ethernet only, never in the DMX chain.

### rig.json changes (`rigs/cuepix-panel.rig.json`)
- Panel groups: count 4 each, addresses `[0, 79, 158, 237]`.
- `cuepix.trusses`: `[[], [1, 2, 3, 4], [5, 6, 7, 8], []]`. Empty outer trusses still render as
  4 ft trusses carrying a head.
- New head group `Beam` (Intimidator Beam 140SR V2, 14ch, addresses `[316, 330]`, universe 0).
- 375ZX group addresses `[344, 359]`.
- `cuepix.moversCalibrated`: stays `false` until plot night; pads render enabled once captured.
- Add `controller2` (MiniLab 3) copied from the party rig. Knob order: 375ZX L, Beam 1, Beam 2,
  375ZX R.
- Add `headSafety` with wide defaults keyed by address.

### build-cuepix-show.ts / build-monitor.ts changes
- Panel count and universe split read from the rig, not the hardcoded 12 / `[[1,2],[3,4,5,6],…]`.
- Head groups iterate every `kind: "head"` group with the same per-model channel map as §2.
- Movers page (page 2): per-head aim pads (Home, Centre, Crowd, Crossed) as one-shot Go chasers;
  head colour pads (full-spectrum palette, wheel values per model); shutter open/strobe; a
  Reset pad. Enabled by `moversCalibrated`.
- MiniLab universe 2: K1-K4 tilt, K5-K8 pan, fenced; faders = Cuepix level + FX speed twins.
- Monitor: two 4-high towers on trusses 2 and 3, four heads at their truss x, 8 ft up.

### start-cuepix.ps1
- Lift the MiniLab resolve-and-repair step from `start-show.ps1` (match `Minilab3 MIDI` by name,
  rewrite the universe-2 index in the runtime .qxw).

### Docs
- Regenerate `CUEPIX-PATCH-CHART.md`, `CUEPIX-SETUP.md` (8 panels, new chain).
- Update `Desktop\Road Map\cuepix-qlcplus-roadmap.md` and the `.html` roadmap to the 8-panel
  scope, per the bookmark's pending work (backup both first, read back, verify no "Cuepix 9-12").

### Hardware carry-over from 9/9
Panels 9 and 11 were faulty; the rig now uses 8 physical units. Confirm which 8 units go up and
that 8 and 10 (fuses replaced) are among the good ones.

## 4. Controllers, launchers, monitor

- **Launchpad Mini MK3**: second MIDI port (`MIDIIN2 (LPMiniMK3 MIDI)` / `MIDIOUT2`),
  Programmer Mode. Launcher repairs the winmm index every start, gated on the .qxw.
- **MiniLab 3**: port `Minilab3 MIDI`, input universe 2. Launcher resolves by name.
- **Shortcuts**: `Desktop\QLC+ FRI Bar Mitzvah.lnk` → Friday worktree `start-show.ps1`;
  `Desktop\QLC+ SAT Homecoming.lnk` → cuepix worktree `start-cuepix.ps1`. Existing `QLC+ MCP.lnk`
  renamed `QLC+ MCP (old punk).lnk`.
- **Art-Net**: USB-Ethernet adapter direct into a laptop port, NIC static 10.201.6.1/24,
  CR011R at 10.201.6.100. Never through the controller hub.
- **3D monitor**: each worktree's `monitor/` renders its own rig from Art-Net on the wire.

## 5. Plot night (each venue)

1. Adapter direct, ping CR011R, confirm the blue data LED.
2. Routing gate: one fixture at a time (White / Blackout), then groups, then All.
3. `capture-head.mjs` per head → `headSafety` + named positions into rig.json → regenerate →
   relaunch.
4. Drag fixture positions in the 3D monitor to the measured x/z, save to rig.json.
5. Console screenshot + monitor screenshot to `Desktop\screenshots`.

## 6. Verification (per show, before "done")

1. `npx vitest run` green in that worktree.
2. Generator runs clean; the .qxw loads in QLC+ 4.14 with no `*` in the title.
3. Monitor shows every fixture at its address. White All lights everything. Each per-head aim
   moves only its head. Each MiniLab knob moves only its head, within the fence.
4. Launchpad pad fires the look and lights the pad LED; page flip works.
5. Screenshots of console and monitor saved to `Desktop\screenshots`.

## 7. Order of work

1. Snapshot commits (§1). 2. Friday worktree + rig + generator + regenerate + verify (Wed).
3. Saturday rig + generator + regenerate + verify (Thu). 4. Shortcuts. 5. Docs and roadmap.
Plot nights on site Fri / Sat.

## 8. Out of scope

Merging either branch to `main`. Fixing the punk-show regression on `feat/nx-touch`. The
open `qlc-show-manuals-audit` findings (manual prints 3 of 7 pages) unless time remains Thursday.
