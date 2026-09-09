export function parseUniverseList(value: string | undefined): number[] {
  const raw = value?.trim() || "0";
  const parsed = raw.split(",").map((part) => Number(part.trim()));
  if (parsed.some((universe) => !Number.isInteger(universe) || universe < 0 || universe > 32767)) {
    throw new Error(`Invalid Art-Net universe list: ${raw}`);
  }
  return [...new Set(parsed)].sort((a, b) => a - b);
}

export class FrameStore {
  readonly universes: number[];
  private readonly frames = new Map<number, Uint8Array>();
  private readonly updatedAt = new Map<number, number>();

  constructor(universes: number[]) {
    this.universes = [...new Set(universes)].sort((a, b) => a - b);
    for (const universe of this.universes) this.frames.set(universe, new Uint8Array(512));
  }

  update(universe: number, data: Uint8Array, now = Date.now()): boolean {
    const frame = this.frames.get(universe);
    if (!frame) return false;
    frame.fill(0);
    frame.set(data.subarray(0, 512));
    this.updatedAt.set(universe, now);
    return true;
  }

  frame(universe: number): Uint8Array {
    return this.frames.get(universe) ?? new Uint8Array(512);
  }

  lastFrameAt(universe: number): number {
    return this.updatedAt.get(universe) ?? 0;
  }

  payload(): string {
    return JSON.stringify(Object.fromEntries(
      this.universes.map((universe) => [universe, Buffer.from(this.frame(universe)).toString("base64")]),
    ));
  }
}
