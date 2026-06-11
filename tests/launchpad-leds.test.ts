import { describe, it, expect, beforeEach } from "vitest";
import { LaunchpadLeds, type LaunchpadPad } from "../src/launchpad/leds";

// The driver turns QLC+ OSC feedback into Mini MK3 RGB SysEx. LaunchpadLeds is pure (the byte sender
// is injected), so we drive it with a collector and assert the exact bytes — no hardware, no sidecar.

const PROGRAMMER_MODE_ON = [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x0e, 0x01, 0xf7];

// Two page-0 looks + one page-1 look that shares note 81 with the first (same pad, hotter tier).
const PADS: LaunchpadPad[] = [
  { note: 81, crc: 1001, path: "/a_l1_r1c1", page: 0, rgb: [200, 0, 0], momentary: false }, // page 0: red
  { note: 82, crc: 1002, path: "/b_l1_r1c2", page: 0, rgb: [0, 200, 0], momentary: false }, // page 0: green
  { note: 81, crc: 2001, path: "/a_l2_r1c1", page: 1, rgb: [0, 0, 200], momentary: false }, // page 1: blue
];

// Find the [R,G,B] a SysEx message sets for a note. Message = [..7-byte head.., (03 note r g b)*, F7].
function specFor(msg: number[], note: number): [number, number, number] | null {
  for (let i = 7; i + 5 <= msg.length - 1; i += 5) {
    if (msg[i] === 0x03 && msg[i + 1] === note) return [msg[i + 2], msg[i + 3], msg[i + 4]];
  }
  return null;
}

describe("LaunchpadLeds — OSC feedback -> MK3 RGB SysEx", () => {
  let sent: number[][];
  let leds: LaunchpadLeds;
  beforeEach(() => {
    sent = [];
    leds = new LaunchpadLeds(PADS, (b) => sent.push(b));
  });
  const last = () => sent[sent.length - 1];

  it("start() enters Programmer Mode, then paints page-0 idle (look colour x0.5)", () => {
    leds.start();
    expect(sent[0]).toEqual(PROGRAMMER_MODE_ON);
    expect(sent[1]).toHaveLength(328); // all 64 pads in one batched SysEx (7 head + 64*5 + 1 tail)
    expect(specFor(sent[1], 81)).toEqual([50, 0, 0]); // red @ 50%
    expect(specFor(sent[1], 82)).toEqual([0, 50, 0]); // green @ 50%
  });

  it("a press lights the pad full; release returns it to 50%", () => {
    leds.start();
    leds.onFeedback("/a_l1_r1c1", [1]);
    expect(specFor(last(), 81)).toEqual([100, 0, 0]); // red @ 100%
    leds.onFeedback("/a_l1_r1c1", [0]);
    expect(specFor(last(), 81)).toEqual([50, 0, 0]); // back to idle 50%
  });

  it("infers the page from the look's tier token and repaints idle for it", () => {
    leds.start(); // page 0
    leds.onFeedback("/a_l2_r1c1", [1]); // tier l2 -> page 1, then light the look
    expect(sent.some((m) => m.length === 328)).toBe(true); // an idle repaint happened
    expect(specFor(last(), 81)).toEqual([0, 0, 100]); // the page-1 look (blue) lit full
  });

  it("resolves numeric feedback paths by crc, and ignores unknown looks", () => {
    leds.start();
    leds.onFeedback("/1001", [1]); // numeric path -> crc 1001 -> note 81 (red)
    expect(specFor(last(), 81)).toEqual([100, 0, 0]);
    const n = sent.length;
    leds.onFeedback("/not_a_real_look_l1_r9c9", [1]); // unknown -> no paint
    expect(sent.length).toBe(n);
  });
});
