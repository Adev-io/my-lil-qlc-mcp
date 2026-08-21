# Obsidian NX Touch → QLC+ via ONYX sACN bridge

## Context

Ask: run the Obsidian NX Touch as a control surface for QLC+, ideally through the QLC+ MCP stack (`C:\Users\Arikl\dev\qlcplus-mcp\QLCPlus-MCP`).

Hardware truth (this machine, 2026-08-21):
- NX Touch enumerates as `USB\VID_11BE&PID_E808`, CompatibleIds `Class_FF&SubClass_FF&Prot_FF` → **vendor-specific USB**. No USB-MIDI, no HID interface. VID 0x11BE = Martin Professional (ONYX lineage). Last plugged in 2026-08-19 21:05–21:55; no driver bound (ONYX not installed).
- Already ruled out as a direct QLC+ device on 8/19 (`.claude/bookmarks/bar-mitzvah-show-design-20260819.json:24`). QLC+ has no plugin; reverse-engineering the protocol has no prior art and needs ONYX running to sniff anyway.

Decision (user, this session): **Path A — ONYX as translator.** Faders = look intensity + flash.

Why this works:
- NX Touch puts ONYX in **NOVA+** (U1-4 Art-Net/sACN out, OSC/MIDI enabled). Even FREE mode allows sACN on universe 1. ONYX is a free download.
- QLC+ 4.14 `E1.31` and `ArtNet` plugins both implement `openInput` (verified in upstream source). Received DMX → input channels → Virtual Console widgets.
- **sACN, not Art-Net**: UDP 6454 is already shared on this host by QLC+ Art-Net out + the 3D monitor; 5568 is clean. **Not ONYX OSC-out**: forum reports ~80% reliability.
- The repo already runs *Playback-slider twins* on one function (MiniLab F1-4 mirror the OSC group faders, `build-party.ts:1119-1127`) — NX faders reuse that exact pattern. `qxwParser.ts:300` drops non-zero input universes from `widgets.json`, so NX twins can't pollute the dashboard.

Data path:
```
NX Touch ─USB─▶ ONYX (10 cuelists, 1 Generic Dimmer each) ─sACN U1 multicast, NIC X─▶
QLC+ E1.31 input (universe "NX Touch" ID 3, Line = NIC X) ─▶ 10 Playback sliders
(Input Universe=3, Channel=n-1) ─▶ named function at fader level; flash pad = ONYX bump → ch hits 255 while held
```

⚠️ **Bar mitzvah show is Sat 2026-08-22.** All work on branch `feat/nx-touch` off `feat/packaging`. Never touch root `rig.json`, the live `.qxw`, or `build-party.ts` behaviour when `controller3` is absent. Apply to the live rig no earlier than Sun 8/23. Punk builder (`build-show.ts`) out of scope — add when asked.

Plan agent skipped: user already picked the path + fader role; every open alternative was closed by research above.

## Part 0 — ONYX side (manual, no code)

Documented in new `docs/NX-TOUCH.md`; done by Ari once:
1. Install ONYX 4.x (obsidiancontrol.com downloads). Plug NX Touch → Device Manager shows it with a driver (Status OK, not Error). ONYX license panel shows NOVA+.
2. New show `NX-to-QLC`: patch **10× Generic Dimmer** at universe 1, DMX 1–10.
3. Record 10 cuelists, one cue each (dimmer n @ FF), onto playbacks 1–10. Fader = cuelist intensity. Velocity pad below each fader = **Flash**. Save.
4. Menu → Network/EtherDMX: enable **sACN** output for universe 1 on the NIC QLC+ will listen on (write that NIC's IPv4 into `rig.json controller3.interfaceIp`).
5. Proof before touching QLC+: move fader 1, watch an sACN viewer (or QLC+ Inputs/Outputs input blink) change U1 ch1.

Encoders / the 4 parameter faders / bank buttons: **skipped v1**, add when asked.

## Part 1 — rig schema

`scripts/rig.ts` — add after `controller2` (mirror its shape):
```ts
controller3: z.object({
  model: z.string().default("Obsidian NX Touch"),
  bridge: z.literal("onyx-sacn"),          // the only bridge; a literal so a typo fails loudly
  sacnUniverse: z.number().int().min(1).max(63999).default(1),
  interfaceIp: z.string(),                  // NIC QLC+ listens on; launcher checks it is up
  line: z.string().default("0"),            // QLC+ E1.31 line = index of interfaceIp in the plugin's sorted-by-IP list
  faders: z.array(z.string().min(1)).min(1).max(10), // function NAMES, index = NX fader 1..10
}).optional(),
```
Example block goes into `rigs/bar-mitzvah.rig.json` (the committed example, NOT root `rig.json`):
`faders: ["Pars L Full","Pars R Full","Truss Full","Banner Full","UV Full","Warm Full"]`.

## Part 2 — generator (`scripts/build-party.ts`)

All new output gated on `const NX = rig.controller3` being present, so existing rigs regenerate byte-identical.

1. **Universe block** next to `miniUniverse` (`:1303`):
   ```ts
   const NX_UNI = 3;
   const nxUniverse = NX ? `   <Universe Name="NX Touch" ID="${NX_UNI}">
       <Input Plugin="E1.31" UID="None" Line="${esc(NX.line)}">
        <PluginParameters universe="${NX.sacnUniverse}" multicast="1"/>
       </Input>
      </Universe>` : "";
   ```
   Parameter keys come from upstream `e131plugin.h` (`universe`, `multicast`, `mcastIP`, `ucastPort`). If `NX && !ML`, `miniUniverse` emits the placeholder `<Universe Name="MiniLab" ID="2"/>` (same trick the punk builder uses for `Controller` ID 1) so universe IDs stay contiguous. Insert `${nxUniverse}` after `${miniUniverse}` at `:1328`.
2. **Input helper** beside `midiInput` (`:991`): `const nxInput = (fader: number) => \`     <Input Universe="${NX_UNI}" Channel="${fader - 1}"/>\`;` — DMX address n → QLC+ input channel n-1 (0-based; confirm on first live test, see Verification 4).
3. **Sliders**: one `playbackSliderXml(940 + i, caption, 12 + i * 68, funcIdByName.get(name)!, nxInput(i + 1))` per `NX.faders[i]`. Caption = function name with trailing ` Full` stripped (matches MiniLab captions). Unknown function name → `throw new Error(\`controller3.faders[${i}] "${name}" is not a function in this show; known: …\`)`. IDs 940–949 are free (930–939 MiniLab, 950–956 head buttons).
4. **Frame**: `frame("Frame", "NX TOUCH", 12, RIGHT_X, 524, 12 + NX.faders.length * 68, SLIDER_H + 40, nxInner)` → right column under TRUSS POSITION/BANNER (those end at y=516), x 805..1497, y 524..784 — inside the 1500×820 box the file's geometry comment demands. 68-px pitch (not 72) is what makes 10 faders fit. Append to the root frame's children next to `miniFrame`.
5. Comment block above it in the file's house style: why Playback twins (adds on HTP, never owns a channel), why E1.31, why channel n-1.

## Part 3 — launcher (`start-show.ps1`)

After the MiniLab status lines (`:201-206`), inside the preflight:
```powershell
if ($rig.controller3) {
  $nxIp = $rig.controller3.interfaceIp
  $ips  = @(Get-NetIPAddress -AddressFamily IPv4 | Select-Object -ExpandProperty IPAddress | Sort-Object)
  if ($ips -notcontains $nxIp) { Write-Host "  [!] NX Touch: sACN interface $nxIp is not up — NX faders stay dead this launch" -ForegroundColor Yellow }
  else {
    $guess = [array]::IndexOf($ips, $nxIp)
    if ("$guess" -ne "$($rig.controller3.line)") { Write-Host "  [!] NX Touch: QLC+ E1.31 line for $nxIp is probably $guess, rig.json says $($rig.controller3.line) — check Inputs/Outputs" -ForegroundColor Yellow }
  }
  if (-not (Get-Process Onyx -ErrorAction SilentlyContinue)) {
    if ($env:ONYX_EXE -and (Test-Path $env:ONYX_EXE)) { Start-Process $env:ONYX_EXE; Write-Host '  -> launching ONYX ...' -ForegroundColor Green }
    else { Write-Host '  [!] ONYX not running — start it and load the NX-to-QLC show, or set $env:ONYX_EXE' -ForegroundColor Yellow }
  }
}
```
`ponytail:` warn-only on the line index; auto-repair (same `$fixUni` pattern as `:156-168`, regex on `<Input Plugin="E1.31"`) only once PowerShell's sorted-IP list is proven to match Qt's enumeration. Process name `Onyx` to be confirmed after install. Add `ONYX_EXE` to `config/.env.example` if that file exists, else to the README env table.

## Part 4 — tests (vitest, `npx vitest run`)

- `tests/rig-schema.test.ts`: controller3 accepted with defaults applied (`sacnUniverse` 1, `line` "0"); 11 faders rejected; `bridge: "midi"` rejected; punk rig still parses with `controller3` undefined.
- `tests/build-party.test.ts`, new `describe("party generator — NX Touch")` built from a temp rig = bar-mitzvah + controller3 (mirror the MiniLab block `:417-491`):
  - universe 3 block matches `/<Universe Name="NX Touch" ID="3">\s*<Input Plugin="E1.31" UID="None" Line="\d+">\s*<PluginParameters universe="1" multicast="1"\/>/`
  - exactly `faders.length` inputs on universe 3, channels 0..n-1, no duplicates
  - each NX slider is `>Playback<` and runs the same function id as the OSC slider of the same caption (reuse the `fid()` helper)
  - frame `NX TOUCH` WindowState X+Width ≤ 1500, Y+Height ≤ 820
  - unknown fader name → build exits non-zero with the name in stderr
  - rig without controller3 → output contains no `NX Touch` and no `E1.31` (gate proof)
- `tests/rig-parameterization.test.ts` untouched and must stay green (punk byte-for-byte).

## Part 5 — docs + bookkeeping

- `docs/NX-TOUCH.md`: Part 0 steps, the data path diagram, channel-base note, troubleshooting (USB Status=Error ⇒ no ONYX driver; faders dead ⇒ check ONYX sACN NIC = `interfaceIp`; why 6454 was avoided).
- Copy this plan to `docs/superpowers/specs/2026-08-21-nx-touch-onyx-sacn-bridge-design.md` (brainstorming spec gate) and commit on `feat/nx-touch`.
- After live verification: update memory `project_qlcplus_mcp_package.md` (NX Touch = bridged via ONYX sACN, not dead) and the 8/19 bookmark note.

## Verification (end-to-end, after the bar mitzvah)

1. `npx vitest run` green; punk regression byte-identical; `npm run generate` on a rig **without** controller3 produces an unchanged `.qxw` (`git diff` empty).
2. ONYX: NX Touch driver bound, NOVA+ shown, fader 1 changes U1 ch1 in an sACN viewer.
3. `npm run generate` on a copy of the bar-mitzvah rig with controller3 → open in QLC+ 4.14 → Inputs/Outputs tab: universe "NX Touch" has E1.31 **Input** ticked, universe 1, interface = `interfaceIp`. Save-As to a temp file and diff the `<PluginParameters>` QLC+ writes back against what we emit (attribute spelling proof).
4. Operate mode: fader 1 up → "Pars L" NX slider moves → pars brighten over whatever pad is lit; if the *second* fader moves it instead, the channel base is 1-based — flip `nxInput` to `fader` and re-run tests.
5. Flash pad → slider to full while held, returns to fader level on release. Fader at 0 → pads rule (HTP add, never override).
6. Dashboard + `qlc_list_widgets` unchanged (widget count identical to the pre-NX build). Launchpad + MiniLab still work.
7. Kill ONYX mid-show → NX faders freeze at last value / QLC+ unaffected; `start-show.ps1` prints the ONYX warning.

## Open items carried from the `/deep-research` ask (verify during build, none block starting)

QLC+ E1.31 input channel 0- vs 1-based · `PluginParameters` attribute spelling as QLC+ writes it back · ONYX sACN multicast loops back to the same host (fallback: ONYX unicast to `interfaceIp`, `multicast="0"`) · ONYX process/exe name · Qt interface order vs PowerShell sorted IPs.
