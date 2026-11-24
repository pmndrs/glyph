import type { FontBakeSelection, UnicodeRange } from '../font-baker/index.js';

const MAX_UNICODE_RANGES = 4_096;
const MAX_UNICODE = 0x10ffff;
const MAX_LAYOUT_FEATURES = 1_024;
/** Four printable ASCII characters; spaces pad the end only. */
const OPEN_TYPE_TAG = /^[!-~](?:[!-~]{3}|[!-~]{2} |[!-~] {2}| {3})$/u;
const EVERY_CODE_POINT: readonly UnicodeRange[] = [{ start: 0, end: MAX_UNICODE }];

/**
 * The selection a bake prepares its source with, or `undefined` when it bakes the source as it is. A layout feature
 * selection without Unicode ranges prepares every code point, so a full bake and a subset bake prune features alike.
 */
export function preparationSelection(
  fontFaceIndex: number,
  unicodeRanges: readonly UnicodeRange[] | undefined,
  layoutFeatures: readonly string[] | undefined,
): FontBakeSelection | undefined {
  if (unicodeRanges === undefined && layoutFeatures === undefined) return undefined;
  return {
    formatVersion: 0,
    fontFaceIndex,
    unicodeRanges: normalizeUnicodeRanges(unicodeRanges ?? EVERY_CODE_POINT),
    ...(layoutFeatures === undefined ? {} : { layoutFeatures: normalizeLayoutFeatures(layoutFeatures) }),
  };
}

export function isOpenTypeTag(value: unknown): value is string {
  return typeof value === 'string' && OPEN_TYPE_TAG.test(value);
}

/** Validates OpenType layout feature tags and returns them sorted without duplicates. */
export function normalizeLayoutFeatures(tags: readonly string[]): readonly string[] {
  if (!Array.isArray(tags)) throw new TypeError('layoutFeatures must be an array of OpenType tags');
  if (tags.length > MAX_LAYOUT_FEATURES) {
    throw new RangeError(`layoutFeatures exceeds ${MAX_LAYOUT_FEATURES} tags`);
  }
  for (const [index, tag] of tags.entries()) {
    if (!isOpenTypeTag(tag)) {
      throw new TypeError(`layoutFeatures[${index}] must be a four-character OpenType tag such as 'smcp'`);
    }
  }
  return [...new Set(tags)].sort();
}

export function normalizeUnicodeRanges(ranges: readonly UnicodeRange[]): readonly UnicodeRange[] {
  if (!Array.isArray(ranges) || ranges.length === 0) {
    throw new TypeError('font selection requires at least one Unicode range');
  }
  if (ranges.length > MAX_UNICODE_RANGES) {
    throw new RangeError(`font selection exceeds ${MAX_UNICODE_RANGES} Unicode ranges`);
  }
  const normalized = ranges.map((range, index) => {
    if (typeof range !== 'object' || range === null || Array.isArray(range)) {
      throw new TypeError(`Unicode range ${index} must be an object`);
    }
    const { start, end } = range;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || end > MAX_UNICODE) {
      throw new RangeError(`Unicode range ${index} must contain ordered integers from U+0000 through U+10FFFF`);
    }
    return { start, end };
  });
  normalized.sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: UnicodeRange[] = [];
  for (const range of normalized) {
    const previous = merged.at(-1);
    if (previous !== undefined && range.start <= previous.end + 1) {
      merged[merged.length - 1] = { start: previous.start, end: Math.max(previous.end, range.end) };
    } else {
      merged.push(range);
    }
  }
  return merged;
}
