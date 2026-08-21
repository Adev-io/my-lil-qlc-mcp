# Obsidian NX Touch on QLC+ (via ONYX → sACN)

The NX Touch is **not** a MIDI or HID device. It enumerates as `USB\VID_11BE&PID_E808`,
USB class `FF/FF/FF` (vendor-specific, Martin/Obsidian). QLC+ has no plugin for it and never
will see it directly. ONYX does — and ONYX can emit what it is doing as sACN, which QLC+
*can* read. So ONYX runs alongside QLC+ purely as a translator.

```
NX Touch ─USB─▶ ONYX (10 cuelists, one Generic Dimmer each)
         ─sACN universe 1, multicast, on NIC <interfaceIp>─▶
QLC+ E1.31 INPUT (universe "NX Touch", ID 3) ─▶ 10 Playback sliders ─▶ the functions named in
rig.json controller3.faders, at fader level. Flash pad = ONYX bump → the channel hits 255 while held.
```

Playback sliders **add on HTP and own nothing** — at 0 the pads rule, raised they push that look
brighter. Same contract as the MiniLab twins (see `scripts/build-party.ts`, "MINILAB FRAME").

## One-time ONYX setup

1. Install ONYX 4.x (free, obsidiancontrol.com → Downloads). Plug the NX Touch in. Device
   Manager must show **NX Touch** with a driver bound (status OK). Status *Error / Unknown* =
   ONYX (and its driver) is not installed. ONYX's license panel should read **NOVA+**.
2. New show, call it `NX-to-QLC`. Patch **10 × Generic Dimmer** at universe 1, DMX 1–10.
3. Record 10 cuelists, one cue each — dimmer *n* at full — onto playbacks 1–10.
   Fader = cuelist intensity. Velocity pad under each fader = **Flash**. Save the show.
4. Menu → Network / EtherDMX: enable **sACN** output for universe 1 on the NIC whose IPv4 you
   put in `rig.json → controller3.interfaceIp`. (Why sACN and not Art-Net: UDP 6454 is already
   shared on the show laptop by QLC+'s Art-Net output and the 3D monitor; 5568 is clean.)
5. Prove it before touching QLC+: move fader 1 and watch an sACN viewer — or QLC+'s
   Inputs/Outputs tab, where the input indicator blinks — change universe 1 channel 1.

Encoders, the four parameter faders and bank buttons are not bridged (v1).

## rig.json

```json
"controller3": {
  "model": "Obsidian NX Touch",
  "bridge": "onyx-sacn",
  "sacnUniverse": 1,
  "interfaceIp": "10.201.6.1",
  "line": "0",
  "faders": ["Pars L Full", "Pars R Full", "Truss Full", "Banner Full", "UV Full", "Warm Full"]
}
```

- `faders[i]` is a **function name** in the show; NX fader *i+1* runs it. Unknown name = build error.
- `line` is QLC+'s E1.31 line for that NIC: the plugin lists interfaces **sorted by IP string**, so
  `10.x` sorts before `127.0.0.1` before `192.168.x`. `start-show.ps1` prints its best guess when
  the two disagree; confirm in QLC+ → Inputs/Outputs → universe "NX Touch" → E1.31 input.
- QLC+ input channels are 0-based: ONYX DMX address *n* arrives as channel *n−1*. The generator
  does that subtraction. If fader 1 moves the *second* slider, that assumption was wrong —
  flip `nxInput` in `build-party.ts` and re-run the tests.

Then `npm run generate` and `./start-show.ps1`. The launcher warns when the NIC is down or ONYX
is not running; set `ONYX_EXE` in `config/.env` (or the environment) to have it start ONYX.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Device Manager: NX Touch status Error/Unknown | No ONYX driver — install ONYX |
| ONYX shows FREE, not NOVA+ | NX Touch not detected by ONYX; replug, check driver |
| Fader moves nothing in QLC+ | ONYX sACN not enabled on `interfaceIp`, or QLC+ input `line` points at another NIC |
| Fader *n* moves slider *n+1* | channel base wrong — see above |
| Faders dead after a network change | NIC list changed → E1.31 line index moved; fix `line`, regenerate |
