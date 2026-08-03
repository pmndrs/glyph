import type { BenchmarkFontFixture } from '../benchmark/font-fixtures';

import type { AdvancedShapingFrame } from './advanced-shaping';
import { advancedShapingLiveTextScene } from './advanced-shaping';
import { benchmarkIpsumLiveTextScene } from './benchmark-ipsum';
import type { BenchmarkWorkloadId } from './catalog';
import type { LiveTextScene } from './live-text-scene';

export interface LiveTextSceneInput {
  readonly fontFixture: BenchmarkFontFixture;
  readonly layoutWidthRatio: number;
  readonly showcaseFrame: AdvancedShapingFrame;
}

/** Returns the authored live Text scene for the selected single-paragraph workload. */
export function liveTextSceneForWorkload(
  workload: BenchmarkWorkloadId,
  input: LiveTextSceneInput,
): LiveTextScene | undefined {
  return LIVE_TEXT_SCENES[workload]?.create(input);
}

const LIVE_TEXT_SCENES: Partial<
  Readonly<Record<BenchmarkWorkloadId, { readonly create: (input: LiveTextSceneInput) => LiveTextScene }>>
> = {
  'advanced-shaping': {
    create: ({ showcaseFrame }) => advancedShapingLiveTextScene(showcaseFrame),
  },
  'benchmark-ipsum': {
    create: ({ fontFixture, layoutWidthRatio }) => benchmarkIpsumLiveTextScene(fontFixture, layoutWidthRatio),
  },
};
