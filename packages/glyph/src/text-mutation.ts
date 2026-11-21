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

/** A string with every lone surrogate replaced by U+FFFD, and how many were replaced. */
export interface WellFormedText {
  readonly text: string;
  readonly replacedSurrogates: number;
}

/**
 * Replaces lone surrogates with U+FFFD, as `String.prototype.toWellFormed` does, and counts them.
 * A string sliced at a UTF-16 index or typed mid-composition carries them routinely, so they are
 * data to repair and report, not a caller error.
 */
export function wellFormedText(text: string): WellFormedText {
  if (text.isWellFormed()) return { text, replacedSurrogates: 0 };
  let replacedSurrogates = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (isHighSurrogate(unit) && isLowSurrogate(text.charCodeAt(index + 1))) index += 1;
    else if (isHighSurrogate(unit) || isLowSurrogate(unit)) replacedSurrogates += 1;
  }
  return { text: text.toWellFormed(), replacedSurrogates };
}

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}
