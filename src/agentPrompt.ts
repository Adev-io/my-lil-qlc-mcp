import { readFile } from "fs/promises";
import path from "path";
import { text, type ToolDefinition } from "./mcp/tool.js";
import { z } from "zod";

export const PROMPT_RESOURCE_URI = "agent://prompt/system";
export const PROMPT_NAME = "agent_prompt";
export const PROMPT_TOOL_NAME = "get_agent_prompt";
export const PROMPT_FILE = process.env.MCP_PROMPT_FILE
  ? path.resolve(process.env.MCP_PROMPT_FILE)
  : path.resolve(process.cwd(), "PROMPT.md");

export async function readAgentPrompt(): Promise<string> {
  return readFile(PROMPT_FILE, "utf8");
}

export function createAgentPromptTool(): ToolDefinition {
  return {
    name: PROMPT_TOOL_NAME,
    description:
      "Return the recommended system prompt for agents using QLCPlus-MCP. Use it to inject QLC+ lighting-specific safety rules, widget/scene guidance, and OSC/DMX constraints into the LLM context when the host supports that workflow.",
    schema: z.object({}),
    cb: async () => text(await readAgentPrompt()),
  };
}
