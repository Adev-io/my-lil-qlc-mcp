import { Hono } from "hono";
import { serve, type ServerType } from "@hono/node-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getLogger } from "../logger.js";
import { Config } from "../config.js";
import { createMcpServer } from "../mcp/server.js";
import type { ToolDefinition } from "../mcp/tool.js";
import { registerDashboard } from "../dashboard/registerDashboard.js";

export type HttpServerHandle = {
  port: number;
  close: () => Promise<void>;
};

function getConnectableHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") {
    return "127.0.0.1";
  }
  return host;
}

export async function startHttpServer(
  config: Config,
  tools: ToolDefinition[]
): Promise<HttpServerHandle> {
  const logger = getLogger();

  logger.info("Starting MCP server in HTTP mode");
  logger.debug({ tools: tools.map((t) => t.name) }, "Tools registered");

  // Build once at boot so a bad tool definition (e.g. a duplicate name) fails here,
  // at startup, instead of as a 500 on every /mcp request.
  createMcpServer(tools);

  const app = new Hono();

  if (config.authMode === "bearer") {
    app.use("*", async (c, next) => {
      // /health and the dashboard page itself are public; the dashboard's
      // /dashboard/api/* control endpoints stay behind the bearer check.
      if (
        c.req.path === "/health" ||
        c.req.path === "/dashboard" ||
        c.req.path === "/dashboard/"
      ) {
        return await next();
      }

      const authHeader = c.req.header("authorization") || "";
      if (!authHeader.startsWith("Bearer ")) {
        return c.json({ error: "Missing or invalid authorization" }, 401);
      }

      const token = authHeader.slice(7);
      if (token !== config.authToken) {
        return c.json({ error: "Invalid token" }, 403);
      }

      return await next();
    });
  }

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      service: "qlcplus-mcp",
      version: "1.0.0",
      transport: "http",
      uptime: process.uptime(),
    })
  );

  registerDashboard(app, tools, config);

  // ponytail: stateless per-request server + transport (the SDK's documented-safe
  // stateless pattern); switch to a session map if a client ever needs resumable SSE.
  // A stateless server has no stream to resume, so GET/DELETE answer 405 like the SDK's
  // own stateless example — otherwise every client would park an idle SSE stream here.
  app.on(["GET", "DELETE"], config.httpMcpPath, (c) =>
    c.json(
      { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null },
      405
    )
  );
  app.post(config.httpMcpPath, async (c) => {
    const server = createMcpServer(tools);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  const { nodeServer, port } = await new Promise<{ nodeServer: ServerType; port: number }>(
    (resolve, reject) => {
      const s = serve(
        { fetch: app.fetch, hostname: config.httpHost, port: config.httpPort },
        (info) => resolve({ nodeServer: s, port: info.port })
      );
      s.once("error", reject);
    }
  );

  const connectableHost = getConnectableHost(config.httpHost);
  const mcpUrl = "http://" + connectableHost + ":" + port + config.httpMcpPath;
  const healthUrl = "http://" + connectableHost + ":" + port + "/health";
  const agentConfig = {
    mcpServers: {
      qlcplus: {
        type: "streamable-http",
        url: mcpUrl,
        headers:
          config.authMode === "bearer" && config.authToken
            ? { Authorization: "Bearer " + config.authToken }
            : {},
        assistantOptions: {
          routing:
            "qlc,qlcplus,lumière,light,éclairage,scène,dmx,fixture,projecteur,couleur",
        },
      },
    },
  };

  logger.info("MCP server listening on http://" + config.httpHost + ":" + port + config.httpMcpPath);
  logger.info("Health endpoint: http://" + config.httpHost + ":" + port + "/health");
  logger.info("Dashboard: http://" + connectableHost + ":" + port + "/dashboard");
  logger.info("Agent MCP URL: " + mcpUrl);
  logger.info("Agent health URL: " + healthUrl);
  if (config.authMode === "bearer") {
    logger.info("Bearer token authentication enabled");
  } else {
    logger.info("HTTP auth: disabled");
  }
  logger.info("Agent HTTP MCP config:");
  logger.info(JSON.stringify(agentConfig, null, 2));

  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        nodeServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
