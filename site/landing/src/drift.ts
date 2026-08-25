/**
 * Value noise, smooth and cheap, for camera movement.
 *
 * Not a library: one dimension, a few octaves and a cubic fade is everything a
 * camera needs, and it keeps the page free of a dependency whose surface would
 * go almost entirely unused. Deterministic from the seed, so the motion is the
 * same on every load and can be judged rather than merely watched.
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

/**
 * Weighted toward the faster octaves.
 *
 * A slow octave carrying most of the amplitude reads as floating — the frame
 * wanders somewhere and stays there. Shake is the opposite shape: the camera
 * never travels far, but it is never quite still either, so the weight belongs
 * on the detail and the amplitude stays small. The octave ratios are irrational
 * so the three never line up into a visible beat.
 */
export function shake(time: number, seed: number): number {
  return noise(time, seed) * 0.3 + noise(time * 3.17, seed + 31) * 0.42 + noise(time * 7.41, seed + 67) * 0.28;
}
