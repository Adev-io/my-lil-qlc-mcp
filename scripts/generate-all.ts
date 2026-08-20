/*
 * generate-all.ts — one command rebuilds the whole generated surface from rig.json:
 *   1. build-show.ts     -> <show>.qxw + PATCH-CHART.md + SETUP-MANUAL.html
 *   2. build-monitor.ts  -> monitor/fixtures.json
 *   3. generateWidgets   -> config/widgets.json (parsed back out of the fresh .qxw)
 * Run:  npm run generate  (optionally: npx tsx scripts/generate-all.ts path/to/rig.json)
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRig, slugify } from "./rig.js";
import { builderScript } from "./generate-all-helpers.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rigArg = process.argv[2];
const { rig, rigPath } = loadRig(rigArg); // validates early, before any subprocess runs
const qxw = `${slugify(rig.meta.name)}.qxw`;

const run = (args: string[]) =>
  execFileSync("npx", ["tsx", ...args], { cwd: REPO, stdio: "inherit", shell: true });

run([builderScript(rig.meta.builder), rigPath]);
run(["scripts/build-monitor.ts", rigPath]);
run(["src/qlc/generateWidgets.ts", `./${qxw}`, "config/widgets.json"]);

console.log(`\nDone. Regenerated ${qxw}, PATCH-CHART.md, SETUP-MANUAL.html, monitor/fixtures.json, config/widgets.json from ${path.basename(rigPath)}.`);
console.log("Restart the MCP server (or start-show.ps1) to pick up the new widget map.");
