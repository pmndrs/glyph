import { GlyphError } from './glyph-error.js';

export const MAX_RASTER_COVERAGE_RANGES = 1_024 as const;
export const MAX_RASTER_COVERAGE_SCALARS = 65_536 as const;
export const MAX_RASTER_COVERAGE_TEXT_CODE_POINTS = 65_536 as const;
export const MAX_RASTER_COVERAGE_GLYPH_IDS = 65_535 as const;

export type RasterUnicodeRange = {
  /** Inclusive Unicode scalar value. */
  readonly start: number;
  /** Inclusive Unicode scalar value. */
  readonly end: number;
};

/**
 * Bounded seeds for a sparse raster artifact. Seeds select nominal font-local glyph IDs only;
 * they do not request source subsetting, glyph remapping, or transitive shaping closure.
 */
export type RasterCoverage = {
  readonly unicodeRanges?: readonly RasterUnicodeRange[];
  readonly text?: string;
  readonly glyphIds?: readonly number[];
};

/** A shaped measure references font-local glyphs omitted from its bounded raster artifact. */
export class RasterCoverageError extends GlyphError<'format-unavailable'> {
  readonly rasterKind: string;
  readonly missingGlyphIds: readonly number[];

  constructor(rasterKind: string, missingGlyphIds: readonly number[]) {
    super(
      'format-unavailable',
      `${rasterKind} raster coverage is missing font-local glyph IDs: ${missingGlyphIds.join(', ')}`,
    );
    this.name = 'RasterCoverageError';
    this.rasterKind = rasterKind;
    this.missingGlyphIds = Object.freeze([...missingGlyphIds]);
  }
}

/** Validate, copy, sort, and freeze caller-authored sparse raster coverage. */
export function normalizeRasterCoverage(value: unknown): RasterCoverage | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('raster coverage must be an object');
  }
  const keys = Object.keys(value);
  if (keys.some((key) => key !== 'glyphIds' && key !== 'text' && key !== 'unicodeRanges')) {
    throw new TypeError('raster coverage contains an unknown property');
  }

  const unicodeRanges = Object.hasOwn(value, 'unicodeRanges')
    ? normalizeUnicodeRanges(Reflect.get(value, 'unicodeRanges'))
    : undefined;
  const text = Object.hasOwn(value, 'text') ? normalizeCoverageText(Reflect.get(value, 'text')) : undefined;
  const glyphIds = Object.hasOwn(value, 'glyphIds')
    ? normalizeCoverageGlyphIds(Reflect.get(value, 'glyphIds'))
    : undefined;
  if (unicodeRanges === undefined && text === undefined && glyphIds === undefined) {
    throw new TypeError('raster coverage must provide at least one non-empty seed');
  }
  return Object.freeze({
    ...(unicodeRanges === undefined ? {} : { unicodeRanges }),
    ...(text === undefined ? {} : { text }),
    ...(glyphIds === undefined ? {} : { glyphIds }),
  });
}

function normalizeUnicodeRanges(value: unknown): readonly RasterUnicodeRange[] | undefined {
  if (!Array.isArray(value)) throw new TypeError('raster coverage unicodeRanges must be an array');
  if (value.length === 0) return undefined;
  if (value.length > MAX_RASTER_COVERAGE_RANGES) {
    throw new RangeError(`raster coverage supports at most ${MAX_RASTER_COVERAGE_RANGES} Unicode ranges`);
  }
  const ranges = value.map((candidate, index) => {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      throw new TypeError(`raster coverage unicodeRanges[${index}] must be an object`);
    }
    const keys = Object.keys(candidate);
    if (
      keys.length !== 2 ||
      !Object.hasOwn(candidate, 'start') ||
      !Object.hasOwn(candidate, 'end') ||
      keys.some((key) => key !== 'start' && key !== 'end')
    ) {
      throw new TypeError(`raster coverage unicodeRanges[${index}] must contain only start and end`);
    }
    const start = Reflect.get(candidate, 'start');
    const end = Reflect.get(candidate, 'end');
    if (!isUnicodeScalar(start) || !isUnicodeScalar(end) || start > end || (start <= 0xdfff && end >= 0xd800)) {
      throw new RangeError(`raster coverage unicodeRanges[${index}] must be an inclusive Unicode scalar range`);
    }
    return Object.freeze({ start, end });
  });
  ranges.sort((left, right) => left.start - right.start || left.end - right.end);
  let scalarCount = 0;
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index]!;
    const previous = ranges[index - 1];
    if (previous !== undefined && range.start <= previous.end) {
      throw new RangeError('raster coverage Unicode ranges must not overlap or repeat scalar values');
    }
    scalarCount += range.end - range.start + 1;
    if (scalarCount > MAX_RASTER_COVERAGE_SCALARS) {
      throw new RangeError(`raster coverage Unicode ranges may select at most ${MAX_RASTER_COVERAGE_SCALARS} scalars`);
    }
  }
  return Object.freeze(ranges);
}

function normalizeCoverageText(value: unknown): string | undefined {
  if (typeof value !== 'string') throw new TypeError('raster coverage text must be a string');
  if (value.length === 0) return undefined;
  let codePoints = 0;
  for (const character of value) {
    if (character.length === 1 && character.charCodeAt(0) >= 0xd800 && character.charCodeAt(0) <= 0xdfff) {
      throw new TypeError('raster coverage text must contain only Unicode scalar values');
    }
    codePoints += 1;
    if (codePoints > MAX_RASTER_COVERAGE_TEXT_CODE_POINTS) {
      throw new RangeError(
        `raster coverage text may contain at most ${MAX_RASTER_COVERAGE_TEXT_CODE_POINTS} code points`,
      );
    }
  }
  return value;
}

function normalizeCoverageGlyphIds(value: unknown): readonly number[] | undefined {
  if (!Array.isArray(value)) throw new TypeError('raster coverage glyphIds must be an array');
  if (value.length === 0) return undefined;
  if (value.length > MAX_RASTER_COVERAGE_GLYPH_IDS) {
    throw new RangeError(`raster coverage supports at most ${MAX_RASTER_COVERAGE_GLYPH_IDS} glyph IDs`);
  }
  const glyphIds = value.map((candidate, index) => {
    if (!Number.isSafeInteger(candidate) || candidate < 0 || candidate > 0xffff) {
      throw new RangeError(`raster coverage glyphIds[${index}] must be an integer in 0..=65535`);
    }
    return candidate;
  });
  glyphIds.sort((left, right) => left - right);
  for (let index = 1; index < glyphIds.length; index += 1) {
    if (glyphIds[index] === glyphIds[index - 1]) {
      throw new RangeError(`raster coverage glyph ID ${glyphIds[index]} is duplicated`);
    }
  }
  return Object.freeze(glyphIds);
}

function isUnicodeScalar(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    typeof value === 'number' &&
    value >= 0 &&
    value <= 0x10ffff &&
    (value < 0xd800 || value > 0xdfff)
  );
}
