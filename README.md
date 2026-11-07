# QLC+ Lighting Control Stack

A complete, agent-driven lighting rig for [QLC+](https://www.qlcplus.org/) 4:

- **MCP server** (TypeScript) — Claude Code (or any MCP client) presses your light cues over OSC
- **Generated show** — your entire QLC+ workspace (`.qxw`), patch chart, and operator manual are *generated* from one `rig.json` describing your fixtures and stage
- **Web dashboard** — every look as a button in the browser, plus live server state and docs
- **3D stage monitor** — a Three.js view of your stage, lit in real time from Art-Net (rehearse the whole show with zero hardware)
- **Claude Code agent squad** — a setup wizard that interviews you about your rig and builds everything, plus specialist agents for every layer

```
 Claude Code ──┐
               ├─ MCP/HTTP :8788 ─> MCP server ── OSC/UDP :7700 ──> QLC+ 4 (Operate mode)
 Dashboard  ───┘   (/dashboard)         ^── feedback :9000 ──────────┘   │
                                                                    Art-Net U0 (:6454)
 3D monitor (:7800) <── SSE ── monitor/server.ts <──────────────────────┼──> DMX node ──> lights
 Launchpad Mini MK3 ── MIDI ────────────────────────────────────────────┘
```

## Prerequisites

| Requirement | Notes |
|---|---|
| **Windows + PowerShell** | The launcher scripts are PowerShell. The MCP server itself is cross-platform (Docker supported). |
| **Node.js ≥ 20.19** | `node --version` |
| **QLC+ 4.14.x** | ⚠️ **Exactly the 4.x line — NOT QLC+ 5.** The generated show uses the classic Virtual Console; QLC+ 5 will not load it. Get 4.14.x from [qlcplus.org](https://www.qlcplus.org/) (4 and 5 can coexist). Default expected at `C:\QLC+4\qlcplus.exe`; override with `$env:QLC_EXE`. |
| Modern browser (WebGL) | For the dashboard and 3D monitor. |
| *Optional:* DMX interface | An Art-Net node is the native path. **No hardware works too** — virtual rehearsal via the 3D monitor + QLC+'s own 2D Fixture Monitor is fully supported. |
| *Optional:* Novation Launchpad Mini MK3 | Hardware grid with LED feedback for every look. The launcher auto-engages it. |

## Quickstart

```powershell
git clone https://github.com/Adev-io/my-lil-qlc-mcp.git && cd my-lil-qlc-mcp
npm install && npm run build
claude        # open Claude Code in the repo
```

Then say **"set me up"**. The `rig-setup-wizard` agent takes over: it verifies prerequisites,
interviews you about your rig (fixtures, DMX addresses, stage measurements, DMX interface,
controller), writes your `rig.json` + `config/.env`, generates **your** show, launches
everything, and walks you through the QLC+-side steps until a look verifiably fires.

Prefer to drive manually? The same flow by hand:

```powershell
cp .env.example config/.env                  # set QLC_HOST if QLC+ runs on another machine
cp rigs/punk-rock-show.rig.json rig.json     # or write your own rig.json (schema: scripts/rig.ts)
npm run generate                             # -> <your-show>.qxw, PATCH-CHART.md, SETUP-MANUAL.html,
                                             #    monitor/fixtures.json, config/widgets.json
./start-show.ps1                             # QLC+ -> MCP server -> 3D monitor -> browser tabs
```

Open **SETUP-MANUAL.html** — it is generated *for your rig* and covers the QLC+ side:
fixture addressing (your patch chart), Art-Net output, OSC plugin (:7700 in / :9000 feedback),
Launchpad setup, and a troubleshooting table.

## The generative pipeline

`rig.json` is the single source of truth for your rig. Everything else is generated and
regenerates in sync:

```
rig.json ──┬─> scripts/build-show.ts    ─> <show>.qxw + PATCH-CHART.md + SETUP-MANUAL.html
           ├─> scripts/build-monitor.ts ─> monitor/fixtures.json   (3D stage layout)
           └─> (generate:widgets reads the .qxw) ─> config/widgets.json  (OSC control map)
```

- **`rig.json`** — fixture groups (kind/model/mode/channels/count/DMX addresses/channel roles),
  stage geometry (ft), performer positions (drives moving-head aim), controller, DMX output.
  Zod-validated with DMX overlap/overflow checks (`scripts/rig.ts`).
- **`npm run generate`** — rebuilds all of the above after any rig change.
- **Never hand-edit the `.qxw` or save over it inside QLC+** — it is written read-only on
  purpose. Rig facts go in `rig.json`; look design lives in the DATA TABLES of
  `scripts/build-show.ts` (wash colours, band looks, head positions, FX, song presets,
  the 3-page pad layout).
- Every look gets **two** bindings: an OSC button (path pre-baked as CRC-16 of
  `/lowercase_name` — no Auto-Detect needed) for the MCP/dashboard, and a Launchpad MIDI pad
  with LED feedback. Same look, same grid position, on hardware, screen, and dashboard.

**v1 honesty:** the look generator knows three fixture kinds — `par` (static wash), `bar`
(3-cell linear), `head` (moving head) — and assumes the channel *layouts* of the reference
fixtures (see the comment atop `build-show.ts`). Same-layout fixtures of any count work out of
the box (including zero — bar-only looks drop out cleanly on a barless rig). A different
layout (e.g. an 8ch RGBW par) means adapting the value builders — that's what the
`qlc-show-designer` agent is for.

## The worked example — Punk Rock Show

A complete real rig ships as the reference: **`rigs/punk-rock-show.rig.json`** →
`punk-rock-show.qxw` — 10× RGBWA+UV pars (floor uplight), 2× COLORband T3-BT (high sides),
2× Intimidator 375Z moving heads (front trusses), on a 20×10 ft stage. 160 looks, 176
functions, 3 Launchpad pages (boots on a minimal SIMPLE page), 5 group faders, performer-aimed
head positions. `PATCH-CHART.md` is its operator map.

Try it without touching your own rig config: `./start-show.ps1` with no `rig.json` falls back
to the example show — press pads in QLC+ or buttons in the dashboard and watch the 3D monitor
light up. The regression tests guarantee the example regenerates byte-for-byte.

## Running pieces individually

| What | Command | URL |
|---|---|---|
| Everything | `./start-show.ps1` | — |
| MCP server (HTTP + dashboard) | `npm run start:http` (or `npx tsx src/index.ts`) | http://127.0.0.1:8788/dashboard · `/mcp` · `/health` |
| 3D monitor only | `./start-monitor.ps1` or `npx tsx monitor/server.ts` | http://127.0.0.1:7800 (`/status`, SSE `/stream`) |
| Regenerate from rig.json | `npm run generate` | — |
| Tests | `npx vitest run` | — |

**Ports:** 8788 MCP+dashboard (TCP) · 7800 monitor (TCP) · 7700 OSC in / 9000 OSC feedback
(UDP) · 6454 Art-Net (UDP) · 9999 QLC+ web UI (only with `-w`).

**Claude Code MCP connection:** the repo's `.mcp.json` points at the running HTTP server
(`http://127.0.0.1:8788/mcp`). Start the stack first, then ask Claude to press looks. (One
server instance at a time — a second would fail binding the OSC feedback port.)

## MCP tools

| Tool | Purpose |
|---|---|
| `qlc_get_state` | OSC runtime state: configured host/ports, last command, whether QLC+ feedback was seen recently (the only real "is it alive" signal — UDP has no ACK) |
| `qlc_list_widgets` | The control surface from `config/widgets.json` (filter by type/text) |
| `qlc_button_press` | Fire a look by logical name (e.g. `Red R1C1`) or OSC path |
| `qlc_send_osc` | Raw OSC escape hatch — disabled unless `QLC_ALLOW_RAW_OSC=true` |
| `get_agent_prompt` | The recommended system prompt for agents driving this server (also a prompt resource) |

`QLC_DRY_RUN=true` logs every send without emitting UDP — ideal for testing path resolution.

## The agent squad (`.claude/agents/`)

| Agent | When |
|---|---|
| `rig-setup-wizard` | Fresh clone / new venue — interviews you, builds and verifies everything |
| `qlc-orchestrator` | Any cross-cutting task; routes to the others and defines "done" |
| `qlc-show-designer` | Looks/presets for your music, new fixture layouts, head-aim geometry |
| `mcp-server-engineer` / `osc-protocol-engineer` / `widget-mapper` / `dashboard-frontend` / `devops-deploy` / `test-qa` | Layer specialists — see `.claude/agents/README.md` |

## Configuration (`config/.env`)

Copy `.env.example` → `config/.env`. The ones that matter:

```bash
QLC_HOST=127.0.0.1        # IP of the machine running QLC+ (LAN IP if remote)
QLC_OSC_INPUT_PORT=7700   # QLC+ OSC input
QLC_OSC_OUTPUT_PORT=9000  # QLC+ OSC feedback (server listens)
HTTP_PORT=8788            # MCP server + dashboard
MCP_AUTH_MODE=none        # 'bearer' + MCP_AUTH_TOKEN for anything beyond trusted LAN
QLC_ALLOW_RAW_OSC=false   # gate the raw OSC tool
QLC_DRY_RUN=false         # log sends without UDP
```

Full reference: `docs/MCP-CONFIG.md`. Docker/compose supported (`docker-compose.yml`) — set
`QLC_HOST` to the QLC+ machine's LAN IP and publish the UDP ports.

## Project structure

```
rig.json                  # YOUR rig (written by the wizard; gitignored)
rigs/                     # example rig configs (punk-rock-show.rig.json)
scripts/                  # rig.ts (schema) + build-show / build-monitor / manual / generate-all
src/                      # MCP server: tools/, osc/, qlc/ (widget pipeline), dashboard/, transports/
monitor/                  # 3D monitor: Art-Net listener + SSE server + Three.js client (vendored)
config/                   # .env (machine-specific, gitignored) + widgets.json (generated)
fixtures/                 # custom QLC+ fixture definitions (.qxf) to install
docs/                     # OSC-REFERENCE, MCP-CONFIG, CHEAT-SHEET, OPERATING-PLAYBOOK, design specs
tests/                    # vitest — incl. rig-parameterization regression suite
start-show.ps1            # one-shot launcher; engage-launchpad.ps1; start-monitor.ps1
SETUP-MANUAL.html         # generated, rig-specific operator manual — open this on show day
PATCH-CHART.md            # generated DMX patch + pad map
```

## Troubleshooting (the short list)

| Symptom | Fix |
|---|---|
| QLC+ opens a blank workspace | Launched without `--open`, **or you opened the show in QLC+ 5** — use 4.14.x |
| Looks "send" but nothing happens | QLC+ not in **Operate** mode, OSC plugin not on :7700, or wrong `QLC_HOST`. Check `qlc_get_state` — no recent feedback means QLC+ isn't talking back |
| `EADDRINUSE 0.0.0.0:9000` | A second server instance (or `oscdump`) holds the feedback port — one listener only |
| Launchpad pads dark/dead | Programmer Mode dropped (hold **Session** → **Stop Solo Mute**), or wrong MIDI port — use **MIDIIN2/MIDIOUT2** in QLC+ Inputs/Outputs |
| Monitor shows nothing | QLC+ Art-Net output not on Universe 0, or `monitor/fixtures.json` stale — `npm run generate` |
| Widget not found | Stale `config/widgets.json` after a show change — `npm run generate`, restart the server |

The generated `SETUP-MANUAL.html` has the full table, plus the OSC protocol details in
`docs/OSC-REFERENCE.md` and runtime procedures in `docs/OPERATING-PLAYBOOK.md`.

## Related projects

- [XMSeries-MCP](https://github.com/infrafast/XMSeries-MCP) — the sister project this MCP
  server's core descends from (part of the [infrafast](https://github.com/infrafast) ecosystem)
- [qlcplus-http-api](https://github.com/wwwil/qlcplus-http-api) — Go REST wrapper over QLC+'s
  websocket API (:9999); an alternative control path this stack doesn't need but plays fine with
- [QLC+ documentation](https://docs.qlcplus.org/) · [OSC spec](https://opensoundcontrol.org/) ·
  [MCP protocol](https://modelcontextprotocol.io/) · [mcp-use](https://github.com/mcp-use/mcp-use)

## License

MIT
