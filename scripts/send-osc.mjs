// Fire a QLC+ Virtual Console button by OSC path (same path QLC+ matches via crc16), the way the
// MCP server does — for driving the rig from this session when the MCP tools aren't wired in here.
// Usage: node scripts/send-osc.mjs /band_v1 [value=1]
import OSC from "osc-js";
import dgram from "node:dgram";

const oscPath = process.argv[2];
if (!oscPath) { console.error("usage: node scripts/send-osc.mjs /path [value]"); process.exit(1); }
const valStr = process.argv[3];
// A bare "1" is an integer, which is what a BUTTON press wants. A decimal is a SLIDER position,
// 0.0-1.0. Caught on the rig: "1.0" parses to the JS number 1, osc-js then encodes it as an
// int32, and QLC+ reads that as DMX 1 — the fader looked dead at the top of its travel while
// 0.5 worked fine. Keep decimals just under 1 so they stay floats on the wire.
const val = valStr == null ? 1
  : valStr.includes(".") ? Math.min(parseFloat(valStr), 0.999)
  : parseInt(valStr, 10);
// QLC+ (Qt) binds 7700 on :: (IPv6 dual-stack). The MCP server also binds 127.0.0.1:7700 (IPv4),
// which steals IPv4 loopback packets — so target QLC+ over IPv6 loopback (::1) by default.
const host = process.env.QLC_HOST || "::1";
const port = Number(process.env.QLC_OSC_INPUT_PORT) || 7700;

const bin = new OSC.Message(oscPath, val).pack();
const buf = Buffer.from(bin instanceof Uint8Array ? bin : new Uint8Array(bin));
const sock = dgram.createSocket(host.includes(":") ? "udp6" : "udp4");
sock.send(buf, port, host, (err) => {
  console.log(err ? `ERR ${err.message}` : `sent OSC ${oscPath} ${val} -> ${host}:${port}`);
  sock.close();
});
