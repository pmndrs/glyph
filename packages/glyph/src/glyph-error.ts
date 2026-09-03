/** Stable top-level categories for operational failures produced by Glyph. */
export type GlyphErrorCode =
  | 'resource-unavailable'
  | 'resource-missing'
  | 'resource-limit'
  | 'artifact-invalid'
  | 'artifact-incompatible'
  | 'integrity-failed'
  | 'format-unavailable'
  | 'bake-failed'
  | 'worker-failed'
  | 'engine-failed'
  | 'frame-rejected'
  | 'internal';

/** Base class for operational and domain failures produced by Glyph. */
export class GlyphError<Code extends GlyphErrorCode = GlyphErrorCode> extends Error {
  readonly code: Code;

  constructor(code: Code, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GlyphError';
    this.code = code;
  }
}
