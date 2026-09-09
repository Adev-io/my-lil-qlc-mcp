# Cuepix Group Show, Launchpad, and QLC+ MCP Design

**Date:** 2026-09-08
**Status:** Approved in brainstorming; awaiting written spec review
**Scope:** 12 Elation CUEPIX Panels, two Chauvet Intimidator Spot 375ZX fixtures, QLC+ 4.14.x, QLC+ MCP/dashboard, Novation Launchpad Mini MK3, Pknight CR011R, and existing dual-universe 3D monitor.

## Goal

Turn the validated Cuepix routing workspace into a two-page performance show. Operators control all 12 Cuepix panels as one instrument from either QLC+ Virtual Console, Launchpad Mini MK3, or MCP/dashboard. Preserve independent fixture patching underneath so chasers can follow physical position and the 3D monitor can render every panel.

Routing tests remain available for setup. Production functions do not unlock moving-head output until physical pan/tilt calibration passes.

## Physical layout and patch

Physical order is left to right:

```text
Truss 1                 Truss 2        Truss 3        Truss 4
[375ZX L][Cuepix 1-3]   [Cuepix 4-6]   [Cuepix 7-9]   [Cuepix 10-12][375ZX R]
```

QLC+ fixture patch remains unchanged:

| QLC+ universe | Wire output | Fixtures and human DMX starts |
|---:|---|---|
| 0 | Art-Net 0 | Cuepix 1-6 at 1, 80, 159, 238, 317, 396; CR011R to 375ZX L at 481 and R at 496 |
| 1 | Art-Net 1 | Cuepix 7-12 at 1, 80, 159, 238, 317, 396 |
| 2 | MIDI input/feedback | Launchpad Mini MK3 Programmer port |

Computer lighting NIC remains `10.201.6.1/24`, no gateway. CR011R remains `10.201.6.100/24`, Art-Net Universe 0 to physical DMX. Cuepix panels receive Art-Net directly over Ethernet in 79-channel mode. The CR011R DMX chain contains only both 375ZX fixtures and a 120-ohm terminator.

## Control architecture

One generated QLC+ function is the authority for each logical control. Virtual Console, Launchpad, and MCP/dashboard invoke those same functions.

- QLC+ Universe 0 has OSC input/feedback plus Art-Net Universe 0 output.
- QLC+ Universe 1 has Art-Net Universe 1 output.
- QLC+ Universe 2 has Launchpad MIDI input and feedback.
- Each MCP-visible control has an OSC button on input Universe 0.
- Each Launchpad control has a MIDI twin on input Universe 2.
- `config/cuepix-widgets.json` is regenerated from the OSC buttons. MIDI twins are excluded from MCP discovery.
- The launcher sets `QLC_WIDGETS_FILE=config/cuepix-widgets.json`, preserving other shows' widget maps.
- QLC+ owns Launchpad MIDI feedback directly. The optional MCP RGB SysEx sidecar stays disabled because this QLC+ runtime previously failed to emit dependable OSC feedback.
- The launcher enters Launchpad Programmer Mode before QLC+ opens MIDI ports.

QLC+ functions use three operating layers:

1. **Base layer:** one active solid color or multicolor pattern.
2. **FX layer:** one active chase, fade, or latched strobe. `STOP FX` selects an empty FX function so the base layer remains visible.
3. **Momentary layer:** `FLASH` and burst controls run only while held, then reveal the previous base/FX state.

Intensity functions write master-dimmer channels only. Strobe functions write strobe channels only. This prevents a strobe from replacing selected RGB content. Blackout overrides all layers and closes mover shutters.

## Cuepix grouping and content

No performance control targets one Cuepix panel as an operator choice. Independent addressing exists only for generated pattern steps and the collapsible routing-test frame.

### Base solids

All panels display the same color: red, amber, yellow, green, cyan, blue, purple, or white.

### Multicolor patterns

All panels act as one synchronized visual system:

- rainbow;
- red/blue split;
- green/magenta split;
- checkerboard;
- horizontal or vertical bands;
- synchronized 5x5 pixel pattern;
- color wave;
- deterministic pseudo-random pixels.

The generator uses fixed pattern data. No runtime random source is needed, so the 3D monitor and hardware repeat the same look.

### Chasers

- left to right follows panels 1 through 12;
- right to left follows panels 12 through 1;
- center out starts at panels 6 and 7 and mirrors outward;
- outside in starts at panels 1 and 12 and mirrors inward;
- truss step activates `1-3`, `4-6`, `7-9`, then `10-12`;
- bounce traverses left to right and back without repeating endpoints;
- snake traverses all 25 pixels inside every panel in synchronization;
- rainbow chase shifts color through panel order.

### Fades and strobes

Fade functions include group color cycle, white breathe, selected-color dim breathe, fixed crossfade, pastel cycle, and gradient shift. Strobes include slow, medium, fast, panel chase, wave, and momentary burst. Speed presets and tap tempo drive chasers and fades. Strobe-rate control remains separately available in Virtual Console.

## Two-page operator layout

Both QLC+ Virtual Console pages mirror the Launchpad 8x8 grid. Every on-screen caption includes its physical coordinate, such as `RAINBOW R2C1`. Buttons use matching background and Launchpad LED colors. Idle pads are dim; active pads are bright.

### Page 1: full Cuepix group

- Row 1: eight solid colors.
- Row 2: eight multicolor patterns.
- Row 3: eight chasers.
- Row 4: six fades plus two reserved pads.
- Row 5: six strobe/burst functions plus two reserved pads.
- Row 6: reserved.
- Row 7: intensity 25/50/75/full; speed slow/medium/fast; tap tempo.
- Row 8: blackout, stop FX, white, reserved, momentary flash, two reserved pads, page cycle.

### Page 2: compact Cuepix plus movers

- Row 1: Cuepix essential colors and blackout.
- Row 2: Cuepix rainbow, checker, bands, pixels, left/right chases, fade, and breathe.
- Row 3: mover colors, gobo, and prism after calibration unlock.
- Row 4: mover home/positions and movement after calibration unlock.
- Row 5: left beam, right beam, both beams, open, three dim presets, and mover strobe after calibration unlock.
- Row 6: reserved.
- Rows 7 and 8: same intensity, speed, tap, safety, and page locations as Page 1.

`R8C8` cycles Page 1 and Page 2. Same utility placement on both pages provides dark-room muscle memory.

## Dynamic Virtual Console

Virtual Console contains:

- one two-page multipage frame matching the Launchpad;
- persistent Cuepix intensity, mover intensity, FX speed, strobe rate, and tap-tempo controls;
- a small four-truss diagram showing fixture order and outside mover placement;
- active-state feedback through QLC+ buttons;
- a collapsed `SETUP / CALIBRATION` frame with individual fixture routing tests.

The routing frame is not mapped to Launchpad and is not exported as normal performance controls in `config/cuepix-widgets.json`.

## Moving-head safety gate

Both 375ZX fixtures are mounted on outside trusses. No production button opens their shutters, changes color/gobo, or starts movement before physical calibration.

Initial Page 2 mover pads appear disabled in Virtual Console and remain dark/unmapped on Launchpad. Routing tests remain available for supervised one-fixture checks. Calibration records safe home, position A/B/C, pan/tilt fences, and mirrored movement ranges in rig data. Regeneration then enables mover functions. No fixture movement macro is used because firmware macros cannot honor stage safety fences.

The launcher performs no automatic mover motion. Startup keeps both shutters closed.

## Launch and plug-and-play behavior

`start-cuepix.ps1` becomes the one operator entry point:

1. Verify/install both QXF files by SHA-256.
2. Validate or optionally configure the isolated lighting NIC.
3. Detect exact Mini MK3 ports `MIDIIN2 (LPMiniMK3 MIDI)` and `MIDIOUT2 (LPMiniMK3 MIDI)` through WinMM.
4. Copy the deterministic generated QXW to a writable runtime file.
5. Patch only the runtime copy with current MIDI indexes.
6. If Launchpad is absent, remove/disable runtime MIDI input instead of binding another Windows MIDI device; continue safely with Virtual Console.
7. Enter Programmer Mode when Launchpad is present.
8. Start the dual-universe 3D monitor.
9. Start QLC+ in Operate mode with the runtime QXW.
10. Start one HTTP MCP/dashboard process.
11. Verify monitor HTTP, MCP HTTP, QLC+ process, and recent Art-Net frames on Universes 0 and 1.

Timestamped backups precede replacement of any existing runtime file. The launcher never edits the versioned generated QXW or another show. Re-running does not start duplicate QLC+, monitor, or MCP instances.

## Generated files and focused changes

Modify existing Cuepix files rather than adding another show generator:

- `scripts/build-cuepix-show.ts` generates performance functions, two-page Virtual Console, OSC/MIDI mappings, widget map input, patch chart, and setup guide.
- `rigs/cuepix-panel.rig.json` gains physical truss grouping, controller settings, and a closed-by-default mover calibration gate.
- `tests/cuepix-build.test.ts` verifies group semantics, function layering, pages, and mappings.
- `start-cuepix.ps1` gains safe runtime-copy, MIDI-port, MCP, and readiness logic.
- `tests/cuepix-launcher.test.ts` verifies launcher safety and fallback contracts.
- Generated `cuepix-panel-show.qxw`, `CUEPIX-PATCH-CHART.md`, `CUEPIX-SETUP.md`, and `config/cuepix-widgets.json` are refreshed.

Existing fixture definitions and dual-universe monitor code stay unchanged unless a failing regression test proves a required correction.

## Verification

### Automated

- Generated QXW parses as XML and contains 14 fixtures.
- Art-Net outputs remain wire Universes 0 and 1.
- Launchpad input/feedback uses QLC+ Universe 2.
- Two Virtual Console pages contain no duplicate MIDI pad on the same page.
- Every performance Cuepix base function targets all 12 panels.
- Chaser steps follow panel and four-truss order exactly.
- Intensity, RGB, and strobe layers write only their owned channels.
- `STOP FX` preserves the base layer contract.
- `FLASH` uses momentary action.
- Page 2 mover functions remain absent from MIDI/function mapping while calibration is locked.
- OSC widget paths are unique and `config/cuepix-widgets.json` resolves every performance control.
- Launcher patches a runtime copy, never source QXW.
- Missing Launchpad disables MIDI safely.
- Existing dual-universe monitor, fixture-definition, party-show, and MCP tests retain current behavior.
- TypeScript build completes.

### Runtime preview

- QLC+ opens the runtime show in Operate mode.
- Monitor receives fresh frames on Art-Net Universes 0 and 1.
- Browser monitor renders 12 Cuepix panels and two heads.
- MCP `/mcp` transport and dashboard respond on port 8788.
- Launchpad page change, one base look, one chase, one fade, one strobe, stop FX, flash release, and blackout work end to end when device is connected.

### Hardware gate

Before production use: validate each Cuepix individually, each universe, CR011R output, each 375ZX, group playback, blackout, Art-Net loss, and 3D monitor agreement. Then perform mover pan/tilt calibration and regenerate to unlock Page 2 mover functions.

## Deliberate limits

- No audio-reactive mode.
- No fixture firmware movement macros.
- No new runtime dependency.
- No per-panel performance buttons.
- No production mover output before calibration.
- No edits to existing punk or bar-mitzvah show artifacts.

## Sources

- Elation CUEPIX Panel product page and DMX Traits version 3.
- Chauvet DJ Intimidator Spot 375ZX User Manual Rev. 1.
- Pknight CR011R manual.
- QLC+ 4.14 Virtual Console, function, MIDI, OSC, and Art-Net behavior represented by existing generated shows and tests in this repository.
- Existing Mini MK3 Programmer Mode, MIDI-index repair, multipage mapping, and direct QLC+ MIDI-feedback implementation in this repository.
