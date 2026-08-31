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
 * Per-axis octave ratios and phase.
 *
 * Sampling every axis at the same time with the same octave ratios is what made
 * the motion read as one diagonal sway: the axes stay in phase, so their sum has
 * a direction, and shared harmonics realign on a period the eye learns. Each
 * axis gets its own ratios and its own offset into the sequence instead, derived
 * from the seed so it stays deterministic. Nothing is rational against anything
 * else, so nothing ever comes back into step.
 */
function axis(seed: number): { offset: number; ratios: readonly [number, number, number] } {
  const jitter = (n: number) => 0.82 + hash(seed * 7.3 + n) * 0.44;
  return {
    offset: hash(seed * 3.1) * 128,
    ratios: [1 * jitter(1), 3.17 * jitter(2), 7.41 * jitter(3)],
  };
}

/**
 * Weighted toward the faster octaves.
 *
 * A slow octave carrying most of the amplitude reads as floating — the frame
 * wanders somewhere and stays there. Shake is the opposite shape: the camera
 * never travels far, but it is never quite still either.
 */
export function shake(time: number, seed: number): number {
  const { offset, ratios } = axis(seed);
  const t = time + offset;
  return (
    noise(t * ratios[0], seed) * 0.3 + noise(t * ratios[1], seed + 31) * 0.42 + noise(t * ratios[2], seed + 67) * 0.28
  );
}

/**
 * How much the camera is moving at all, right now.
 *
 * Constant-amplitude noise is still relentless — it never rests, and relentless
 * is what turns small movement into motion sickness. A slow envelope gates it so
 * the camera drifts, settles for a few seconds, and picks up again. Biased
 * toward the low end and floored just above zero: mostly quiet, never frozen,
 * and its period is unrelated to any of the axes above.
 */
export function envelope(time: number, seed: number): number {
  const slow = noise(time * 0.23 + hash(seed) * 64, seed + 991);
  const shaped = (slow + 1) / 2;
  return 0.16 + shaped * shaped * 0.84;
}
