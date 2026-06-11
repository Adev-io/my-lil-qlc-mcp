/*
 * rig.ts — load + validate the rig config that drives every generator.
 *
 * Single source of truth: scripts/build-show.ts (the .qxw + patch chart + manual)
 * and scripts/build-monitor.ts (the 3D monitor's fixtures.json) both read the SAME
 * rig.json, so fixtures, addresses, stage geometry and channel roles can never drift.
 *
 * Resolution order: explicit CLI arg -> <repo>/rig.json. The repo ships with NO root
 * rig.json (the rig-setup-wizard agent writes one for your rig on first run);
 * rigs/punk-rock-show.rig.json is the worked example.
 */

import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const Performer = z.object({
  x: z.number(), // ft from stage centre, +X = audience-right
  y: z.number(), // ft from the front edge, +Y = upstage
  aimZ: z.number().optional(), // beam target height (ft above the floor); default deck + 4
});

const FixtureGroup = z
  .object({
    kind: z.enum(["par", "bar", "head"]),
    namePrefix: z.string().optional(), // "Rainbow Par" -> "Rainbow Par 1..n"; defaults to the kind
    manufacturer: z.string(),
    model: z.string(),
    mode: z.string(),
    channels: z.number().int().positive(),
    count: z.number().int().min(0),
    addresses: z.array(z.number().int().min(0).max(511)),
    qxfFile: z.string().optional(), // custom fixture definition to install into QLC+
    roles: z.record(z.string(), z.union([z.number(), z.array(z.array(z.number()))])).optional(),
    // head-only extras (ignored for par/bar)
    beam: z
      .object({
        panRangeDeg: z.number().default(540),
        tiltRangeDeg: z.number().default(270),
        tiltCentreDeprDeg: z.number().default(37.5),
        shutterOpen: z.number().default(255),
        shutterOpenMin: z.number().default(216),
      })
      .optional(),
    colorWheel: z.record(z.string(), z.number()).optional(),
    goboSlots: z.array(z.number()).optional(),
  })
  .refine((g) => g.addresses.length === g.count, {
    message: "addresses[] length must equal count",
  });

export const RigSchema = z.object({
  $schema: z.string().optional(),
  meta: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    author: z.string().optional(),
  }),
  stage: z.object({
    widthFt: z.number().positive(),
    depthFt: z.number().positive(),
    deckHeightFt: z.number().min(0).default(0),
    headHeightFt: z.number().positive().default(8.5),
    headSeparationFt: z.number().positive().optional(), // default: stage width
    notes: z.string().optional(),
  }),
  performers: z.record(z.string(), Performer).optional(),
  fixtures: z.array(FixtureGroup).min(1),
  controller: z
    .object({
      launchpad: z.boolean().default(false),
      model: z.string().optional(),
      profile: z.string().optional(),
      inputUid: z.string().default("None"),
      inputLine: z.string().default("0"),
      outputUid: z.string().default("None"),
      outputLine: z.string().default("0"),
    })
    .optional(),
  dmxOutput: z
    .object({
      plugin: z.string().default("ArtNet"),
      universe: z.number().int().min(0).default(0),
      transmitMode: z.string().default("Standard"),
      outputIp: z.string().nullable().default(null),
      notes: z.string().optional(),
    })
    .optional(),
});

export type Rig = z.infer<typeof RigSchema>;
export type RigFixtureGroup = Rig["fixtures"][number];

// DMX footprints must fit in the universe and must not overlap across fixtures.
function checkAddresses(rig: Rig): void {
  const spans: { name: string; start: number; end: number }[] = [];
  for (const g of rig.fixtures) {
    g.addresses.forEach((a, i) => {
      const end = a + g.channels - 1;
      if (end > 511)
        throw new Error(`${g.model} #${i + 1} at address ${a} runs past channel 512 (${g.channels}ch)`);
      spans.push({ name: `${g.namePrefix ?? g.kind} ${i + 1}`, start: a, end });
    });
  }
  spans.sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].start <= spans[i - 1].end)
      throw new Error(
        `DMX overlap: "${spans[i - 1].name}" (${spans[i - 1].start}-${spans[i - 1].end}) and "${spans[i].name}" (${spans[i].start}-${spans[i].end})`,
      );
  }
}

export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function loadRig(explicitPath?: string): { rig: Rig; rigPath: string } {
  const rigPath = explicitPath
    ? path.resolve(explicitPath)
    : path.join(REPO, "rig.json");
  if (!existsSync(rigPath)) {
    throw new Error(
      `No rig config at ${rigPath}.\n` +
        `First time here? Ask the rig-setup-wizard agent to interview you and write one,\n` +
        `or copy the worked example:  cp rigs/punk-rock-show.rig.json rig.json`,
    );
  }
  const raw = JSON.parse(readFileSync(rigPath, "utf8"));
  const parsed = RigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid rig config ${rigPath}:\n${issues}`);
  }
  checkAddresses(parsed.data);
  return { rig: parsed.data, rigPath };
}
