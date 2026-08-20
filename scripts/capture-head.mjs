// Read-only Art-Net capture for live moving-head plotting.
//
// Sniffs QLC+'s Art-Net Universe 0 (UDP 6454) and prints the two heads' current
// channel values as JSON. Used during a Simple Desk plotting session: the operator
// aims a head on the QLC+ faders, then we snapshot exactly what's on the wire.
//
// READ-ONLY: binds a socket with reuseAddr (coexists with the 3D monitor), receives
// frames, prints, exits. Sends nothing, writes no files, changes no DMX.
//
// Usage:  node scripts/capture-head.mjs ["label"]
//   Collects frames for ~500ms (skips fade transients) and emits the latest.
//   Exits 1 with a hint if no U0 frame arrives within the timeout.

import dgram from "node:dgram";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.MONITOR_PORT_ARTNET) || 6454;
const UNIVERSE = Number(process.env.MONITOR_UNIVERSE) || 0;
const SETTLE_MS = 500;   // collect frames this long, emit the most recent
const TIMEOUT_MS = 4000; // give up if nothing on U0
const label = process.argv[2] || null;

// --- head patch from rig.json (fallback: Chauvet 375Z @ 152/167) ------------
// EVERY head group, not just the first. The bar mitzvah rig has two: "Truss" @100/115 and
// "Floor" @130/145 — capturing only the first would silently leave the banner pair unplotted.
let addresses = [152, 167];
let roles = { pan: 0, panFine: 1, tilt: 2, tiltFine: 3, ptSpeed: 4, color: 5, gobo: 6, goboRot: 7, prism: 8, focus: 9, dim: 10, shutter: 11, ctrl: 12, mov: 13, zoom: 14 };
let groups = [];
try {
  const rig = JSON.parse(readFileSync(join(ROOT, "rig.json"), "utf8"));
  const heads = (rig.fixtures || []).filter((f) => f.kind === "head");
  if (heads[0]?.addresses?.length) addresses = heads[0].addresses;
  if (heads[0]?.roles) roles = { ...roles, ...heads[0].roles };
  // Key each head the way the plot sheet and rig.movingHeadSettings do: trussL, trussR, floorL...
  for (const g of heads) {
    const prefix = (g.namePrefix ?? "head").toLowerCase().replace(/[^a-z0-9]/g, "");
    (g.addresses ?? []).forEach((addr, i) => {
      groups.push({ key: `${prefix}${g.addresses.length === 2 ? (i === 0 ? "L" : "R") : i + 1}`, addr });
    });
  }
} catch { /* defaults */ }
if (groups.length === 0) groups = [{ key: "L", addr: addresses[0] }, { key: "R", addr: addresses[1] }];

// --- minimal ArtDMX parser (mirrors monitor/artnet.ts) ----------------------
const HEADER = "Art-Net\0";
function parseArtDmx(buf) {
  if (buf.length < 18) return null;
  for (let i = 0; i < 8; i++) if (buf[i] !== HEADER.charCodeAt(i)) return null;
  if ((buf[8] | (buf[9] << 8)) !== 0x5000) return null;
  const subUni = buf[14], net = buf[15];
  const universe = (net << 8) | subUni;
  const length = (buf[16] << 8) | buf[17];
  if (length < 1 || length > 512) return null;
  if (buf.length < 18 + length) return null;
  return { universe, data: buf.subarray(18, 18 + length) };
}

const STAGE = { 152: "stage-right", 167: "stage-left" };
function readHead(frame, base) {
  const at = (off) => frame[base + off] ?? 0;
  const pan = at(roles.pan), panFine = at(roles.panFine);
  const tilt = at(roles.tilt), tiltFine = at(roles.tiltFine);
  return {
    addr: base,
    stage: STAGE[base] ?? null,
    pan, panFine, pan16: pan * 256 + panFine,
    tilt, tiltFine, tilt16: tilt * 256 + tiltFine,
    ptSpeed: at(roles.ptSpeed),
    color: at(roles.color),
    gobo: at(roles.gobo),
    goboRot: at(roles.goboRot),
    prism: at(roles.prism),
    focus: at(roles.focus),
    dim: at(roles.dim),
    shutter: at(roles.shutter),
    ctrl: at(roles.ctrl),
    mov: at(roles.mov),
    zoom: at(roles.zoom),
  };
}

let latest = null;
const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
sock.on("message", (msg) => {
  const pkt = parseArtDmx(msg);
  if (pkt && pkt.universe === UNIVERSE) latest = pkt.data;
});
sock.on("error", (e) => { console.error(`capture: socket error ${e.message}`); process.exit(1); });

const giveUp = setTimeout(() => {
  console.error(`capture: no Art-Net U0 frame in ${TIMEOUT_MS}ms — is QLC+ outputting? (Operate mode + Simple Desk engaged?)`);
  process.exit(1);
}, TIMEOUT_MS);

// The 3D monitor is normally already bound to 6454 (start-show.ps1 launches it), and on Windows
// two sockets on the same port do not both get the frames — capture would just time out with
// QLC+ plainly running. The monitor re-broadcasts every frame on its SSE endpoint, so read it
// from there when it is up, and fall back to the raw socket when it is not.
const MON = process.env.MONITOR_URL || `http://127.0.0.1:${process.env.MONITOR_PORT || 7800}`;
async function fromMonitor() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    const res = await fetch(`${MON}/stream`, { signal: ctl.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return null;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const line = buf.slice(0, i).split("\n").find((l) => l.startsWith("data:"));
          buf = buf.slice(i + 2);
          if (!line) continue;
          const frame = Buffer.from(line.slice(5).trim(), "base64");
          if (frame.length >= 512) { clearTimeout(t); return frame; }
        }
      }
    } finally { clearTimeout(t); reader.cancel().catch(() => {}); }
  } catch { return null; }
}

function emit() {
  clearTimeout(giveUp);
  const heads = {};
  for (const g of groups) heads[g.key] = readHead(latest, g.addr);
  const out = {
    label,
    universe: UNIVERSE,
    heads,
    // Legacy aliases: the punk workflow reads .L / .R (first head group).
    L: readHead(latest, addresses[0]),
    R: readHead(latest, addresses[1]),
  };
  // human-readable summary to stderr, machine JSON to stdout
  const f = (h) => `pan ${h.pan} (16:${h.pan16})  tilt ${h.tilt} (16:${h.tilt16})  color ${h.color}  gobo ${h.gobo}  dim ${h.dim}  zoom ${h.zoom}  mov ${h.mov}`;
  console.error(`\n[capture${label ? " " + label : ""}]`);
  for (const g of groups) console.error(`  ${g.key.padEnd(7)} @${String(g.addr).padStart(3)}:  ${f(heads[g.key])}`);
  console.log(JSON.stringify(out));
  try { sock.close(); } catch { /* never bound: monitor path */ }
  process.exit(0);
}

const viaMonitor = await fromMonitor();
if (viaMonitor) {
  latest = viaMonitor;
  emit();
} else {
  sock.bind(PORT, "0.0.0.0", () => {
    // first matching frame arms a short settle window, then we emit the latest
    const armed = setInterval(() => {
      if (latest) { clearInterval(armed); setTimeout(emit, SETTLE_MS); }
    }, 30);
  });
}
