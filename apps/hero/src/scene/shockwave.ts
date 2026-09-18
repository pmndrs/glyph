import { vec3 } from 'math';

/** Fixed ring of impacts. Readers copy coordinates they retain beyond this frame. */
const KEEP = 16;
const recent = Array.from({ length: KEEP }, () => ({ id: 0, at: 0, world: vec3.create() }));
let nextId = 1;
let latest = -1;
export function triggerShockwave(x: number, y: number, z: number): void {
  latest = (latest + 1) % KEEP;
  const wave = recent[latest]!;
  wave.id = nextId++;
  wave.at = performance.now();
  vec3.set(wave.world, x, y, z);
}
export function shockwaves() {
  return recent;
}
export function latestShockwave() {
  return latest < 0 ? undefined : recent[latest];
}
