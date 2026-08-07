import type { BenchmarkFontFixture } from '../../benchmark/font-fixtures';
import type { BitmapTextSceneUpdate } from '../../techniques/bitmap/persistent-scene';
import type { BenchmarkWorkloadId } from '../../workloads/catalog';
import type { LiveTextScene } from '../../workloads/live-text-scene';

/** Renderer-facing extension of a workload-owned Text scene. */
export interface LiveTextConfiguration extends LiveTextScene {
  readonly fontSize: number;
}

export interface RetainedLiveTextUpdate extends BitmapTextSceneUpdate {
  /** Required here, unlike the scene contract: a live surface always names the fixture it wants committed. */
  readonly fontFixture: BenchmarkFontFixture;
  readonly timelineTick: number | undefined;
  readonly workload: BenchmarkWorkloadId;
}

export interface PresentationEvidence {
  readonly revision: number;
  readonly progress: 0 | 1;
  /** Whether the reflow interpolated matched glyphs, or snapped because the change replaced or reordered them. */
  readonly transitioned: boolean;
  readonly matchedGlyphs: number;
  readonly targetGlyphs: number;
}
