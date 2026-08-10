import type { UnicodeRangeV0 } from '../font-baker/index.js';

const MAX_UNICODE_RANGES = 4_096;
const MAX_UNICODE = 0x10ffff;

export function normalizeUnicodeRanges(ranges: readonly UnicodeRangeV0[]): readonly UnicodeRangeV0[] {
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
  const merged: UnicodeRangeV0[] = [];
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
