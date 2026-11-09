# Drop `mcp-use`, serve MCP on the official SDK — design

Date: 2026-11-07
Repo: Adev-io/my-lil-qlc-mcp (branch `feat/nx-touch`)

## Problem

GitHub Dependabot reports 90 open alerts on `main` (3 critical, 26 high, 50 moderate,
11 low). Local `npm audit` on the branch: 36 (3 critical, 14 high). Every critical and
high traces to one dependency: `mcp-use@1.28.0` (pinned exact). It ships its developer
CLI and inspector web UI as *runtime* dependencies — `@mcp-use/cli`, `@mcp-use/inspector`,
vite, react-router, tar, posthog-js → dompurify, an old hono, body-parser, proxy-addr.
None of that code runs when the show server runs.

`npm audit fix` (non-breaking) clears nothing. The only fix npm offers is `mcp-use@2.12.3`,
a major that removes the `mcp-use/server` entrypoint this code imports and still bundles
the CLI + inspector with peer deps on react 19 and vite. Upgrading is a rewrite that keeps
the bloat.

`@modelcontextprotocol/sdk@1.29.0` is itself in the audit (fixed in 1.31.1+; latest 1.32.2).

## Decision

Remove `mcp-use`. Build the server on `@modelcontextprotocol/sdk` directly, with Hono
(already a transitive dependency of the SDK) for the HTTP routes. Goal: 0 critical, 0 high
in `npm audit`, behaviour identical for MCP clients, the dashboard and the stdio launcher.

Rejected:
- **Dismiss alerts on GitHub** — decays with every new advisory on react/vite/tar; shows on
  a repo the mylilvj.com source page links to.
- **`mcp-use@2`** — rewrite anyway, bloat stays, adds react/vite peers.
- **Plain `node:http`, no Hono** — one fewer direct dep, ~40 more hand-written lines for
  the dashboard routes. Hono is already in the tree through the SDK, so it costs nothing.

## What `mcp-use` gives us today

Five things, nothing else:

| Symbol | Used in |
|---|---|
| `MCPServer` | `transports/http.ts`, `transports/stdio.ts` |
| `text()`, `error()` | 5 tool files, `agentPrompt.ts` |
| `ToolDefinition` type | all tool files, `index.ts`, `dashboard/registerDashboard.ts` |
| `server.app` (Hono) | `http.ts` (bearer middleware, `/health`), `registerDashboard.ts` (4 routes) |
| `server.prompt()`, `server.resource()` | `agentPrompt.ts` |

Tool definitions have the shape `{ name, description, schema: z.ZodObject, cb }`.
`text()` returns `{ content: [{ type: "text", text }] }`; `error()` returns the same with
`isError: true`. The dashboard JS reads `body.isError` and `body.content[0].text` from the
raw result, so these shapes are a contract.

## Design

### New: `src/mcp/server.ts` (~60 lines)

```ts
export type ToolResult = { isError?: boolean; content: Array<{ type: "text"; text: string }> };
export type ToolDefinition = {
  name: string;
  description: string;
  schema: z.ZodObject<any>;
  cb: (input: any) => Promise<ToolResult>;
};
export const text  = (s: string): ToolResult => ({ content: [{ type: "text", text: s }] });
export const error = (s: string): ToolResult => ({ isError: true, content: [{ type: "text", text: s }] });
export function createMcpServer(tools: ToolDefinition[]): McpServer;
```

`createMcpServer`:
1. `new McpServer({ name: "qlcplus-mcp", version: "1.0.0" })`.
2. For each tool: `server.registerTool(t.name, { description: t.description, inputSchema: t.schema }, t.cb)`.
   The SDK accepts a Zod object as `inputSchema` (zod `^3.25 || ^4.0`), so `t.schema` passes
   through unchanged — no `.shape` extraction. `zod@4.4.3` stays.
3. `registerPrompt(PROMPT_NAME, …)` and `registerResource("QLCPlus MCP Agent Prompt", PROMPT_RESOURCE_URI, …)`
   with the bodies currently in `agentPrompt.ts` (`registerPromptName`, `registerPromptResource`).
   Strings, titles, descriptions and mime type unchanged. `agentPrompt.ts` keeps
   `readAgentPrompt`, the constants and `createAgentPromptTool`; its two `register*`
   functions and `registerAgentPrompt` move here.

### `src/transports/stdio.ts`

```ts
const server = createMcpServer(tools);
const transport = new StdioServerTransport();
transport.onclose / onerror  — unchanged
await server.connect(transport);
```

The `server.nativeServer` cast and the manual `ListResourceTemplatesRequestSchema` handler
go: the official `McpServer` answers `resources/templates/list` itself once a resource is
registered.

### `src/transports/http.ts`

Hono app served by `@hono/node-server`. Same paths, same order as today:

1. `app.use("*", bearer)` when `config.authMode === "bearer"` — body unchanged (Hono
   context API is what the code already uses). Exemptions stay exactly `/health`,
   `/dashboard`, `/dashboard/`. `/mcp` stays behind the token.
2. `app.get("/health", …)` — unchanged.
3. `registerDashboard(app, tools, config)` — see below.
4. `app.all(config.httpMcpPath, async (c) => { … })` — per request:
   ```ts
   const server = createMcpServer(tools);
   const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
   await server.connect(transport);
   return transport.handleRequest(c.req.raw);
   ```
   Stateless, one server per request: the SDK's documented-safe stateless pattern, and what
   `mcp-use@1.28` did on its default path. Mark in code:
   `// ponytail: stateless per-request; session map if a client needs resumable SSE`.
5. `serve({ fetch: app.fetch, hostname: config.httpHost, port: config.httpPort })`, wrapped
   in a promise that resolves on `listening` and rejects on `error`, so a bind failure
   reaches the existing `logger.fatal` in `index.ts` instead of racing the log lines.
6. All `logger.info` lines (MCP URL, health URL, dashboard URL, agent config JSON) unchanged.

**Signature change:** `startHttpServer` returns `{ close(): Promise<void>; port: number }` so
the test can bind port 0 and shut down. `index.ts` ignores the return value.

### `src/dashboard/registerDashboard.ts`

First parameter becomes the Hono `app` (type `Hono`) instead of `{ app: { get, post } }`.
Calls change from `server.app.get(...)` to `app.get(...)`. The four handlers are unchanged
(`c.html`, `c.json`, `c.text`, `c.req.json()` are Hono's own API). Import of
`ToolDefinition` moves to `../mcp/server.js`.

### Tool files and `index.ts`

Seven files change one line: `from "mcp-use/server"` → `from "../mcp/server.js"`
(`index.ts`: `./mcp/server.js`). Bodies untouched.

### `package.json`

- remove `mcp-use`
- `@modelcontextprotocol/sdk`: `^1.32.2`
- add `hono` and `@hono/node-server` as direct dependencies, caret-pinned to whatever the
  SDK bump resolves (today `4.12.x`, `1.19.x`) — no package enters the tree that the SDK
  did not already bring
- restore `"license": "MIT"` (dropped on this branch by accident; `main` has it) — own commit

### Untouched

OSC client, widget resolver, Launchpad LED driver, monitor, every script under `scripts/`,
every `.qxw` and rig file, `dashboardPage.ts` HTML/JS, `Dockerfile`, `docker-compose.yml`
(`npm run start:http` remains the entry).

## Error handling

Nothing new is invented; today's behaviour is preserved:

- Tool `cb` throws under MCP → the SDK returns an `isError` result to the client.
- Tool `cb` throws under `/dashboard/api/call` → existing try/catch returns
  `{ isError: true, content: [...] }` (unchanged).
- Bad JSON / wrong `Accept` / malformed JSON-RPC on `/mcp` → the transport's own 4xx
  JSON-RPC error; not intercepted.
- Bearer: 401 missing header, 403 wrong token, exemptions as listed above.
- Listen failure → rejected promise → `logger.fatal` + exit (existing path in `index.ts`).

## Testing

Written **before** the swap and run green against the current `mcp-use` build, so the
tests are known-good and then gate the rewrite.

### `tests/http-transport.test.ts`

Setup: `startHttpServer` with `httpPort: 0`, `httpHost: "127.0.0.1"`, `authMode: "bearer"`,
`authToken: "t"`, two fake tools (one returns `text("ok")`, one throws) plus the real
`createAgentPromptTool()` with `MCP_PROMPT_FILE` pointed at a temp file.

Assertions:
1. `GET /health` → 200, `status: "ok"`, no token needed.
2. `POST /dashboard/api/call` → 401 without header; 403 wrong token; 200 with token and
   `content[0].text === "ok"`; unknown tool → 404 `isError`; throwing tool → 200 `isError: true`.
3. `GET /dashboard` → 200 without token (exemption holds).
4. `POST /mcp` (`Accept: application/json, text/event-stream`, token) with `initialize`
   → 200, `result.serverInfo.name === "qlcplus-mcp"`.
5. `tools/list` → contains the three fake/real tool names; `prompts/list` contains
   `agent_prompt`; `resources/list` contains `agent://prompt/system`.
6. `POST /mcp` without token → 401.
7. `close()` resolves; vitest exits without open handles.

### `tests/mcp-server.test.ts`

`createMcpServer(tools)` connected to a `Client` over `InMemoryTransport.createLinkedPair()`
(both from the SDK): `tools/list` names match, `tools/call` on the text tool returns
`content[0].text === "ok"`, `prompts/get agent_prompt` returns the temp file's text,
`resources/read agent://prompt/system` returns it as `text/markdown`. This covers the core
both transports share without spawning a stdio child.

### Done check

- `npm audit` → 0 critical, 0 high (report the moderate/low count; expected ~0).
- `npx vitest run` green, `npx tsc --noEmit` clean.
- `npm run start:http`, then Claude Code `claude mcp add --transport http qlc http://127.0.0.1:8788/mcp`
  and press one look with `QLC_DRY_RUN=1`; dashboard loads and presses the same look.
- `MCP_TRANSPORT=stdio` launch answers `tools/list` from Claude Code.

## Commits

1. `test: HTTP transport + dashboard smoke test, in-memory MCP core test` (green on mcp-use)
2. `feat: serve MCP on the official SDK + Hono, drop mcp-use` (package.json, lockfile, src)
3. `chore: restore MIT licence field in package.json`

## Implementation notes (2026-11-08)

Landed on `feat/nx-touch` as `a94c191..85ae381`. Deviations from the design above, all deliberate:

- **`src/mcp/tool.ts` holds `ToolDefinition`, `ToolResult`, `text()`, `error()`.** The design put them in
  `server.ts`; that would have made `agentPrompt.ts` (imports `text`) and `server.ts` (imports
  `readAgentPrompt`) an import cycle. Tool files import `../mcp/tool.js`.
- **`text()` no longer adds `_meta: { mimeType: "text/plain" }`.** `mcp-use` did. Nothing in `src/` or the
  dashboard reads it.
- **`GET`/`DELETE` on `/mcp` answer 405.** The design said `app.all`. In stateless mode a GET would have
  parked an idle SSE stream plus an orphan `McpServer` per client; the SDK's own stateless example
  answers 405 and the SDK client tolerates it silently.
- **`/mcp` requires `Accept: application/json, text/event-stream`** (SDK default; JSON-only `Accept`
  gets 406). `mcp-use` rewrote the header. Claude Code and the SDK client send both; the curl examples in
  `docs/MCP-CONFIG.md` were fixed.
- **`createMcpServer(tools)` also runs once at boot** so a duplicate tool name dies at startup instead of
  as a 500 per request.
- **Dashboard API hardening (not in the design, found in review):** `POST /dashboard/api/call` returns 415
  unless `Content-Type` is `application/json`, and `/dashboard/api/*` bodies are capped at 64 KB. Without
  it, in the default `authMode: none`, any open web page could fire a lighting tool with a cross-site
  `text/plain` POST that needs no preflight. The old server also sent `Access-Control-Allow-Origin: *`;
  the new one sends no CORS headers.
- **Tests were red-then-green, not green-on-mcp-use-first.** `mcp-use`'s `listen(0)` binds 3000 and hides
  its close handle, so the "known-good on the old build" step was impossible.
- **`vitest.config.ts` excludes `.claude/**`.** Stale worktree checkouts under `.claude/worktrees/` were
  being collected (9 red files).
- **`npm audit fix` was needed after the swap** (lockfile only, no majors): `mcp-use` was the unfixable
  root, but it was also blocking non-breaking bumps of express/ajv/vite transitive deps and `zod`.

Result: `npm audit` 0 critical / 0 high / 6 moderate (none in the runtime path: `@hono/node-server`
`serveStatic` which we never call, `qs` via the SDK's unused express router, vitest dev deps).
Suite 13 files / 172 passed in the owner's working tree; a clean checkout shows 169 passed plus one pre-existing red (`rig-parameterization` byte-match vs the committed `.qxw`, present on the base commit too, untouched here). Live check on the real stack passed: dashboard press, SDK client round-trip,
`claude mcp list` connected, stdio.

Follow-ups, not done here: the stdio server stays alive after stdin closes (OSC socket + Launchpad
driver), and a client that spawns it via `npx` on Windows kills `npx` but not the `node` child, which
then holds UDP :9000 — pre-existing, same under `mcp-use`; dry-run sends do not bump `sendCount`;
`close()` waits on keep-alive sockets (production never calls it).
