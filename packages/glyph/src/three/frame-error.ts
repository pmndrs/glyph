import {
  GlyphEngineStatusError,
  glyphEngineStatusErrorDetails,
  type GlyphEngineFault,
  type GlyphEngineStatusCode,
} from '../engine-error.js';
import { GlyphError } from '../glyph-error.js';
import type { RasterFormatMetadata } from '../config/raster-format.js';
import type { Text, TextSpan } from './text.js';

/** The authored input a rejected frame names, resolved from the engine's internal handle/style id onto the `Text` (and span+index, when a span owns the cause) the consumer wrote. */
export type TextFrameSubject<Format extends RasterFormatMetadata = RasterFormatMetadata> =
  | Readonly<{ kind: 'span'; text: Text<Format>; index: number; span: TextSpan<Format> }>
  | Readonly<{ kind: 'paragraph'; text: Text<Format> }>
  | Readonly<{ kind: 'unattributed' }>;

/** Why the engine refused the frame, branchable by `cause`; `engine` is the residual for unclassified internal invariant violations — a defect report, not an input to fix. */
export type TextFrameRejection<Format extends RasterFormatMetadata = RasterFormatMetadata> =
  /** A span's `[start, end)` is inverted, reaches past the text, or splits a UTF-16 surrogate pair. */
  | Readonly<{ cause: 'span-range'; subject: TextFrameSubject<Format> }>
  /** A style boundary falls inside an extended grapheme cluster. */
  | Readonly<{ cause: 'cluster-boundary'; subject: TextFrameSubject<Format> }>
  /** Two spans partially overlap; spans must be disjoint or fully nested. */
  | Readonly<{ cause: 'span-overlap'; subject: TextFrameSubject<Format> }>
  /** The paragraph's own root style is missing, duplicated, or does not cover the whole text. */
  | Readonly<{ cause: 'paragraph-root'; subject: TextFrameSubject<Format> }>
  /** A style names a font stack the engine does not hold. */
  | Readonly<{ cause: 'font-stack-missing'; subject: TextFrameSubject<Format> }>
  /** A font in the laid-out text has no registered metrics. */
  | Readonly<{ cause: 'font-metrics-missing'; subject: TextFrameSubject<Format> }>
  /** The frame did not fit the planner arenas even after the handle grew them. */
  | Readonly<{ cause: 'capacity'; requiredRequestBytes: number; requiredResultBytes: number }>
  /** A status the engine does not classify as caller-actionable. */
  | Readonly<{ cause: 'engine' }>;

/** A frame the engine refused, with cause resolved onto the caller's own objects. Branch on `rejection.cause`; `status` is raw and for reporting only, not classification. */
export class TextFrameError extends GlyphError<'frame-rejected'> {
  readonly rejection: TextFrameRejection;
  readonly status: number;

  constructor(rejection: TextFrameRejection, status: number, message: string, options?: ErrorOptions) {
    super('frame-rejected', message, options);
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

/** Re-raises an engine status as a typed rejection; the status code alone decides the cause. Non-engine-status errors pass through untouched. */
export function textFrameError(error: unknown, resolve: TextFrameSubjectResolver): unknown {
  if (!(error instanceof GlyphEngineStatusError)) return error;
  const details = glyphEngineStatusErrorDetails(error);
  const cause = CAUSE_BY_CODE.get(error.statusCode) ?? 'engine';
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
