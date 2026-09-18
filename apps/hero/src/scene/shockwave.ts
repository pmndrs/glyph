/**
 * Impacts, published by whatever lands and read by whatever reacts. The title fires one per letter, so the sheets are
 * struck in five places at once rather than pushed from a single point at the origin — a word-shaped disturbance
 * instead of a circular one. Module state: there is a single scene.
 */
export interface Shockwave {
  readonly id: number;
  /** Milliseconds, from `performance.now()`. */
  readonly at: number;
  readonly world: readonly [x: number, y: number, z: number];
}

/** Only ever a handful in flight; every listener reads them the frame they are published. */
const KEEP = 16;
const recent: Shockwave[] = [];
let nextId = 1;

export function triggerShockwave(world: readonly [x: number, y: number, z: number]): void {
  recent.push({ id: nextId, at: performance.now(), world });
  nextId += 1;
  if (recent.length > KEEP) recent.shift();
}

export function shockwaves(): readonly Shockwave[] {
  return recent;
}

export function latestShockwave(): Shockwave | undefined {
  return recent.at(-1);
}
