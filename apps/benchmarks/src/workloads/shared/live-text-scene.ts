import type { FontFeature } from '@pmndrs/glyph';

import type { BenchmarkFontFixture } from '../../benchmark/font-fixtures';

import type { LiveTextAnchor } from './text-style';

/**
 * Authored Text input for one retained live benchmark scene.
 *
 * Renderer adapters consume this data, but do not define it: this keeps the
 * example a direct record of the public Text properties it intends to exercise.
 */
export interface LiveTextScene {
  readonly anchor: LiveTextAnchor;
  readonly animatePresentation: boolean;
  readonly direction: 'ltr' | 'rtl';
  /** Optional exact oracle for `Text.measure().glyphCount`. */
  readonly expectedGlyphCount: number | undefined;
  readonly features: readonly FontFeature[];
  readonly fontFixture: BenchmarkFontFixture;
  readonly language: string;
  readonly layoutWidthRatio: number;
  readonly presentation: 'static' | 'timeline';
  readonly text: string;
  readonly textAlign: 'start' | 'center';
  readonly timelineTick: number | undefined;
}
