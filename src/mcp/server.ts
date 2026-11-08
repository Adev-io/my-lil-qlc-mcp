import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PROMPT_NAME, PROMPT_RESOURCE_URI, readAgentPrompt } from "../agentPrompt.js";
import type { ToolDefinition } from "./tool.js";

export const SERVER_INFO = { name: "qlcplus-mcp", version: "1.0.0" } as const;

const PROMPT_DESCRIPTION =
  "Recommended system prompt for agents controlling QLC+ lighting through this MCP server.";

/**
 * Build a fresh official McpServer with every tool, the PROMPT.md prompt and
 * the PROMPT.md resource registered. Cheap enough to call per HTTP request.
 */
export function createMcpServer(tools: ToolDefinition[]): McpServer {
  const server = new McpServer(SERVER_INFO);

  for (const t of tools) {
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: t.schema },
      async (args: any) => t.cb(args)
    );
  }

  server.registerPrompt(
    PROMPT_NAME,
    { title: "QLCPlus Lighting Assistant", description: PROMPT_DESCRIPTION },
    async () => ({
      description: PROMPT_DESCRIPTION,
      messages: [
        {
          role: "user",
          content: { type: "text", text: await readAgentPrompt() },
        },
      ],
    })
  );

  server.registerResource(
    "QLCPlus MCP Agent Prompt",
    PROMPT_RESOURCE_URI,
    {
      title: "QLCPlus Lighting Assistant Prompt",
      description: "Contents of PROMPT.md for agents that inject MCP resources into model instructions.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: await readAgentPrompt() }],
    })
  );

  return server;
}
