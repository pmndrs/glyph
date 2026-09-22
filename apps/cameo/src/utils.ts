import { clamp } from 'math';
import { easing } from 'math/time';

/** Deterministic jitter in [0, 1) from an index. */
export function jitter(index: number): number {
  const value = Math.sin(index * 12.9898 + 78.233) * 43_758.545_3;

  return value - Math.floor(value);
}

/**
 * How a beat reaches its value from the one before it. `hold` restates the value the track is resting at, so a
 * span that only waits is written as one beat rather than a pair.
 */
export type Ease = 'hold' | 'drive' | 'brake' | 'swing';

/** Reach `to` at `at` seconds, easing from whatever the preceding beat left behind. */
export interface Beat {
  readonly at: number;
  readonly to: number;
  readonly ease: Ease;
}

const EASINGS: Readonly<Record<Ease, (fraction: number) => number>> = {
  hold: () => 1,
  drive: easing.cubicIn,
  brake: easing.cubicOut,
  swing: easing.sineInOut,
};

/**
 * A choreography track read at `time`. Beats are in order; before the first and after the last the track holds its
 * end values, so a take that overruns never snaps. `hold` keeps the previous value for the whole span and jumps on
 * arrival, which is what lets a track spell out a pause without a second keyframe.
 */
export function trackAt(beats: readonly Beat[], time: number): number {
  const first = beats[0]!;

  if (time <= first.at) return first.to;

  for (let index = 1; index < beats.length; index++) {
    const beat = beats[index]!;

    if (time > beat.at) continue;

    const previous = beats[index - 1]!;
    const span = beat.at - previous.at;
    const fraction = span > 0 ? clamp((time - previous.at) / span, 0, 1) : 1;

    return previous.to + (beat.to - previous.to) * EASINGS[beat.ease](fraction);
  }

  return beats[beats.length - 1]!.to;
}
