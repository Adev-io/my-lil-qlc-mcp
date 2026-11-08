import type { z } from "zod";

/** Exact shape the dashboard JS reads: body.isError, body.content[0].text. */
export type ToolResult = {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
};

export type ToolDefinition = {
  name: string;
  description: string;
  schema: z.ZodObject<any>;
  cb: (input: any) => Promise<ToolResult>;
};

export const text = (s: string): ToolResult => ({
  content: [{ type: "text", text: s }],
});

export const error = (s: string): ToolResult => ({
  isError: true,
  content: [{ type: "text", text: s }],
});
