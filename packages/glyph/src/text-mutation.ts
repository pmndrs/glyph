/** @internal Text-range helpers shared by the planner and the integrations; not a published entry. */
/** One replacement of a UTF-16 range, the unit every text change reaches the engine as. */
export interface TextRangeReplacement {
  /** First replaced UTF-16 code unit of the text the engine last prepared. */
  readonly start: number;
  /** One past the last replaced UTF-16 code unit of that text. */
  readonly end: number;
  readonly insert: string;
}

/**
 * Derives the smallest single replacement that turns `previous` into `next`, or `undefined` when they
 * are equal. A whole-string setter states no range, so this is where it gets one; an editor that
 * knows its range supplies a {@link TextRangeReplacement} directly and skips the comparison.
 *
 * The range never splits a surrogate pair: a boundary that lands between the two halves moves outward.
 */
export function minimalTextReplacement(previous: string, next: string): TextRangeReplacement | undefined {
  if (previous === next) return undefined;
  const shorter = Math.min(previous.length, next.length);
  let start = 0;
  while (start < shorter && previous.charCodeAt(start) === next.charCodeAt(start)) start += 1;
  if (start > 0 && isHighSurrogate(previous.charCodeAt(start - 1))) start -= 1;
  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previous.charCodeAt(previousEnd - 1) === next.charCodeAt(nextEnd - 1)
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }
  if (previousEnd < previous.length && isLowSurrogate(previous.charCodeAt(previousEnd))) {
    previousEnd += 1;
    nextEnd += 1;
  }
  return { start, end: previousEnd, insert: next.slice(start, nextEnd) };
}

/**
 * @internal The replacement an edit stated, when applying it to `previous` gives exactly `next`; otherwise `undefined`
 * and the caller compares the two texts. A stated range is the only thing that tells the engine which of
 * several equal characters an edit inserted, and so which text unit keeps its identity.
 */
export function statedTextReplacement(
  stated: TextRangeReplacement | undefined,
  previous: string | undefined,
  next: string,
): TextRangeReplacement | undefined {
  if (stated === undefined || previous === undefined || previous === next) return undefined;
  if (stated.start > stated.end || stated.end > previous.length) return undefined;
  if (previous.length - (stated.end - stated.start) + stated.insert.length !== next.length) return undefined;
  return previous.slice(0, stated.start) + stated.insert + previous.slice(stated.end) === next ? stated : undefined;
}

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

const PAINT_STYLE_KEYS: ReadonlySet<string> = new Set(['color', 'opacity']);

/** @internal What a layout callback is told when it writes a layout input. */
export const LAYOUT_PHASE_WRITE_MESSAGE =
  'a layout callback wrote a layout input of a text; inside the layout phase only transforms, visibility, colour, opacity and material may be written';

/** @internal Whether two styles differ in anything but paint. Styles are small frozen records of plain data. */
export function changesLayoutStyle(previous: object | undefined, next: object | undefined): boolean {
  if (previous === next) return false;
  const layoutOnly = (style: object | undefined): string =>
    JSON.stringify(Object.entries(style ?? {}).filter(([key]) => !PAINT_STYLE_KEYS.has(key)));
  return layoutOnly(previous) !== layoutOnly(next);
}
