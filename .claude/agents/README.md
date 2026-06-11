# QLC+ Stack — Specialist Agent Squad

Project-level Claude Code subagents for this QLC+ lighting-control stack. Each owns one part
of the system and carries that part's file paths, conventions, and gotchas. They load
automatically when you start Claude Code from the repo root.

## Roster
| Agent | Owns | Model |
|-------|------|-------|
| **rig-setup-wizard** | First-run onboarding: rig interview → rig.json + .env → generate → launch → verify. Start here on a fresh clone. | opus |
| **qlc-orchestrator** | Lead. Routes cross-cutting work, plans, defines "done". Start here when unsure. | opus |
| **mcp-server-engineer** | MCP tools, transports, config, server wiring (`src/`) | sonnet |
| **osc-protocol-engineer** | OSC/DMX, `oscClient.ts`, feedback, QLC+ OSC plugin | sonnet |
| **widget-mapper** | `.qxw` parsing, `widgets.json`, `generate:widgets`, resolver | sonnet |
| **dashboard-frontend** | `/dashboard` UI + `/dashboard/api/*` proxy + the 3D monitor web client | sonnet |
| **qlc-show-designer** | The show: rig.json, look design in `build-show.ts`, fixtures, QLC+ I/O setup | opus |
| **devops-deploy** | Docker, compose, `.env`, auth, build pipelines, the launcher | sonnet |
| **test-qa** | vitest, rig regression, dry-run, oscdump, end-to-end verification | sonnet |

## Using them
- Fresh clone? **rig-setup-wizard** interviews you and builds the stack around YOUR rig.
- Let the orchestrator route: *"use qlc-orchestrator to plan adding a master-dimmer end to end"*.
- Or invoke a specialist directly: *"have osc-protocol-engineer debug the EADDRINUSE on :9000"*.
- Independent specialists can run in parallel; sequential dependencies (a widget must exist before
  it's mapped) are called out in each agent.

## Typical flow — "add a new control end to end"
`qlc-show-designer` (add the look to the generator / rig.json → regenerate) → `widget-mapper`
(verify the regenerated map) → `mcp-server-engineer` / `osc-protocol-engineer` (expose it) →
`dashboard-frontend` (surface it) → `test-qa` (confirm via feedback or the 3D monitor).
`devops-deploy` ships it.
