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
  | 'layout-phase'
  | 'invalid-input'
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

/**
 * Thrown by a setter that writes a layout input while layout callbacks run. A callback may read anything and
 * write transforms, visibility, colour, opacity and material; a layout input written there could not be laid
 * out before the frame it was meant for, so the write is refused where it was made.
 */
export class GlyphLayoutPhaseError extends GlyphError<'layout-phase'> {
  constructor(message: string) {
    super('layout-phase', message);
    this.name = 'GlyphLayoutPhaseError';
  }
}

/**
 * Thrown by a setter, `set()`/`update()` or `createText()` that was given a value it cannot accept. The text
 * keeps its previous value. `path` names the input from the property the caller wrote, outermost first
 * (`['style']`, `['text', 'spans', 2, 'style']`); it is empty when the properties are only invalid together.
 * `cause` is the validator's `TypeError` or `RangeError`.
 */
export class GlyphInputError extends GlyphError<'invalid-input'> {
  readonly path: readonly (string | number)[];

  constructor(path: readonly (string | number)[], message: string, options?: ErrorOptions) {
    super('invalid-input', message, options);
    this.name = 'GlyphInputError';
    this.path = Object.freeze([...path]);
  }
}

/** @internal Runs one input's validation; what it throws for a bad value becomes a {@link GlyphInputError}. */
export function validatingInput<Result>(path: readonly (string | number)[], validate: () => Result): Result {
  try {
    return validate();
  } catch (error) {
    throw glyphInputError(path, error);
  }
}

/** @internal A validator's `TypeError` or `RangeError` as an input error; anything else is returned unchanged. */
export function glyphInputError(path: readonly (string | number)[], error: unknown): unknown {
  if (!(error instanceof TypeError) && !(error instanceof RangeError)) return error;
  return new GlyphInputError(path, error.message, { cause: error });
}

/** @internal Identifies failures after authored state has committed and must not be rolled back. */
export class PostCommitError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = 'PostCommitError';
  }
}
