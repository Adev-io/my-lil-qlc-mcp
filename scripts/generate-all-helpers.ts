// Which show builder a rig's meta.builder selects. Kept as a pure helper so the
// dispatch is unit-testable without spawning the generator subprocesses.
export function builderScript(builder: string | undefined): string {
  return builder === "party" ? "scripts/build-party.ts" : "scripts/build-show.ts";
}
