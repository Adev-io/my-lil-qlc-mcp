/*
 * manual.ts — renders SETUP-MANUAL.html, a self-contained user manual for the
 * generated QLC+ show. Called by build-show.ts with live data (from rig.json)
 * so the Launchpad map, OSC paths and patch table never drift from the project.
 */

export interface ManualPlaced {
  row: number; col: number; caption: string; frame: string; osc: string;
  crc: number; pad: number; led: number; bg: number[]; action: string; ftype: string; page: number;
}
export interface ManualFixture {
  name: string; model: string; mode: string; channels: number; start: number; end: number;
}
export interface ManualData {
  placed: ManualPlaced[];
  fixtures: ManualFixture[];
  maxCh: number;
  counts: { fixtures: number; functions: number; looks: number };
  showName: string; // e.g. "Punk Rock Show"
  qxwFile: string; // e.g. "punk-rock-show.qxw"
  qxfFiles: string[]; // custom fixture definitions to install (repo-relative paths)
}

// Energy-ladder frames are named "<BAND>-L<tier>" (BASE-L1, STROBE-L2 …); colour + note key on the band.
const bandOf = (frame: string): string => frame.replace(/-L\d+$/, "");
const FRAME_COLOR: Record<string, string> = {
  BASE: "#5b9cff", STROBE: "#ff6b6b", CHASE: "#a78bfa", CTRL: "#36d399",
};
const FRAME_NOTE: Record<string, string> = {
  BASE: "Openers (R1-3) + verses/choruses (R4-5) — full looks. Solo: one base look at a time.",
  STROBE: "Strobes / hits (R6). Tap = momentary, overlays the running chaser.",
  CHASE: "Chasers (R7). Solo: one running effect at a time, riding on the base look.",
  CTRL: "Utility (R8, same on every page): Strobe All · Blinder · Sound Active · Park All · Heads Blackout · Blackout · Full On.",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// "10× Smart 2 Pro RGBWA+UV · 2× COLORband T3 BT · 2× Intimidator Spot 375Z IRC"
function fixtureSummary(fx: ManualFixture[]): string {
  const counts = new Map<string, number>();
  for (const f of fx) counts.set(f.model, (counts.get(f.model) ?? 0) + 1);
  return [...counts].map(([m, n]) => `${n}× ${m}`).join(" · ");
}
// One <li> per model with its 1-based start addresses, e.g. "Smart 2 Pro (10) → 1, 11, ..."
function addressBullets(fx: ManualFixture[]): string {
  const byModel = new Map<string, ManualFixture[]>();
  for (const f of fx) {
    const list = byModel.get(f.model) ?? [];
    list.push(f);
    byModel.set(f.model, list);
  }
  return [...byModel]
    .map(([model, list]) =>
      `        <li>${esc(model)} (${list.length}) → <span class="mono">${list.map((f) => f.start).join(", ")}</span></li>`)
    .join("\n");
}
function rgb(c: number[]): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function textOn(c: number[]): string {
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] > 150 ? "#10131a" : "#f3f6fc";
}

function asciiFlow(qxwFile: string): string {
  const openLine = `| 1. Open  ${qxwFile.padEnd(23).slice(0, 23)}|`;
  return `             +-----------------------------------------------+
             |  START - gear on hand, laptop on show network |
             +-----------------------------+-----------------+
                                           |
                          +----------------v----------------+
                          | 0. Install custom .qxf files     |
                          |    into QLC+ Fixtures, restart   |
                          +----------------+----------------+
                                           |
                          +----------------v----------------+
                          ${openLine}
                          +----------------+----------------+
                                           |
                          +----------------v----------------+
                          | 2. Address each light            |
                          |    (see Patch Chart)             |
                          +----------------+----------------+
                                           |
            +------------------------------+------------------------------+
            |                              |                              |
 +----------v-----------+      +-----------v-----------+      +-----------v-----------+
 | 3. Art-Net OUTPUT    |      | 4. Launchpad INPUT    |      | (optional) MCP / OSC  |
 |    Universe 0 -> node|      |    MIDI in + feedback |      |    dashboard control  |
 |    broadcast or IP   |      |    + Programmer Mode  |      |    /look  paths       |
 +----------+-----------+      +-----------+-----------+      +-----------+-----------+
            |                              |                              |
            +------------------------------+------------------------------+
                                           |
                          +----------------v----------------+
                          | 5. LOAD TEST  ->  doors          |
                          +---------------------------------+`;
}

// "How the Launchpad works" — three ASCII blocks (device / data flow / row inversion).
// Position-based (the operator is colorblind): pads are read by R#C#, not colour.
function asciiDevice(): string {
  return `  TOP ROUND BUTTONS  (firmware - DEAD in Programmer mode, except Session)
   [ ^ ]  [ v ]  [ < ]  [ > ]  [SESSION]  [Drums] [Keys] [User]
    arrows do NOT change pages -->   |
                                     +-- hold to ENTER / EXIT Programmer mode
                                         (an accidental tap KILLS the pads)

         C1   C2   C3   C4   C5   C6   C7   C8      right-edge
       +----+----+----+----+----+----+----+----+    scene column
    R1 |R1C1|    |    |    |    |    |    |R1C8|   ( )
    R2 |    |    |    |    |    |    |    |    |   ( )
    R3 |    |    |    |    |    |    |    |    |   ( )
    R4 |    |    |   8 x 8  GRID  (64 pads)   |   ( )
    R5 |    |    |    |    |    |    |    |    |   ( )
    R6 |    |    |    |    |    |    |    |    |   ( )
    R7 |    |    |    |    |    |    |    |    |   ( )
    R8 |    |    |    |    |    |    |    |R8C8|  (SSM)  <- "Stop Solo Mute"
       +----+----+----+----+----+----+----+----+
                                      |             hold SESSION + SSM
                       PAGE FLIP pad -+             = enter Programmer mode`;
}
function asciiDataFlow(): string {
  return `  PHYSICAL                  LAPTOP - QLC+ 4.14.4               WIRELESS
  -------------             --------------------              ------------
  Launchpad pad  --USB-->   MIDIIN2  --> VC button (MIDI) --+
   (Programmer mode)        (port 2)                        |
                                                            +--> Function --> Art-Net U0 --> rig
  Launchpad LED  <--USB--   MCP server --RGB SysEx (winmm)-->        |
   50% idle / 100% active   (owns MIDI OUT; QLC+ = input only)       |
                            OSC :7700 <--Wi-Fi-- iPad dashboard ------+
                                         VC button (OSC)   /look_r#c#

  Both buttons drive the SAME Function, so MIDI and OSC stay in sync.`;
}
function asciiRows(): string {
  return `  Hardware numbers pads BOTTOM-UP        Show maps them TOP-DOWN (PAD.rows)
  -------------------------------        ---------------------------------
   top row    = highest notes 81-88       R1 (top)    = colours    <- ch 209
   ...            (notes go down)         ...             (go down)
   bottom row = lowest  notes 11-18       R8 (bottom) = control    <- ch 139

  => the row order is REVERSED in software so the TOP row = your main colours.
  LEDs (driven by the MCP server, not QLC+):  idle = 50%  |  active look = 100%.`;
}

function gridHtml(placed: ManualPlaced[], page: number): string {
  let cells = "";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (r === 7 && c === 7) {
        // Bottom-right pad is the page-toggle on both pages (fires no look).
        cells += `<div class="pad" style="background:#222a3a;color:#cdd7ea;box-shadow:inset 0 0 0 2px #8a97ad">` +
          `<span class="rc">R8C8</span><span class="nm">⇄ PAGE</span><span class="tp">cycle</span></div>`;
        continue;
      }
      const g = placed.find((x) => x.row === r && x.col === c && x.page === page);
      if (!g) {
        cells += `<div class="pad empty"><span class="rc">R${r + 1}C${c + 1}</span></div>`;
        continue;
      }
      cells += `<div class="pad" style="background:${rgb(g.bg)};color:${textOn(g.bg)};box-shadow:inset 0 0 0 2px ${FRAME_COLOR[bandOf(g.frame)] || "#888"}">` +
        `<span class="rc">R${r + 1}C${c + 1}</span>` +
        `<span class="nm">${esc(g.caption)}</span>` +
        `<span class="tp">${esc(g.ftype)}</span></div>`;
    }
  }
  return `<div class="grid8">${cells}</div>`;
}

function legendHtml(frames: string[]): string {
  return frames
    .map((f) => `<span class="lg"><i style="background:${FRAME_COLOR[f]}"></i>${f} <small>${esc(FRAME_NOTE[f])}</small></span>`)
    .join("");
}

function lookRows(placed: ManualPlaced[], page: number): string {
  const order = ["BASE", "STROBE", "CHASE", "CTRL"];
  return [...placed]
    .filter((g) => g.page === page)
    .sort((a, b) => order.indexOf(bandOf(a.frame)) - order.indexOf(bandOf(b.frame)) || a.row - b.row || a.col - b.col)
    .map((g) => `<tr>
      <td><span class="dot" style="background:${rgb(g.bg)}"></span>${esc(g.caption)}</td>
      <td><span class="tag" style="border-color:${FRAME_COLOR[bandOf(g.frame)]};color:${FRAME_COLOR[bandOf(g.frame)]}">${bandOf(g.frame)}</span></td>
      <td>${esc(g.ftype)}${g.action === "Flash" ? " · hold" : ""}</td>
      <td class="mono">P${g.page + 1} R${g.row + 1}C${g.col + 1} · ch ${g.pad}</td>
      <td class="mono">${esc(g.osc)}</td>
    </tr>`)
    .join("\n");
}

function patchRows(fixtures: ManualFixture[]): string {
  return fixtures
    .map((f) => `<tr><td class="mono">${f.start}–${f.end}</td><td>${esc(f.name)}</td><td>${esc(f.model)}</td><td class="mono">${esc(f.mode)}</td><td class="mono">${f.channels}</td></tr>`)
    .join("\n");
}

export function renderManual(d: ManualData): string {
  const toc = [
    ["overview", "1 · Overview"],
    ["flow", "2 · Setup flow chart"],
    ["s0", "3 · Step 0 — Install fixture"],
    ["s1", "4 · Step 1 — Open project"],
    ["s2", "5 · Step 2 — Address lights"],
    ["s3", "6 · Step 3 — Art-Net output"],
    ["s4", "7 · Step 4 — Launchpad"],
    ["s5", "8 · Step 5 — Load test"],
    ["rehearse", "9 · Rehearse virtually (no lights)"],
    ["launchpad-anatomy", "10 · How the Launchpad works"],
    ["map", "11 · Launchpad map"],
    ["patch", "12 · Patch chart"],
    ["model", "13 · Control model"],
    ["trouble", "14 · Troubleshooting"],
  ]
    .map(([id, t]) => `<a href="#${id}">${t}</a>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>QLC+ ${esc(d.showName)} — Setup Manual</title>
<style>
  :root{--bg:#0b0e14;--panel:#121722;--panel2:#0e131c;--line:#1f2738;--txt:#e6ebf5;
    --muted:#8a97ad;--accent:#5b9cff;--ok:#36d399;--warn:#f7b955;--err:#ff6b6b;--chip:#1a2233;
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--radius:12px}
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{margin:0;background:radial-gradient(1100px 540px at 82% -8%,#16203a 0,var(--bg) 60%);
    color:var(--txt);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
  .wrap{display:grid;grid-template-columns:260px 1fr;max-width:1280px;margin:0 auto;gap:0}
  nav{position:sticky;top:0;align-self:start;height:100vh;overflow:auto;padding:22px 16px;
    border-right:1px solid var(--line)}
  nav .brand{font-weight:800;letter-spacing:.3px;font-size:15px;margin-bottom:4px}
  nav .brand b{color:var(--accent)}
  nav .sub{color:var(--muted);font-size:12px;margin-bottom:16px}
  nav a{display:block;padding:7px 10px;border-radius:8px;color:var(--muted);font-size:13px;font-weight:600}
  nav a:hover{background:var(--chip);color:var(--txt);text-decoration:none}
  main{padding:28px 30px 80px;min-width:0}
  h1{font-size:26px;margin:0 0 4px}
  .lede{color:var(--muted);margin:0 0 22px}
  section{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);
    padding:18px 20px;margin:0 0 18px;scroll-margin-top:14px}
  section h2{margin:0 0 12px;font-size:18px;display:flex;align-items:center;gap:10px}
  section h3{font-size:14px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:18px 0 8px}
  .num{display:inline-flex;width:26px;height:26px;border-radius:7px;background:var(--accent);
    color:#06101f;font-weight:800;align-items:center;justify-content:center;font-size:14px;flex:0 0 auto}
  pre{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:14px;
    overflow:auto;font-family:var(--mono);font-size:12.5px;line-height:1.35;color:#cdd7ea}
  code{font-family:var(--mono);background:var(--chip);padding:1px 6px;border-radius:6px;font-size:13px}
  ol.steps{margin:0;padding-left:20px}ol.steps>li{margin:8px 0}
  ul{margin:8px 0;padding-left:20px}li{margin:4px 0}
  .note{border-left:3px solid var(--warn);background:rgba(247,185,85,.08);padding:10px 14px;
    border-radius:8px;margin:12px 0;font-size:14px}
  .ok{border-left-color:var(--ok);background:rgba(54,211,153,.08)}
  .kpi{display:flex;gap:10px;flex-wrap:wrap;margin:6px 0 0}
  .kpi div{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:8px 12px;font-size:13px}
  .kpi b{color:var(--accent);font-size:18px;display:block}
  table{width:100%;border-collapse:collapse;font-size:13.5px;margin-top:6px}
  th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  th{color:var(--muted);text-transform:uppercase;font-size:11px;letter-spacing:.5px}
  .mono{font-family:var(--mono);font-size:12.5px}
  .dot,.lg i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:7px;vertical-align:middle}
  .tag{border:1px solid;border-radius:999px;padding:1px 9px;font-size:11px;font-weight:700}
  .legend{display:flex;flex-wrap:wrap;gap:14px;margin:4px 0 14px}
  .lg{font-size:12px;color:var(--txt);font-weight:700;display:flex;align-items:center;gap:0}
  .lg small{color:var(--muted);font-weight:500;margin-left:6px}
  .grid8{display:grid;grid-template-columns:repeat(8,1fr);gap:6px;max-width:880px}
  .pad{aspect-ratio:1/1;border-radius:9px;padding:6px;display:flex;flex-direction:column;
    justify-content:space-between;font-size:11px;overflow:hidden;border:1px solid var(--line)}
  .pad .rc{font-family:var(--mono);font-size:9px;opacity:.7}
  .pad .nm{font-weight:800;line-height:1.15;font-size:11px}
  .pad .tp{font-size:9px;opacity:.85;text-transform:uppercase;letter-spacing:.3px}
  .pad.empty{background:var(--panel2);color:#475067}
  @media (max-width:880px){.wrap{grid-template-columns:1fr}nav{position:static;height:auto;border-right:none;border-bottom:1px solid var(--line)}.grid8{grid-template-columns:repeat(4,1fr)}}
  @media print{nav{display:none}.wrap{grid-template-columns:1fr}body{background:#fff;color:#000}
    section{break-inside:avoid;border-color:#ccc}a{color:#000}}
</style>
</head>
<body>
<div class="wrap">
  <nav>
    <div class="brand">QLC+ <b>${esc(d.showName)}</b></div>
    <div class="sub">Setup Manual</div>
    ${toc}
  </nav>
  <main>
    <h1>${esc(d.showName)} — Setup Manual</h1>
    <p class="lede">${esc(fixtureSummary(d.fixtures))}.
      Art-Net out, Launchpad + MCP/dashboard control.</p>

    <section id="overview"><h2><span class="num">1</span> Overview</h2>
      <p>The project is fully pre-built. On show day there are three real jobs:
        <b>address the lights</b>, <b>point Art-Net at the node</b>, and <b>map the Launchpad</b>.
        Then load-test and you're live.</p>
      <div class="kpi">
        <div><b>${d.counts.fixtures}</b>fixtures</div>
        <div><b>${d.counts.looks}</b>looks</div>
        <div><b>${d.counts.functions}</b>functions</div>
        <div><b>${d.maxCh}/512</b>DMX channels</div>
        <div><b>1</b>universe</div>
      </div>
      <div class="note ok">Files: <code>${esc(d.qxwFile)}</code> (open in QLC+),
        ${d.qxfFiles.map((f) => `<code>${esc(f)}</code>, `).join("")}<code>config/widgets.json</code>, <code>PATCH-CHART.md</code>, this manual.</div>
      <div class="note">Use <b>QLC+ 4.14.x</b> (the build at <code>C:\\QLC+4</code>). The show is in
        4.x format — <b>QLC+ 5 has a different Virtual Console and will not load it correctly.</b>
        You can <b>rehearse the whole show on screen with no lights or DMX node</b> — see
        <a href="#rehearse">§9 Rehearse virtually</a>.</div>
    </section>

    <section id="flow"><h2><span class="num">2</span> Setup flow chart</h2>
      <pre>${esc(asciiFlow(d.qxwFile))}</pre>
    </section>

    <section id="s0"><h2><span class="num">0</span> Install custom fixture definitions</h2>
      ${d.qxfFiles.length === 0
        ? `<p>This rig only uses fixtures QLC+ already knows — nothing to install. Skip to Step 1.</p>`
        : `<p>QLC+ won't know these fixtures until their definitions are in your user fixtures folder.</p>
      <ol class="steps">
        <li>Copy ${d.qxfFiles.map((f) => `<code>${esc(f)}</code>`).join(", ")} to
          <code>C:\\Users\\&lt;you&gt;\\QLC+\\Fixtures\\</code> (create the folder if missing).</li>
        <li>Restart QLC+ so it loads the new definition${d.qxfFiles.length > 1 ? "s" : ""}.</li>
      </ol>`}
      ${d.qxfFiles.some((f) => f.includes("Rainbow"))
        ? `<div class="note">✅ The Rainbow 10-channel map is
        <span class="mono">Dim · Strobe · R · G · B · W · A · UV · Macro · Speed</span> —
        <b>rig-verified 2026-06-09</b> (the vendor's published layout had Strobe at ch 8 and the
        colours one slot early; the real light puts Strobe at ch 2 and colours at ch 3–8).
        The def and the generator both use the verified map; nothing to check on the light
        beyond <b>10-channel mode</b>.</div>`
        : ""}
    </section>

    <section id="s1"><h2><span class="num">1</span> Open the project</h2>
      <p>Easiest: the desktop <b>QLC+ MCP</b> shortcut launches QLC+ with the show + dashboard.
        Or manually run:</p>
      <pre>C:\\QLC+4\\qlcplus.exe --open ${esc(d.qxwFile)} -p -w</pre>
      <p><code>--open &lt;file&gt;</code> loads the project (a bare path is <b>ignored</b>),
        <code>-p</code> = start in Operate mode, <code>-w</code> = web API on :9999. Then the
        <b>Virtual Console</b> opens on <b>Page 1 (Level 1 — chill)</b>; the R8C8 pad or PgDn/PgUp ramps
        energy to <b>Page 2 (Level 2 — driving)</b> and <b>Page 3 (Level 3 — full-send)</b>, then wraps
        back. All three pages share the same pad layout; five faders sit to the right of the grid.</p>
    </section>

    <section id="s2"><h2><span class="num">2</span> Address the lights</h2>
      <p>Set each fixture's physical DMX <b>start address</b> on its display / DIP switches to match
        the <a href="#patch">Patch Chart</a>. All on one universe; spacing leaves room for mode changes.</p>
      <ul>
${addressBullets(d.fixtures)}
      </ul>
    </section>

    <section id="s3"><h2><span class="num">3</span> Art-Net output → your DMX node</h2>
      <p><b>Nothing to enable in QLC+</b> — the show ships with ArtNet output baked in
        (Line 0, universe 0, broadcast). What follows documents the <b>example rig's node</b>
        (a Pknight CR011R, verified live 2026-06-09) — your node's IPs and settings will differ,
        but the shape of the setup (static NIC IP on the node's subnet, node transmit =
        Art-Net→DMX, universe 0) is the same:</p>
      <ul>
        <li><b>PC:</b> USB Ethernet NIC ("Ethernet 3") set <b>static 10.201.6.1 / 255.255.255.0</b>
          (elevated: <span class="mono">New-NetIPAddress -InterfaceAlias 'Ethernet 3' -IPAddress 10.201.6.1 -PrefixLength 24</span>).</li>
        <li><b>Node:</b> Pknight CR011R at <b>10.201.6.100/24</b> (fw v2.7). OLED settings:
          <span class="mono">Port universe 0 · Port SubNet 0 · Port Net 0 · Transmit: Artnet -&gt; dmx</span>.
          Configured on the box itself (no web UI): Menu steps pages, Enter selects,
          <b>hold Enter 3 seconds to save</b>.</li>
        <li><b>Node LEDs:</b> blue LED <b>blinks while Art-Net data flows</b> (fw 2.7 — the printed
          manual's v2.5 legend is wrong); RJ45 right-side green = data activity, left = link.</li>
      </ul>
      <div class="note">⚠️ If the PC NIC's IP ever changes, the ArtNet line index shifts and the rig
        goes dark. <b>Live fix, no relaunch:</b> browser → <span class="mono">localhost:9999/config</span>
        → <i>Stage</i> row → Output → select <span class="mono">[ArtNet] 10.201.6.1</span>.
        Applies instantly, nothing to save.</div>
    </section>

    <section id="s4"><h2><span class="num">4</span> Launchpad Mini MK3 → MIDI IN only (the MCP drives the LEDs)</h2>
      <p><b>QLC+ reads pad presses; it does NOT light the pads.</b> The MCP server's launchpad module
        owns the Launchpad MIDI output and lights every pad itself over RGB SysEx (idle 50%, the active
        look at 100%) — see <code>src/launchpad/leds.ts</code>. In QLC+'s
        <b>Inputs/Outputs ▸ Launchpad</b>, set <b>Input = MIDIIN2 (LPMiniMK3 MIDI)</b> and
        <b>leave Feedback EMPTY</b> — binding Feedback would fight the module for the MIDI OUT port.
        Windows' numeric device index can shift on replug/reboot; if presses stop registering,
        re‑select <b>Input = MIDIIN2</b>. If pads stay dark, reseat the USB and restart the MCP server.</p>

      <h3>Programmer Mode (set automatically by the MCP — manual fallback below)</h3>
      <ol class="steps">
        <li><b>Hold</b> the <b>Session</b> button (top‑row round button) and keep holding it.</li>
        <li>While still holding Session, press the <b>bottom button of the right‑edge column</b> —
          the bottom‑right corner button, printed <b>"Stop&nbsp;Solo&nbsp;Mute"</b>. (Read the label,
          not the color — that's the Programmer‑mode selector.)</li>
        <li><b>Release.</b> Confirmation: the green <b>Session light goes OUT</b> and the grid goes
          dark, then your look pads glow in their colors.</li>
      </ol>
      <div class="note">⚠️ <b>Do not tap Session while playing.</b> It drops the Launchpad back to
        Session mode and the pads go dead (QLC+ stops receiving). Fix: hold <b>Session</b> →
        <b>Stop&nbsp;Solo&nbsp;Mute</b> again. This is the one thing that knocks the rig out.</div>
      <p>Pads glow at <b>50%</b> in their look colour when idle; the <b>active</b> look in each row
        jumps to <b>100%</b> so the live look is unmistakable. The grid reads <b>top rows =
        openers</b> (whole‑band hues + member spotlights),
        then verses/choruses, strobes, chasers, and the <b>utility row at the bottom</b>. The <b>physical
        Launchpad, the QLC+ on‑screen console, and the dashboard all share this exact 8×8</b>, so a look
        sits in the same spot on all three. See the <a href="#map">Launchpad map</a> for what each pad does.</p>
    </section>

    <section id="s5"><h2><span class="num">5</span> Load test (5 min, before doors)</h2>
      <ul>
        <li><b>Patch:</b> Inputs/Outputs shows fixtures at the right addresses, no overlap warnings.</li>
        <li><b>Output:</b> fire <b>WASH ▸ White</b> — the rig lights.</li>
        <li><b>Launchpad:</b> a grid pad fires the look and lights up.</li>
        <li><b>OSC/dashboard:</b> the dashboard Control tab lists every look; pressing one fires it.</li>
      </ul>
      <div class="note ok">Both surfaces drive the same function, so the Launchpad LED and the
        dashboard stay in sync.</div>
    </section>

    <section id="rehearse"><h2><span class="num">▶</span> Rehearse virtually (no lights)</h2>
      <p>You don't need the rig to practice. QLC+'s <b>Fixture Monitor</b> draws your fixtures on
        screen and lights them exactly as the real rig would — so you can build and learn looks on
        the Launchpad with <b>no lights, no Art‑Net node, no DMX</b>.</p>
      <ol class="steps">
        <li><b>Launch the show in Operate mode</b> (Step 1): desktop shortcut, or
          <code>C:\\QLC+4\\qlcplus.exe --open ${esc(d.qxwFile)} -p -w</code>.</li>
        <li><b>Programmer Mode</b> on the Launchpad (Step 4 — hold Session → Stop Solo Mute).</li>
        <li>Top toolbar → <b>Monitor</b> → click <b>2D View</b> → drag the window beside the main one.
          Your ${d.counts.fixtures} fixtures appear laid out (pars front, bars mid, heads upstage).</li>
        <li><b>Press pads</b> — looks fire, the fixtures light in the Monitor, and the pad glows
          bright. That's the full show, virtual.</li>
      </ol>
      <div class="note">If the Monitor looks empty or everything's crammed in a corner, the grid
        size got reset — it's baked at <b>5 × 4 m</b>; nudge the <b>Size</b> spinner (top of the
        Monitor) back to roughly 5 × 4 if needed. Heads show as gobo icons; RGB pars/bars are dark
        squares until a look lights them.</div>
    </section>

    <section id="launchpad-anatomy"><h2><span class="num">10</span> How the Launchpad works</h2>
      <p>One device, three things to know: the <b>physical buttons</b>, how a press <b>travels to the
        rig</b>, and why the <b>rows are flipped</b>. Read a pad by its <b>position</b> (R#C#), not its
        colour.</p>
      <h3>The physical device</h3>
      <pre>${esc(asciiDevice())}</pre>
      <div class="note">⚠️ The page-flip pad <b>R8C8</b> (a grid pad) and <b>Stop&nbsp;Solo&nbsp;Mute</b>
        (a round scene button used <i>with Session</i> to enter Programmer Mode) are <b>two different
        buttons</b> — don't confuse them.</div>
      <h3>How a press reaches the lights</h3>
      <pre>${esc(asciiDataFlow())}</pre>
      <p>Use the <b>second</b> MIDI port. If the pads go dead after a replug/reboot, re-select
        <b>Input = MIDIIN2</b> and <b>Feedback = MIDIOUT2</b> in QLC+ Inputs/Outputs.</p>
      <h3>Why the top row is your colours — row inversion + LED states</h3>
      <pre>${esc(asciiRows())}</pre>
      <p>See the <a href="#map">Launchpad map</a> for what every pad does on each page.</p>
    </section>

    <section id="map"><h2><span class="num">11</span> Launchpad map — the energy ladder (3 pages)</h2>
      <p>The 8×8 grid exactly as it sits on the Launchpad (<b>row 1 = top</b>). The physical Launchpad,
        the QLC+ on‑screen console, and the dashboard all use this <b>same layout</b>. All three pages
        share <b>one positional grammar</b> — a pad keeps its song‑moment meaning on every page, just
        redesigned hotter each level. The show <b>boots on Page 1 (Level 1)</b>; <b>press the
        bottom‑right pad (R8C8) to ramp energy</b> — it cycles <b>Page 1 → 2 → 3 → 1</b>, so you raise a
        song's intensity without moving your fingers. That corner pad fires no look. (The Mini MK3's top
        →/← arrows don't transmit on the Programmer port, so a real grid pad owns the switch.)
        <b>PgDn / PgUp</b> also switch pages. Each button's caption shows its <b>tier + R#C#</b> after the
        name (e.g. "Band Red L1 R1C2"); idle pads glow at 50% and the <b>active</b> look at <b>100%</b>. Read
        by <b>position</b>, not colour.</p>
      <p style="margin:0 0 8px">Every page, same rows: <b>R1‑3 openers</b> (whole‑band hues + member
        spotlights + texture/crowd), <b>R4‑5 verses/choruses</b>, <b>R6 strobes/hits</b>, <b>R7 chasers</b>,
        <b>R8 utility</b> (identical on every page — the stable safety layer).</p>
      <div class="legend">${legendHtml(["BASE", "STROBE", "CHASE", "CTRL"])}</div>
      <h3>Page 1 — Level 1 · chill <span style="font-weight:400">(boots here)</span></h3>
      ${gridHtml(d.placed, 0)}
      <h3>Page 2 — Level 2 · driving <span style="font-weight:400">(tap R8C8 to ramp up)</span></h3>
      ${gridHtml(d.placed, 1)}
      <h3>Page 3 — Level 3 · full‑send <span style="font-weight:400">(tap R8C8 again)</span></h3>
      ${gridHtml(d.placed, 2)}
      <div class="note">Five console faders sit to the <b>right of the grid, visible on every page</b>:
        <b>Pars Dim · Bars Dim · Heads Dim</b> (per‑group masters — default full, pull one down to dim
        that group), plus <b>Strobe Rate</b> and <b>Heads Zoom</b>. <b>Master Dim</b> is the built‑in
        GrandMaster (top‑right — dims everything).</div>
      <h3>Every pad — settings</h3>
      <table>
        <thead><tr><th>Look</th><th>Band</th><th>Type</th><th>Page · pad · LP ch</th><th>OSC path</th></tr></thead>
        <tbody>
${lookRows(d.placed, 0)}
${lookRows(d.placed, 1)}
${lookRows(d.placed, 2)}
        </tbody>
      </table>
    </section>

    <section id="patch"><h2><span class="num">12</span> Patch chart</h2>
      <table>
        <thead><tr><th>Address</th><th>Fixture</th><th>Model</th><th>Mode</th><th>Ch</th></tr></thead>
        <tbody>
${patchRows(d.fixtures)}
        </tbody>
      </table>
    </section>

    <section id="model"><h2><span class="num">13</span> Control model</h2>
      <p>QLC+ stores only one external input per Virtual Console button, so every look has
        <b>two</b> buttons pointing at the <b>same function</b>: one bound to the Launchpad (MIDI,
        with LED feedback) and one bound to OSC for the MCP/dashboard. The dashboard's
        <code>widgets.json</code> only lists the OSC buttons, so each look shows once.</p>
      <p>The grid is an <b>energy ladder</b>: <b>three pages</b> of 8×8 that share one positional
        grammar, each a hotter energy tier. The show <b>boots on Page 1 (Level 1)</b>; the
        <b>bottom-right pad (R8C8)</b> or <b>PgDn / PgUp</b> ramps energy (Page 1 → 2 → 3 → 1, wrapping).
        Each page's looks sit in non-overlapping row bands:</p>
      <ul>
        <li><b>Rows 1-5 · BASE</b> (Solo — one base look at a time): rows 1-3 openers (whole-band hues,
          member spotlights, texture/crowd) and rows 4-5 verses/choruses. These 40 looks render at three
          energy levels — P1 deep/cool, P2 saturated, P3 hot + white punch.</li>
        <li><b>Row 6 · STROBES</b> (non-solo): momentary hits that overlay a running chaser. <b>Row 7 ·
          CHASERS</b> (Solo — one running effect at a time, riding on the base look). Both escalate slow →
          medium → fast/hard with the tier.</li>
        <li><b>Row 8 · UTILITY</b> — <b>identical on every page</b> (the stable safety layer, does not
          escalate): Strobe All · Blinder · Sound Active · Park All · Heads Blackout · Blackout · Full On.
          R8C8 is the energy-up page flip. Plus <b>5 faders</b> to the right (Pars/Bars/Heads Dim, Strobe
          Rate, Heads Zoom), visible on every page.</li>
      </ul>
      <p><b>Brightness:</b> every scene drives its own master dimmer to full, so looks light up on their
        own — including the bars. The three Dim faders on page 2 are <i>overrides</i>: leave them up for
        full, pull one down to dim that group. <b>Master Dim</b> is the QLC+ GrandMaster (global reducer).</p>
      <p><b>Moving heads aim by stage geometry.</b> Pan/tilt for the heads are computed from your
        measured stage and performer positions (see <code>rig.json</code>) so the named positions point at
        real targets: <b>Singer</b>, <b>Guitar</b>, <b>Bass</b>, <b>Drums</b>, the crowd, plus
        <b>Stage Wash</b> and crossed beams. The motion chases (Head Circle,
        Audience Sweep, Cross Zigzag, Figure 8, Pan Wave, Tilt Dip) orbit the band and stay on stage;
        Audience Sweep spins downstage and throws out over the crowd. If a beam misses, note which way it's
        off and the show is rebuilt with the corrected geometry — no hand-nudging pan/tilt inside QLC+.</p>
      <p>OSC paths are <code>/</code> + the lowercase look name (spaces → <code>_</code>) including the
        pad coordinate, e.g. <code>/red_r1c1</code>. The channel QLC+ matches is the CRC-16 hash of that
        path — pre-baked, so no Auto-Detect is ever needed.</p>
    </section>

    <section id="trouble"><h2><span class="num">14</span> Troubleshooting</h2>
      <table>
        <thead><tr><th>Symptom</th><th>Fix</th></tr></thead>
        <tbody>
          <tr><td><b>Pads were working, now nothing fires</b></td><td>The Launchpad got knocked to Session mode (Session got tapped). Re‑enter Programmer Mode: <b>hold Session → Stop Solo Mute</b> (bottom‑right). The green Session light should go OUT.</td></tr>
          <tr><td>Top →/← arrows don't change the page</td><td>Expected — the Mini MK3's top arrows don't transmit in Programmer mode. Flip pages with the <b>bottom‑right pad (R8C8)</b>, or <b>PgDn/PgUp</b> on the keyboard.</td></tr>
          <tr><td>Pads dead from the start / pads don't glow</td><td>Wrong MIDI port. Inputs/Outputs ▸ Launchpad → set Input = <b>MIDIIN2</b>, Feedback = <b>MIDIOUT2</b> (the second port). And confirm Programmer Mode.</td></tr>
          <tr><td>Presses register but Monitor shows nothing</td><td>The 2D Monitor grid got reset huge — fixtures are crammed in a corner. Set the Monitor <b>Size</b> back to ~5 × 4 m, or reopen Monitor ▸ 2D View.</td></tr>
          <tr><td>QLC+ opens "New Workspace" / project blank</td><td>You launched without <code>--open</code> (a bare path is ignored), or you opened it in <b>QLC+ 5</b>. Use <code>C:\\QLC+4\\qlcplus.exe --open ${esc(d.qxwFile)}</code>.</td></tr>
          <tr><td>MIDI input stalls and won't resume</td><td>Reload QLC+: close it and relaunch with <code>--open … -p -w</code>, then re‑enter Programmer Mode once.</td></tr>
          <tr><td>Lights don't respond (real rig)</td><td>Walk the chain: fixture's address display <b>blinking = no DMX</b> → swap that hop's XLR cable (a bad head-of-chain cable caused a full-dark night on 2026-06-09). Then: node blue LED blinking? <span class="mono">localhost:9999/config</span> → Stage Output = <span class="mono">[ArtNet] 10.201.6.1</span>; NIC static 10.201.6.1/24; ping 10.201.6.100.</td></tr>
          <tr><td>Wrong colors on Rainbow pars</td><td>Ensure <b>10-channel mode</b> on the light. Map is rig-verified (Dim·Strobe·R·G·B·W·A·UV·Macro·Speed) — if colors shift, the light is in a different personality, not a def problem.</td></tr>
          <tr><td>Dashboard button does nothing</td><td>QLC+ Stage ▸ Input OSC enabled (port 7700); MCP host/port point at QLC+.</td></tr>
          <tr><td>Two looks stuck on together</td><td>WASH/HEADS are Solo by design; if not soloing, confirm buttons sit inside the Solo frame.</td></tr>
          <tr><td>Heads parked / not moving</td><td>Fire a HEADS position; check Pan/Tilt addressing and that the dimmer/shutter are open.</td></tr>
        </tbody>
      </table>
    </section>
  </main>
</div>
</body>
</html>
`;
}
