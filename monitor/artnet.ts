// Art-Net (ArtDMX) receiver for the 3D monitor.
//
// QLC+ broadcasts the Punk Rock Show on Art-Net Universe 0 (UDP 6454) whenever it
// runs — physical rig or not. This module turns those packets into the latest DMX
// frame. `parseArtDmx` is pure (and unit-tested); `createArtNetListener` wires it to
// a dgram socket. No dependency on the live MCP code path.

import dgram from "node:dgram";

export const ARTNET_PORT = 6454;
const HEADER = "Art-Net\0"; // 8 bytes, NUL-terminated
const OP_DMX = 0x5000; // ArtDmx opcode (stored little-endian on the wire)

export interface ArtDmxPacket {
  universe: number; // 15-bit Port-Address (Net<<8 | SubUni)
  length: number; // number of DMX data slots (1..512)
  sequence: number;
  data: Uint8Array; // `length` channel values, 0..255
}

/**
 * Parse one UDP datagram as an ArtDMX packet. Returns null for anything that
 * isn't a well-formed ArtDMX (wrong magic, wrong opcode, bad length, truncated).
 */
export function parseArtDmx(buf: Uint8Array): ArtDmxPacket | null {
  if (buf.length < 18) return null;
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== HEADER.charCodeAt(i)) return null;
  }
  const opcode = buf[8] | (buf[9] << 8); // little-endian
  if (opcode !== OP_DMX) return null;

  const sequence = buf[12];
  const subUni = buf[14];
  const net = buf[15];
  const universe = (net << 8) | subUni;
  const length = (buf[16] << 8) | buf[17]; // big-endian
  if (length < 1 || length > 512) return null;
  if (buf.length < 18 + length) return null;

  return { universe, length, sequence, data: new Uint8Array(buf.subarray(18, 18 + length)) };
}

export interface ArtNetListener {
  close(): void;
}

export interface ListenerOptions {
  universe?: number; // default 0
  port?: number; // default 6454
  bind?: string; // default 0.0.0.0
  onFrame: (data: Uint8Array, universe: number) => void;
  onError?: (err: Error) => void;
  onListening?: (address: string, port: number) => void;
}

/** Bind a UDP socket and deliver matching-universe DMX frames to `onFrame`. */
export function createArtNetListener(opts: ListenerOptions): ArtNetListener {
  const universe = opts.universe ?? 0;
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });

  sock.on("message", (msg) => {
    const pkt = parseArtDmx(msg);
    if (pkt && pkt.universe === universe) opts.onFrame(pkt.data, pkt.universe);
  });
  sock.on("error", (err) => opts.onError?.(err));
  sock.on("listening", () => {
    const a = sock.address();
    opts.onListening?.(a.address, a.port);
  });

  sock.bind(opts.port ?? ARTNET_PORT, opts.bind ?? "0.0.0.0");
  return { close: () => sock.close() };
}
