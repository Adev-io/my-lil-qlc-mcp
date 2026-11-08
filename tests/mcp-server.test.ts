import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { text, type ToolDefinition } from "../src/mcp/tool";

// agentPrompt.ts resolves PROMPT_FILE at import time, so the env var must be
// set before the dynamic imports in beforeAll.
const dir = mkdtempSync(path.join(tmpdir(), "qlc-mcp-"));
const promptFile = path.join(dir, "PROMPT.md");
writeFileSync(promptFile, "# test prompt\n");
process.env.MCP_PROMPT_FILE = promptFile;

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

describe("createMcpServer", () => {
  let client: Client;

  beforeAll(async () => {
    const { createMcpServer } = await import("../src/mcp/server");
    const { createAgentPromptTool } = await import("../src/agentPrompt");
    const server = createMcpServer([okTool, boomTool, createAgentPromptTool()]);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
  });

  it("identifies as qlcplus-mcp", () => {
    expect(client.getServerVersion()?.name).toBe("qlcplus-mcp");
  });

  it("lists every registered tool", async () => {
    const r = await client.listTools();
    expect(r.tools.map((t) => t.name).sort()).toEqual(["boom_tool", "get_agent_prompt", "ok_tool"]);
  });

  it("calls a tool and returns the text() shape", async () => {
    const r = await client.callTool({ name: "ok_tool", arguments: {} });
    expect(r.isError).toBeFalsy();
    expect((r.content as any)[0]).toEqual({ type: "text", text: "ok" });
  });

  it("turns a throwing tool into an isError result", async () => {
    const r = await client.callTool({ name: "boom_tool", arguments: {} });
    expect(r.isError).toBe(true);
    expect((r.content as any)[0].text).toContain("boom");
  });

  it("serves PROMPT.md as the agent_prompt prompt", async () => {
    const r = await client.getPrompt({ name: "agent_prompt" });
    expect(r.messages[0].role).toBe("user");
    expect((r.messages[0].content as any).text).toBe("# test prompt\n");
  });

  it("serves PROMPT.md as the agent://prompt/system resource", async () => {
    const list = await client.listResources();
    expect(list.resources.map((x) => x.uri)).toContain("agent://prompt/system");
    const r = await client.readResource({ uri: "agent://prompt/system" });
    expect(r.contents[0].mimeType).toBe("text/markdown");
    expect((r.contents[0] as any).text).toBe("# test prompt\n");
  });

  it("serves PROMPT.md through the get_agent_prompt tool", async () => {
    const r = await client.callTool({ name: "get_agent_prompt", arguments: {} });
    expect((r.content as any)[0].text).toBe("# test prompt\n");
  });
});
