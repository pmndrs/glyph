import type { BenchmarkFontFixture } from '../../benchmark/font-fixtures';
import type { BitmapTextPreviewUpdate } from '../../renderer/bitmap-text';
import type { BenchmarkWorkloadId } from '../../workloads/catalog';

export interface LiveTextConfiguration extends Omit<BitmapTextPreviewUpdate, 'fontSize'> {
  readonly animatePresentation: boolean;
  readonly fontFixture: BenchmarkFontFixture;
  readonly expectedGlyphCount: number | undefined;
  readonly timelineTick: number | undefined;
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
