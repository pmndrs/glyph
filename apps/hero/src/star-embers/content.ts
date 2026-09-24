// The bake reads this module in Node, which resolves only a full specifier.
import { jitter } from '../utils.ts';

/** How long the embers burn after the pop, in seconds. */
export const EMBER_SECONDS = 1.25;

/** Unicode star shapes shared by the renderer and its baked font subset. */
export const STAR_SYMBOLS = ['★', '☆', '✦', '✧', '✩', '✶'] as const;

/** The burst: sixteen stars in pastel tints, each with its own reach, size, delay, and spin. */
const COLORS = ['#fff0ac', '#ffd0dc', '#cbbcff', '#b9e6ff'];
export const PARTICLES = Array.from({ length: 16 }, (_, index) => ({
  index,
  symbol: STAR_SYMBOLS[index % STAR_SYMBOLS.length]!,
  color: COLORS[index % COLORS.length]!,
  angle: index * 2.39996 + jitter(index) * 0.4,
  reachX: Math.cos(index * 2.39996 + jitter(index) * 0.4) * (0.75 + jitter(index + 43) * 1.15),
  reachY: Math.sin(index * 2.39996 + jitter(index) * 0.4) * (0.75 + jitter(index + 43) * 1.15),
  size: 0.18 + jitter(index + 71) * 0.14,
  delay: jitter(index + 91) * 0.045,
  spin: (jitter(index + 121) - 0.5) * 5,
}));
