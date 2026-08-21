import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { parseQxwFile } from "../src/qlc/qxwParser";
import { panTiltSafe } from "../scripts/party-geometry";

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
// Value of one channel in a "ch,val,ch,val" string, or null if the scene does not set it.
// Must walk channel slots only: indexOf would happily match a VALUE — colour wheel 8 is orange,
// which is not channel 8 — and silently report the wrong thing.
const chVal = (s: string, ch: number): number | null => {
  const n = s.split(",").map(Number);
  for (let i = 0; i + 1 < n.length; i += 2) if (n[i] === ch) return n[i + 1];
  return null;
};

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

  it("guards captured head positions against the beam rule", () => {
    const badRig = JSON.parse(readFileSync(RIG, "utf8"));
    badRig.movingHeadSettings = { trussL: { home: { pan: 213, tilt: 128 } } }; // overshoots the guard
    const tempPath = path.join(OUT, "bad-capture-rig.json");
    writeFileSync(tempPath, JSON.stringify(badRig));
    expect(() =>
      execSync(`npx tsx scripts/build-party.ts "${tempPath}"`,
        { cwd: ROOT, stdio: "pipe", env: { ...process.env, QLC_BUILD_OUT: OUT } }),
    ).toThrow(/movingHeadSettings/);
  });
});

describe("party generator — looks", () => {
  it("builds the static wall + banner scene set", () => {
    for (const fn of ["Gold Wall", "Blue Wall", "Gold Blue Alt", "Soft Amber", "Warm White",
      "UV Accent", "Banner Soft", "Doors Blue", "Wall Low Gold", "Banner Bright", "Banner Only",
      "House Bright", "Banner On", "Banner Off", "Panic White", "Banner Blast"])
      expect(raw).toContain(`Name="${fn}"`);
  });

  it("builds the dynamics: dim presets, strobes, chases, positions, sound fallback", () => {
    for (const fn of ["Dim 25", "Dim 50", "Dim 75", "Dim Full", "Strobe Burst", "Sync Strobe",
      "Chase Gold Blue", "Chase Blue UV", "Chase Gold UV", "Rainbow Chase", "Rainbow Fast",
      "UV Blacklight", "Par Sound Mode", "Beat Pulse",
      "Fast Gold Blue", "White Burst", "Gold Blue Full", "Entrance", "Build Chase", "Slow Build",
      "Truss Home", "Speaker Light", "Banner Home", "Gold Pulse", "Beam Punch", "Candle"])
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

  it("SAFETY: no scene sets a head movement macro (ch13) — firmware programs ignore DMX aim", () => {
    for (const sc of raw.matchAll(/Type="Scene" Name="([^"]*)"[^]*?<\/Function>/g))
      for (const f of sc[0].matchAll(/<FixtureVal ID="(1[0-3])">([^<]*)<\/FixtureVal>/g)) {
        const nums = f[2].split(",").map(Number);
        for (let k = 0; k + 1 < nums.length; k += 2)
          if (nums[k] === 13) expect(nums[k + 1], `${sc[1]} fx${f[1]}`).toBe(0);
      }
    expect(raw).not.toContain('Name="Truss Sound"');
    expect(baseNames.some((n) => n.startsWith("Truss Sound"))).toBe(false);
  });

  it("LTP RECLAIM: looks zero the sound channels, so a look press takes fixtures off their mics", () => {
    // QLC+ is HTP only on intensity channels; everything else is LTP and keeps its last value
    // when the function that set it stops. Without this, pressing R8C6/R8C7 a second time leaves
    // the fixture on its microphone forever. Verified on the rig 2026-08-20.
    for (const look of ["Gold Wall", "Blue Wall", "UV Accent", "Doors Blue", "Panic White"])
      expect(chVal(fv(look, 0), 9), `${look} par ch9`).toBe(0);
    for (const look of ["Gold Wall", "Blue Wall", "UV Accent", "Panic White", "Truss Home", "Speaker Light"])
      expect(chVal(fv(look, 10), 13), `${look} truss ch13`).toBe(0);
  });

  it("BEAM RECLAIM: colour looks clear the gobo wheel so a beam look cannot stick", () => {
    // Same LTP trap as the sound macro: ch6/ch7/ch8 keep their last value after the scene that
    // set them stops. Without this the first gobo look of the night textures every look after it.
    // Panic and Truss Home are the two "put it back to normal" buttons, so they clear beams too.
    // Truss: the Gobo knob (MiniLab K3) OWNS ch6, so no truss scene writes it at all — not even 0.
    for (const look of ["Gold Wall", "Blue Wall", "Warm White", "Doors Blue", "All Gold", "Panic White", "Truss Home"])
      expect(chVal(fv(look, 10), 6), `${look} truss gobo`).toBeNull();
    // Floor: no knob, so colour looks still clear the wheel.
    for (const look of ["Banner Bright", "Banner Soft", "All Gold"])
      expect(chVal(fv(look, 12), 6), `${look} floor gobo`).toBe(0);
    // ch7 rotation and ch8 prism belong to the MiniLab knobs, so NO scene may write them —
    // a Level fader owns its channel and the scene's value would be silently ignored.
    for (const sc of raw.matchAll(/Type="Scene" Name="([^"]*)"[^]*?<\/Function>/g))
      for (const f of sc[0].matchAll(/<FixtureVal ID="(1[0-3])">([^<]*)</g)) {
        const n = f[2] ? f[2].split(",").map(Number) : [];
        for (let k = 0; k + 1 < n.length; k += 2)
          expect([7, 8], `scene "${sc[1]}" writes head ch${n[k]}, which a knob owns`).not.toContain(n[k]);
      }
  });

  it("banner beam looks texture the floor pair only (truss gobo is a MiniLab knob now)", () => {
    // ch6: 8-63 = the seven gobos, 64-119 = the same gobos shaking, 128-189 = cycle gobos.
    const goboOk = (v: number) => (v >= 8 && v <= 119) || (v >= 128 && v <= 189);
    // The floor pair textures the banner, and never gets a movement macro.
    for (const look of ["Banner Gobo", "Banner Swirl"]) {
      expect(chVal(fv(look, 12), 6), `${look} floor gobo`).toBeGreaterThan(0);
      const g = chVal(fv(look, 12), 6);
      expect(goboOk(g!), `${look} gobo ${g} outside the fixture's usable bands`).toBe(true);
      expect(chVal(fv(look, 12), 13), `${look} floor macro`).toBe(0);
    }
  });

  it("the Door Spot look puts the reachable truss head on the doorway, the other at home, never the floor pair", () => {
    const homeL = chVal(fv("Truss Home", 10), 0), homeLTilt = chVal(fv("Truss Home", 10), 2);
    const homeR = chVal(fv("Truss Home", 11), 0), homeRTilt = chVal(fv("Truss Home", 11), 2);
    // The far tower (fx11 at x=15) cannot reach a house-left door (x=-15) without crossing
    // the floor at ~8 ft where it needs 11 ft. If geometry allows, the left tower lights the door;
    // otherwise both heads hold home (no safe doorway aim exists).
    const pan10 = chVal(fv("Door Spot", 10), 0), tilt10 = chVal(fv("Door Spot", 10), 2);
    const pan11 = chVal(fv("Door Spot", 11), 0), tilt11 = chVal(fv("Door Spot", 11), 2);
    // Near head (fx10) leaves its ceiling home for the door. Pan happens to match home (both
    // are straight downstage from the tower), so it is the TILT that must drop.
    expect(pan10).not.toBeNull();
    expect(tilt10, "near head tilts off the ceiling onto the doorway").not.toBe(homeLTilt);
    expect(pan11).not.toBeNull();
    expect(tilt11).not.toBeNull();
    // Far head (fx11) always stays home (cannot reach door safely)
    expect(pan11, "far head holds home").toBe(homeR);
    expect(tilt11).toBe(homeRTilt);
    expect(chVal(fv("Door Spot", 10), 10), "Door Spot fx10 dimmer").toBe(255);
    expect(chVal(fv("Door Spot", 11), 10), "Door Spot fx11 dimmer").toBe(255);
    expect(sceneXml("Door Spot")).not.toContain('<FixtureVal ID="12">');
  });

  it("THE RULE: every truss pan/tilt in every scene passes the beam guard", () => {
    // fx10 = Truss L at (-15,0,8), fx11 = Truss R at (15,0,8). Anything a scene writes to
    // ch0/ch2 on those two must land on ceiling, banner, stage or above the doorway.
    const heads = { 10: { x: -15, y: 0, z: 8 }, 11: { x: 15, y: 0, z: 8 } } as const;
    let checked = 0;
    for (const sc of raw.matchAll(/Type="Scene" Name="([^"]*)"[^]*?<\/Function>/g))
      for (const f of sc[0].matchAll(/<FixtureVal ID="(10|11)">([^<]*)<\/FixtureVal>/g)) {
        const pan = chVal(f[2], 0), tilt = chVal(f[2], 2);
        if (pan === null || tilt === null) continue;
        checked++;
        expect(panTiltSafe(heads[Number(f[1]) as 10 | 11], pan, tilt), `${sc[1]} fx${f[1]} pan ${pan} tilt ${tilt}`).toBeNull();
      }
    expect(checked).toBeGreaterThan(4); // Truss Home ×2, Speaker ×2, doors ×4 at least
  });

  it("no function moves a truss head onto the dance floor: the floor sweeps are gone", () => {
    for (const gone of ["Sweep Wide", "Sweep Cross", "Sweep Punch", "Circles"])
      expect(raw, gone).not.toContain(`Name="${gone}"`);
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

  it("leaves R8C4 (tap) and R8C8 (page) free of look buttons", () => {
    // R8C6 used to be the audio-trigger arm pad; it is the Truss Sound toggle now.
    const utilPads = names.filter((n) => / R8C[48]$/.test(n));
    expect(utilPads).toEqual([]);
  });

  it("places each page's looks on their page", () => {
    for (const n of ["Doors R1C1", "Gold Wall R1C2", "Entrance R5C2",
      "Gold Blue Full R1C1", "GB Chase R2C1"])
      expect(names).toContain(n);
  });

  // Captions become OSC paths, so punctuation leaks straight into them ("Entrance!" once shipped
  // as "/entrance!_r1c3"). Keep every path to lowercase words, digits and underscores.
  it("keeps every OSC path free of punctuation", () => {
    for (const n of names) {
      const p = `/${n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ /g, "_")}`;
      expect(p, `widget "${n}"`).toMatch(/^\/[a-z0-9_]+$/);
    }
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

  // REGRESSION GUARD — verified on the real rig 2026-08-20. A QLC+ Level slider does not take part
  // in HTP: it owns its channels and forces its value out. Dim/UV/strobe faders therefore pinned
  // those channels and the rig stayed dark with "Dim Full" apparently running. Any channel a look
  // or a pad drives must never appear on a Level fader again.
  it("puts NO look-driven channel on a Level fader (dimmers, UV, strobe stay pad/scene territory)", () => {
    const forbidden: Record<string, number[]> = {
      par: [0, 1, 2, 3, 4, 5, 6, 7],   // dimmer, strobe, and all colour channels
      head: [0, 2, 5, 10, 11],          // pan, tilt, colour wheel, dimmer, shutter
    };
    for (const s of raw.matchAll(/<Slider Caption="([^"]*)"[^]*?<\/Slider>/g)) {
      for (const c of s[0].matchAll(/<Channel Fixture="(\d+)">(\d+)<\/Channel>/g)) {
        const fixtureId = Number(c[1]), ch = Number(c[2]);
        const kind = fixtureId < 10 ? "par" : "head";
        expect(forbidden[kind], `slider "${s[1]}" claims ${kind} ch${ch}`).not.toContain(ch);
      }
    }
  });

  it("THE FADER RULE: no Level fader touches a channel any scene writes", () => {
    // The rule, not a headcount. A QLC+ Level slider OWNS its channels, so a Level fader on a
    // channel a scene also drives means the scene loses — that is what pinned the whole rig dark
    // the first time. Group INTENSITY faders dodge this by being Playback sliders instead.
    const sceneWrites = new Set<string>();
    for (const sc of raw.matchAll(/Type="Scene" Name="[^"]*">[^]*?<\/Function>/g))
      for (const f of sc[0].matchAll(/<FixtureVal ID="(\d+)">([^<]*)</g)) {
        const n = f[2] ? f[2].split(",").map(Number) : [];
        for (let k = 0; k + 1 < n.length; k += 2) sceneWrites.add(`${f[1]}:${n[k]}`);
      }
    for (const s of raw.matchAll(/<Slider Caption="([^"]*)"[^]*?<\/Slider>/g)) {
      if (!s[0].includes(">Level</SliderMode>")) continue;
      for (const c of s[0].matchAll(/<Channel Fixture="(\d+)">(\d+)<\/Channel>/g))
        expect(sceneWrites.has(`${c[1]}:${c[2]}`), `Level fader "${s[1]}" owns fx${c[1]} ch${c[2]}, which a scene also writes`).toBe(false);
    }
    for (const gone of ["Pars Dim", "Truss Dim", "Banner Dim", "UV Level", "Strobe Rate"])
      expect(names, `${gone} must not be a Level fader`).not.toContain(gone);
    const focus = raw.match(/<Slider Caption="Focus"[^]*?<\/Slider>/)?.[0] || "";
    expect(focus).toContain('Value="128"');
    expect(focus).toContain(">Level</SliderMode>");
  });

  it("every slider answers the OSC path the widget map advertises", () => {
    // generate:widgets re-derives the path from the CAPTION when it parses the .qxw, so a
    // hand-written osc name binds one path while the dashboard calls another. Shipped exactly
    // that way once: the faders answered "/fader_pars_l" and the map said "/pars_l".
    // Skip sliders whose Input is not Universe="0" (MIDI-only sliders).
    const crcOf = (s: string) => {
      const T = [0x0000,0x1081,0x2102,0x3183,0x4204,0x5285,0x6306,0x7387,0x8408,0x9489,0xa50a,0xb58b,0xc60c,0xd68d,0xe70e,0xf78f];
      let crc = 0xffff;
      for (const b of Buffer.from(s, "utf8")) {
        let c = b;
        crc = ((crc >> 4) & 0x0fff) ^ T[(crc ^ c) & 15];
        c = c >> 4;
        crc = ((crc >> 4) & 0x0fff) ^ T[(crc ^ c) & 15];
      }
      return ~crc & 0xffff; // X-25 final inversion — leaving it off shifts every expected channel
    };
    let seen = 0;
    for (const s of raw.matchAll(/<Slider Caption="([^"]*)"[^]*?<\/Slider>/g)) {
      if (!s[0].includes(`<Input Universe="0"`)) continue; // skip MIDI-only sliders
      const want = crcOf(`/${s[1].toLowerCase().replace(/ /g, "_")}`);
      expect(s[0], `slider "${s[1]}" must answer /${s[1].toLowerCase().replace(/ /g, "_")}`)
        .toContain(`<Input Universe="0" Channel="${want}"/>`);
      seen++;
    }
    expect(seen, "sliders found").toBeGreaterThan(4);
  });

  it("group intensity faders are Playback sliders bound to a real function", () => {
    for (const cap of ["Pars L", "Pars R", "Truss", "Banner"]) {
      const s = raw.match(new RegExp(`<Slider Caption="${cap}"[^]*?</Slider>`))?.[0] || "";
      expect(s, `${cap} fader`).toContain(">Playback</SliderMode>");
      const fid = s.match(/<Playback>\s*<Function>(\d+)<\/Function>/)?.[1];
      expect(fid, `${cap} playback function`).toBeTruthy();
      expect(raw, `${cap} function ${fid} exists`).toContain(`<Function ID="${fid}" Type="Scene"`);
      expect(s, `${cap} starts at zero so the pads rule until it is raised`).toContain('Value="0"');
    }
  });

  it("emits a tap-tempo SpeedDial on R8C4 (pad 142) driving every chaser incl. Sync Strobe", () => {
    const dial = raw.match(/<SpeedDial[^]*?<\/SpeedDial>/)?.[0] || "";
    expect(dial).toContain('<Input Universe="1" Channel="142"/>');
    expect(dial).toContain("<Tap>");
    for (const fn of ["Sync Strobe", "Chase Gold Blue", "Rainbow Chase"]) {
      const id = raw.match(new RegExp(`<Function ID="(\\d+)" Type="Chaser" Name="${fn}">`))?.[1];
      expect(id, `${fn} chaser id`).toBeTruthy();
      expect(dial, fn).toContain(`Duration="6">${id}</Function>`); // multiplier 6 = "1" (as tapped)
    }
  });

  it("builds NO AudioTriggers widget by default — reactivity is the fixtures' own mics", () => {
    // QLC+ stores the capture device as an application preference, so a widget with none chosen
    // listens to the machine's default input (the laptop mic) and pulses the pars off room noise.
    // No AudioBox for this show => no widget. PARTY_AUDIO=1 builds it back in, without a pad.
    expect(raw).not.toContain("<AudioTriggers");
  });

  it("Beat Pulse bumps only par dimmers, so audio reactivity never overrides look colours", () => {
    expect(fv("Beat Pulse", 0)).toBe("0,255");
    expect(sceneXml("Beat Pulse")).not.toContain('<FixtureVal ID="10">');
  });
});

describe("party generator — MiniLab 3", () => {
  const rig = JSON.parse(readFileSync(RIG, "utf8"));
  const cc = rig.controller2.cc as Record<string, number>;
  const sliderByInput = (ch: number) =>
    [...raw.matchAll(/<Slider Caption="([^"]*)"[^]*?<\/Slider>/g)].find((m) => m[0].includes(`<Input Universe="2" Channel="${ch}"/>`));
  const dial = (cap: string) => raw.match(new RegExp(`<SpeedDial Caption="${cap}"[^]*?</SpeedDial>`))?.[0] || "";
  const fv = (scene: string, id: number): string =>
    raw.match(new RegExp(`Name="${scene}">[^]*?<FixtureVal ID="${id}">([^<]*)<`))?.[1] || "";

  it("declares universe 2 as the MiniLab input", () => {
    expect(raw).toMatch(/<Universe Name="MiniLab" ID="2">\s*<Input Plugin="MIDI" UID="\d+" Line="\d+"\/>\s*<\/Universe>/);
  });

  it("faders 1-4 are Playback twins of Pars L / Pars R / Truss / Banner", () => {
    const fid = (x: string) => x.match(/<Playback>\s*<Function>(\d+)/)?.[1];
    for (const [k, cap] of [["f1", "Pars L"], ["f2", "Pars R"], ["f3", "Truss"], ["f4", "Banner"]] as const) {
      const s = sliderByInput(cc[k]);
      expect(s, `${k} -> ${cap}`).toBeTruthy();
      expect(s![1]).toBe(cap);
      expect(s![0]).toContain(">Playback</SliderMode>");
      const osc = raw.match(new RegExp(`<Slider Caption="${cap}"[^]*?<Input Universe="0"[^]*?</Slider>`))?.[0] || "";
      expect(fid(s![0]), `${cap} MIDI twin runs the same function`).toBe(fid(osc));
    }
  });

  it("knobs 3-8: Level knobs own beam channels no scene writes; washes are Playback", () => {
    const want: Record<string, { cap: string; ch?: number; fx?: number[]; fn?: string }> = {
      k3: { cap: "Gobo", ch: 6, fx: [10, 11] },
      k4: { cap: "Gobo Spin", ch: 7, fx: [10, 11, 12, 13] },
      k5: { cap: "Prism", ch: 8, fx: [10, 11, 12, 13] },
      k6: { cap: "Zoom", ch: 14, fx: [10, 11, 12, 13] },
      k7: { cap: "UV Wash", fn: "UV Full" },
      k8: { cap: "Warm Wash", fn: "Warm Full" },
    };
    for (const [k, w] of Object.entries(want)) {
      const s = sliderByInput(cc[k]);
      expect(s, `${k} -> ${w.cap}`).toBeTruthy();
      expect(s![1]).toBe(w.cap);
      if (w.fn) {
        expect(s![0]).toContain(">Playback</SliderMode>");
        const fid = s![0].match(/<Playback>\s*<Function>(\d+)/)![1];
        expect(raw).toContain(`<Function ID="${fid}" Type="Scene" Name="${w.fn}"`);
      } else {
        expect(s![0]).toContain(">Level</SliderMode>");
        for (const f of w.fx!) expect(s![0], `${w.cap} fx${f}`).toContain(`<Channel Fixture="${f}">${w.ch}</Channel>`);
        expect((s![0].match(/<Channel /g) || []).length).toBe(w.fx!.length);
      }
    }
    expect(fv("UV Full", 0)).toBe("7,255");
    expect(fv("Warm Full", 0)).toBe("5,255,6,255");
  });

  it("K1 drives a Fade dial over every look; K2 sets the Tempo dial absolutely while tap stays on the pad", () => {
    const fade = dial("Fade"), tempo = dial("Tempo");
    expect(fade).toMatch(new RegExp(`<AbsoluteValue[^>]*>\\s*<Input Universe="2" Channel="${cc.k1}"/>`));
    expect(tempo).toMatch(new RegExp(`<AbsoluteValue[^>]*>\\s*<Input Universe="2" Channel="${cc.k2}"/>`));
    expect(tempo).toMatch(/<Tap>\s*<Input Universe="1" Channel="\d+"\/>/);
    // Fade: FadeIn/FadeOut multiplier index 6 ("1"), Duration index 0 ("(Not Sent)"); covers every look scene.
    // QLC+ speed-dial function entries carry the id as text: <Function FadeIn FadeOut Duration>id</Function>
    const fadeFns = [...fade.matchAll(/<Function FadeIn="(\d+)" FadeOut="(\d+)" Duration="(\d+)">(\d+)<\/Function>/g)]
      .map((m) => ({ id: m[4], fadeIn: m[1], fadeOut: m[2], duration: m[3] }));
    expect(fadeFns.length).toBeGreaterThan(20);
    for (const f of fadeFns) { expect(f.fadeIn).toBe("6"); expect(f.fadeOut).toBe("6"); expect(f.duration).toBe("0"); }
    const idOf = (n: string) => raw.match(new RegExp(`<Function ID="(\\d+)" Type="Scene" Name="${n}">`))![1];
    for (const n of ["Gold Wall", "Doors Blue", "All Gold", "Ceiling Gold", "House Bright"])
      expect(fadeFns.some((f) => f.id === idOf(n)), `Fade covers ${n}`).toBe(true);
    for (const n of ["Dim Full", "Panic White", "Strobe Burst", "UV Full", "CGB S1"])
      expect(fadeFns.some((f) => f.id === idOf(n)), `Fade must NOT touch ${n}`).toBe(false);
  });

  it("no two MiniLab controls share an input channel, and there are exactly twelve", () => {
    const chans = [...raw.matchAll(/<Input Universe="2" Channel="(\d+)"\/>/g)].map((m) => m[1]);
    expect(new Set(chans).size).toBe(chans.length);
    expect(chans.length).toBe(12);
  });

  it("a shared OSC path always means the same function (pages share a coordinate grammar)", () => {
    const byPath = new Map<string, string>();
    for (const btn of raw.matchAll(/<Button Caption="[^"]*" ID="\d+"[^]*?<\/Button>/g)) {
      const fn = btn[0].match(/<Function ID="(\d+)"\/>/)?.[1], ch = btn[0].match(/<Input Universe="0" Channel="(\d+)"\/>/)?.[1];
      if (!fn || !ch) continue; // MIDI twins and action-only buttons
      const seen = byPath.get(ch);
      if (seen !== undefined) expect(seen, `OSC channel ${ch} drives two functions`).toBe(fn);
      byPath.set(ch, fn);
    }
    expect(byPath.size).toBeGreaterThan(40);
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

  it("never lights the two input-only pads (notes 14 tap, 18 page, on the bottom row)", () => {
    // Note 16 (R8C6) is now empty — the Truss Sound pad was removed (unfenceable).
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

describe("party generator — Launchpad grammar", () => {
  const ROW_KIND = ["static", "chase", "motion", "banner", "special"] as const;
  const kindOf = (fn: string, raw: string): typeof ROW_KIND[number] | "other" => {
    const t = raw.match(new RegExp(`<Function ID="\\d+" Type="(\\w+)" Name="${fn}">`))?.[1];
    if (t === "Collection") return "motion";
    if (t === "Chaser") return "chase";
    if (/^Banner /.test(fn)) return "banner";
    if (/^(Door Spot|Entrance|Speaker Light|Truss Home|White Burst)$/.test(fn)) return "special";
    return t === "Scene" ? "static" : "other";
  };

  it("every pad on rows 0-4 sits in the row its kind belongs to, on every page", () => {
    let checked = 0;
    for (const b of raw.matchAll(/<Button Caption="([^"]*) R([0-4])C\d+"[^]*?<Function ID="(\d+)"\/>/g)) {
      const fnName = raw.match(new RegExp(`<Function ID="${b[3]}" Type="\\w+" Name="([^"]*)">`))?.[1] || "";
      const kind = kindOf(fnName, raw);
      const row = Number(b[2]) - 1; // display is 1-indexed, map to 0-indexed row
      expect(kind, `${b[1]} -> ${fnName}`).not.toBe("other");
      expect(ROW_KIND[row], `${b[1]} (${fnName}) is on row ${row}`).toBe(kind);
      checked++;
    }
    expect(checked).toBeGreaterThan(60);
  });

  it("every look has a pad: no orphan scene, chaser or collection", () => {
    const onPad = new Set([...raw.matchAll(/<Button Caption="[^"]*" ID="\d+"[^]*?<Function ID="(\d+)"\/>/g)].map((m) => m[1]));
    const orphanOk = (n: string) => /^[A-Z]{3} S\d+$/.test(n)                          // chase steps
      || /^(Pars [LR]|Truss|Banner|UV|Warm) Full$/.test(n)                              // fader-backing scenes
      || /^(Blink On|Blink Off|Beat Pulse)$/.test(n)
      || / [LR]$/.test(n) && /Type="EFX"/.test(raw.match(new RegExp(`<Function ID="\\d+" Type="\\w+" Name="${n}">`))?.[0] || ""); // EFX halves live inside Collections
    for (const f of raw.matchAll(/<Function ID="(\d+)" Type="(Scene|Chaser|Collection)" Name="([^"]*)">/g))
      if (!orphanOk(f[3])) expect(onPad.has(f[1]), `"${f[3]}" (${f[2]}) has no button`).toBe(true);
  });

  it("no scene writes a truss gobo (ch6 != 0 on fx10/11): the MiniLab knob owns it", () => {
    for (const sc of raw.matchAll(/Type="Scene" Name="([^"]*)"[^]*?<\/Function>/g))
      for (const f of sc[0].matchAll(/<FixtureVal ID="(10|11)">([^<]*)</g))
        expect(chVal(f[2], 6) ?? 0, `${sc[1]} fx${f[1]} ch6`).toBe(0);
  });
});

describe("party generator — 3D monitor layout", () => {
  let mon: any;
  beforeAll(() => {
    execSync(`npx tsx scripts/build-monitor.ts "${RIG}"`, {
      cwd: ROOT, stdio: "inherit", env: { ...process.env, QLC_BUILD_OUT: OUT },
    });
    mon = JSON.parse(readFileSync(path.join(OUT, "monitor", "fixtures.json"), "utf8"));
  });

  it("names heads by their rig group and stands the floor pair directly below the truss pair", () => {
    const trussL = mon.fixtures.find((f: any) => f.name === "Truss L");
    const floorL = mon.fixtures.find((f: any) => f.name === "Floor L");
    expect(trussL).toBeTruthy();
    expect(floorL).toBeTruthy();
    expect(trussL.pos[2]).toBe(8);              // on the 8ft truss
    expect(floorL.pos[2]).toBeLessThan(1);      // on the floor
    expect(floorL.pos[0]).toBe(trussL.pos[0]);  // same X — directly below
  });

  it("passes the banner through to the renderer", () => {
    expect(mon.meta.banner).toEqual({ widthFt: 12, heightFt: 8, centerX: 0, centerHeightFt: 8 });
  });

  it("still carries all 14 fixtures with their DMX addresses", () => {
    expect(mon.fixtures).toHaveLength(14);
    expect(mon.fixtures.filter((f: any) => f.kind === "par")).toHaveLength(10);
    expect(mon.fixtures.filter((f: any) => f.kind === "head").map((f: any) => f.address))
      .toEqual([100, 115, 130, 145]);
  });
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

describe("party generator — EFX motion", () => {
  const MOTION = ["Ceiling Circle", "Ceiling Circle Fast", "Figure 8", "Ceiling Line", "Diamond", "Banner Wave"];
  const heads = { 10: { x: -15, y: 0, z: 8 }, 11: { x: 15, y: 0, z: 8 } } as const;
  const collXml = (n: string) => raw.match(new RegExp(`<Function ID="\\d+" Type="Collection" Name="${n}">[^]*?</Function>`))?.[0] || "";
  const efxById = (id: string) => raw.match(new RegExp(`<Function ID="${id}" Type="EFX" Name="[^"]*">[^]*?</Function>`))?.[0] || "";
  const members = (n: string) => [...collXml(n).matchAll(/<Step Number="\d+">(\d+)<\/Step>/g)].map((m) => efxById(m[1]));

  it("each motion look is a Collection of two EFX, one per truss head, Position mode, never a floor head", () => {
    for (const n of MOTION) {
      const ms = members(n);
      expect(ms.length, n).toBe(2);
      const ids = ms.map((e) => e.match(/<Fixture>\s*<ID>(\d+)<\/ID>/)![1]).sort();
      expect(ids, n).toEqual(["10", "11"]);
      for (const e of ms) {
        expect(e).toContain("<Mode>Position</Mode>");
        expect(e).toContain("<IsRelative>0</IsRelative>");
        expect((e.match(/<Fixture>/g) || []).length).toBe(1);
      }
    }
  });

  it("every EFX box stays inside the rule: centre + 16 perimeter points pass the guard", () => {
    for (const n of MOTION)
      for (const e of members(n)) {
        const id = Number(e.match(/<Fixture>\s*<ID>(1[01])<\/ID>/)![1]) as 10 | 11;
        const w = Number(e.match(/<Width>(\d+)</)![1]), h = Number(e.match(/<Height>(\d+)</)![1]);
        const cx = Number(e.match(/<Axis Name="X">\s*<Offset>(\d+)</)![1]);
        const cy = Number(e.match(/<Axis Name="Y">\s*<Offset>(\d+)</)![1]);
        const pts: [number, number][] = [[cx, cy]];
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * 2 * Math.PI;
          pts.push([cx + w * Math.cos(a), cy + h * Math.sin(a)]);
        }
        for (const [p, t] of pts)
          expect(panTiltSafe(heads[id], p, t), `${n} fx${id} pan ${p.toFixed(0)} tilt ${t.toFixed(0)}`).toBeNull();
      }
  });

  it("places the motion pads on row 2 and the ceiling static looks exist", () => {
    for (const cap of ["Ceiling Circle", "Figure 8", "Ceiling Line", "Diamond", "Banner Wave", "Ceiling Circle Fast"])
      expect(baseNames, cap).toContain(cap);
    for (const fn of ["Ceiling Gold", "Ceiling Blue", "Banner Beams"]) expect(raw).toContain(`Name="${fn}"`);
    expect(names.filter((n) => /R2C\d$/.test(n)).length).toBeGreaterThanOrEqual(8);
  });
});

describe("party generator — console fits the show laptop", () => {
  const CANVAS = { w: 1500, h: 820 };
  const topFrames = () => {
    const root = raw.match(/<VirtualConsole>\s*<Frame Caption="">[^]*?<\/VirtualConsole>/)![0];
    const out: { name: string; x: number; y: number; w: number; h: number }[] = [];
    for (const m of root.matchAll(/<(?:Solo)?Frame Caption="(Pages|FADERS|MINILAB|TRUSS POSITION|BANNER)" ID="\d+">[^]*?<WindowState Visible="True" X="(\d+)" Y="(\d+)" Width="(\d+)" Height="(\d+)"\/>/g))
      out.push({ name: m[1], x: +m[2], y: +m[3], w: +m[4], h: +m[5] });
    return out;
  };
  it("every top-level frame sits inside 1500x820", () => {
    const fr = topFrames();
    expect(fr.map((f) => f.name).sort()).toEqual(["BANNER", "FADERS", "MINILAB", "Pages", "TRUSS POSITION"]);
    for (const f of fr) {
      expect(f.x + f.w, `${f.name} right edge`).toBeLessThanOrEqual(CANVAS.w);
      expect(f.y + f.h, `${f.name} bottom edge`).toBeLessThanOrEqual(CANVAS.h);
    }
  });
  it("no two top-level frames overlap (QLC+ frames are opaque)", () => {
    const fr = topFrames();
    for (let i = 0; i < fr.length; i++) for (let j = i + 1; j < fr.length; j++) {
      const a = fr[i], b = fr[j];
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      expect(apart, `${a.name} overlaps ${b.name}`).toBe(true);
    }
  });
  it("every slider and dial fits inside its frame", () => {
    for (const name of ["FADERS", "MINILAB"]) {
      const fx = raw.match(new RegExp(`<Frame Caption="${name}" ID="\\d+">[^]*?<WindowState Visible="True" X="\\d+" Y="\\d+" Width="(\\d+)" Height="(\\d+)"\\/>([^]*?)\\n   </Frame>`))!;
      expect(fx, `${name} frame`).toBeTruthy();
      const fw = +fx[1], fh = +fx[2], body = fx[3];
      let n = 0;
      for (const w of body.matchAll(/<(Slider|SpeedDial) Caption="([^"]*)"[^]*?<WindowState Visible="True" X="(\d+)" Y="(\d+)" Width="(\d+)" Height="(\d+)"\/>/g)) {
        n++;
        expect(+w[3] + +w[5], `${name}/${w[2]} right`).toBeLessThanOrEqual(fw);
        expect(+w[4] + +w[6], `${name}/${w[2]} bottom`).toBeLessThanOrEqual(fh);
      }
      expect(n, `${name} widgets found`).toBeGreaterThan(5);
    }
  });
  it("OSC and MIDI twin buttons share one geometry so they render as one pad", () => {
    const byCaption = new Map<string, string[]>();
    for (const b of raw.matchAll(/<Button Caption="([^"]* R\dC\d)" ID="\d+"[^]*?<WindowState Visible="True" X="(\d+)" Y="(\d+)" Width="(\d+)" Height="(\d+)"\/>/g))
      byCaption.set(b[1], [...(byCaption.get(b[1]) ?? []), `${b[2]},${b[3]},${b[4]},${b[5]}`]);
    let pairs = 0;
    for (const [cap, geos] of byCaption) if (geos.length > 1) { pairs++; expect(new Set(geos).size, cap).toBe(1); }
    expect(pairs).toBeGreaterThan(50);
  });
});
