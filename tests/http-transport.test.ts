import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ConfigSchema, type Config } from "../src/config";
import { text, type ToolDefinition } from "../src/mcp/tool";
import type { HttpServerHandle } from "../src/transports/http";

// agentPrompt.ts resolves PROMPT_FILE at import time, so the env var must be set before the dynamic imports in beforeAll.
const dir = mkdtempSync(path.join(tmpdir(), "qlc-mcp-http-"));
const promptFile = path.join(dir, "PROMPT.md");
writeFileSync(promptFile, "# http prompt\n");
process.env.MCP_PROMPT_FILE = promptFile;

const TOKEN = "test-token";

const okTool: ToolDefinition = {
  name: "ok_tool",
  description: "returns ok",
  schema: z.object({ n: z.number().optional() }),
  cb: async () => text("ok"),
};

const boomTool: ToolDefinition = {
  name: "boom_tool",
  description: "throws",
  schema: z.object({}),
  cb: async () => {
    throw new Error("boom");
  },
};

describe("HTTP transport", () => {
  let handle: HttpServerHandle;
  let base: string;

  beforeAll(async () => {
    const { startHttpServer } = await import("../src/transports/http");
    const { createAgentPromptTool } = await import("../src/agentPrompt");
    // ConfigSchema rejects port 0 (min 1); override after parsing so the OS picks a free port.
    const config: Config = {
      ...ConfigSchema.parse({
        transport: "http",
        httpHost: "127.0.0.1",
        authMode: "bearer",
        authToken: TOKEN,
        qlcDryRun: true,
      }),
      httpPort: 0,
    };
    handle = await startHttpServer(config, [okTool, boomTool, createAgentPromptTool()]);
    base = `http://127.0.0.1:${handle.port}`;
  });

  afterAll(async () => {
    await handle?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const call = (body: unknown, token?: string) =>
    fetch(`${base}/dashboard/api/call`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

  it("binds an ephemeral port", () => {
    expect(handle.port).toBeGreaterThan(0);
  });

  it("GET /health is public", async () => {
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.status).toBe("ok");
    expect(j.service).toBe("qlcplus-mcp");
  });

  it("GET /dashboard is public and serves HTML", async () => {
    const r = await fetch(`${base}/dashboard`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
  });

  it("dashboard API: 401 without a token", async () => {
    const r = await call({ name: "ok_tool", input: {} });
    expect(r.status).toBe(401);
  });

  it("dashboard API: 403 with the wrong token", async () => {
    const r = await call({ name: "ok_tool", input: {} }, "nope");
    expect(r.status).toBe(403);
  });

  it("dashboard API: 200 and the tool result with the right token", async () => {
    const r = await call({ name: "ok_tool", input: {} }, TOKEN);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.content[0].text).toBe("ok");
  });

  it("dashboard API: 404 isError for an unknown tool", async () => {
    const r = await call({ name: "nope_tool", input: {} }, TOKEN);
    expect(r.status).toBe(404);
    const j = await r.json();
    expect(j.isError).toBe(true);
  });

  it("dashboard API: a throwing tool yields isError, not a 500", async () => {
    const r = await call({ name: "boom_tool", input: {} }, TOKEN);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.isError).toBe(true);
    expect(j.content[0].text).toContain("boom");
  });

  it("GET /dashboard/api/meta never returns the token", async () => {
    const r = await fetch(`${base}/dashboard/api/meta`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).not.toContain(TOKEN);
    expect(JSON.parse(body).tools.map((t: any) => t.name)).toContain("ok_tool");
  });

  it("GET /dashboard/ (trailing slash) is public too", async () => {
    const r = await fetch(`${base}/dashboard/`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
  });

  it("GET /dashboard/api/meta is behind the token", async () => {
    const r = await fetch(`${base}/dashboard/api/meta`);
    expect(r.status).toBe(401);
  });

  it("GET /dashboard/api/patch-chart is behind the token", async () => {
    const r = await fetch(`${base}/dashboard/api/patch-chart`);
    expect(r.status).toBe(401);
  });

  it("dashboard API: 400 isError when input fails the tool schema", async () => {
    const r = await call({ name: "ok_tool", input: { n: "x" } }, TOKEN);
    expect(r.status).toBe(400);
    const j = await r.json();
    expect(j.isError).toBe(true);
  });

  it("GET /mcp with a token answers 405 (stateless, nothing to stream)", async () => {
    const r = await fetch(`${base}/mcp`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(r.status).toBe(405);
  });

  it("POST /mcp is behind the bearer token", async () => {
    const r = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "t", version: "0" },
        },
      }),
    });
    expect(r.status).toBe(401);
  });

  it("an SDK client completes initialize, tools/list, prompts/list, resources/list over /mcp", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
    });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(transport);
    try {
      expect(client.getServerVersion()?.name).toBe("qlcplus-mcp");

      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name).sort()).toEqual(["boom_tool", "get_agent_prompt", "ok_tool"]);

      const prompts = await client.listPrompts();
      expect(prompts.prompts.map((p) => p.name)).toContain("agent_prompt");

      const resources = await client.listResources();
      expect(resources.resources.map((x) => x.uri)).toContain("agent://prompt/system");

      const r = await client.callTool({ name: "ok_tool", arguments: {} });
      expect((r.content as any)[0].text).toBe("ok");
    } finally {
      await client.close();
    }
  });

  it("dashboard API: 415 when the body is not application/json", async () => {
    const r = await fetch(`${base}/dashboard/api/call`, {
      method: "POST",
      headers: { "content-type": "text/plain", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ name: "ok_tool", input: {} }),
    });
    expect(r.status).toBe(415);
    const j = await r.json();
    expect(j.isError).toBe(true);
  });

  it("dashboard API: 413 when the body exceeds the limit", async () => {
    const r = await call({ name: "ok_tool", input: { pad: "x".repeat(70 * 1024) } }, TOKEN);
    expect(r.status).toBe(413);
  });

  it("POST /mcp without an SSE-capable Accept header answers 406", async () => {
    const r = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(r.status).toBe(406);
  });
});

describe("HTTP transport with authMode none", () => {
  let handle: HttpServerHandle;
  let base: string;

  beforeAll(async () => {
    const { startHttpServer } = await import("../src/transports/http");
    const config: Config = {
      ...ConfigSchema.parse({ transport: "http", httpHost: "127.0.0.1", qlcDryRun: true }),
      httpPort: 0,
    };
    handle = await startHttpServer(config, [okTool]);
    base = `http://127.0.0.1:${handle.port}`;
  });

  afterAll(async () => {
    await handle?.close();
  });

  it("serves the dashboard API without a token", async () => {
    const r = await fetch(`${base}/dashboard/api/meta`);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.config.authMode).toBe("none");
    expect(j.tools.map((t: any) => t.name)).toEqual(["ok_tool"]);
  });

  it("runs a tool without a token", async () => {
    const r = await fetch(`${base}/dashboard/api/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ok_tool", input: {} }),
    });
    expect(r.status).toBe(200);
    expect((await r.json()).content[0].text).toBe("ok");
  });
});
