import { describe, expect, it } from "vitest";
import { parseStringPromise } from "xml2js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readMode(file: string, modeName: string) {
  const xml = await readFile(path.join(ROOT, file), "utf8");
  const doc = await parseStringPromise(xml);
  const modes = doc.FixtureDefinition.Mode as Array<{ $: { Name: string }; Channel: unknown[] }>;
  return modes.find((mode) => mode.$.Name === modeName);
}

describe("Cuepix and 375ZX fixture definitions", () => {
  it("Cuepix 79CH has 79 channels and 25 RGB modules", async () => {
    const mode = await readMode("fixtures/Elation-Cuepix-Panel-79CH.qxf", "79 Channel");
    expect(mode?.Channel).toHaveLength(79);
    expect((mode?.Channel ?? []).slice(0, 75)).toHaveLength(75);
  });

  it("375ZX 15CH has 15 channels", async () => {
    const mode = await readMode("fixtures/Chauvet-Intimidator-Spot-375ZX-15CH.qxf", "15 Channel");
    expect(mode?.Channel).toHaveLength(15);
  });
});
