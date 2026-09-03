export const DENSE_GLYPH_RECORD_STRIDE = 20 as const;
export const ABSENT_GLYPH_PAGE = 0xffff as const;

export interface RasterPageDimensions {
  readonly width: number;
  readonly height: number;
}

export type DenseGlyphRecordErrorCode =
  | 'RECORD_LENGTH'
  | 'RECORD_FLAGS'
  | 'RECORD_ABSENT_DATA'
  | 'RECORD_PAGE'
  | 'RECORD_PLANE_BOUNDS'
  | 'RECORD_ATLAS_BOUNDS';

export class DenseGlyphRecordError extends GlyphError<'artifact-invalid'> {
  readonly reason: DenseGlyphRecordErrorCode;
  readonly glyphId: number | undefined;

  constructor(code: DenseGlyphRecordErrorCode, message: string, glyphId?: number) {
    super('artifact-invalid', message);
    this.name = 'DenseGlyphRecordError';
    this.reason = code;
    this.glyphId = glyphId;
  }
}

export function validateDenseGlyphRecordTable(
  records: Uint8Array,
  pages: readonly RasterPageDimensions[],
  glyphCount: number,
  requireNonEmptyPlaneSpans = false,
): void {
  const expectedByteLength = glyphCount * DENSE_GLYPH_RECORD_STRIDE;
  if (
    !Number.isSafeInteger(glyphCount) ||
    glyphCount < 0 ||
    !Number.isSafeInteger(expectedByteLength) ||
    records.byteLength !== expectedByteLength
  ) {
    throw new DenseGlyphRecordError(
      'RECORD_LENGTH',
      'record table must contain exactly one dense 20-byte record per glyph',
    );
  }
  const view = new DataView(records.buffer, records.byteOffset, records.byteLength);
  for (let glyphId = 0; glyphId < glyphCount; glyphId += 1) {
    const offset = glyphId * DENSE_GLYPH_RECORD_STRIDE;
    const page = view.getUint16(offset + 16, true);
    if (view.getUint16(offset + 18, true) !== 0) {
      throw new DenseGlyphRecordError('RECORD_FLAGS', 'V0 record flags must be zero', glyphId);
    }
    if (page === ABSENT_GLYPH_PAGE) {
      if (records.subarray(offset, offset + 16).some((value) => value !== 0)) {
        throw new DenseGlyphRecordError(
          'RECORD_ABSENT_DATA',
          'absent records must zero every field except the page sentinel',
          glyphId,
        );
      }
      continue;
    }
    const resource = pages[page];
    if (resource === undefined) {
      throw new DenseGlyphRecordError('RECORD_PAGE', 'record references a missing logical page', glyphId);
    }
    const planeLeft = view.getInt16(offset, true);
    const planeBottom = view.getInt16(offset + 2, true);
    const planeRight = view.getInt16(offset + 4, true);
    const planeTop = view.getInt16(offset + 6, true);
    const atlasLeft = view.getUint16(offset + 8, true);
    const atlasTop = view.getUint16(offset + 10, true);
    const atlasRight = view.getUint16(offset + 12, true);
    const atlasBottom = view.getUint16(offset + 14, true);
    const invertedPlaneBounds = planeLeft > planeRight || planeBottom > planeTop;
    const emptyRequiredSpan = requireNonEmptyPlaneSpans && (planeLeft === planeRight || planeBottom === planeTop);
    if (invertedPlaneBounds || emptyRequiredSpan) {
      throw new DenseGlyphRecordError(
        'RECORD_PLANE_BOUNDS',
        `plane bounds must form ${requireNonEmptyPlaneSpans ? 'a non-empty' : 'an ordered'} span`,
        glyphId,
      );
    }
    if (
      atlasLeft >= atlasRight ||
      atlasTop >= atlasBottom ||
      atlasRight > resource.width ||
      atlasBottom > resource.height
    ) {
      throw new DenseGlyphRecordError('RECORD_ATLAS_BOUNDS', 'atlas bounds exceed their logical page', glyphId);
    }
  }
}
import { GlyphError } from '../glyph-error.js';
