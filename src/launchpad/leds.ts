// ----------------------------------------------------------------------------
// Launchpad LED driver — we paint the Novation Launchpad Mini MK3 pads OURSELVES.
//
// QLC+ is now MIDI-input-only on the Launchpad (the generated show has no <Feedback Plugin="MIDI">
// line), so this module owns the LED output. It learns which look is live from QLC+'s OSC feedback
// (the same :9000 stream the MCP already listens to) and lights the matching pad over the MK3's
// Programmer-Mode RGB SysEx: idle pads glow their look colour at 50%, the active look at 100%
// (steady). This gives true-colour brightness QLC+'s own MIDI feedback could not (the MK3 palette
// has no clean half-bright for colours; its hardware flash/pulse never animate).
//
// MIDI output goes through a dumb winmm sidecar (scripts/launchpad-midi-sidecar.ps1) so the Node
// install stays pure-JS — see startLaunchpadLeds() below. The LaunchpadLeds class itself is pure
// (the byte sender is injected), so it is unit-tested with a fake sender, no hardware.
// ----------------------------------------------------------------------------
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getLogger } from "../logger.js";
import type { Config } from "../config.js";
import { setFeedbackHook } from "../osc/oscClient.js";

export interface LaunchpadPad {
  note: number; // MK3 programmer-mode note (11..88) = QLC+ universe-1 pad channel - 128
  crc: number; // crc16 of the OSC path (QLC+ universe-0 channel) — numeric-feedback fallback key
  path: string; // OSC path; carries the energy-tier token (_l1_/_l2_/_l3_) for page inference
  page: number; // 0..2
  rgb: [number, number, number]; // 0..255
  momentary: boolean;
}

// MK3 RGB SysEx (Programmer Mode, lighting spec 0x03). Each pad spec = 03 <note> <R> <G> <B>, 0..127.
const SYSEX_HEAD = [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x03];
const SYSEX_TAIL = 0xf7;
const PROGRAMMER_MODE_ON = [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x0e, 0x01, 0xf7];

const IDLE = 0.5; // idle brightness (50%)
const ACTIVE = 1; // active brightness (100%) — steady, no flash
const NEUTRAL: [number, number, number] = [70, 70, 70]; // faint grey for unmapped pads (e.g. R8C8 page-flip)

// The 64 MK3 grid notes (row*10+col, row/col 1..8).
const ALL_NOTES: number[] = (() => {
  const a: number[] = [];
  for (let r = 1; r <= 8; r++) for (let c = 1; c <= 8; c++) a.push(r * 10 + c);
  return a;
})();

function scale(c: number, factor: number): number {
  return Math.max(0, Math.min(127, Math.round((c / 255) * 127 * factor)));
}

export type Sender = (bytes: number[]) => void;

export class LaunchpadLeds {
  private byPath = new Map<string, LaunchpadPad>();
  private byCrc = new Map<number, LaunchpadPad>();
  private idleByPage = new Map<number, Map<number, LaunchpadPad>>(); // page -> (note -> pad)
  private active = new Map<number, LaunchpadPad>(); // note -> the look currently lit there
  private currentPage = 0;

  constructor(
    pads: LaunchpadPad[],
    private send: Sender,
  ) {
    for (const p of pads) {
      if (p.path) this.byPath.set(p.path, p);
      if (p.crc) this.byCrc.set(p.crc, p);
      let pg = this.idleByPage.get(p.page);
      if (!pg) {
        pg = new Map();
        this.idleByPage.set(p.page, pg);
      }
      pg.set(p.note, p);
    }
  }

  /** Enter Programmer Mode and paint page-0 idle. Call once after the sidecar reports READY. */
  start(): void {
    this.send(PROGRAMMER_MODE_ON);
    this.repaintIdle();
  }

  /** Re-paint idle for the current page (belt-and-suspenders after the MK3 settles post-mode-switch). */
  refresh(): void {
    this.repaintIdle();
  }

  /** Handle one QLC+ OSC feedback message (a VC button changing state). */
  onFeedback(oscPath: string | null, args: unknown[] | null): void {
    if (!oscPath) return;
    const pad = this.resolve(oscPath);
    if (!pad) return;
    // Every look path carries its energy tier (_l1_/_l2_/_l3_); use it to self-correct the page —
    // the R8C8 page-flip is a MIDI nav input and emits no OSC, so this is our only page signal.
    const tier = /_l([123])(?:_|$)/.exec(oscPath);
    if (tier) this.setPage(Number(tier[1]) - 1);

    const on = Number(args?.[0] ?? 0) >= 0.5;
    if (on) {
      this.active.set(pad.note, pad);
      this.paint(pad.note, pad.rgb, ACTIVE);
    } else {
      this.active.delete(pad.note);
      this.paint(pad.note, pad.rgb, IDLE);
    }
  }

  /** All pads off (blackout) — used on shutdown. */
  blackout(): void {
    const specs: number[] = [];
    for (const note of ALL_NOTES) specs.push(0x03, note, 0, 0, 0);
    this.send([...SYSEX_HEAD, ...specs, SYSEX_TAIL]);
  }

  private repaintIdle(): void {
    const idle = this.idleByPage.get(this.currentPage);
    const specs: number[] = [];
    for (const note of ALL_NOTES) {
      const pad = idle?.get(note);
      const rgb = pad ? pad.rgb : NEUTRAL;
      const f = pad ? IDLE : 1; // NEUTRAL is already a faint value
      specs.push(0x03, note, scale(rgb[0], f), scale(rgb[1], f), scale(rgb[2], f));
    }
    this.send([...SYSEX_HEAD, ...specs, SYSEX_TAIL]);
    // Re-assert anything currently active so a repaint never dims a live look.
    for (const [note, pad] of this.active) this.paint(note, pad.rgb, ACTIVE);
  }

  private setPage(page: number): void {
    if (page === this.currentPage) return;
    this.currentPage = page;
    this.active.clear(); // the freshly-shown page has nothing active until a press (matches QLC+ multipage)
    this.repaintIdle();
  }

  private resolve(oscPath: string): LaunchpadPad | undefined {
    const direct = this.byPath.get(oscPath);
    if (direct) return direct;
    // Numeric-feedback fallback: a path like "/11507" or "/0/11507" (no letters) => match by crc.
    if (!/[a-z]/i.test(oscPath)) {
      const m = /(\d+)\s*$/.exec(oscPath);
      if (m) return this.byCrc.get(Number(m[1]));
    }
    return undefined;
  }

  private paint(note: number, rgb: [number, number, number], factor: number): void {
    this.send([
      ...SYSEX_HEAD,
      0x03,
      note,
      scale(rgb[0], factor),
      scale(rgb[1], factor),
      scale(rgb[2], factor),
      SYSEX_TAIL,
    ]);
  }
}

// ----------------------------------------------------------------------------
// IO wrapper — spawn the winmm sidecar, wire OSC feedback in, clean up on exit.
// Gated so non-Windows / no-Launchpad / dry-run / no-map installs simply skip (the MCP server keeps
// working with no LEDs). Never throws.
// ----------------------------------------------------------------------------
let running: { stop: () => void } | null = null;

export async function startLaunchpadLeds(config: Config): Promise<void> {
  const logger = getLogger();
  if (running) return;

  if (process.env.LAUNCHPAD_LEDS === "0") {
    logger.info("Launchpad LEDs disabled (LAUNCHPAD_LEDS=0)");
    return;
  }
  if (config.qlcDryRun) {
    logger.info("Launchpad LEDs skipped (dry-run)");
    return;
  }
  if (process.platform !== "win32") {
    logger.info("Launchpad LEDs skipped (winmm sidecar is Windows-only)");
    return;
  }

  const mapFile = process.env.LAUNCHPAD_LEDS_MAP
    ? path.resolve(process.env.LAUNCHPAD_LEDS_MAP)
    : path.resolve(process.cwd(), "config", "launchpad-leds.json");
  if (!existsSync(mapFile)) {
    logger.info(`Launchpad LEDs skipped (no map at ${mapFile})`);
    return;
  }

  let pads: LaunchpadPad[];
  try {
    pads = (JSON.parse(readFileSync(mapFile, "utf8")).pads ?? []) as LaunchpadPad[];
  } catch (e) {
    logger.warn(`Launchpad LEDs: failed to read ${mapFile}: ${(e as Error).message}`);
    return;
  }
  if (pads.length === 0) {
    logger.info("Launchpad LEDs skipped (empty map)");
    return;
  }

  const sidecar = path.resolve(process.cwd(), "scripts", "launchpad-midi-sidecar.ps1");
  const child = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", sidecar], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  const send: Sender = (bytes) => {
    const stdin = child.stdin;
    if (!stdin || !stdin.writable) return;
    stdin.write(bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ") + "\n");
  };

  const leds = new LaunchpadLeds(pads, send);
  let started = false;

  child.stdout?.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    if (!started && line.startsWith("READY")) {
      started = true;
      logger.info(`Launchpad LEDs: sidecar ${line}`);
      leds.start();
      setTimeout(() => leds.refresh(), 150); // re-paint after the MK3 settles from the mode switch
    }
  });
  child.stderr?.on("data", (d: Buffer) => logger.warn(`Launchpad LEDs sidecar: ${d.toString().trim()}`));
  child.on("error", (e) => logger.warn(`Launchpad LEDs: sidecar spawn failed: ${e.message}`));
  child.on("exit", (code) => {
    if (code && code !== 0 && !started)
      logger.warn(`Launchpad LEDs: sidecar exited ${code} (2 not found · 3 port busy · 4 winmm)`);
    setFeedbackHook(null);
    running = null;
  });

  setFeedbackHook((p, a) => leds.onFeedback(p, a));

  const stop = () => {
    setFeedbackHook(null);
    try {
      leds.blackout();
      const stdin = child.stdin;
      if (stdin && stdin.writable) {
        stdin.write("BYE\n");
        stdin.end();
      }
    } catch {
      /* best-effort */
    }
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    running = null;
  };
  running = { stop };
  process.once("exit", stop);
  process.once("SIGINT", () => {
    stop();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    stop();
    process.exit(0);
  });

  logger.info(
    `Launchpad LEDs: driving ${pads.length} pads via winmm sidecar (idle 50% / active 100%)`,
  );
}

export function stopLaunchpadLeds(): void {
  if (running) running.stop();
}
