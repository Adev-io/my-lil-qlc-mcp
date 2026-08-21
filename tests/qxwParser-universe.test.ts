import { describe, expect, it } from "vitest";
import { parseQxwFile } from "../src/qlc/qxwParser";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const mini = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE Workspace>
<Workspace xmlns="http://www.qlcplus.org/Workspace" CurrentWindow="VirtualConsole">
 <Engine><InputOutputMap/></Engine>
 <VirtualConsole><Frame Caption="">
  <Button Caption="Osc Btn" ID="1"><Function ID="0"/><Action>Toggle</Action><Input Universe="0" Channel="123"/></Button>
  <Button Caption="Midi Btn" ID="2"><Function ID="0"/><Action>Toggle</Action><Input Universe="1" Channel="209"/></Button>
  <Slider Caption="Midi Knob" ID="3" WidgetStyle="Slider"><SliderMode>Level</SliderMode><Level LowLimit="0" HighLimit="255" Value="0"/><Input Universe="2" Channel="74"/></Slider>
 </Frame></VirtualConsole>
</Workspace>`;

describe("qxwParser — only OSC-bound widgets go in the map", () => {
  it("keeps Universe 0 and drops MIDI universes (they never answered an OSC path)", async () => {
    const f = path.join(os.tmpdir(), `mini-${process.pid}.qxw`);
    await fs.writeFile(f, mini, "utf8");
    const r = await parseQxwFile(f);
    expect(r.errors).toEqual([]);
    expect(r.widgets.map((w) => w.name)).toEqual(["Osc Btn"]);
  });
});
