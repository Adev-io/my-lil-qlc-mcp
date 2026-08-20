# QLC+ 4.14.3 XML ground truth — SpeedDial + AudioTriggers

Pinned for `scripts/build-party.ts` (bar mitzvah party show). Every shape below is read
from the QLC+ **4.14.3 tag** source, `saveXML()` **and** `loadXML()` — the loader is what
actually parses our generated file, so it is the binding contract.

Sources (fetched 2026-08-20 from `github.com/mcallegari/qlcplus`, tag `QLC+_4.14.3`):
`ui/src/virtualconsole/vcspeeddial.{cpp,h}` · `ui/src/virtualconsole/vcspeeddialfunction.cpp` ·
`ui/src/virtualconsole/vcaudiotriggers.{cpp,h}` · `ui/src/audiobar.{cpp,h}` · `engine/src/function.h`

Status: **source-verified.** Live hardware verification (does the widget actually react to the
PreSonus AudioBox USB96) is the remaining half of the audio gate — see the last section.

---

## `<SpeedDial>` — tap tempo

Element name `SpeedDial`. Emission order in `saveXML` (the loader accepts children in any
order, but matching the writer keeps diffs against a QLC+-saved file readable):

```xml
<SpeedDial Caption="Tempo" ID="920">
 <WindowState Visible="True" X="..." Y="..." Width="..." Height="..."/>
 <Appearance>
  <FrameStyle>None</FrameStyle>
  <ForegroundColor>Default</ForegroundColor>
  <BackgroundColor>Default</BackgroundColor>
  <BackgroundImage>None</BackgroundImage>
  <Font>Default</Font>
 </Appearance>
 <AbsoluteValue Minimum="0" Maximum="2000"/>
 <Tap>
  <Input Universe="1" Channel="142"/>
 </Tap>
 <Time>500</Time>
 <Function FadeIn="0" FadeOut="0" Duration="6">12</Function>
 <Function FadeIn="0" FadeOut="0" Duration="6">37</Function>
</SpeedDial>
```

- **`<AbsoluteValue>`** is written unconditionally with `Minimum`/`Maximum` attributes, and
  carries the (optional) absolute-value `<Input>` as a child.
- **`<Tap>`** wraps the tap `<Input>` — this is the pad that taps tempo. Written only when a
  valid tap source exists. Same `<Input Universe Channel/>` shape every other widget uses.
- **`<Time>`** = the dial's current value in ms (the tempo the show boots with).
- **`<Function>`** — one per attached function, **function ID is the element's TEXT**, the
  three multipliers are attributes (`function.h`: `FadeIn` / `FadeOut` / `Duration`).
- Optional children not needed here: `Visibility`, `Mult`, `Div`, `MultDivReset`, `Apply`,
  `ResetFactorOnDialChange`, `Key`, `MultKey`, `DivKey`, `MultDivResetKey`, `ApplyKey`,
  and `<Preset>` entries.

### Multiplier values (`VCSpeedDialFunction::speedMultiplierNames`) — an INDEX, not a factor

| index | meaning |
|-------|---------|
| 0 | `(Not Sent)` — leave that speed alone |
| 1 | `0` |
| 2 | `1/16` |
| 3 | `1/8` |
| 4 | `1/4` |
| 5 | `1/2` |
| **6** | **`1` — the dial time applied as-is** |
| 7 | `2` |
| 8 | `4` |
| 9 | `8` |
| 10 | `16` |

**For our chasers:** `FadeIn="0" FadeOut="0" Duration="6"` — tap tempo becomes each chaser's
step duration, fades untouched. `Duration="5"` (1/2) on the sync-strobe chaser gives a
double-time blink against the same tap if that reads better on the floor.

---

## `<AudioTriggers>` — beat-reactive pulse

Element name `AudioTriggers`, one attribute:

```xml
<AudioTriggers BarsNumber="16" Caption="Audio" ID="930">
 <WindowState Visible="True" X="..." Y="..." Width="..." Height="..."/>
 <Appearance>...</Appearance>
 <Input Universe="1" Channel="144"/>
 <VolumeBar Name="Volume Bar" Type="0" MinThreshold="51" MaxThreshold="204" Divisor="1" Index="1000"/>
 <SpectrumBar Name="#1" Type="2" MinThreshold="51" MaxThreshold="204" Divisor="1" Index="0" FunctionID="42"/>
</AudioTriggers>
```

- **`BarsNumber`** is read FIRST and calls `setSpectrumBarsNumber(n)`, which allocates the bar
  array. A `<SpectrumBar Index="i">` is applied **only if `0 <= i < BarsNumber`** — an index
  past the count is silently dropped. Set `BarsNumber` before/consistently with every index used.
- **`<Input>`** on the widget itself = external input that toggles the triggers on/off. This is
  how the R8C6 pad enables/disables reactivity.
- **`<Key>`** (text element) = keyboard equivalent of that toggle.
- `saveXML` returns false and writes NO bars when every bar is `Type=None` — meaning a widget
  with no assignment is legal but pointless. We always assign at least one.

### AudioBar attributes (`audiobar.h` / `AudioBar::saveXML`)

| attribute | notes |
|---|---|
| `Name` | display label |
| `Type` | **0 None · 1 DMXBar · 2 FunctionBar · 3 VCWidgetBar** |
| `MinThreshold` | 0-255; **QLC+ default 51 (20%)** |
| `MaxThreshold` | 0-255; **QLC+ default 204 (80%)** |
| `Divisor` | beat divisor, default `1` |
| `Index` | bar index; the volume bar uses `volumeBarIndex()`, spectrum bars use 0..n-1 |
| `FunctionID` | **only when `Type="2"`** — the function this bar fires |
| `WidgetID` | only when `Type="3"` |

`Type="1"` (DMXBar) instead writes a **child text element**, not an attribute:
`<DMXChannels>fixtureId,channel,fixtureId,channel,...</DMXChannels>`

### Party show mapping

- One spectrum bar (lowest index = bass) → `Type="2"`, `FunctionID` = the **Beat Pulse** scene.
  Colors stay whatever look is running; the pulse only bumps par dimmers.
- Volume bar stays `Type="0"` (None) unless the live test shows a clean use for it — the spec
  explicitly allows dropping the banner-shimmer idea ("keep the mapping minimal").
- Thresholds ship at the QLC+ defaults (51/204) and get tuned at soundcheck, in the QLC+ UI.

---

## The audio INPUT DEVICE is not in the workspace

`vcaudiotriggers.cpp` touches `QSettings` only for the widget's stored size — there is no
capture-device attribute anywhere in the widget's XML. In QLC+ 4 the audio input device is an
**application preference, per machine**, not part of the `.qxw`.

**Consequence for Saturday:** the generator cannot bake in "use the AudioBox". The operator
selects it once in QLC+ (Input/Output panel → audio input), and that selection persists on
that machine across shows. This belongs in SHOW-SETUP as an explicit step — a show file
that "should" be audio-reactive but was opened on a machine pointed at the laptop's internal
mic looks broken and isn't.

---

## Live verification (the other half of the gate) — PENDING

Source truth is settled; hardware truth is not. Before Task 10's widget ships, run this at the
show machine with the AudioBox plugged in:

1. Open QLC+ 4.14.3 with a **scratch** workspace (never the generated show).
2. Add an Audio Triggers widget; set a spectrum bar to a scene; select the AudioBox as audio input.
3. Add a Speed Dial, attach a chaser, map a tap key.
4. Save as `scratchpad/audio-probe.qxw`, play music, confirm the scene fires on the beat and
   tapping changes chaser speed.
5. Diff that saved file against the shapes above. Any mismatch — this doc loses, the saved file wins.

**Verdict: not yet run.** GO → Task 10 emits the widget. NO-GO → widget dropped; tap tempo +
the par sound-mode pad carry reactivity (pre-agreed fallback, spec §Audio reactivity).
