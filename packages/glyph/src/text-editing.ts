/**
 * Editing queries: the engine answers, this file asks and decodes. Not a published entry; the public names
 * are re-exported from the package root and from `three`.
 *
 * Each query is one engine call that writes one fixed record. Offsets are UTF-16 code units of the source
 * text and cross as the number the caller gave, so the engine is the only place an offset is validated: its
 * grapheme boundaries are Unicode 17's, never `Intl.Segmenter`'s. Coordinates cross paragraph-local and
 * unanchored; the caller's anchor offset is applied here.
 */
import { GlyphError } from './glyph-error.js';
import { textShaperAbi } from './generated/text-shaper-abi.js';
import type { LayoutBox, LayoutPoint } from './layout.js';
import { shaperStatusError, type ShaperExports } from './internal/text-shaper-module.js';
import type { TextRangeReplacement } from './text-mutation.js';

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

/** One engine query: given the gateway, the root and the paragraph, ask and decode. */
export type TextQuery<Result> = (exports: ShaperExports, root: number, paragraph: number) => Result;

/** What a text gives the queries: a way to run one against its prepared paragraph, and its anchor. */
export interface TextQueryHost {
  run<Result>(query: TextQuery<Result>): Result;
  anchorOffset(): LayoutPoint;
  /** Records the exact range the text's next value replaces. */
  stateReplacement(replacement: TextRangeReplacement): void;
}

const wire = textShaperAbi.textQuery;
const record = textShaperAbi.layouts.textQueryResult;
const rectRecord = textShaperAbi.layouts.textRect;
const status = textShaperAbi.status;

const AFFINITIES: Readonly<Record<TextAffinity, number>> = wire.affinity;
const UNITS: Readonly<Record<TextUnit, number>> = wire.unit;
const DIRECTIONS: Readonly<Record<TextDirection, number>> = wire.direction;
const REASONS: readonly TextOffsetReason[] = ['not-integer', 'out-of-range', 'reversed', 'inside-grapheme'];
const ARGUMENTS: readonly TextOffsetArgument[] = ['offset', 'start', 'end'];

/** The record's address holds for the life of an instance; a restarted engine has another memory. */
const recordPointers = new WeakMap<WebAssembly.Memory, number>();

function answer(exports: ShaperExports): DataView {
  const memory = exports.memory;
  let pointer = recordPointers.get(memory);
  if (pointer === undefined) {
    pointer = exports.textQueryPointer();
    recordPointers.set(memory, pointer);
  }
  return new DataView(memory.buffer, pointer, record.size);
}

function named<Name extends string>(names: Readonly<Record<Name, number>>, value: unknown, subject: string): number {
  if (typeof value !== 'string' || !Object.hasOwn(names, value)) {
    throw new TypeError(`${subject} must be one of ${Object.keys(names).join(', ')}`);
  }
  return names[value as Name];
}

/** A value that is not a number is not an integer: the engine refuses it, and the error carries it as given. */
function offsetNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number.NaN;
}

function positionArguments(position: TextPosition, method: string): readonly [offset: number, affinity: number] {
  if (typeof position !== 'object' || position === null) {
    throw new TypeError(`${method}() takes a position: { offset, affinity }`);
  }
  return [offsetNumber(position.offset), named(AFFINITIES, position.affinity, `${method}() position affinity`)];
}

function finite(value: unknown, subject: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError(`${subject} must be a finite number`);
  return value;
}

/** Turns a status into the query's error. `given` maps the engine's argument name back to what the caller passed. */
function accept(
  code: number,
  exports: ShaperExports,
  method: TextOffsetMethod,
  given: Readonly<Record<TextOffsetArgument, unknown>>,
): DataView {
  const view = answer(exports);
  if (code === status.ok) return view;
  if (code === status.textOffsetInvalid) {
    const detail = view.getUint32(record.errorDetail, true);
    const argument = ARGUMENTS[detail >>> 8] ?? 'offset';
    const before = view.getInt32(record.errorBefore, true);
    const after = view.getInt32(record.errorAfter, true);
    const asGiven = given[argument];
    throw new TextOffsetError({
      method,
      argument,
      offset: typeof asGiven === 'number' ? asGiven : (asGiven as number),
      reason: REASONS[detail & 0xff] ?? 'out-of-range',
      textLength: view.getUint32(record.errorTextLength, true),
      before: before === wire.noBoundary ? undefined : before,
      after: after === wire.noBoundary ? undefined : after,
    });
  }
  if (code === status.textQueryInvalid) throw new RangeError(`${method}() was given a value the engine cannot use`);
  throw shaperStatusError(code, `answer ${method}()`);
}

function readPosition(view: DataView): TextPosition {
  return Object.freeze({
    offset: view.getUint32(record.offset, true),
    affinity: (view.getUint32(record.flags, true) & wire.flags.downstream) !== 0 ? 'downstream' : 'upstream',
  });
}

function box(x: number, y: number, width: number, height: number, anchor: LayoutPoint): LayoutBox {
  return Object.freeze({ x: x + anchor.x, y: y + anchor.y, width, height });
}

/** The caret of a position, in Text-local coordinates (+X right, +Y down), anchor included. */
export function queryCaret(host: TextQueryHost, position: TextPosition): TextCaret {
  const [offset, affinity] = positionArguments(position, 'caret');
  const anchor = host.anchorOffset();
  return host.run((exports, root, paragraph) => {
    const view = accept(exports.textCaret(root, paragraph, offset, affinity), exports, 'caret', {
      offset: position.offset,
      start: position.offset,
      end: position.offset,
    });
    const flags = view.getUint32(record.flags, true);
    return Object.freeze({
      rect: box(
        view.getFloat64(record.x, true),
        view.getFloat64(record.y, true),
        view.getFloat64(record.width, true),
        view.getFloat64(record.height, true),
        anchor,
      ),
      line: view.getUint32(record.line, true),
      level: view.getUint32(record.level, true),
      secondary:
        (flags & wire.flags.secondary) === 0
          ? undefined
          : box(
              view.getFloat64(record.secondaryX, true),
              view.getFloat64(record.secondaryY, true),
              0,
              view.getFloat64(record.secondaryHeight, true),
              anchor,
            ),
      clipped: (flags & wire.flags.clipped) !== 0,
    });
  });
}

/** The caret stop nearest a point in Text-local coordinates; the point may be anywhere. */
export function queryHitTest(host: TextQueryHost, point: LayoutPoint): TextPosition {
  if (typeof point !== 'object' || point === null) throw new TypeError('hitTest() takes a point: { x, y }');
  const anchor = host.anchorOffset();
  const x = finite(point.x, 'hitTest() point x') - anchor.x;
  const y = finite(point.y, 'hitTest() point y') - anchor.y;
  return host.run((exports, root, paragraph) => {
    const code = exports.textHitTest(root, paragraph, x, y);
    if (code !== status.ok) throw shaperStatusError(code, 'answer hitTest()');
    return readPosition(answer(exports));
  });
}

/** Moves a position one unit. `up` and `down` take `unit: 'line'`. */
export function queryMove(
  host: TextQueryHost,
  position: TextPosition,
  direction: TextDirection,
  unit: TextUnit,
  goalX?: number,
): TextMovement {
  const [offset, affinity] = positionArguments(position, 'move');
  const directionCode = named(DIRECTIONS, direction, 'move() direction');
  const unitCode = named(UNITS, unit, 'move() unit');
  if ((direction === 'up' || direction === 'down') && unit !== 'line') {
    throw new RangeError(`move() ${direction} moves by line; pass unit 'line'`);
  }
  const anchor = host.anchorOffset();
  const goal = goalX === undefined ? Number.NaN : finite(goalX, 'move() goalX') - anchor.x;
  return host.run((exports, root, paragraph) => {
    const view = accept(
      exports.textMove(root, paragraph, offset, affinity, directionCode, unitCode, goal),
      exports,
      'move',
      { offset: position.offset, start: position.offset, end: position.offset },
    );
    return Object.freeze({
      position: readPosition(view),
      goalX: view.getFloat64(record.goalX, true) + anchor.x,
    });
  });
}

/** The grapheme, word, sentence or line that contains a position. */
export function queryBoundary(host: TextQueryHost, position: TextPosition, unit: TextUnit): TextRange {
  const [offset, affinity] = positionArguments(position, 'boundary');
  const unitCode = named(UNITS, unit, 'boundary() unit');
  return host.run((exports, root, paragraph) => {
    const view = accept(exports.textBoundary(root, paragraph, offset, affinity, unitCode), exports, 'boundary', {
      offset: position.offset,
      start: position.offset,
      end: position.offset,
    });
    return Object.freeze({
      start: view.getUint32(record.offset, true),
      end: view.getUint32(record.end, true),
    });
  });
}

/** The rectangles covering `[start, end)`: one per run of the range that is contiguous on its line. */
export function queryRangeRects(host: TextQueryHost, start: number, end: number): readonly LayoutBox[] {
  const anchor = host.anchorOffset();
  return host.run((exports, root, paragraph) => {
    const view = accept(
      exports.textRangeRects(root, paragraph, offsetNumber(start), offsetNumber(end)),
      exports,
      'rangeRects',
      { offset: start, start, end },
    );
    const count = view.getUint32(record.rectCount, true);
    if (count === 0) return Object.freeze([]);
    const rects = new DataView(exports.memory.buffer, exports.textRectsPointer(), count * rectRecord.size);
    const boxes: LayoutBox[] = [];
    for (let index = 0; index < count; index += 1) {
      const at = index * rectRecord.size;
      boxes.push(
        box(
          rects.getFloat64(at + rectRecord.x, true),
          rects.getFloat64(at + rectRecord.y, true),
          rects.getFloat64(at + rectRecord.width, true),
          rects.getFloat64(at + rectRecord.height, true),
          anchor,
        ),
      );
    }
    return Object.freeze(boxes);
  });
}

/** Checks the range a replacement names against the prepared text; throws {@link TextOffsetError}. */
export function checkReplaceRange(host: TextQueryHost, start: number, end: number): TextRange {
  return host.run((exports, root, paragraph) => {
    const view = accept(
      exports.textCheckRange(root, paragraph, offsetNumber(start), offsetNumber(end)),
      exports,
      'replace',
      { offset: start, start, end },
    );
    return { start: view.getUint32(record.offset, true), end: view.getUint32(record.end, true) };
  });
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

/** The six entry points over one host. */
export function createTextEditingQueries(host: TextQueryHost): TextEditingQueries {
  return Object.freeze({
    caret: (position: TextPosition) => queryCaret(host, position),
    hitTest: (point: LayoutPoint) => queryHitTest(host, point),
    move: (position: TextPosition, direction: TextDirection, unit: TextUnit, goalX?: number) =>
      queryMove(host, position, direction, unit, goalX),
    boundary: (position: TextPosition, unit: TextUnit) => queryBoundary(host, position, unit),
    rangeRects: (start: number, end: number) => queryRangeRects(host, start, end),
    beginReplace: (start: number, end: number, insert: string) => {
      const range = checkReplaceRange(host, start, end);
      host.stateReplacement({ start: range.start, end: range.end, insert });
      return range;
    },
  });
}
