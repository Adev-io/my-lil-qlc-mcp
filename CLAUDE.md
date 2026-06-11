# QLC+ Lighting Control Stack — Claude Code Guide

An MCP-driven lighting rig: a TypeScript MCP server controls QLC+ 4.14.x over OSC, a
generated show provides every look as a pressable widget, a web dashboard mirrors the
control surface, and a Three.js 3D monitor renders the stage live from Art-Net.

## FIRST RUN — read this before anything else

**If there is no `rig.json` at the repo root, this is a fresh install.** Do not try to run
servers or generators yet — launch the **`rig-setup-wizard`** agent and let it drive. It will:

1. Verify prerequisites (Node ≥ 20.19, **QLC+ 4.14.x — NOT QLC+ 5**, `npm install` + build).
2. Interview the user about their rig — fixtures, DMX addresses, stage measurements,
   DMX interface (Art-Net node / USB / none-virtual), Launchpad or not.
3. Write `rig.json` + `config/.env`, run `npm run generate` to build THEIR show
   (.qxw, patch chart, setup manual, 3D monitor layout, widget map).
4. Launch everything via `./start-show.ps1` and verify a look fires end to end.

The worked example (look, don't edit): `rigs/punk-rock-show.rig.json` → `punk-rock-show.qxw`
(14 fixtures, 160 looks, 3 Launchpad pages) + `PATCH-CHART.md` + `SETUP-MANUAL.html`.

## Normal operation

| What | How |
|------|-----|
| Launch the full stack | `./start-show.ps1` (Launchpad → QLC+ Operate → MCP server → 3D monitor → browser) |
| Dashboard | http://127.0.0.1:8788/dashboard |
| 3D monitor | http://127.0.0.1:7800 |
| MCP endpoint (this repo's `.mcp.json` points here) | http://127.0.0.1:8788/mcp |
| Regenerate after a rig/look change | `npm run generate` |
| Tests | `npx vitest run` |
| Build | `npm run build` |

Ports: 8788 MCP+dashboard · 7800 monitor · 7700/9000 OSC in/feedback (UDP) · 6454 Art-Net (UDP).

## Hard rules

- **The show is generated.** Never hand-edit a `.qxw` or save over it inside QLC+ — edit
  `rig.json` (rig facts) or `scripts/build-show.ts` (look design) and run `npm run generate`.
  The generated file is intentionally written read-only.
- **QLC+ 4.14.x only.** QLC+ 5's Virtual Console cannot load these shows.
- **Never invent OSC paths.** Valid paths live in `config/widgets.json` (pre-baked by the
  generator). UDP OSC has no ACK — "sent" is not "applied"; verify via `qlc_get_state`
  feedback, the 3D monitor, or a visible light change.
- `config/.env` and `rig.json` are machine-specific and gitignored — never commit them with
  someone's LAN IPs unless the user wants their rig versioned (then it's their call).
- One MCP server instance at a time — a second instance fails binding the OSC feedback
  port (:9000). Claude Code connects to the running HTTP server via `.mcp.json`.

## Agent squad (`.claude/agents/`)

`rig-setup-wizard` (first run) · `qlc-orchestrator` (routes everything — start here when
unsure) · `qlc-show-designer` (looks, fixtures, aim geometry) · `mcp-server-engineer` ·
`osc-protocol-engineer` · `widget-mapper` · `dashboard-frontend` (dashboard + 3D monitor UI) ·
`devops-deploy` · `test-qa`. Details: `.claude/agents/README.md`.

## Key docs

- `README.md` — install, architecture, quickstart
- `SETUP-MANUAL.html` — rig-specific operator manual (regenerated per rig)
- `PATCH-CHART.md` — DMX patch + pad map (regenerated per rig)
- `docs/OSC-REFERENCE.md`, `docs/MCP-CONFIG.md`, `docs/CHEAT-SHEET.md`, `docs/OPERATING-PLAYBOOK.md`
- `PROMPT.md` — the system prompt the `get_agent_prompt` tool serves to MCP clients
