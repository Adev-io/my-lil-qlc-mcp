# Show Setup — Punk/Alt-Rock Rig

Everything gear-independent is already built. When the equipment is in hand, this is the
whole job: **dial addresses → map Art-Net → map the Launchpad → load test.**

Files in this folder:

| File | What it is |
|---|---|
| `punk-rock-show.qxw` | The QLC+ project — open this in QLC+. |
| `fixtures/Rainbow-Lights-Smart-2-Pro-RGBWAUV.qxf` | Custom fixture def for the Rainbow pars. |
| `PATCH-CHART.md` | DMX addresses + Launchpad grid map (also in the dashboard Docs tab). |
| `config/widgets.json` | OSC look list driving the MCP + dashboard (auto-generated). |
| `scripts/build-show.ts` | Regenerates the project + chart from data tables. |

---

## 0. Install the Rainbow fixture definition (one time)

QLC+ won't know the Rainbow pars until its definition is in your user fixtures folder.

- **Windows:** copy `fixtures/Rainbow-Lights-Smart-2-Pro-RGBWAUV.qxf` to
  `C:\Users\<you>\QLC+\Fixtures\` (create the folder if missing), then restart QLC+.

> ⚠️ The Rainbow 10ch map (ch 1 Dimmer · 2 R · 3 G · 4 B · 5 W · 6 A · 7 UV · 8 Strobe ·
> 9 Color Macro · 10 Speed) is the standard budget RGBWA+UV layout. **Verify ch 9–10 against
> the light's own menu the first time you plug in** — if they differ, fix them in QLC+'s
> Fixture Editor (or edit the `.qxf`); patch addresses don't change.

## 1. Open the project

QLC+ → File → Open → `punk-rock-show.qxw`. Switch to the **Virtual Console** tab — you'll see
four frames: **WASH**, **HEADS**, **FX**, **MASTER**.

## 2. Address the lights (from PATCH-CHART.md)

Set each fixture's physical DMX start address on its own display/dip-switches:

```
Rainbow Par 1..10  ->  1, 11, 21, 31, 41, 51, 61, 71, 81, 91
COLORband Bar 1..4 ->  101, 114, 127, 140
375Z Head L, R     ->  153, 168
```

All one universe. Spacing leaves room if you ever change a fixture's channel mode.

## 3. Art-Net output → the CR011R node

QLC+ → **Inputs/Outputs** tab → universe **Stage**:

1. **Output** column → enable **ArtNet** on the network interface that's on the show LAN
   (the line whose IP matches your laptop's show-network IP).
2. The project already sets **Art-Net universe 0**, transmit mode Standard (broadcast) — so it
   works the moment the node is on the same subnet, no IP needed.
3. **For unicast to the CR011R (optional):** open the ArtNet line's configuration and set the
   node's IP as the destination for universe 0. This is the *single field* to fill when you
   have the node's IP. Broadcast is fine if you skip it.

## 4. Launchpad Mini MK3 → MIDI in + LED feedback

Same **Inputs/Outputs** tab → universe **Launchpad** (profile *Novation Launchpad Mini MK3* is
already assigned):

1. **Input** column → select the Launchpad's MIDI input (e.g. *Launchpad Mini MK3 MIDI*).
2. **Feedback** column → select the Launchpad's MIDI output (drives the pad LEDs).
3. **Put the Launchpad in Programmer Mode** — the shipped profile (pad notes 11–88 / QLC+
   channels 139–216) expects it. Use Novation's method from the Launchpad Mini MK3 user guide
   (hold **Session** to open settings, then choose **Programmer** on the bottom row). In
   Programmer Mode the pads will light in each look's color as you arm them.

## 5. Load test (5 min, do this before doors)

- **Patch:** Inputs/Outputs shows fixtures at the addresses above; no overlap warnings.
- **Output:** trigger **WASH → White**; the rig should light. (Use the QLC+ DMX monitor or the
  real fixtures.)
- **OSC / dashboard:** run the MCP in HTTP mode and open the dashboard; the **Control** tab lists
  all 49 looks and the **Docs** tab shows the patch chart. Pressing a look fires it in QLC+.
  (Behind the scenes the MCP sends e.g. `/red`; QLC+ matches it by CRC-16 hash — pre-baked, no
  Auto-Detect needed.)
- **Launchpad:** a grid pad fires the same look and lights up. Both surfaces drive the same
  function, so they stay in sync.

---

## Control model (why there are "two" of each button)

QLC+ persists only one external input per Virtual Console button. So each look has **two**
buttons pointing at the **same function**: one bound to the Launchpad (MIDI, universe 1, with LED
feedback) and one bound to OSC (universe 0) for the MCP/dashboard. The `widgets.json` generator
only picks up the OSC buttons, so the dashboard shows each look once. Color/wash and head looks
live in **Solo** frames (one active at a time); FX are momentary **Flash**; Blackout/Panic are
QLC+ blackout actions.

## Still pending real hardware (all isolated, quick edits)

- Rainbow ch 9–10 confirmation (step 0).
- CR011R unicast IP (step 3) — only if you don't want broadcast.
- Device selections (which MIDI port, which NIC) — picked live in Inputs/Outputs.

## Changing the show later

Edit the data tables at the top of `scripts/build-show.ts` (colors, positions, chases, pad
layout), then:

```
npx tsx scripts/build-show.ts
npx tsx src/qlc/generateWidgets.ts ./punk-rock-show.qxw config/widgets.json
```

Reload the project in QLC+. The CRC-16 OSC bindings and Launchpad pads are recomputed
automatically.
