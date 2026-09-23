# Cuepix + QLC+ show setup

## Rig and physical order

- Truss 2: Cuepix 1-2, bottom to top.
- Truss 3: Cuepix 4-3, bottom to top.
- Beam L / Beam R (Intimidator Beam 140SR, 14-channel mode) mount on the inside 8 ft trusses 2 and 3.
- 375ZX L / 375ZX R (15-channel mode) mount on the outside 4 ft trusses 1 and 4, with the Cuepix stacks.
- All Cuepix panels use 79-channel mode (the units report 75; addressing is unaffected).
- Maximum 4 panels per Elation rigging bar; each panel gets an independent safety cable; never daisy-chain safety cables.
- Maximum 2 Cuepix panels power-linked at 120 V.
- Mover pads are live from the first launch with pre-plot defaults, all at or above horizontal; capture real aims on plot night, then regenerate.

## Lighting LAN

- Use a dedicated unmanaged Ethernet switch. Connect QLC+ computer, CR011R, and all 4 Cuepix panels.
- Computer lighting NIC: static `10.201.6.1`, mask `255.255.255.0`, no gateway. Disable sharing and bridging.
- Pknight CR011R: `10.201.6.100`; Art-Net Universe 0 to its DMX output.
- Cuepix 1, 2, 3, 4 receive Art-Net Universe 0.
- Panels: Service PIN `050`, Network Switch `ON`, Protocol `ArtNet` (per-panel menu).
- Set panel addresses from `CUEPIX-PATCH-CHART.md`.
- CR011R DMX OUT → Beam L at 317 → Beam R at 331 → 375ZX L at 345 → 375ZX R at 360 → DMX terminator.
- Cuepix panels receive Ethernet directly. Do not add them to the CR011R DMX chain.

## First install

1. Install QLC+ 4.14.x. Do not use QLC+ 5 for this show.
2. Close QLC+.
3. Run `powershell.exe -NoProfile -File .\start-cuepix.ps1 -InstallOnly`.
4. Start QLC+ once, close it, then reconnect the controller.

## Normal launch

1. Connect the Novation Launchpad Mini MK3 before opening QLC+.
2. Confirm Windows exposes `MIDIIN2 (LPMiniMK3 MIDI)` and `MIDIOUT2 (LPMiniMK3 MIDI)`.
3. Run `powershell.exe -NoProfile -File .\start-cuepix.ps1`.
4. Launcher creates `cuepix-panel-show.runtime.qxw`, resolves current WinMM indexes, puts Launchpad in Programmer Mode, starts QLC+, MCP, and 3D monitor.
5. MCP/dashboard: http://127.0.0.1:8788/dashboard
6. 3D monitor: http://127.0.0.1:7800

If Launchpad is absent, launcher removes MIDI routes from runtime copy. QLC+ Virtual Console and MCP remain usable. To force this mode, add `-DisableLaunchpad`. QLC+ MIDI feedback owns pad LEDs; `LAUNCHPAD_LEDS` stays `0`.

## Virtual Console and Launchpad

- Page 1: full Cuepix colors, pixel patterns, chasers, fades, strobes, burst, levels, speed, tap, blackout, stop, white flash, page switch.
- Page 2: compact Cuepix controls plus the HEAD rows — colours R3, aims + shutter R6.
- Page 3: MOVERS. R1-R4 = 28 mover looks + HOLD at R4C8 (one solo frame: one look at a time; floor, then room, then ceiling). R5 head colours. R4C5-C6 HIT FLOOR/HIT UP (stops the look and snaps every beam to one spot until the next look). R6 layers that never stop the look: C1-C3 GOBO OPEN/A/B, C4 PRISM, C5 BM OPEN, C6 SP OPEN, C7 HD OPEN, C8 HD STROBE.
- Page 1 R6: pixel effects (FILL DRAIN, RAIN, TWINKLE, PLASMA, GAP SWEEP, V COMET, CHEVRONS, APEX PULSE) + R5C8 FIRE, in the panel FX solo frame. Two speed dials: FX Speed (panels, TAP) and Mover Speed (movers).
- Page 1 R5C7: FLOOR FULL (whole panel floor white). Load-in: fire BANDS and set cuepix.pixelOrigin if band 1 is not the top row.
- R7C1-R7C4: 25%, 50%, 75%, Full. R7C5-R7C7: Slow, Medium, Fast. R7C8: Tap.
- R8C1: Blackout. R8C2: Stop FX. R8C3: White. R8C5: Flash. R8C8: Page.
- Use visible `FX Speed` dial for exact speed. Use QLC+ Grand Master for overall output.
- No Cuepix dimmer or strobe DMX Level slider exists. Such sliders would seize channels from scenes and pads.

### MiniLab 3

F1-F4 = dimmers of 375ZX L · Beam L · Beam R · 375ZX R — raise all four before doors. PLOT MODE: K1-K4 tilt, K5-K8 pan of the same heads. Plot, write the captures into the rig, set controller2.plotMode false and regenerate before the show. Port `Minilab3 MIDI`; the launcher binds it at start.

## Test gate — routing before performance

1. Expand collapsed `SETUP · ROUTING TESTS` in Virtual Console.
2. Power one Cuepix only. Test its Red, Green, Blue, White, and Blackout buttons.
3. Repeat for Cuepix 1-4, one fixture at a time.
4. Test Universe 0 Panels White, then All Blackout.
5. Test Beam L, Beam R, 375ZX L and 375ZX R one at a time through CR011R.
6. Collapse setup controls. Test grouped solids, patterns, fades, chasers, levels, strobe, stop, flash press/release, and blackout.
7. Test Launchpad page switch and LED feedback. Compare both universes against 3D monitor.
8. Perform mover calibration last. Stop if any wrong fixture, universe, address, direction, or unsafe aim appears.

## Art-Net numbering warning

Workspace maps QLC+ Universe ID 0 → Art-Net universe 0. Some device screens label these 1 and 2. Match wire values, not display wording.
