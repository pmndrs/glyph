import type { BitmapTextPreviewUpdate } from '../../renderer/bitmap-text';
import type { BenchmarkWorkloadId } from '../../workloads/catalog';
import type { LiveTextScene } from '../../workloads/live-text-scene';

/** Renderer-facing extension of a workload-owned Text scene. */
export interface LiveTextConfiguration extends LiveTextScene {
  readonly fontSize: number;
}

export interface RetainedLiveTextUpdate extends BitmapTextPreviewUpdate {
  readonly timelineTick: number | undefined;
  readonly workload: BenchmarkWorkloadId;
}

export interface PresentationEvidence {
  readonly revision: number;
  readonly progress: 0 | 1;
  readonly matchedGlyphs: number;
  readonly targetGlyphs: number;
}
