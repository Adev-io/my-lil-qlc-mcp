# Show Setup — QLC+ side

Everything gear-independent is already built. When the equipment is in hand, this is the
whole job: **dial addresses → map Art-Net → map the Launchpad → load test.**

> **Two shows live in this repo.** The active one is whichever `rig.json` points at, and the
> generated docs always describe THAT show. **Take DMX addresses and the pad map from
> `PATCH-CHART.md`, never from the examples below** — the addresses printed in step 2 are the
> punk rig's and are wrong for any other show.
>
> | Show | rig file | project file | operator manual |
> |---|---|---|---|
> | Punk / alt-rock band | `rigs/punk-rock-show.rig.json` | `punk-rock-show.qxw` | `SETUP-MANUAL.html` |
> | Bar mitzvah party | `rigs/bar-mitzvah.rig.json` | `bar-mitzvah-party.qxw` | `SETUP-MANUAL.html` |
>
> Switch shows with `Copy-Item rigs/<show>.rig.json rig.json -Force` then `npm run generate`.
> Both shows share the Rainbow pars and the 375Z heads, so step 0 below applies to either.

Files in this folder:

| File | What it is |
|---|---|
| `<show>.qxw` | The QLC+ project — open the active show's file in QLC+. |
| `fixtures/Rainbow-Lights-Smart-2-Pro-RGBWAUV.qxf` | Custom fixture def for the Rainbow pars. |
| `PATCH-CHART.md` | **Authoritative** DMX addresses + Launchpad grid map for the active show. |
| `config/widgets.json` | OSC look list driving the MCP + dashboard (auto-generated). |
| `scripts/build-show.ts` / `scripts/build-party.ts` | Regenerate the project + chart from the rig. |

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

QLC+ → File → Open → the active show's `.qxw` (`punk-rock-show.qxw` or
`bar-mitzvah-party.qxw`), or just run `./start-show.ps1`, which opens it in Operate mode
along with the MCP server and the 3D monitor.

## 2. Address the lights — **use PATCH-CHART.md, not this page**

Set each fixture's physical DMX start address on its own display/dip-switches, reading the
addresses out of the freshly generated `PATCH-CHART.md`. Its numbers are 1-based, exactly as
the fixture menus want them.

The punk rig's addresses, as an example of the shape (the party show uses different ones):

```
Rainbow Par 1..10  ->  1, 11, 21, 31, 41, 51, 61, 71, 81, 91
COLORband Bar 1..4 ->  101, 114, 127, 140
375Z Head L, R     ->  153, 168
```

All one universe. Spacing leaves room if you ever change a fixture's channel mode.

**Party show only — audio reactivity.** QLC+ stores the audio input device as an application
preference, not in the show file, so the AudioBox has to be picked once on the show machine or
the audio triggers do nothing. See `docs/qlc-xml-notes.md`.

## 3. Art-Net output → the CR011R node

QLC+ → **Inputs/Outputs** tab → universe **Stage**:

1. **Output** column → enable **ArtNet** on the network interface that's on the show LAN
   (the line whose IP matches your laptop's show-network IP).
2. The project already sets **Art-Net universe 0**, transmit mode Standard (broadcast) — so it
   works the moment the node is on the same subnet, no IP needed.
3. **For unicast to the CR011R (optional):** open the ArtNet line's configuration and set the
   node's IP as the destination for universe 0. This is the *single field* to fill when you
   have the node's IP. Broadcast is fine if you skip it.

## 4. Launchpad Mini MK3 → MIDI IN only (the MCP server drives the LEDs)

Same **Inputs/Outputs** tab → universe **Launchpad** (profile *Novation Launchpad Mini MK3* is
already assigned):

1. **Input** column → select the Launchpad's MIDI input (e.g. *Launchpad Mini MK3 MIDI*).
2. **Leave the Feedback column EMPTY.** QLC+ no longer drives the pad LEDs — the MCP server's
   launchpad module owns the Launchpad MIDI output and lights the pads itself over RGB SysEx (idle
   at 50%, the active look at 100%). Binding Feedback here would fight it for the port.
3. **Programmer Mode is automatic** — the MCP module sets it (and paints the pads) when the server
   starts via `start-show.ps1`. The shipped profile maps pad notes 11–88 / QLC+ channels 139–216.
   (By hand, if ever needed: hold **Session** and pick **Programmer** on the bottom row.)

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

Edit the data tables in the builder for the active show — `scripts/build-show.ts` (punk) or
`scripts/build-party.ts` (party): colors, positions, chases, pad layout. Then rebuild
everything with one command, which picks the right builder off `rig.meta.builder`:

```
npm run generate
```

Reload the project in QLC+. The CRC-16 OSC bindings and Launchpad pads are recomputed
automatically. Never hand-edit a `.qxw` or save over it inside QLC+ — the generated file is
written read-only for exactly that reason.
