// Local 3D-monitor server: Art-Net U0 in, browser out. Standalone — touches none of
// the live MCP code. Start with:  npx tsx monitor/server.ts   (or start-monitor.ps1)
//
//   QLC+ --Art-Net U0--> [createArtNetListener] --latest frame--> [SSE /stream] --> browser
//
// Routes:
//   GET  /              static index.html
//   GET  /app.js, /vendor/*   static assets (Three.js vendored for offline use)
//   GET  /fixtures.json fixture map merged with any monitor/layout.json position overrides
//   GET  /stream        Server-Sent Events; base64 DMX frames, pushed on change (~30 fps cap)
//   POST /layout        save dragged positions -> monitor/layout.json

import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createArtNetListener } from "./artnet.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "public");
const FIXTURES_FILE = path.join(HERE, "fixtures.json");
const LAYOUT_FILE = path.join(HERE, "layout.json");

const PORT = Number(process.env.MONITOR_PORT) || 7800;
const HOST = process.env.MONITOR_HOST || "127.0.0.1";
const UNIVERSE = Number(process.env.MONITOR_UNIVERSE) || 0;
const ARTNET_BIND = process.env.ARTNET_BIND || "0.0.0.0";
const FRAME_MS = 33; // ~30 fps broadcast cap

// --- DMX frame state --------------------------------------------------------
const frame = new Uint8Array(512);
let frameDirty = false;
let lastSent: string | null = null;
let lastFrameAt = 0;

createArtNetListener({
  universe: UNIVERSE,
  bind: ARTNET_BIND,
  onFrame: (data) => {
    frame.fill(0, data.length); // clear any tail beyond this packet's length
    frame.set(data.subarray(0, 512));
    frameDirty = true;
    lastFrameAt = Date.now();
  },
  onError: (err) => console.error(`[artnet] ${err.message}`),
  onListening: (addr, port) =>
    console.log(`[artnet] listening universe ${UNIVERSE} on ${addr}:${port}`),
});

// --- SSE clients ------------------------------------------------------------
const clients = new Set<http.ServerResponse>();

function framePayload(): string {
  return Buffer.from(frame).toString("base64");
}

setInterval(() => {
  if (!frameDirty || clients.size === 0) return;
  const payload = framePayload();
  if (payload === lastSent) {
    frameDirty = false;
    return;
  }
  lastSent = payload;
  frameDirty = false;
  for (const res of clients) res.write(`data: ${payload}\n\n`);
}, FRAME_MS);

// SSE keep-alive so proxies/clients don't drop an idle (no-cue) connection.
setInterval(() => {
  for (const res of clients) res.write(`: ping ${Date.now()}\n\n`);
}, 15000);

// --- fixtures + layout ------------------------------------------------------
async function fixturesWithLayout(): Promise<string> {
  const base = JSON.parse(await readFile(FIXTURES_FILE, "utf8"));
  try {
    const layout = JSON.parse(await readFile(LAYOUT_FILE, "utf8")); // { "<id>": [x,y,z] }
    for (const f of base.fixtures) {
      const p = layout[String(f.id)];
      if (Array.isArray(p) && p.length === 3 && p.every((n: unknown) => typeof n === "number")) {
        f.pos = p;
      }
    }
  } catch {
    /* no layout override yet — defaults from fixtures.json */
  }
  return JSON.stringify(base);
}

async function saveLayout(body: string): Promise<void> {
  const parsed = JSON.parse(body);
  const clean: Record<string, [number, number, number]> = {};
  for (const [id, p] of Object.entries(parsed)) {
    if (Array.isArray(p) && p.length === 3 && p.every((n) => typeof n === "number")) {
      clean[id] = p as [number, number, number];
    }
  }
  await writeFile(LAYOUT_FILE, JSON.stringify(clean, null, 2) + "\n", "utf8");
}

// --- static files -----------------------------------------------------------
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

async function serveStatic(res: http.ServerResponse, rel: string): Promise<void> {
  // Resolve under PUBLIC and refuse anything that escapes it (path traversal guard).
  const full = path.join(PUBLIC, rel);
  if (!full.startsWith(PUBLIC)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const buf = await readFile(full);
    res.writeHead(200, { "content-type": MIME[path.extname(full)] ?? "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404).end("not found");
  }
}

// --- server -----------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/stream") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(`retry: 2000\n\n`);
    res.write(`data: ${framePayload()}\n\n`); // prime with current state
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (req.method === "GET" && pathname === "/fixtures.json") {
    try {
      res.writeHead(200, { "content-type": MIME[".json"] });
      res.end(await fixturesWithLayout());
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
    return;
  }

  if (req.method === "GET" && pathname === "/status") {
    res.writeHead(200, { "content-type": MIME[".json"] });
    res.end(
      JSON.stringify({
        universe: UNIVERSE,
        clients: clients.size,
        lastFrameAt,
        ageMs: lastFrameAt ? Date.now() - lastFrameAt : null,
      })
    );
    return;
  }

  if (req.method === "POST" && pathname === "/layout") {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1_000_000) req.destroy(); // sanity cap
    });
    req.on("end", async () => {
      try {
        await saveLayout(body);
        res.writeHead(200, { "content-type": MIME[".json"] }).end(`{"ok":true}`);
      } catch (e) {
        res.writeHead(400).end(String(e));
      }
    });
    return;
  }

  if (req.method === "GET") {
    const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    await serveStatic(res, rel);
    return;
  }

  res.writeHead(405).end("method not allowed");
});

server.listen(PORT, HOST, () => {
  console.log(`[monitor] 3D monitor on http://${HOST}:${PORT}`);
  console.log(`[monitor] open that URL while QLC+ is running (Art-Net U0).`);
});
