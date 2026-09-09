# Cuepix / QLC+ Art-Net Rig Design

**Date:** 2026-09-08  
**Status:** Approved direction; awaiting spec review  
**Scope:** 12 Elation CUEPIX Panels, 2 Chauvet Intimidator Spot 375ZX fixtures, QLC+ 4.14.x Virtual Console, Pknight CR011R, existing QLC+ MCP 3D monitor.

## Goal

Create a separate, repeatable QLC+ project for the Cuepix rig. The project must open in QLC+ 4.14.x, expose Art-Net output for two universes, patch both Cuepix banks, send Universe 0 through the CR011R to the two 375ZX fixtures, and provide routing-test controls before any show scenes are authored.

Existing QLC+ shows remain untouched. The project lives in the existing `QLCPlus-MCP` workspace and follows its generated-show pattern.

## Hardware topology

```text
QLC+ PC: 10.201.6.1/24
  |
  +-- isolated gigabit lighting switch
        +-- Cuepix 1-6: Art-Net Universe 0
        +-- Cuepix 7-12: Art-Net Universe 1
        +-- CR011R: Art-Net Universe 0 -> DMX output
                              +-- 375ZX #1 start 481
                              +-- 375ZX #2 start 496
                              +-- DMX terminator
```

CR011R target settings: `10.201.6.100/24`, `Net 0 / Sub-Net 0 / Universe 0`, `Art-Net -> DMX`. Use Art-Net broadcast first. Add unicast only after the broadcast path passes.

## QLC+ patch

QLC+ universe IDs remain zero-based:

| QLC+ universe | Art-Net universe | Fixtures |
|---:|---:|---|
| 0 | 0 | Cuepix 1-6 and 375ZX #1/#2 through CR011R |
| 1 | 1 | Cuepix 7-12 |

Patch addresses use QLC+'s zero-based XML address internally and the human-facing DMX start address in the chart:

| Fixtures | Mode | Human start addresses | Channels |
|---|---|---:|---:|
| Cuepix 1-6 | 79CH | 1, 80, 159, 238, 317, 396 | 79 |
| Cuepix 7-12 | 79CH | 1, 80, 159, 238, 317, 396 | 79 |
| 375ZX #1 | DMX / 15CH | 481 | 15 |
| 375ZX #2 | DMX / 15CH | 496 | 15 |

The 375ZX fixtures share Art-Net Universe 0 with Cuepix 1-6 but use only DMX channels 481-510 on the CR011R output. Cuepix 1-6 are direct Art-Net fixtures; they are not placed on the DMX chain.

## Fixture definitions

1. Add `Elation-Cuepix-Panel-79CH.qxf` with 79 channels:
   - channels 1-75: 25 COB modules, RGB per module;
   - channel 76: macro;
   - channel 77: master dimmer / macro speed;
   - channel 78: flash / strobe;
   - channel 79: dimming curve.
2. Validate the Cuepix definition against Elation DMX Traits version 3 and assert exactly 79 channels and one 79-channel mode.
3. Validate the existing Chauvet 15-channel definition against the 375ZX manual. Reuse the existing definition when the channel map matches; create a 375ZX-specific file only if the fixture identity or map requires it. Avoid duplicate QLC+ definitions without a map difference.

## Generated project files

Create a separate rig configuration and generator output:

- `rigs/cuepix-panel.rig.json` — fixture counts, addresses, universes, LAN facts, and monitor geometry.
- `scripts/build-cuepix-show.ts` — minimal generated QXW and routing-test functions.
- `fixtures/Elation-Cuepix-Panel-79CH.qxf` — custom Cuepix definition.
- `cuepix-panel-show.qxw` — QLC+ workspace.
- `PATCH-CHART.md` — authoritative physical patch.
- `CUEPIX-SETUP.md` — install, LAN, fixture menu, node, chain, and test procedure.
- `monitor/fixtures.json` — generated fixture map for this rig.

The first QXW contains routing-test controls only. It does not contain show scenes, chasers, song presets, MIDI mappings, or Launchpad dependencies.

## Routing-test controls

The Virtual Console will expose enough controls to prove each output path without building looks:

- Cuepix 1-12: individual red, green, blue, white, dimmer, strobe-off, and blackout tests.
- 375ZX #1/#2: individual dimmer, shutter-open, white, pan, tilt, and blackout tests.
- Group tests: Cuepix Universe 0, Cuepix Universe 1, both 375ZX fixtures, all fixtures, and global blackout.

Tests will label universe, fixture, address, and channel range. Controls are temporary routing tools and may be replaced by the later scene design.

## 3D monitor

The existing monitor currently listens only to Art-Net Universe 0. Extend it without breaking current shows:

- Art-Net listener accepts a list of universes, defaulting to `[0]` for existing shows.
- Cuepix mode uses `[0, 1]` and keeps one 512-byte frame per universe.
- Monitor fixture records gain a `universe` field; addresses stay zero-based within that universe.
- SSE sends a small JSON payload containing changed universe frames. Existing single-universe clients continue to receive the current base64 frame format when configured for one universe.
- Cuepix renderer shows each panel as a 5x5 RGB module array, driven from its 75 pixel channels plus master dimmer/strobe state.
- 375ZX renderer keeps the existing pan/tilt beam model and reads those fixtures from Universe 0.
- HUD reports both received universes and stale-frame age.
- `start-monitor.ps1` prints both universes for Cuepix mode and still opens `http://127.0.0.1:7800`.

Monitor tests must cover parsing Universe 0 and 1, merging/preserving both frames, fixture lookup by universe, and Cuepix pixel rendering data.

## Verification gates

### Offline

- Fixture XML parses.
- Cuepix definition has exactly 79 channels.
- 375ZX definition has exactly 15 channels.
- Every patch start/end range fits within 512 channels.
- No overlap inside either universe.
- QXW XML parses and contains two Art-Net outputs.
- Generated monitor map contains 14 fixtures with correct universe/address pairs.
- QLC+ 4.14.x opens the generated QXW in Operate mode.
- Existing monitor tests and the new dual-universe tests pass.

### Hardware

1. Connect PC, switch, Cuepix panels, and CR011R on the isolated LAN only.
2. Set unique Cuepix IP addresses and assign panels 1-6 to Art-Net Universe 0; panels 7-12 to Universe 1.
3. Set all Cuepix panels to 79CH.
4. Set 375ZX fixtures to DMX / 15CH and start addresses 481 and 496.
5. Set CR011R to Art-Net -> DMX, Universe 0. Save with the node's long-press save action.
6. Connect the DMX chain: CR011R -> 375ZX #1 -> 375ZX #2 -> terminator.
7. Test one Cuepix at a time, then one 375ZX at a time.
8. Test each universe, the CR011R chain, all fixtures, blackout, and Art-Net loss behavior.
9. Open the 3D monitor and confirm both Cuepix banks and both heads react to QLC+ output.
10. Build scenes only after every routing test passes.

## Known baseline

- QLC+ executable exists at `C:\QLC+4\qlcplus.exe`; it is not on PATH.
- Existing show notes identify that portable runtime as QLC+ 4.14.4.
- Current branch has unrelated dirty edits. Work is isolated in branch `feat/cuepix-qlcplus`.
- Baseline build passes. Existing suite has one unrelated byte-for-byte regression: generated `punk-rock-show.qxw` differs from its committed copy; 141 tests pass, 1 fails, 1 is skipped.

## Sources

- Elation CUEPIX Panel product page and DMX Traits version 3.
- Chauvet DJ Intimidator Spot 375ZX User Manual Rev. 1.
- Pknight CR011R manual.
- QLC+ Input/Output and Fixture Definition Editor documentation.
- Existing QLC+ MCP show files, generator, 3D monitor, and prior load-test notes.
