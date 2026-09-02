import {
  GlyphEngineStatusError,
  glyphEngineStatusErrorDetails,
  type GlyphEngineFault,
  type GlyphEngineStatusCode,
} from '../index.js';
import type { AnyRasterFormat } from '../raster-format.js';
import type { Text, TextSpan } from './text.js';

/**
 * The authored input a rejected frame names.
 *
 * The engine reports a paragraph handle and a style id, both allocated by this layer; neither is
 * meaningful to a consumer. They are resolved here into the objects the consumer actually wrote:
 * the `Text` and, when one span owns the cause, that span together with its index in `Text.spans`.
 */
export type TextFrameSubject<Technique extends AnyRasterFormat = AnyRasterFormat> =
  | Readonly<{ kind: 'span'; text: Text<Technique>; index: number; span: TextSpan<Technique> }>
  | Readonly<{ kind: 'paragraph'; text: Text<Technique> }>
  | Readonly<{ kind: 'unattributed' }>;

/**
 * Why the engine refused the frame, in terms a consumer can branch on.
 *
 * `engine` is the residual: a status the engine does not classify further, including every internal
 * invariant violation. Treat it as a defect report rather than something to correct in the input.
 */
export type TextFrameRejection<Technique extends AnyRasterFormat = AnyRasterFormat> =
  /** A span's `[start, end)` is inverted, reaches past the text, or splits a UTF-16 surrogate pair. */
  | Readonly<{ cause: 'span-range'; subject: TextFrameSubject<Technique> }>
  /** A style boundary falls inside an extended grapheme cluster. */
  | Readonly<{ cause: 'cluster-boundary'; subject: TextFrameSubject<Technique> }>
  /** Two spans partially overlap; spans must be disjoint or fully nested. */
  | Readonly<{ cause: 'span-overlap'; subject: TextFrameSubject<Technique> }>
  /** The paragraph's own root style is missing, duplicated, or does not cover the whole text. */
  | Readonly<{ cause: 'paragraph-root'; subject: TextFrameSubject<Technique> }>
  /** A style names a font stack the engine does not hold. */
  | Readonly<{ cause: 'font-stack-missing'; subject: TextFrameSubject<Technique> }>
  /** A font in the laid-out text has no registered metrics. */
  | Readonly<{ cause: 'font-metrics-missing'; subject: TextFrameSubject<Technique> }>
  /** The frame did not fit the planner arenas even after the handle grew them. */
  | Readonly<{ cause: 'capacity'; requiredRequestBytes: number; requiredResultBytes: number }>
  /** Any status the engine does not classify as caller-actionable. */
  | Readonly<{ cause: 'engine' }>;

/**
 * A frame the text engine refused, raised with the cause resolved onto the caller's own objects.
 *
 * Branch on `rejection.cause`; `status` is the raw engine status the rejection was decoded from and
 * exists for reporting, not for classification.
 */
export class TextFrameError extends Error {
  readonly rejection: TextFrameRejection;
  readonly status: number;

  constructor(rejection: TextFrameRejection, status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TextFrameError';
    this.rejection = rejection;
    this.status = status;
  }
}

/** Resolves an engine fault onto authored objects. `paragraphs` maps the engine's paragraph handle. */
export type TextFrameSubjectResolver = (fault: GlyphEngineFault) => TextFrameSubject;

const CAUSE_BY_CODE: ReadonlyMap<GlyphEngineStatusCode, TextFrameRejection['cause']> = new Map([
  ['style-range-invalid', 'span-range' as const],
  ['style-splits-cluster', 'cluster-boundary' as const],
  ['style-nesting-invalid', 'span-overlap' as const],
  ['style-root-invalid', 'paragraph-root' as const],
  ['font-stack-missing', 'font-stack-missing' as const],
  ['font-metrics-missing', 'font-metrics-missing' as const],
  ['result-too-large', 'capacity' as const],
]);

/**
 * Re-raises an engine status as a typed rejection.
 *
 * The status alone decides the cause; nothing is recovered from the underlying message. Errors that
 * are not engine statuses pass through untouched, because they already name their own cause.
 */
export function textFrameError(error: unknown, resolve: TextFrameSubjectResolver): unknown {
  if (!(error instanceof GlyphEngineStatusError)) return error;
  const details = glyphEngineStatusErrorDetails(error);
  const cause = CAUSE_BY_CODE.get(error.code) ?? 'engine';
  const rejection: TextFrameRejection =
    cause === 'capacity'
      ? {
          cause,
          requiredRequestBytes: details.requiredRequestCapacity,
          requiredResultBytes: details.requiredResultCapacity,
        }
      : cause === 'engine'
        ? { cause }
        : { cause, subject: resolve(details.fault) };
  return new TextFrameError(rejection, error.status, rejectionMessage(rejection, error), { cause: error });
}

function rejectionMessage(rejection: TextFrameRejection, error: GlyphEngineStatusError): string {
  if (rejection.cause === 'capacity') {
    return (
      `text frame exceeded the planner arenas (required request=${rejection.requiredRequestBytes},` +
      ` result=${rejection.requiredResultBytes}): ${error.message}`
    );
  }
  if (rejection.cause === 'engine') return `text frame was rejected: ${error.message}`;
  return `${subjectLabel(rejection.subject)} ${causeLabel(rejection.cause)}: ${error.message}`;
}

function subjectLabel(subject: TextFrameSubject): string {
  switch (subject.kind) {
    case 'span':
      return `spans[${subject.index}] (${subject.span.start}, ${subject.span.end})`;
    case 'paragraph':
      return 'paragraph';
    case 'unattributed':
      return 'a paragraph the engine did not name';
  }
}

function causeLabel(cause: Exclude<TextFrameRejection['cause'], 'capacity' | 'engine'>): string {
  switch (cause) {
    case 'span-range':
      return 'states a range that is inverted, past the end of the text, or inside a surrogate pair';
    case 'cluster-boundary':
      return 'states a boundary inside an extended grapheme cluster';
    case 'span-overlap':
      return 'partially overlaps another span instead of nesting inside it';
    case 'paragraph-root':
      return 'does not carry exactly one root style over its whole text';
    case 'font-stack-missing':
      return 'names a font stack the engine does not hold';
    case 'font-metrics-missing':
      return 'uses a font with no registered metrics';
  }
}
