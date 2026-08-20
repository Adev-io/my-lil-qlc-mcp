// Eye-safe fence enforcer: clamp every moving-head PAN and TILT into that head's MEASURED safe
// fence (rig.json -> headSafety, keyed by DMX address) and zero any firmware movement macro (ch13).
// Runs from start-show.ps1 right before QLC+ opens the show, so the fence is re-applied at every
// launch and survives hand-edits and regenerates.
//
// 2026-06-13: heads were lowered 8.5ft -> ~4ft (near eye level). The old single tilt band [185,225]
// is GONE — at 4ft the three settings (Band/Canopy/Trees) point opposite ways, so each head gets a
// UNION fence in rig.json. This is a COARSE backstop; precise eye-safety comes from the build emitting
// only measured settings + the live card-sweep before doors.
//
// Contract: IDEMPOTENT (no write when already in fence), backs up to <file>.floorbak before any
// change, and ALWAYS exits 0 — a failure here must never stop the show launching.
//
// Usage: node scripts/floor-head-tilt.mjs <show.qxw> [more.qxw ...]
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// head model + channel offsets + per-address fence from rig.json (fallback: Chauvet 375Z, no fence)
let headModel = "Intimidator", panCh = 0, tiltCh = 2, movCh = 13;
let headSafety = {};
try {
  const rig = JSON.parse(readFileSync(join(ROOT, "rig.json"), "utf8"));
  const head = (rig.fixtures || []).find((f) => f.kind === "head");
  if (head) {
    if (head.model) headModel = head.model;
    if (head.roles?.pan != null) panCh = head.roles.pan;
    if (head.roles?.tilt != null) tiltCh = head.roles.tilt;
    if (head.roles?.mov != null) movCh = head.roles.mov;
  }
  headSafety = rig.headSafety || {};
} catch { /* defaults */ }
const headRe = new RegExp(headModel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const clampN = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

for (const file of process.argv.slice(2)) {
  try {
    if (!existsSync(file)) { console.log(`  fence: ${file} absent — skipped`); continue; }
    const xml = readFileSync(file, "utf8");
    // Map each head fixture ID -> its fence (by DMX address). Parse <Fixture> blocks for ID+Address.
    const fenceById = new Map();
    for (const m of xml.matchAll(/<Fixture>[\s\S]*?<\/Fixture>/g)) {
      if (!headRe.test(m[0])) continue;
      const id = m[0].match(/<ID>(\d+)<\/ID>/);
      const addr = m[0].match(/<Address>(\d+)<\/Address>/);
      if (id && addr) {
        const f = headSafety[addr[1]];
        if (f) fenceById.set(id[1], f);
      }
    }
    // Be honest here: with no fences there is nothing to key off, so this pass changes NOTHING —
    // not even macros. Saying "only zeroing macros" once cost a debugging cycle.
    if (fenceById.size === 0) { console.log(`  fence: ${file} — no head fences in rig.json (or no heads) — nothing to enforce`); }

    let panFixed = 0, tiltFixed = 0, macroFixed = 0;
    // Walk Function blocks rather than the whole file, so a scene can declare itself exempt from
    // macro-zeroing by NAME. A firmware sound-active program is the one movement macro that IS
    // intentional (bar mitzvah show, R8C6 "Truss Sound"); without this the fence would silently
    // strip it at every launch and the pad would look broken. Pan/tilt clamping still applies —
    // it costs nothing, since a head in a firmware program ignores those channels anyway.
    const out = xml.replace(/<Function\b[^>]*>[\s\S]*?<\/Function>/g, (block) => {
      const soundMode = /sound/i.test(block.match(/\sName="([^"]*)"/)?.[1] ?? "");
      return block.replace(/<FixtureVal ID="(\d+)">([^<]*)<\/FixtureVal>/g, (full, id, body) => {
        const fence = fenceById.get(id);
        if (!fence) return full; // only head fixtures (those with a rig.headSafety fence) are touched
        const parts = body.split(",");
        if (parts.length % 2 !== 0 || parts.some((x) => x === "" || Number.isNaN(Number(x)))) return full;
        const n = parts.map(Number);
        let changed = false;
        for (let k = 0; k + 1 < n.length; k += 2) {
          if (n[k] === panCh) {
            const c = clampN(n[k + 1], fence.panMin, fence.panMax);
            if (c !== n[k + 1]) { n[k + 1] = c; panFixed++; changed = true; }
          } else if (n[k] === tiltCh) {
            const c = clampN(n[k + 1], fence.tiltMin, fence.tiltMax);
            if (c !== n[k + 1]) { n[k + 1] = c; tiltFixed++; changed = true; }
          } else if (n[k] === movCh && n[k + 1] !== 0 && !soundMode) { n[k + 1] = 0; macroFixed++; changed = true; }
        }
        return changed ? `<FixtureVal ID="${id}">${n.join(",")}</FixtureVal>` : full;
      });
    });

    if (out !== xml) {
      copyFileSync(file, file + ".floorbak");
      writeFileSync(file, out);
      console.log(`  fence: ${file} — clamped ${panFixed} pan / ${tiltFixed} tilt into rig.headSafety, zeroed ${macroFixed} macro(s) [backup: ${file}.floorbak]`);
    } else {
      console.log(`  fence: ${file} — already inside head fences, no macros`);
    }
  } catch (e) {
    console.log(`  fence: ${file} — skipped on error (show still launches): ${e.message}`);
  }
}

process.exit(0); // never block the show
