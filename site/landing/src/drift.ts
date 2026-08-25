/**
 * Value noise, smooth and cheap, for camera drift.
 *
 * Not a library: one dimension, two octaves and a cubic fade is everything a
 * slow camera move needs, and it keeps the page free of a dependency whose
 * whole surface would go unused. Deterministic from the seed, so the motion is
 * the same on every load and can be judged rather than merely watched.
 */
function hash(n: number): number {
  const x = Math.sin(n * 127.1) * 43_758.545_312;
  return x - Math.floor(x);
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function noise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash(i + seed);
  const b = hash(i + 1 + seed);
  return (a + (b - a) * fade(f)) * 2 - 1;
}

/** Two octaves: a slow swing with a smaller wander riding on it. */
export function drift(time: number, seed: number): number {
  return noise(time, seed) * 0.72 + noise(time * 2.17, seed + 31) * 0.28;
}
