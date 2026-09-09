# Cuepix + QLC+ routing setup

## Network

- Lighting LAN only. Disable Wi-Fi sharing/bridging on lighting NIC.
- Computer lighting NIC: static `10.201.6.1`, mask `255.255.255.0`, no gateway.
- Pknight CR011R: `10.201.6.100`, Art-Net Universe 0 to DMX output.
- Cuepix 1–6: Art-Net Universe 0. Cuepix 7–12: Art-Net Universe 1.
- All Cuepix panels: 79-channel mode; addresses from CUEPIX-PATCH-CHART.md.
- 375ZX fixtures: 15-channel mode; DMX addresses 481 and 496.

## Install and open

1. Close QLC+.
2. Copy both files from `fixtures/` into `%USERPROFILE%\QLC+\Fixtures`.
3. Start QLC+ once, then close it so fixture cache refreshes.
4. Open `cuepix-panel-show.qxw`.
5. In Inputs/Outputs, confirm ArtNet output enabled for QLC+ Universe 1 and 2. Plugin parameters must map to Art-Net 0 and 1.
6. Open Virtual Console. Use only ROUTING TESTS until every fixture passes.

## Cable order

- Ethernet switch: QLC+ computer, CR011R, all 12 Cuepix panels.
- CR011R DMX OUT → 375ZX at address 481 → 375ZX at address 496 → DMX terminator.
- Do not put Cuepix panels in this DMX chain; their addresses occupy Art-Net space but they receive Ethernet directly.

## Test order

1. Power one Cuepix only. Press its Red, Green, Blue, White, Blackout buttons.
2. Repeat for Cuepix 1–12, one powered fixture at a time.
3. Test each 375ZX Open White, Pan Center, Tilt Center, Blackout.
4. Press Universe 0 Panels White, Universe 1 Panels White, Both 375ZX Open White, All Blackout.
5. If wrong fixture responds, stop. Fix panel universe/address or DMX address before scenes.

## Art-Net numbering warning

This workspace maps QLC+ Universe ID 0 → Art-Net universe 0 and QLC+ Universe ID 1 → Art-Net universe 1. Some device screens label these 1 and 2. Match wire universe values, not display wording.
