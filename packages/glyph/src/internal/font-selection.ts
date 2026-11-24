import type { FontBakeSelection, UnicodeRange } from '../font-baker/index.js';

const MAX_UNICODE_RANGES = 4_096;
const MAX_UNICODE = 0x10ffff;
const MAX_LAYOUT_FEATURE_TOKENS = 1_024;
/** Four printable ASCII characters; spaces pad the end only. */
const OPEN_TYPE_TAG = /^[!-~](?:[!-~]{3}|[!-~]{2} |[!-~] {2}| {3})$/u;
const EVERY_CODE_POINT: readonly UnicodeRange[] = [{ start: 0, end: MAX_UNICODE }];

/**
 * The selection every bake prepares its source with. Without Unicode ranges it prepares every code point, so a full
 * bake and a subset bake keep the same layout features for the same code points.
 */
export function preparationSelection(
  fontFaceIndex: number,
  unicodeRanges: readonly UnicodeRange[] | undefined,
  layoutFeatures: readonly string[] | undefined,
): FontBakeSelection {
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

/**
 * Validates `--layout-features` tokens and returns them in a canonical order: `*` first when present, then added tags,
 * then removed tags, each sorted without duplicates. `*` must be the first token; `tag` and `+tag` add; `-tag` removes;
 * a tag both added and removed is rejected. The baker also refuses removing a feature script shaping needs.
 */
export function normalizeLayoutFeatures(tokens: readonly string[], label = 'layoutFeatures'): readonly string[] {
  if (!Array.isArray(tokens)) throw new TypeError(`${label} must be an array of feature tokens`);
  if (tokens.length > MAX_LAYOUT_FEATURE_TOKENS) {
    throw new RangeError(`${label} exceeds ${MAX_LAYOUT_FEATURE_TOKENS} tokens`);
  }
  let every = false;
  const added = new Set<string>();
  const removed = new Set<string>();
  for (const [index, token] of tokens.entries()) {
    if (token === '*') {
      if (index !== 0) throw new TypeError(`${label} token ${index}: '*' must be the first token`);
      every = true;
      continue;
    }
    const sign = typeof token === 'string' ? token[0] : undefined;
    const tag = sign === '-' || sign === '+' ? token.slice(1) : token;
    if (!isOpenTypeTag(tag)) {
      throw new TypeError(
        `${label} token ${index} must be '*', or a four-character OpenType tag with an optional + or -, such as 'smcp' or '-liga'`,
      );
    }
    (sign === '-' ? removed : added).add(tag);
  }
  for (const tag of added) {
    if (removed.has(tag)) throw new TypeError(`${label} adds and removes '${tag}'`);
  }
  return [...(every ? ['*'] : []), ...[...added].sort(), ...[...removed].sort().map((tag) => `-${tag}`)];
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
