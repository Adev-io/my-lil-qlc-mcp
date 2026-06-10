import { describe, it, expect } from "vitest";
import { parseArtDmx } from "../monitor/artnet";
import { beamDirBuilder } from "../monitor/public/aim.js";

// Build a minimal, well-formed ArtDMX datagram for a given universe + data slots.
function artdmx(universe: number, data: number[]): Uint8Array {
  const buf = Buffer.alloc(18 + data.length);
  buf.write("Art-Net\0", 0, "latin1"); // 8-byte magic incl. NUL
  buf[8] = 0x00;
  buf[9] = 0x50; // opcode 0x5000 (ArtDmx), little-endian
  buf[10] = 0;
  buf[11] = 14; // protocol version
  buf[14] = universe & 0xff; // SubUni (low byte of 15-bit port-address)
  buf[15] = (universe >> 8) & 0xff; // Net (high byte)
  buf[16] = (data.length >> 8) & 0xff; // length hi (big-endian)
  buf[17] = data.length & 0xff; // length lo
  Buffer.from(data).copy(buf, 18);
  return new Uint8Array(buf);
}

describe("parseArtDmx", () => {
  it("parses a valid ArtDMX packet on universe 0", () => {
    const pkt = parseArtDmx(artdmx(0, [10, 20, 30, 255]));
    expect(pkt).not.toBeNull();
    expect(pkt!.universe).toBe(0);
    expect(pkt!.length).toBe(4);
    expect(Array.from(pkt!.data)).toEqual([10, 20, 30, 255]);
  });

  it("reads the 15-bit port-address spanning the net + subuni bytes", () => {
    expect(parseArtDmx(artdmx(5, [1]))!.universe).toBe(5);
    expect(parseArtDmx(artdmx(260, [1]))!.universe).toBe(260);
  });

  it("rejects a bad magic header", () => {
    const b = artdmx(0, [1, 2]);
    b[0] = 0x42;
    expect(parseArtDmx(b)).toBeNull();
  });

  it("rejects a non-ArtDMX opcode (e.g. ArtPoll 0x2000)", () => {
    const b = artdmx(0, [1, 2]);
    b[9] = 0x20;
    expect(parseArtDmx(b)).toBeNull();
  });

  it("rejects truncated packets", () => {
    expect(parseArtDmx(artdmx(0, [1, 2, 3]).subarray(0, 17))).toBeNull(); // shorter than header
    expect(parseArtDmx(artdmx(0, [1, 2, 3, 4]).subarray(0, 20))).toBeNull(); // length claims more data
  });
});

describe("beamDirBuilder reproduces the show's documented head aims", () => {
  // Unit vector from a head position to its aim target, in builder coords (ft).
  const unit = (from: number[], to: number[]) => {
    const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const L = Math.hypot(d[0], d[1], d[2]);
    return d.map((n) => n / L);
  };
  const close = (got: number[], exp: number[], tol = 0.03) =>
    got.every((n, i) => Math.abs(n - exp[i]) <= tol);

  it("Crowd Near (head L, pan 185 / tilt 108) aims at (0,-6,5)", () => {
    // Head L = (-10,0,8.5); crowd-near target (0,-6,5) — DMX from the build-show.ts aim() test.
    const got = beamDirBuilder(185, 108);
    const exp = unit([-10, 0, 8.5], [0, -6, 5]);
    expect(close(got, exp), `got ${got.map((n) => n.toFixed(3))} exp ${exp.map((n) => n.toFixed(3))}`).toBe(true);
  });

  it("pan 128 / tilt 128 = straight upstage, 37.5° below horizontal", () => {
    const [x, y, z] = beamDirBuilder(128, 128);
    expect(Math.abs(x)).toBeLessThan(1e-9); // no left/right offset
    expect(y).toBeGreaterThan(0); // points upstage (+Y)
    expect(z).toBeCloseTo(-Math.sin((37.5 * Math.PI) / 180), 3); // 37.5° down
  });

  it("crosses horizontal at tilt ≈ 92.6 (roof guard boundary)", () => {
    expect(beamDirBuilder(128, 93)[2]).toBeLessThan(0); // 93 -> just below horizontal (down)
    expect(beamDirBuilder(128, 92)[2]).toBeGreaterThan(0); // 92 -> above horizontal (up)
  });
});
