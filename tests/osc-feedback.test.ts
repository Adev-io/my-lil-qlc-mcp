import { describe, it, expect, afterEach } from "vitest";
import dgram from "node:dgram";
import { initOsc, closeOsc, getOscRuntimeState } from "../src/osc/oscClient";
import { ConfigSchema } from "../src/config";

// Regression: QLC+ addresses VC button feedback "-1" (no leading slash). osc-js rejects that
// ("OSC Message found malformed or missing address string"), so qlc_get_state kept saying
// "no QLC+ feedback" while QLC+ was in fact talking back.
describe("OSC feedback listener", () => {
  afterEach(async () => {
    await closeOsc();
  });

  it("counts QLC+ feedback whose address is '-1'", async () => {
    const port = 19001;
    await initOsc(ConfigSchema.parse({ qlcHost: "127.0.0.1", qlcOscInputPort: 17701, qlcOscOutputPort: port }));

    // what QLC+ 4.14.4 really sends: "-1" , float 1.0
    const packet = Buffer.from("2d3100002c6600003f800000", "hex");
    const tx = dgram.createSocket("udp4");
    await new Promise<void>((resolve) => tx.send(packet, port, "127.0.0.1", () => resolve()));
    tx.close();
    await new Promise((r) => setTimeout(r, 200));

    const state = getOscRuntimeState();
    expect(state.feedbackCount).toBe(1);
    expect(state.lastFeedbackPath).toBe("-1");
    expect(state.lastFeedbackArgs).toEqual([1]);
    expect(state.feedbackSeenRecently).toBe(true);
  });
});
