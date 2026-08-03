import type { BenchmarkFontFixture } from '../benchmark/font-fixtures';

import { advancedShapingLiveTextScene, type AdvancedShapingFrame } from './advanced-shaping/scene';
import { benchmarkIpsumLiveTextScene } from './benchmark-ipsum/scene';
import type { BenchmarkWorkloadId } from './catalog';
import type { LiveTextScene } from './shared/live-text-scene';

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
    create: ({ fontFixture, showcaseFrame }) => advancedShapingLiveTextScene(showcaseFrame, fontFixture),
  },
  'benchmark-ipsum': {
    create: ({ fontFixture, layoutWidthRatio }) => benchmarkIpsumLiveTextScene(fontFixture, layoutWidthRatio),
  },
};
