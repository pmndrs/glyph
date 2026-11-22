/**
 * The editing vocabulary: positions, carets, units, the offset error, and the span rule of `replace`. The
 * engine answers the queries (`internal/text-queries.ts` asks and decodes); this file is what an application
 * and an integration see. Not a published entry: the names are re-exported from the package root and `three`.
 */
import { GlyphError } from './glyph-error.js';
import type { LayoutBox, LayoutPoint } from './layout.js';

/** Which grapheme a caret at an offset attaches to: the one that ends there, or the one that starts there. */
export type TextAffinity = 'upstream' | 'downstream';

/**
 * A caret position: a UTF-16 offset of the source text on a grapheme boundary, and a side. The two sides
 * differ at a soft wrap (`upstream` is the end of the earlier line) and at a bidi boundary (two x on one
 * line); everywhere else they are one place.
 */
export interface TextPosition {
  readonly offset: number;
  readonly affinity: TextAffinity;
}

export type TextUnit = 'grapheme' | 'word' | 'sentence' | 'line';

/** `forward`/`backward` are logical; `left`/`right` are visual across bidi runs; `up`/`down` move by line. */
export type TextDirection = 'forward' | 'backward' | 'left' | 'right' | 'up' | 'down';

/** Where a caret is drawn. */
export interface TextCaret {
  /** Zero width, the line box's height. */
  readonly rect: LayoutBox;
  /** Index of the line the caret is on. */
  readonly line: number;
  /** Bidi embedding level of the grapheme the caret attaches to, or of the paragraph on an empty line. */
  readonly level: number;
  /** The other side's rectangle when the position is a bidi boundary: the second half of a split caret. */
  readonly secondary: LayoutBox | undefined;
  /** The offset is in text the layout did not draw (past an ellipsis or a line limit); the caret is parked at the end of the last drawn line. */
  readonly clipped: boolean;
}

export interface TextMovement {
  readonly position: TextPosition;
  /** The x to pass to the next `up` or `down` move so a column survives a short line. */
  readonly goalX: number;
}

/** A half-open range of UTF-16 offsets. */
export interface TextRange {
  readonly start: number;
  readonly end: number;
}

export type TextOffsetMethod = 'replace' | 'caret' | 'move' | 'boundary' | 'rangeRects';
export type TextOffsetArgument = 'start' | 'end' | 'offset';
export type TextOffsetReason = 'not-integer' | 'out-of-range' | 'reversed' | 'inside-grapheme';

/**
 * Thrown when an offset is not a whole number in range, is the end of a reversed range, or is inside a
 * grapheme. Nothing is snapped: the error carries the offset as given and the nearest valid boundaries.
 */
export class TextOffsetError extends GlyphError<'invalid-offset'> {
  readonly method: TextOffsetMethod;
  readonly argument: TextOffsetArgument;
  /** The offset as given. */
  readonly offset: number;
  readonly reason: TextOffsetReason;
  /** Length of the source text in UTF-16 code units. */
  readonly textLength: number;
  /** The nearest grapheme boundary at or before the offset. */
  readonly before: number | undefined;
  /** The nearest grapheme boundary at or after the offset. */
  readonly after: number | undefined;

  constructor(details: {
    readonly method: TextOffsetMethod;
    readonly argument: TextOffsetArgument;
    readonly offset: number;
    readonly reason: TextOffsetReason;
    readonly textLength: number;
    readonly before: number | undefined;
    readonly after: number | undefined;
  }) {
    super('invalid-offset', offsetMessage(details));
    this.name = 'TextOffsetError';
    this.method = details.method;
    this.argument = details.argument;
    this.offset = details.offset;
    this.reason = details.reason;
    this.textLength = details.textLength;
    this.before = details.before;
    this.after = details.after;
  }
}

function offsetMessage(details: {
  readonly method: TextOffsetMethod;
  readonly argument: TextOffsetArgument;
  readonly offset: number;
  readonly reason: TextOffsetReason;
  readonly textLength: number;
  readonly before: number | undefined;
  readonly after: number | undefined;
}): string {
  const subject = `${details.method}(): ${details.argument} ${String(details.offset)}`;
  const units = '(UTF-16 code units of the source text)';
  const nearest =
    details.before !== undefined && details.after !== undefined
      ? `nearest boundaries are ${details.before} and ${details.after}`
      : `nearest boundary is ${details.before ?? details.after ?? 0}`;
  switch (details.reason) {
    case 'not-integer':
      return `${subject} is not a whole number; ${nearest} ${units}`;
    case 'out-of-range':
      return `${subject} is outside the text, which is ${details.textLength} long; ${nearest} ${units}`;
    case 'reversed':
      return `${subject} is before the start of the range ${units}`;
    case 'inside-grapheme':
      return `${subject} is inside a grapheme; ${nearest} ${units}`;
  }
}

/**
 * Where a span boundary lands after `[start, end)` is replaced by `inserted` units. The inserted text takes
 * the style of the grapheme before it: a span that ends at or inside the replaced range grows over the
 * insertion, and a span that starts there starts after it. At the very start of the text there is nothing
 * before, so the inserted text takes the style of what follows. A span left empty is dropped.
 */
export function rebaseSpanRange(span: TextRange, start: number, end: number, inserted: number): TextRange | undefined {
  const shift = inserted - (end - start);
  const spanStart =
    span.start < start || (span.start === start && start === 0)
      ? span.start
      : span.start <= end
        ? start + inserted
        : span.start + shift;
  const spanEnd = span.end < start ? span.end : span.end < end ? start + inserted : span.end + shift;
  return spanStart < spanEnd ? { start: spanStart, end: spanEnd } : undefined;
}

/** Rebases every span of a text across one replacement, keeping each span's other properties. */
export function rebaseSpans<Span extends TextRange>(
  spans: readonly Span[],
  start: number,
  end: number,
  inserted: number,
): readonly Span[] {
  const rebased: Span[] = [];
  for (const span of spans) {
    const range = rebaseSpanRange(span, start, end, inserted);
    if (range === undefined) continue;
    rebased.push(range.start === span.start && range.end === span.end ? span : { ...span, ...range });
  }
  return rebased;
}

/** The text and spans after one validated replacement. */
export function replaceInText<Span extends TextRange>(
  text: string,
  spans: readonly Span[],
  range: TextRange,
  insert: string,
): { readonly text: string; readonly spans: readonly Span[] } {
  return {
    text: text.slice(0, range.start) + insert + text.slice(range.end),
    spans: rebaseSpans(spans, range.start, range.end, insert.length),
  };
}

/**
 * The editing queries of one text, in Text-local coordinates (+X right, +Y down), anchor included. Each
 * prepares the text first when a setter left it dirty, makes one engine call and publishes nothing.
 */
export interface TextEditingQueries {
  /** Where the caret of a position is drawn. */
  caret(position: TextPosition): TextCaret;
  /** The caret stop nearest a point; the point may be between lines or outside the text. */
  hitTest(point: LayoutPoint): TextPosition;
  /** Moves a position one unit; `up` and `down` take `unit: 'line'` and a `goalX` to keep a column. */
  move(position: TextPosition, direction: TextDirection, unit: TextUnit, goalX?: number): TextMovement;
  /** The grapheme, word, sentence or line that contains a position. */
  boundary(position: TextPosition, unit: TextUnit): TextRange;
  /** The rectangles covering `[start, end)`: one per run of the range that is contiguous on its line. */
  rangeRects(start: number, end: number): readonly LayoutBox[];
  /**
   * The first half of `replace(start, end, insert)`: checks the range against the current text, throwing
   * {@link TextOffsetError}, and states it so the engine is told exactly this edit. The caller then sets the
   * text the replacement produces ({@link replaceInText}).
   */
  beginReplace(start: number, end: number, insert: string): TextRange;
}
