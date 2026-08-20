import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { parseQxwFile } from "../src/qlc/qxwParser";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Generate into a temp dir so running tests never clobbers the user's generated show.
const OUT = path.join(os.tmpdir(), `qlc-build-party-test-${process.pid}`);
const QXW = path.join(OUT, "bar-mitzvah-party.qxw");
const LEDS_JSON = path.join(OUT, "config", "launchpad-leds.json");
const RIG = path.join(ROOT, "rigs", "bar-mitzvah.rig.json");

let names: string[] = [];
let baseNames: string[] = [];
let raw = "";

const stripCoord = (s: string): string => s.replace(/ R\d+C\d+$/, "");

// Universe-1 (Launchpad press) channel bound to a caption. Each look emits OSC first, MIDI second.
const padChOf = (caption: string): number | null => {
  const m = raw.match(new RegExp(`Caption="${caption} R\\dC\\d"[^]*?Universe="1" Channel="(\\d+)"`));
  return m ? Number(m[1]) : null;
};
// FixtureVal channel,value string for one scene + fixture id.
const fv = (scene: string, id: number): string =>
  raw.match(new RegExp(`Name="${scene}">[^]*?<FixtureVal ID="${id}">([^<]*)<`))?.[1] || "";
const sceneXml = (scene: string): string =>
  raw.match(new RegExp(`Type="Scene" Name="${scene}">[^]*?</Function>`))?.[0] || "";
const chans = (s: string): number[] => s.split(",").map(Number).filter((_, i) => i % 2 === 0);

beforeAll(async () => {
  execSync(`npx tsx scripts/build-party.ts "${RIG}"`, {
    cwd: ROOT, stdio: "inherit", env: { ...process.env, QLC_BUILD_OUT: OUT },
  });
  const result = await parseQxwFile(QXW);
  expect(result.errors).toEqual([]);
  names = result.widgets.map((w) => w.name);
  baseNames = names.map(stripCoord);
  raw = await fs.readFile(QXW, "utf8");
}, 60000);

describe("party generator — boot + rig binding", () => {
  it("emits a valid qxw with 14 fixtures named by their group prefix", () => {
    expect(raw).toContain("<Name>Rainbow Par 1</Name>");
    expect(raw).toContain("<Name>Rainbow Par 10</Name>");
    for (const n of ["Truss L", "Truss R", "Floor L", "Floor R"])
      expect(raw).toContain(`<Name>${n}</Name>`);
    expect(raw).not.toContain("<Name>Bar 1</Name>"); // no bars on this rig
  });

  it("patches the heads at 100/115/130/145 (1-based 101/116/131/146 on the fixture menus)", () => {
    for (const a of [100, 115, 130, 145]) expect(raw).toContain(`<Address>${a}</Address>`);
  });

  it("refuses a rig that is not meta.builder=party", () => {
    expect(() =>
      execSync(`npx tsx scripts/build-party.ts "${path.join(ROOT, "rigs", "punk-rock-show.rig.json")}"`,
        { cwd: ROOT, stdio: "pipe", env: { ...process.env, QLC_BUILD_OUT: OUT } }),
    ).toThrow();
  });
});

describe("party generator — looks", () => {
  it("builds the static wall + banner scene set", () => {
    for (const fn of ["Gold Wall", "Blue Wall", "Gold Blue Alt", "Soft Amber", "Warm White",
      "UV Accent", "Banner Soft", "Doors Blue", "Wall Low Gold", "Banner Bright", "Banner Only",
      "House Bright", "Banner On", "Banner Off", "Panic White", "Banner Blast"])
      expect(raw).toContain(`Name="${fn}"`);
  });

  it("builds the dynamics: dim presets, strobes, chases, sweeps, positions, sound fallback", () => {
    for (const fn of ["Dim 25", "Dim 50", "Dim 75", "Dim Full", "Strobe Burst", "Sync Strobe",
      "Chase Gold Blue", "Chase Blue UV", "Chase Gold UV", "Rainbow Chase", "Rainbow Fast",
      "UV Blacklight", "Sweep Wide", "Sweep Cross", "Sweep Punch", "Par Sound Mode", "Beat Pulse",
      "Circles", "Fast Gold Blue", "White Burst", "Gold Blue Full", "Entrance", "Build Chase",
      "Truss Home", "Speaker Light", "Banner Home"])
      expect(raw).toContain(`Name="${fn}"`);
  });

  it("THE DIM RULE: looks never write the par dimmer (ch0) or the truss dimmer (ch10)", () => {
    for (const look of ["Gold Wall", "Blue Wall", "UV Accent", "House Bright", "Entrance",
      "Gold Blue Full", "UV Blacklight", "White Burst"]) {
      expect(chans(fv(look, 0)), `${look} par ch0`).not.toContain(0);
      const truss = fv(look, 10);
      if (truss) expect(chans(truss), `${look} truss ch10`).not.toContain(10);
    }
  });

  it("the three dim-rule exceptions DO carry their own brightness (break-glass pads)", () => {
    expect(chans(fv("Panic White", 0))).toContain(0);        // Panic: par dimmer
    expect(fv("Panic White", 10)).toContain("10,255");        // Panic: truss dimmer
    expect(chans(fv("Strobe Burst", 0))).toContain(0);        // Strobe hold pad
    expect(fv("Speaker Light", 10)).toContain("10,255");      // Speaker light
  });

  it("dim presets write ONLY dimmers, scaled, and exclude the floor (banner) heads", () => {
    expect(fv("Dim 50", 0)).toBe("0,128");
    expect(fv("Dim 50", 10)).toBe("10,128");
    expect(fv("Dim 25", 0)).toBe("0,64");
    expect(fv("Dim Full", 0)).toBe("0,255");
    expect(sceneXml("Dim 50")).not.toContain('<FixtureVal ID="12">');
    expect(sceneXml("Dim 50")).not.toContain('<FixtureVal ID="13">');
  });

  it("banner scenes drive ONLY the floor heads, with dim + open shutter baked in", () => {
    const b = sceneXml("Banner Bright");
    expect(b).toContain('<FixtureVal ID="12">');
    expect(b).toContain('<FixtureVal ID="13">');
    expect(b).not.toContain('<FixtureVal ID="10">');
    for (const id of [12, 13]) {
      expect(fv("Banner Bright", id)).toContain("10,255"); // dim full
      expect(fv("Banner Bright", id)).toContain("11,255"); // shutter open
    }
  });

  it("Par Sound Mode uses the fixture's real sound-active ranges, pars only", () => {
    // Rainbow Smart 2 Pro: ch8 220-255 "Sound active color", ch9 251-255 "Sound active".
    const s = fv("Par Sound Mode", 0).split(",").map(Number);
    const ch8 = s[s.indexOf(8) + 1], ch9 = s[s.indexOf(9) + 1];
    expect(ch8).toBeGreaterThanOrEqual(220);
    expect(ch9).toBeGreaterThanOrEqual(251);
    for (const id of [10, 11, 12, 13]) expect(sceneXml("Par Sound Mode")).not.toContain(`<FixtureVal ID="${id}">`);
  });

  it("SAFETY: no scene ever sets a head movement macro (ch13)", () => {
    for (const sc of raw.matchAll(/Type="Scene" Name="([^"]*)"[^]*?<\/Function>/g))
      for (const f of sc[0].matchAll(/<FixtureVal ID="(1[0-3])">([^<]*)</g)) {
        const nums = f[2].split(",").map(Number);
        for (let k = 0; k + 1 < nums.length; k += 2)
          if (nums[k] === 13) expect(nums[k + 1], `${sc[1]} fx${f[1]}`).toBe(0);
      }
  });

  it("SAFETY: floor heads only ever aim upstage at the banner (tilt above horizontal)", () => {
    // aimBanner tilts ABOVE centre-depression, which lands below DMX 128 on this fixture.
    for (const id of [12, 13]) {
      const t = fv("Banner Home", id).split(",").map(Number);
      const tilt = t[t.indexOf(2) + 1];
      expect(tilt, `Floor fx${id} tilt`).toBeLessThan(128);
    }
  });
});

describe("party VC — 5 pages, shared rows, faders, tempo, audio", () => {
  it("has a 5-page multipage grid booting on INTRO, cycled from R8C8 (pad 146)", () => {
    expect(raw).toContain('<Multipage PagesNum="5" CurrentPage="0"/>');
    expect(raw).toContain("<PagesLoop>True</PagesLoop>");
    expect(raw).toContain('<Input Universe="1" Channel="146"/>');
    expect(raw).toContain("<Key>PgDown</Key>");
    expect(raw).toContain("<Key>PgUp</Key>");
    expect(raw).toContain('Page="4"'); // the fifth page's sub-frames exist
  });

  it("repeats the R7 brightness row and R8 utility row on every page", () => {
    for (const pg of [1, 2, 3, 4, 5]) {
      for (const cap of ["Dim 25", "Dim 50", "Dim 75", "Dim Full", "Sync Strobe"])
        expect(baseNames, `R7 page ${pg}`).toContain(`${cap} P${pg}`);
      for (const cap of ["Blackout", "Panic", "Banner", "Strobe", "Par Sound"])
        expect(baseNames, `R8 page ${pg}`).toContain(`${cap} P${pg}`);
    }
  });

  it("puts the shared rows on the same pads on every page (R7C1=149, R8C1=139)", () => {
    for (const pg of [1, 2, 3, 4, 5]) {
      expect(padChOf(`Dim 25 P${pg}`)).toBe(149);   // R7C1
      expect(padChOf(`Blackout P${pg}`)).toBe(139); // R8C1
      expect(padChOf(`Strobe P${pg}`)).toBe(143);   // R8C5
    }
  });

  it("leaves R8C4 (tap), R8C6 (audio) and R8C8 (page) free of look buttons", () => {
    const utilPads = names.filter((n) => / R8C[468]$/.test(n));
    expect(utilPads).toEqual([]);
  });

  it("places each page's looks on their page", () => {
    for (const n of ["Doors R1C1", "Entrance! R1C3", "Gold Wall R1C1", "Banner Bright R1C1",
      "Gold Blue Full R1C1", "GB Chase R1C1", "Sweep Wide R2C1"])
      expect(names).toContain(n);
  });

  it("uses solo frames for looks + brightness and a plain frame for utility", () => {
    expect(raw).toContain('<SoloFrame Caption="INTRO P1"');
    expect(raw).toContain('<SoloFrame Caption="PARTY P5"');
    expect(raw).toContain('<SoloFrame Caption="BRIGHT P1"');
    expect(raw).toContain('<Frame Caption="UTIL P1"');
  });

  it("makes the strobe pad momentary and looks toggles", () => {
    expect(raw.match(/Caption="Strobe P1 R8C5"[^]*?<Action>(\w+)<\/Action>/)?.[1]).toBe("Flash");
    expect(raw.match(/Caption="Gold Wall R1C1"[^]*?<Action>(\w+)<\/Action>/)?.[1]).toBe("Toggle");
    expect(raw.match(/Caption="Blackout P1 R8C1"[^]*?<Action>(\w+)<\/Action>/)?.[1]).toBe("Blackout");
  });

  it("ships six faders, all dim faders defaulting to 0 so the R7 pads own brightness", () => {
    expect((raw.match(/<Slider Caption=/g) || []).length).toBe(6);
    expect(names).toEqual(expect.arrayContaining(
      ["Pars Dim", "Truss Dim", "Banner Dim", "UV Level", "Strobe Rate", "Heads Zoom"]));
    for (const cap of ["Pars Dim", "Truss Dim", "Banner Dim", "UV Level", "Strobe Rate"]) {
      const s = raw.match(new RegExp(`<Slider Caption="${cap}"[^]*?</Slider>`))?.[0] || "";
      expect(s, cap).toContain('Value="0"');
      expect(s, cap).toContain(">Level</SliderMode>");
    }
    // Banner Dim drives the floor heads' dimmer, Truss Dim the truss heads' — never crossed.
    const banner = raw.match(/<Slider Caption="Banner Dim"[^]*?<\/Slider>/)?.[0] || "";
    expect(banner).toContain('<Channel Fixture="12">10</Channel>');
    expect(banner).not.toContain('<Channel Fixture="10">');
  });

  it("emits a tap-tempo SpeedDial on R8C4 (pad 142) driving every chaser incl. Sync Strobe", () => {
    const dial = raw.match(/<SpeedDial[^]*?<\/SpeedDial>/)?.[0] || "";
    expect(dial).toContain('<Input Universe="1" Channel="142"/>');
    expect(dial).toContain("<Tap>");
    for (const fn of ["Sync Strobe", "Chase Gold Blue", "Rainbow Chase", "Sweep Wide", "Circles"]) {
      const id = raw.match(new RegExp(`<Function ID="(\\d+)" Type="Chaser" Name="${fn}">`))?.[1];
      expect(id, `${fn} chaser id`).toBeTruthy();
      expect(dial, fn).toContain(`Duration="6">${id}</Function>`); // multiplier 6 = "1" (as tapped)
    }
  });

  it("emits the AudioTriggers widget: bass bar -> Beat Pulse, enable on R8C6 (pad 144)", () => {
    const at = raw.match(/<AudioTriggers[^]*?<\/AudioTriggers>/)?.[0] || "";
    expect(at).toContain('BarsNumber="16"');
    expect(at).toContain('<Input Universe="1" Channel="144"/>');
    const pulseId = raw.match(/<Function ID="(\d+)" Type="Scene" Name="Beat Pulse">/)?.[1];
    expect(pulseId).toBeTruthy();
    expect(at).toContain(`Type="2"`);                    // FunctionBar
    expect(at).toContain(`FunctionID="${pulseId}"`);
    expect(at).toContain('Index="0"');                   // lowest band = bass
  });

  it("Beat Pulse bumps only par dimmers, so audio reactivity never overrides look colours", () => {
    expect(fv("Beat Pulse", 0)).toBe("0,255");
    expect(sceneXml("Beat Pulse")).not.toContain('<FixtureVal ID="10">');
  });
});

describe("party generator — Launchpad LED map", () => {
  let pads: Array<{ note: number; crc: number; path: string; page: number; rgb: number[]; momentary: boolean }> = [];
  beforeAll(async () => {
    pads = JSON.parse(await fs.readFile(LEDS_JSON, "utf8")).pads;
  });

  it("emits one LED entry per placed pad with valid notes and RGB", () => {
    expect(pads.length).toBe(placedCount());
    for (const p of pads) {
      expect(p.rgb).toHaveLength(3);
      for (const c of p.rgb) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(255); }
      expect(p.path.startsWith("/")).toBe(true);
      expect(p.note).toBeGreaterThanOrEqual(11);
      expect(p.note).toBeLessThanOrEqual(88);
    }
  });

  it("never lights the three input-only pads (notes 14, 16, 18 on the bottom row)", () => {
    for (const n of [14, 16, 18]) expect(pads.map((p) => p.note)).not.toContain(n);
  });

  it("flags the hold-strobe pads momentary and toggles not", () => {
    expect(pads.find((p) => p.path === "/strobe_p1_r8c5")?.momentary).toBe(true);
    expect(pads.find((p) => p.path === "/gold_wall_r1c1")?.momentary).toBe(false);
  });

  // Look count is derived from the parsed widget list rather than hard-coded, so adding a look
  // does not fail this file for the wrong reason.
  function placedCount(): number {
    return names.filter((n) => / R\d+C\d+$/.test(n)).length;
  }
});

describe("party generator — patch chart", () => {
  it("documents the party rig, the five pages and the audio-device gotcha", () => {
    const chart = readFileSync(path.join(OUT, "PATCH-CHART.md"), "utf8");
    expect(chart).toContain("Bar Mitzvah Party");
    expect(chart).toContain("Truss L");
    expect(chart).toContain("Floor R");
    for (const pg of ["INTRO", "DINNER", "SPEECHES", "HORA", "PARTY"]) expect(chart).toContain(pg);
    expect(chart).toContain("TAP TEMPO");
    expect(chart).toContain("QLC+ preference"); // the audio-input-device warning
  });
});
