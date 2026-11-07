import { describe, it, expect, afterEach } from "vitest";
import dgram from "node:dgram";
import { initOsc, closeOsc } from "../src/osc/oscClient";
import { ConfigSchema } from "../src/config";

// Regression: initOsc used to bind qlcHost:qlcOscInputPort locally, which on a single
// machine shadows QLC+ itself and swallows every command the server sends.
describe("initOsc", () => {
  afterEach(async () => {
    await closeOsc();
  });

  it("leaves the QLC+ input port free so QLC+ can own it", async () => {
    const port = 17700;
    await initOsc(ConfigSchema.parse({ qlcHost: "127.0.0.1", qlcOscInputPort: port, qlcOscOutputPort: 19000 }));

    const probe = dgram.createSocket("udp4");
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.bind(port, "127.0.0.1", () => resolve());
    });
    probe.close();
    expect(true).toBe(true);
  });
});
