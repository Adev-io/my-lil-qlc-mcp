import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { parseQxwFile } from "../src/qlc/qxwParser";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QXW = path.join(ROOT, "punk-rock-show.qxw");

let names: string[] = [];
let baseNames: string[] = []; // names with the trailing " R#C#" pad-coordinate suffix stripped
let raw = "";

// The generator stamps every look caption with its pad coordinate ("Red" at r0c0 -> "Red R1C1").
const stripCoord = (s: string): string => s.replace(/ R\d+C\d+$/, "");

// Launchpad pad channel bound to a look's MIDI (Universe-1) button. Dual buttons share a
// Caption ("<name> R#C#"); the OSC button (Universe 0) is emitted first, so the first Universe-1
// match after the caption is that look's pad. Reused captions resolve to their page-1 button.
const padChOf = (caption: string): number | null => {
  const m = raw.match(new RegExp(`Caption="${caption} R\\dC\\d"[^]*?Universe="1" Channel="(\\d+)"`));
  return m ? Number(m[1]) : null;
};

beforeAll(async () => {
  // Regenerate from source, then parse the real artifact.
  execSync("npx tsx scripts/build-show.ts", { cwd: ROOT, stdio: "inherit" });
  const result = await parseQxwFile(QXW);
  expect(result.errors).toEqual([]);
  names = result.widgets.map((w) => w.name);
  baseNames = names.map(stripCoord);
  raw = await fs.readFile(QXW, "utf8");
}, 60000);

describe("punk-rock-show generator", () => {
  it("still exposes the existing colour looks", () => {
    expect(baseNames).toEqual(expect.arrayContaining(["Red", "Blue", "White", "Rainbow", "Police"]));
  });

  it("adds the 3 head-motion dynamic scenes", () => {
    expect(baseNames).toEqual(expect.arrayContaining(["Head Circle", "Audience Sweep", "Cross Zigzag"]));
  });

  it("adds the 2 auto scenes and 2 crossfade twins", () => {
    expect(baseNames).toEqual(expect.arrayContaining(["Pars Auto", "Bars Auto", "Pars Morph", "Bars Morph"]));
  });

  it("adds the 5 chasers and Pixel Bounce", () => {
    expect(baseNames).toEqual(expect.arrayContaining(
      ["Color Stab", "Kill Strobe", "Par Run", "Alt Flash", "Build Drop", "Pixel Bounce"]));
  });

  it("adds Bar Scroll as an RGBMatrix over a 6-cell Bars group", () => {
    expect(baseNames).toContain("Bar Scroll");
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

  it("lays page 1 out as four non-overlapping solo bands", () => {
    // PAD.rows = [209,199,189,179,169,159,149,139] (top row first).
    expect(padChOf("Red")).toBe(209);        // WASH-STATIC  r0 c0
    expect(padChOf("White")).toBe(216);      // WASH-STATIC  r0 c7
    expect(padChOf("Singer")).toBe(189);     // HEADS-STATIC r2 c0
    expect(padChOf("Rainbow")).toBe(169);    // DYNAMICS     r4 c0
    expect(padChOf("Park All")).toBe(156);   // DYNAMICS     r6 c7
    expect(padChOf("Strobe All")).toBe(139); // CONTROL      r7 c0
    expect(padChOf("Blackout")).toBe(145);   // CONTROL      r7 c6
  });

  it("surfaces 3 song presets on page 1 DYNAMICS r6 (Item B, 2026-06-09)", () => {
    // page-1 r6 base channel = PAD.rows[6] = 149; presets at c2/c3/c4. They are emitted on page 1
    // (DYNAMICS frame) before the page-2 PRESETS, so padChOf resolves to the page-1 button.
    expect(padChOf("Opener")).toBe(151);       // r6 c2
    expect(padChOf("Chorus Warm")).toBe(152);  // r6 c3
    expect(padChOf("Breakdown UV")).toBe(153); // r6 c4
    // Audience Sweep + Cross Zigzag stay on page 1 for live head motion
    expect(padChOf("Audience Sweep")).toBe(154); // r6 c5
    expect(padChOf("Cross Zigzag")).toBe(155);   // r6 c6
    // the displaced sweeps + circle still exist (now only on page 2)
    expect(baseNames).toEqual(expect.arrayContaining(["Head Sweep Slow", "Head Sweep Fast", "Head Circle"]));
  });

  it("positions buttons RELATIVE to their frame (no double-offset / off-screen)", () => {
    // Park All is grid r6c7 inside the DYNAMICS frame, whose top row is r4. The button must render
    // at the frame-relative Y (6-4)*50+4 = 104 — not the absolute 12+6*50 = 312 (which clipped off).
    const m = raw.match(/Caption="Park All R7C8"[^]*?<WindowState[^>]*\bX="(\d+)" Y="(\d+)"/);
    expect(m).toBeTruthy();
    expect(Number(m![1])).toBe(676); // (7-0)*96 + 4
    expect(Number(m![2])).toBe(104); // (6-4)*50 + 4
  });

  it("adds the full page-2 look set (Glow Out dropped for the page-toggle pad)", () => {
    expect(baseNames).toEqual(expect.arrayContaining([
      "Pars Red", "Bars Red", "Heads Red", "Gobo 1", "Prism",
      "Figure 8", "Pan Wave", "Tilt Dip", "Rainbow Fast", "Mega Build",
      "Opener", "Punk Slam",
    ]));
    expect(padChOf("Pars Red")).toBe(209);  // page-2 r0 c0
    expect(padChOf("Punk Slam")).toBe(145); // page-2 r7 c6 — now the last preset
    expect(baseNames).not.toContain("Glow Out"); // its pad (R8C8) is the page toggle
    expect(baseNames).not.toContain("Panic");    // page-1 R8C8 freed for the toggle too
  });

  it("stamps each look caption with its R#C# pad coordinate", () => {
    expect(raw).toContain('Caption="Red R1C1"');        // page-1 top-left
    expect(raw).toContain('Caption="Pars Red R1C1"');   // page-2 top-left
    expect(raw).toContain('Caption="Strobe All R8C1"'); // page-1 bottom-left
    // the coordinate flows through to the OSC widget name (and thus the path)
    expect(names).toEqual(expect.arrayContaining(["Red R1C1", "Pars Red R1C1"]));
  });

  it("switches pages from a dedicated pad (R8C8) + keyboard, not the dead top arrows", () => {
    expect(raw).toContain('<Multipage PagesNum="2" CurrentPage="0"/>');
    expect(raw).toContain('<PagesLoop>True</PagesLoop>');           // single Next pad wraps 2->1
    expect(raw).toContain('<Input Universe="1" Channel="146"/>');   // R8C8 bottom-right = page toggle
    expect(raw).toContain('<Key>PgDown</Key>');                     // keyboard backup (next)
    expect(raw).toContain('<Key>PgUp</Key>');                       // keyboard backup (prev)
    expect(raw).not.toContain('<Input Universe="1" Channel="94"/>'); // old top-arrow CC binding gone
    expect(raw).toContain('Page="1"'); // page-2 sub-frames
    expect((raw.match(/<Slider Caption=/g) || []).length).toBe(5);
    expect(raw).toContain('<SliderMode ValueDisplayStyle="Exact" ClickAndGoType="None" Monitor="false">Level</SliderMode>');
    expect(names).toEqual(expect.arrayContaining(["Pars Dim", "Bars Dim", "Heads Dim", "Strobe Rate", "Heads Zoom"]));
  });

  it("self-illuminates every scene (master dimmer FULL) so bars/pars light; Dim faders stay overrides", () => {
    // The "Red" wash scene's first par: ch0 dimmer 255, ch1 strobe 0, ch2 RED 255
    // (par channel map rig-verified 2026-06-09: colors on ch2..7, strobe ch1).
    const redPar = raw.match(/Name="Red">[^]*?<FixtureVal ID="0">([^<]*)</)?.[1] || "";
    expect(redPar.startsWith("0,255,1,0,2,255")).toBe(true);
    // ...and every BAR in a wash scene drives ch12 (the T3-BT master dimmer) to 255 — the bug fix.
    const redBar = raw.match(/Name="Red">[^]*?<FixtureVal ID="10">([^<]*)</)?.[1] || "";
    expect(redBar).toContain("12,255");
    // the per-group Dim faders remain as Level overrides on the dimmer channels
    const parsDim = raw.match(/<Slider Caption="Pars Dim"[^]*?<\/Slider>/)?.[0] || "";
    expect(parsDim).toContain('<Channel Fixture="0">0</Channel>');
    expect(parsDim).toContain(">Level</SliderMode>");
  });

  it("aims the heads at the band from the 2026-06-09 stage geometry", () => {
    // Heads are fixtures 12 (L) and 13 (R). aim() turns a floor target (ft) into pan(ch0)/tilt(ch2)
    // DMX; values come from the 20x10 stage, ground trusses at the front corners (±10, 0, 8.5).
    const hv = (scene: string, id: 12 | 13): string =>
      raw.match(new RegExp(`Name="${scene}">[^]*?<FixtureVal ID="${id}">([^<]*)<`))?.[1] || "";
    // Singer → stage centre (0,3.3): the two heads converge symmetrically.
    expect(hv("Singer", 12).startsWith("0,162,2,103")).toBe(true);
    expect(hv("Singer", 13).startsWith("0,94,2,103")).toBe(true);
    // Guitar is front-left → near for L (steep), far for R (shallow).
    expect(hv("Guitar", 12).startsWith("0,156,2,113")).toBe(true);
    expect(hv("Guitar", 13).startsWith("0,90,2,99")).toBe(true);
    // Drums back-right; Crowd Near is downstage of the heads (pan swings past 128/across).
    expect(hv("Drums", 12).startsWith("0,159,2,100")).toBe(true);
    expect(hv("Crowd Near", 12).startsWith("0,185,2,108")).toBe(true);
    expect(hv("Crowd Near", 13).startsWith("0,71,2,108")).toBe(true);
    // The dead-centre 128/128 placeholder is gone from the position scenes.
    expect(hv("Singer", 12).startsWith("0,128,2,128")).toBe(false);
  });

  it("replaces the generic position pads with the 8 aimed pads (Approach A)", () => {
    expect(baseNames).toEqual(expect.arrayContaining(
      ["Singer", "Guitar", "Bass", "Drums", "Crowd Near", "Crowd Deep", "Stage Wash", "Park"]));
    for (const old of ["Center", "Wide", "Cross X", "Downstage", "Upstage", "Tight Center", "Wide Open"])
      expect(baseNames).not.toContain(old);
    // positions no longer force colour/gobo — colour pads keep control
    const singerL = raw.match(/Name="Singer">[^]*?<FixtureVal ID="12">([^<]*)</)?.[1] || "";
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
        const fv = raw.match(new RegExp(`Name="${s}">[^]*?<FixtureVal ID="${id}">([^<]*)<`))?.[1] || "";
        const pairs = fv.split(",").map(Number);
        let tilt = -1;
        for (let k = 0; k < pairs.length; k += 2) if (pairs[k] === 2) tilt = pairs[k + 1];
        expect(tilt, `${s} fixture ${id} tilt`).toBeGreaterThanOrEqual(93);
      }
    }
  });

  it("exposes all looks + sliders as OSC widgets (126 looks + 5 sliders)", () => {
    expect(names.length).toBe(131);
  });
});
