import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { parseQxwFile } from "../src/qlc/qxwParser";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Generate into a temp dir (QLC_BUILD_OUT) so running tests never clobbers the
// user's own generated show/docs at the repo root.
const OUT = path.join(os.tmpdir(), `qlc-build-show-test-${process.pid}`);
const QXW = path.join(OUT, "punk-rock-show.qxw");
const LEDS_JSON = path.join(OUT, "config", "launchpad-leds.json");
const EXAMPLE_RIG = path.join(ROOT, "rigs", "punk-rock-show.rig.json");

let names: string[] = [];
let baseNames: string[] = []; // names with the trailing " R#C#" pad-coordinate suffix stripped
let raw = "";

// The generator stamps every look caption with its tier + pad coordinate
// ("Band Red L1" at r0c1 -> "Band Red L1 R1C2"). Strip the coordinate to get the tier base name.
const stripCoord = (s: string): string => s.replace(/ R\d+C\d+$/, "");

// Launchpad pad channel bound to a look's MIDI (Universe-1) PRESS button. Each look emits two buttons
// (OSC + press); the OSC button (Universe 0) is emitted first and the press button (Universe 1, the
// pad channel) second, so the first Universe-1 match after the caption is the pad.
const padChOf = (caption: string): number | null => {
  const m = raw.match(new RegExp(`Caption="${caption} R\\dC\\d"[^]*?Universe="1" Channel="(\\d+)"`));
  return m ? Number(m[1]) : null;
};

// FixtureVal channel,value string for one scene + fixture (0 = Par 1, 12 = Head L, 13 = Head R).
const fv = (scene: string, id: number): string =>
  raw.match(new RegExp(`Name="${scene}">[^]*?<FixtureVal ID="${id}">([^<]*)<`))?.[1] || "";
const hv = (scene: string, id: 12 | 13): string => fv(scene, id);

beforeAll(async () => {
  // Regenerate from source (the example rig) into a temp dir, then parse the real artifact.
  execSync(`npx tsx scripts/build-show.ts "${EXAMPLE_RIG}"`, {
    cwd: ROOT, stdio: "inherit", env: { ...process.env, QLC_BUILD_OUT: OUT },
  });
  const result = await parseQxwFile(QXW);
  expect(result.errors).toEqual([]);
  names = result.widgets.map((w) => w.name);
  baseNames = names.map(stripCoord);
  raw = await fs.readFile(QXW, "utf8");
}, 60000);

describe("punk-rock-show generator — 3-page ENERGY LADDER", () => {
  it("still defines the base scene + chaser functions the ladder rows reuse", () => {
    for (const fn of ["Red", "Blue", "White", "Rainbow", "Police", "Strobe All", "Blinder",
      "Full On", "Park All", "Sound Active", "Heads Blackout", "Strobe Color", "Kill Strobe"])
      expect(raw).toContain(`Name="${fn}"`);
  });

  it("generates 120 per-tier BASE scenes (40 looks x 3 energy levels)", () => {
    for (const t of [1, 2, 3]) {
      expect(raw).toContain(`Name="Band White L${t}"`); // first opener
      expect(raw).toContain(`Name="Crowd Mag L${t}"`);  // last opener
      expect(raw).toContain(`Name="Cho Cross L${t}"`);  // last verse/chorus
    }
    expect((raw.match(/Name="[^"]+ L[123]"/g) || []).length).toBe(120);
  });

  it("keeps the head-motion chasers, autos, crossfade twins, FX chasers, Bar Scroll", () => {
    for (const fn of ["Head Circle", "Audience Sweep", "Cross Zigzag", "Pars Auto", "Bars Auto",
      "Pars Morph", "Bars Morph", "Color Stab", "Par Run", "Alt Flash", "Build Drop",
      "Pixel Bounce", "Mega Build", "Figure 8", "Tilt Dip", "Rainbow Fast", "Strobe Rainbow"])
      expect(raw).toContain(`Name="${fn}"`);
  });

  it("adds Bar Scroll as an RGBMatrix over a 6-cell Bars group", () => {
    expect(raw).toContain('Type="RGBMatrix"');
    expect(raw).toContain('Name="Bar Scroll"');
    expect(raw).toContain('<Algorithm Type="Script">Stripes</Algorithm>');
    expect(raw).toContain('<ControlMode>RGB</ControlMode>');
    expect(raw).toContain('<FixtureGroup ID="0">');
    expect(raw).toContain('<Size X="6" Y="1"/>');
    expect((raw.match(/<Head X="\d+" Y="0" Fixture="1[01]">[0-2]<\/Head>/g) || []).length).toBe(6);
  });

  it("has only 2 bars after the 2026-06-09 rig reduction", () => {
    expect(raw).toContain("<Name>Bar 1</Name>");
    expect(raw).toContain("<Name>Bar 2</Name>");
    expect(raw).not.toContain("<Name>Bar 3</Name>");
    expect(raw).not.toContain("<Name>Bar 4</Name>");
  });

  it("lays every page out with the same 4-band grammar (BASE r0-4 / STROBE r5 / CHASE r6 / UTIL r7)", () => {
    // PAD.rows = [209,199,189,179,169,159,149,139] (top row first).
    expect(padChOf("Band White L1")).toBe(209); // R1C1 — openers (BASE)
    expect(padChOf("Band UV L1")).toBe(216);    // R1C8
    expect(padChOf("Singer White L1")).toBe(199); // R2C1
    expect(padChOf("Vrs Sng Blue L1")).toBe(179); // R4C1 — verses (BASE)
    expect(padChOf("Strobe L1")).toBe(159);     // R6C1 — strobes
    expect(padChOf("Col Cycle L1")).toBe(149);  // R7C1 — chasers
    expect(padChOf("Strobe All L1")).toBe(139); // R8C1 — utility
    expect(padChOf("Full On L1")).toBe(145);    // R8C7 — utility
  });

  it("repeats the SAME grammar on all 3 energy pages — same pad, unique caption/OSC per tier", () => {
    for (const t of [1, 2, 3]) {
      expect(padChOf(`Band White L${t}`)).toBe(209); // R1C1 on every page (multipage-gated)
      expect(padChOf(`Strobe All L${t}`)).toBe(139); // R8C1 on every page
    }
    // the per-tier " L<n>" suffix makes each page's OSC path unique (no cross-page CRC collision)
    expect(names).toEqual(expect.arrayContaining(
      ["Band Red L1 R1C2", "Band Red L2 R1C2", "Band Red L3 R1C2"]));
  });

  it("the R8 utility row is identical on every page — the stable safety layer", () => {
    for (const t of [1, 2, 3])
      for (const u of ["Strobe All", "Blinder", "Sound Active", "Park All", "Heads Black",
        "Blackout", "Full On"])
        expect(baseNames).toContain(`${u} L${t}`);
    // R8C8 carries no look — it is the page-flip pad
    expect(baseNames.filter((n) => n.startsWith("Page"))).toEqual([]);
  });

  it("escalates colour energy P1 -> P2 -> P3 (Band Red darker at L1, white-punched at L3)", () => {
    expect(fv("Band Red L1", 0)).toContain("2,128"); // chill = half red on the par's R channel (ch2)
    expect(fv("Band Red L2", 0)).toContain("2,255"); // driving = full red
    expect(fv("Band Red L3", 0)).toContain("5,90");  // full-send = + white punch (ch5 W >= 90)
  });

  it("positions buttons RELATIVE to their frame (no double-offset / off-screen)", () => {
    // "Cho Cross L1" is BASE r4 c7; the BASE frame's top row is r0, so the button renders at the
    // frame-relative (7-0)*96+4 = 676, (4-0)*50+4 = 204 — not the absolute grid coord (which clipped).
    const m = raw.match(/Caption="Cho Cross L1 R5C8"[^]*?<WindowState[^>]*\bX="(\d+)" Y="(\d+)"/);
    expect(m).toBeTruthy();
    expect(Number(m![1])).toBe(676);
    expect(Number(m![2])).toBe(204);
  });

  it("stamps each look caption with its energy tier + R#C# pad coordinate", () => {
    expect(raw).toContain('Caption="Band White L1 R1C1"'); // page 1 top-left
    expect(raw).toContain('Caption="Band White L2 R1C1"'); // page 2 top-left (same pad, gated)
    expect(raw).toContain('Caption="Strobe All L1 R8C1"'); // utility bottom-left
    expect(names).toEqual(expect.arrayContaining(["Band White L1 R1C1", "Strobe All L3 R8C1"]));
  });

  it("shows the active pad by brightness — idle 30% dim, active 100% (no MK3 flash channel)", () => {
    // Each look emits only OSC + press (the MK3's hardware flash channel pad+256 doesn't animate on this
    // unit). Idle pads glow their colour at 30% (dimOf), the active look at 100%. No 395 / 465 feedback.
    expect(raw).not.toContain('Channel="395"');
    expect(raw).not.toContain('Channel="465"');
    // every Universe-1 feedback channel stays inside the pad range (139..216) — the static channel only.
    const chans = (raw.match(/Universe="1" Channel="(\d+)"/g) || []).map((m) => Number(m.match(/\d+/)![0]));
    expect(Math.max(...chans)).toBeLessThanOrEqual(216);
    // R8C1 press pad = 139: idle dim (LowerValue dimOf(6) = 2), active bright (UpperValue led = 6).
    const press = raw.match(/Caption="Strobe All L1 R8C1"[^]*?Universe="1" Channel="139"[^>]*\/>/)?.[0] || "";
    expect(press).toContain('LowerValue="2"');
    expect(press).toContain('UpperValue="6"');
  });

  it("labels are black except the two dark blackout pads (R8C5 / R8C6), which stay white", () => {
    // argb(0,0,0) = 4278190080 (black); argb(255,255,255) = 4294967295 (white).
    const fgOf = (cap: string): string | undefined =>
      raw.match(new RegExp(`Caption="${cap}"[^]*?<ForegroundColor>(\\d+)</ForegroundColor>`))?.[1];
    expect(fgOf("Band White L1 R1C1")).toBe("4278190080");   // a normal look -> black
    expect(fgOf("Vrs Sng Blue L2 R4C1")).toBe("4278190080"); // another page -> black
    expect(fgOf("Heads Black L1 R8C5")).toBe("4294967295");  // dark bg -> white
    expect(fgOf("Heads Black L3 R8C5")).toBe("4294967295");  // white on every page
    expect(fgOf("Blackout L2 R8C6")).toBe("4294967295");
  });

  it("uses SoloFrames for BASE+CHASE and plain Frames for STROBE+UTILITY (overlay vs one-at-a-time)", () => {
    expect(raw).toContain('<SoloFrame Caption="BASE L1"');
    expect(raw).toContain('<SoloFrame Caption="CHASE L1"');
    expect(raw).toContain('<Frame Caption="STROBE L1"');
    expect(raw).toContain('<Frame Caption="UTILITY L1"');
  });

  it("switches pages from a dedicated pad (R8C8) + keyboard; 3 energy pages; faders on every page", () => {
    expect(raw).toContain('<Multipage PagesNum="3" CurrentPage="0"/>'); // boots Page 1 (Level 1)
    expect(raw).toContain('<PagesLoop>True</PagesLoop>');               // one Next pad wraps 3 -> 1
    expect(raw).toContain('<Input Universe="1" Channel="146"/>');       // R8C8 = the energy-up toggle
    expect(raw).toContain('<Key>PgDown</Key>');
    expect(raw).toContain('<Key>PgUp</Key>');
    expect(raw).toContain('Page="2"'); // tier-3 sub-frames exist
    // the FADERS frame is a ROOT sibling of the multipage grid (no Page attr), so it shows on every page.
    expect(raw).toContain('<Frame Caption="FADERS" ID="9">');
    expect((raw.match(/<Slider Caption=/g) || []).length).toBe(5);
    expect(names).toEqual(expect.arrayContaining(["Pars Dim", "Bars Dim", "Heads Dim", "Strobe Rate", "Heads Zoom"]));
  });

  it("self-illuminates every scene (master dimmer FULL) so bars/pars light; Dim faders stay overrides", () => {
    // The "Red" wash scene's first par: ch0 dimmer 255, ch1 strobe 0, ch2 RED 255.
    expect(fv("Red", 0).startsWith("0,255,1,0,2,255")).toBe(true);
    // ...and every BAR in a wash scene drives ch12 (the T3-BT master dimmer) to 255 — the bug fix.
    expect(fv("Red", 10)).toContain("12,255");
    // the per-group Dim faders remain as Level overrides on the dimmer channels.
    const parsDim = raw.match(/<Slider Caption="Pars Dim"[^]*?<\/Slider>/)?.[0] || "";
    expect(parsDim).toContain('<Channel Fixture="0">0</Channel>');
    expect(parsDim).toContain(">Level</SliderMode>");
  });

  it("aims the heads at the band from the 2026-06-09 stage geometry", () => {
    // Heads are fixtures 12 (L) and 13 (R). The named POSITION scenes carry the canonical aim points.
    expect(hv("Singer", 12).startsWith("0,162,2,103")).toBe(true);
    expect(hv("Singer", 13).startsWith("0,94,2,103")).toBe(true);
    expect(hv("Guitar", 12).startsWith("0,156,2,113")).toBe(true);
    expect(hv("Guitar", 13).startsWith("0,90,2,99")).toBe(true);
    expect(hv("Drums", 12).startsWith("0,159,2,100")).toBe(true);
    expect(hv("Crowd Near", 12).startsWith("0,185,2,108")).toBe(true);
    expect(hv("Crowd Near", 13).startsWith("0,71,2,108")).toBe(true);
    expect(hv("Singer", 12).startsWith("0,128,2,128")).toBe(false); // not the dead-centre placeholder
  });

  it("gives band-member focus a wide beam (zoom) and leaves area looks fader-controlled", () => {
    const ch14 = (scene: string, id: 12 | 13): number | null => {
      const pairs = hv(scene, id).split(",").map(Number);
      for (let k = 0; k < pairs.length; k += 2) if (pairs[k] === 14) return pairs[k + 1];
      return null;
    };
    // Member looks (singer / guitar / bass / drums) force a wide pool so the performer stays lit.
    for (const m of ["Singer White L1", "Guitar Amber L2", "Bass Blue L3", "Drums Red L1", "Vrs Sng Cyan L2"])
      for (const id of [12, 13] as const) expect(ch14(m, id), `${m} fixture ${id} zoom`).toBe(200);
    // Area looks (wash / crowd / cross) set no zoom — the Heads Zoom fader owns ch14.
    for (const a of ["Band White L1", "Crowd White L2", "Cross White L3", "Cho Warm L1"])
      for (const id of [12, 13] as const) expect(ch14(a, id), `${a} fixture ${id} zoom`).toBeNull();
  });

  it("keeps the 8 aimed position scenes (no colour/gobo set, so the colour pads keep the wheel)", () => {
    for (const p of ["Singer", "Guitar", "Bass", "Drums", "Crowd Near", "Crowd Deep", "Stage Wash", "Park"])
      expect(raw).toContain(`Name="${p}"`);
    // channels 5/6 = colour/gobo — position scenes must NOT set them.
    const singerL = hv("Singer", 12);
    expect(singerL).not.toContain("5,0");
    expect(singerL).not.toContain("6,0");
  });

  it("keeps every aimed beam below horizontal (roof-safe)", () => {
    // tilt DMX 128 = 37.5° below horizontal at 0.9444 DMX/°; horizontal ≈ 92.6 → require ≥ 93.
    const SCENES = ["Singer", "Guitar", "Bass", "Drums", "Crowd Near", "Crowd Deep", "Stage Wash",
      "hCirc 1", "hCirc 2", "hCirc 3", "hCirc 4", "hCirc 5", "hCirc 6",
      "hSweep 1", "hSweep 2", "hSweep 3"];
    for (const s of SCENES) {
      for (const id of [12, 13]) {
        const pairs = fv(s, id).split(",").map(Number);
        let tilt = -1;
        for (let k = 0; k < pairs.length; k += 2) if (pairs[k] === 2) tilt = pairs[k + 1];
        expect(tilt, `${s} fixture ${id} tilt`).toBeGreaterThanOrEqual(93);
      }
    }
  });

  it("exposes all looks + sliders as OSC widgets (189 looks + 5 sliders)", () => {
    expect(names.length).toBe(194);
  });
});

// QLC+ drives the Launchpad LEDs via MIDI feedback (dim idle / bright active velocities per pad).
// The generator still emits config/launchpad-leds.json for the optional MCP SysEx driver, which is
// disabled by default (LAUNCHPAD_LEDS=0) because this QLC+ install emits no OSC feedback.
describe("punk-rock-show generator — Launchpad LED map (self-driven RGB)", () => {
  let pads: Array<{ note: number; crc: number; path: string; page: number; rgb: number[]; momentary: boolean }> = [];
  beforeAll(async () => {
    pads = JSON.parse(await fs.readFile(LEDS_JSON, "utf8")).pads;
  });

  it("wires Launchpad MIDI input AND MIDI feedback (QLC+ drives the pad LEDs)", () => {
    expect(raw).toContain('<Input Plugin="MIDI"');
    expect(raw).toContain('<Feedback Plugin="MIDI"');
  });

  it("emits one LED entry per placed look with true RGB + a tier-carrying OSC path", () => {
    expect(pads.length).toBe(189); // == the 189 OSC looks above (one LED entry per placed pad)
    for (const p of pads) {
      expect(p.rgb).toHaveLength(3);
      for (const c of p.rgb) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
      expect(p.path.startsWith("/")).toBe(true);
      expect(p.note).toBeGreaterThanOrEqual(11);
      expect(p.note).toBeLessThanOrEqual(88);
    }
  });

  it("maps note = pad-128 (top row 81.., bottom row 11..) and leaves R8C8 (note 18) unmapped", () => {
    const noteOf = (p: string) => pads.find((x) => x.path === p)?.note;
    expect(noteOf("/band_white_l1_r1c1")).toBe(81); // R1C1 top-left  (pad 209 - 128)
    expect(noteOf("/full_on_l1_r8c7")).toBe(17); // R8C7 bottom row (pad 145 - 128)
    expect(pads.map((p) => p.note)).not.toContain(18); // R8C8 is the page-flip nav input, not a lit look
  });

  it("flags momentary (Flash) looks and leaves toggles/solo non-momentary", () => {
    expect(pads.find((p) => p.path === "/strobe_l1_r6c1")?.momentary).toBe(true); // row-6 strobe = Flash
    expect(pads.find((p) => p.path === "/band_white_l1_r1c1")?.momentary).toBe(false); // base look = Toggle
  });
});
