# MiniLab 3 — pads as break-glass, knobs as soundcheck

**Date:** 2026-08-21 · **Show:** bar-mitzvah-party (Saturday 2026-08-22) · **Status:** approved design, spec for planning

## Goal

Make the Arturia MiniLab 3 the operator's second hand: faders and pads are what gets grabbed mid-song,
knobs are set at soundcheck and left. Every console slider that matters live gets a physical control;
the two that never get touched live (Gobo Spin, Prism) stay dashboard-only. No banks, no layers,
nothing to remember.

Operator's own split (2026-08-21): *group intensities and break-glass are hands; beam feel is set and forget.*

## Physical map (Arturia program — display must read "Arturia", Shift + Pad 3 cycles programs)

```
FADERS   F1 Pars L    F2 Pars R    F3 Truss     F4 Banner          unchanged (Playback, group intensity)

KNOBS    K1 Fade      K2 Tempo     K3 Gobo      K4 Zoom            set at soundcheck
         K5 Focus     K6 Move Spd  K7 UV Wash   K8 Warm Wash

PADS     P1 Flash Full      velocity = level, 0 on release
         P2 Strobe          note velocity = burst level; PRESSURE = strobe rate; both 0 on release
         P3 Blackout        toggle (QLC+ blackout action) — press dark, press again back
         P4 Gold Punch      velocity = level
         P5 Blue Punch      velocity = level
         P6 UV Punch        velocity = level
         P7 Beam Punch      truss heads only, velocity = level
         P8 Banner Flash    floor heads white, velocity = level
```

Knob changes vs today: K4 Gobo Spin → **Zoom**, K5 Prism → **Focus**, K6 Zoom → **Move Speed**. Gobo Spin and
Prism lose their MIDI input and gain an OSC input (dashboard-only, still on the console and the MCP).

Not on the MiniLab, by rule: **Tap tempo** and **Page ▶** each already own their single QLC+ input source on the
Launchpad (R8C4, R8C8). A QLC+ widget has exactly one input source, so they stay there.

## How each pad works in QLC+

| Pad | Widget | Input | Function | Why this shape |
|---|---|---|---|---|
| P1, P4–P8 | VCSlider, **Playback** mode | note `128 + n` on universe 2 | a dedicated `… Punch`/`Flash …` scene | Note-on velocity (0–127 → 0–255) sets the function's intensity; note-off (velocity 0) drops it to 0 and stops it. HTP blend over the running look; nothing latches. |
| P2 note | VCSlider, Playback | note `128 + n2` | `Strobe Burst` (exists) | same as above — the hit is the burst |
| P2 pressure | VCSlider, **Level** | poly aftertouch `256 + n2` | pars' strobe channel, low limit 0 (off), high limit = fastest strobe | Lean in = faster. Release → aftertouch 0 → channel 0 → strobe off. The Level slider owns a channel no look writes, same rule as Gobo/Zoom. |
| P3 | VCButton, action **Blackout** | note `128 + n3` | — | Hold is impossible on HTP (a flash cannot *lower* intensity); the QLC+ blackout action is the one thing that can. Toggle, like Launchpad R8C1. |

**Dedicated functions are mandatory for every Playback slider.** A Playback slider returning to 0 *stops* its
function. If a pad shared `Dim Full` with the boot-lit pad, releasing the pad would kill the room. So:
`Flash Full`, `Gold Punch`, `Blue Punch`, `UV Punch`, `Banner Flash` are new scenes referenced by nothing else;
`Beam Punch` and `Strobe Burst` exist and are only referenced by the Tempo dial / NOT_FADED list — the build
test below proves no button references any pad function.

Pads send on MIDI channel 10 (knobs/faders on channel 1). The MiniLab input line must be **omni** (not pinned to
channel 1) or the pads never arrive — pre-check 2.

## rig.json / rig schema

`controller2` grows:

```json
"pads": { "channel": 10, "notes": [36, 37, 38, 39, 40, 41, 42, 43], "aftertouch": "poly" }
```

`notes` are whatever `scripts/midi-learn.ps1` prints for pads 1–8 in bank A (the sniff on 2026-08-21 saw notes 44/46
with the bank toggled — the captured values go in, not the factory guess). `aftertouch` is `"poly"` or `"off"`;
`"off"` drops the P2 pressure slider and P2 becomes a plain velocity burst.

`scripts/rig.ts`: `pads: z.object({ channel: z.number().int().min(1).max(16), notes: z.array(z.number().int().min(0).max(127)).length(8), aftertouch: z.enum(["poly","off"]) }).optional()` inside `controller2`.
`rigs/bar-mitzvah.rig.json` carries the same block (template); `rig.json` is gitignored and patched by hand.

## Generator (`scripts/build-party.ts`)

- `midiNoteInput(n)` → `<Input Universe="2" Channel="${128 + n}"/>`; `midiAftertouchInput(n)` → `Channel="${256 + n}"`.
  The 256 offset is QLC+'s NOTE_AFTERTOUCH block — pre-check 3 confirms it on 4.14.3 before any task uses it.
- New scenes (all pars unless stated; every one clears sound macros like every look does):
  `Flash Full` (pars + truss dimmer 255), `Gold Punch` (gold at full), `Blue Punch` (blue at full), `UV Punch` (ch7 255),
  `Banner Flash` (floor heads dimmer 255, white, shutter open). Colours come from the existing palette constants.
- Knob table: K3 Gobo (934), K4 Zoom (937), K5 Focus (MIDI twin of dashboard 908), K6 Move Speed (MIDI twin of 909),
  K7 UV Wash (938), K8 Warm Wash (939), K1/K2 dials unchanged. Gobo Spin (935) and Prism (936) switch from
  `midiInput` to `oscInput` (they then appear in `config/widgets.json`).
- New **PADS** frame: 8 Playback sliders (P1, P2 burst, P4–P8) + the P2 pressure Level slider + the P3 blackout button.
  Placed in the free right-hand strip under TRUSS POSITION/BANNER: `(RIGHT_X, 525, 444, 290)`; sliders 52 wide,
  stride 54, height 180. Must satisfy the existing console geometry tests (inside 1500×820, no frame overlap,
  widgets inside frames).
- MINILAB frame stays 10 sliders wide; Focus and Move Speed twins replace the Gobo Spin and Prism twins in place.

## Launcher / docs

- `start-show.ps1`: no new MIDI resolution — pads ride the same `Minilab3` input line. Add one line after
  `-> MiniLab MIDI index in=N`: `   MiniLab must show "Arturia" (Shift + Pad 3 cycles programs)`.
- Roadmap operator guide + `SETUP-MANUAL.html` MiniLab section: the map above, the "Arturia not DAW" rule, the two
  pad rules (velocity = level; P2 pressure = rate).

## Tests (`tests/build-party.test.ts`)

1. Every `controller2.pads.notes` entry is distinct and every pad widget's channel is `128 + note` (or `256 + note` for the pressure slider).
2. **No VCButton references a function that any Playback slider references** (the boot-lit/Dim Full trap).
3. Knob table: K3→ch6 truss, K4→ch14 heads, K5→ch9 heads (Focus), K6→ch4 heads (Move Speed), K7→`UV Full`, K8→`Warm Full`; Gobo Spin and Prism carry universe-0 inputs.
4. With `aftertouch: "off"` no widget uses a 256+ channel.
5. Console geometry suite passes with the PADS frame (existing tests cover it automatically).
6. Every pad function clears sound macros (par ch9 = 0) — the LTP RECLAIM rule, extended to the new scenes.

## Bench pre-checks (before Task 1 — each either passes or changes the design)

1. **Pads transmit note + poly aftertouch** in the Arturia program: extend `scripts/midi-learn.ps1` to decode `0xA0`
   (poly AT) and `0xD0` (channel AT); sniff `Minilab3` with QLC+ closed; record the 8 bank-A notes. If no aftertouch →
   `aftertouch: "off"`.
2. **Channel-10 notes reach a QLC+ widget** on a line that also carries channel-1 CCs. If not, set the MIDI input line's
   channel parameter to omni in the generated `<Input>` block and re-test.
3. **Velocity drives a Playback slider** and **aftertouch lands on channel 256+n**: a throwaway `.qxw` with one
   Playback slider on `Flash Full` bound to `128+n` and one Level slider bound to `256+n`; hit pad → par ch0 on the
   Art-Net wire tracks velocity, lean in → strobe channel tracks pressure, release → both 0.

## Verification (done = all of these)

- `npx vitest run` green, `tsc` clean, `npm run generate` produces the show; punk show byte-identical.
- On the wire (`raw-probe.mjs`): P1 soft hit → par ch0 ≈ 60–120, hard hit → 255, release → back to the running look.
  P2 lean in → strobe channel rises, release → 0. P4 → gold RGB on pars scaled by velocity. P7 → truss dimmer only.
  P8 → floor heads only. P3 → all dimmers 0, again → restored.
- K5 moves head ch9, K6 moves head ch4, Gobo Spin/Prism still move from the dashboard.
- Console screenshot via `scripts/qlc-window.ps1`: PADS frame fully visible, nothing overlapped.

## Out of scope (next spec)

More scenes/chasers and truss-mover dynamics over the dance floor — show design under the beam-safety rule, separate
spec `2026-08-21-dance-floor-dynamics-design.md`.
