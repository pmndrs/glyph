import type { BakeWarning } from '../bake.js';
import { FontBakeError, type FontBakeCore, type PreparedFontReport, type UnicodeRange } from '../font-baker/index.js';
import { preparationSelection } from './font-selection.js';

/** The bytes a bake shapes and rasterizes, and how they were prepared. */
export interface BakeSource {
  readonly bytes: Uint8Array;
  readonly preparation?: PreparedFontReport;
  readonly warning?: BakeWarning;
}

/**
 * Prepares a bake's source. Skera 0.5.1 cannot serialize the layout tables of some very large faces (Noto Sans CJK's
 * whole BMP overflows its GSUB). A bake that named neither Unicode ranges nor layout features then keeps the source as
 * it is, every feature and glyph with it, and says so; a bake that asked for either fails, since it cannot have what
 * it asked for. Freshness checks call this too, so they mirror the bake exactly.
 */
export function prepareBakeSource(
  baker: Pick<FontBakeCore, 'prepare'>,
  source: Uint8Array,
  fontFaceIndex: number,
  unicodeRanges: readonly UnicodeRange[] | undefined,
  layoutFeatures: readonly string[] | undefined,
): BakeSource {
  const selection = preparationSelection(fontFaceIndex, unicodeRanges, layoutFeatures);
  try {
    const prepared = baker.prepare({ source, selection });
    return { bytes: prepared.bytes, preparation: prepared.report };
  } catch (error) {
    const implicit = unicodeRanges === undefined && layoutFeatures === undefined;
    if (!implicit || !(error instanceof FontBakeError) || error.reason !== 'SUBSETTING_FAILED') throw error;
    return {
      bytes: source,
      warning: {
        code: 'LAYOUT_FEATURES_KEPT',
        message: `${error.message}; the bake keeps every layout feature and glyph of this font`,
      },
    };
  }
}
