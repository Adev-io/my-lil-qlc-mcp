import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Hono } from "hono";
import type { ToolDefinition } from "../mcp/tool.js";
import { SERVER_INFO } from "../mcp/server.js";
import type { Config } from "../config.js";
import { getLogger } from "../logger.js";
import { DASHBOARD_HTML } from "./dashboardPage.js";

/**
 * Mount the control + docs dashboard onto the server's Hono app.
 *
 * - GET  /dashboard            -> static single-page UI (exempted from bearer auth in http.ts)
 * - GET  /dashboard/api/meta   -> safe server config + registered tool list (token never returned)
 * - POST /dashboard/api/call   -> { name, input } invokes the already-registered tool callback
 *
 * Tool callbacks are reused directly, so the dashboard exercises the exact same
 * code path as MCP clients without a second JSON-RPC handshake or any CORS setup.
 */
export function registerDashboard(
  app: Hono,
  tools: ToolDefinition[],
  config: Config
): void {
  const logger = getLogger();
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  const servePage = (c: any) => c.html(DASHBOARD_HTML);
  app.get("/dashboard", servePage);
  app.get("/dashboard/", servePage);

  app.get("/dashboard/api/meta", (c: any) =>
    c.json({
      server: SERVER_INFO,
      config: {
        transport: config.transport,
        httpHost: config.httpHost,
        httpPort: config.httpPort,
        httpMcpPath: config.httpMcpPath,
        authMode: config.authMode,
        qlcHost: config.qlcHost,
        qlcOscInputPort: config.qlcOscInputPort,
        qlcOscOutputPort: config.qlcOscOutputPort,
        qlcUniverse: config.qlcUniverse,
        qlcWidgetsFile: config.qlcWidgetsFile,
        qlcAllowRawOsc: config.qlcAllowRawOsc,
        qlcDryRun: config.qlcDryRun,
      },
      tools: tools.map((t) => ({ name: t.name, description: t.description })),
    })
  );

  // Serves the generated ASCII patch chart (read fresh so a rebuild shows up
  // without restarting the server). Resolved relative to the process cwd, the
  // same convention used for config/widgets.json.
  app.get("/dashboard/api/patch-chart", async (c: any) => {
    try {
      const text = await readFile(path.resolve(process.cwd(), "PATCH-CHART.md"), "utf8");
      return c.text(text);
    } catch {
      return c.text("PATCH-CHART.md not found. Run: npx tsx scripts/build-show.ts", 404);
    }
  });

  app.post("/dashboard/api/call", async (c: any) => {
    let payload: any;
    try {
      payload = await c.req.json();
    } catch {
      return c.json(
        { isError: true, content: [{ type: "text", text: "Invalid JSON body" }] },
        400
      );
    }

    const name = payload?.name;
    const tool = name ? toolMap.get(name) : undefined;
    if (!tool) {
      return c.json(
        { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] },
        404
      );
    }

    // Validate with the tool's own zod schema so the dashboard mirrors MCP behavior.
    let args = payload?.input ?? {};
    const schema: any = (tool as any).schema;
    if (schema && typeof schema.safeParse === "function") {
      const parsed = schema.safeParse(args);
      if (!parsed.success) {
        return c.json(
          {
            isError: true,
            content: [
              { type: "text", text: "Invalid input: " + JSON.stringify(parsed.error.issues) },
            ],
          },
          400
        );
      }
      args = parsed.data;
    }

    try {
      const result = await (tool as any).cb(args);
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Dashboard tool call failed (${name}): ${message}`);
      return c.json({
        isError: true,
        content: [{ type: "text", text: "Tool error: " + message }],
      });
    }
  });

  logger.info("Dashboard mounted at /dashboard");
}
