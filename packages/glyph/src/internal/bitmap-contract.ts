import type { RasterKey } from '../identity.js';
import type { StaticNumberTuple } from '../raster.js';
import { normalizeRasterCoverage, type RasterCoverage } from '../raster-coverage.js';
import { deriveRasterKey } from './raster-identity.js';

export const BITMAP_KIND = 'bitmap' as const;
export const BITMAP_EXTENSION = 'PMNDRS_font_bitmap' as const;
export const BITMAP_FORMAT_VERSION = 0 as const;
export const BITMAP_GENERATOR_VERSION = '0.0.0' as const;
export const MAX_BITMAP_PPEM = 1022 as const;

export interface BitmapOptions<Strikes extends readonly [number, ...number[]]> {
  readonly strikes: StaticNumberTuple<Strikes>;
  readonly coverage?: RasterCoverage;
}

export type BitmapDescriptor = Readonly<{
  readonly generatorVersion: typeof BITMAP_GENERATOR_VERSION;
  readonly strikes: readonly number[];
  readonly coverage?: RasterCoverage;
}>;

export interface NormalizedBitmapOptions {
  readonly strikes: readonly [number, ...number[]];
  readonly coverage?: RasterCoverage;
}

function canonicalStrikes(values: readonly number[]): readonly number[] {
  if (values.length === 0) throw new TypeError('bitmap strikes must be a non-empty tuple');

  const unique = new Set<number>();
  for (const value of values) {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0 || value > MAX_BITMAP_PPEM) {
      throw new TypeError(`bitmap strikes must contain positive integers no greater than ${MAX_BITMAP_PPEM}`);
    }
    if (unique.has(value)) throw new TypeError(`bitmap strike ${value} is duplicated`);
    unique.add(value);
  }
  return Object.freeze([...unique].sort((left, right) => left - right));
}

/** Create the complete payload-changing descriptor owned by the bitmap package. */
export function bitmapDescriptor<const Strikes extends readonly [number, ...number[]]>(
  options: BitmapOptions<Strikes>,
): BitmapDescriptor {
  const normalized = normalizeBitmapOptions(options);
  return canonicalizeBitmapDescriptor(normalized.strikes, normalized.coverage);
}

/** Validate options crossing JavaScript, JSON, or Worker boundaries. */
export function normalizeBitmapOptions(value: unknown): NormalizedBitmapOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('bitmap options must provide a strikes tuple');
  }
  const keys = Object.keys(value);
  if (keys.some((key) => key !== 'coverage' && key !== 'strikes')) {
    throw new TypeError('bitmap options contain an unknown property');
  }
  const strikes = Reflect.get(value, 'strikes');
  if (!Array.isArray(strikes)) throw new TypeError('bitmap options must provide a strikes tuple');
  const normalizedStrikes = canonicalStrikes(strikes) as readonly [number, ...number[]];
  const coverage = Object.hasOwn(value, 'coverage')
    ? normalizeRasterCoverage(Reflect.get(value, 'coverage'))
    : undefined;
  return Object.freeze({
    strikes: normalizedStrikes,
    ...(coverage === undefined ? {} : { coverage }),
  });
}

/** Canonicalize JSON strike data at analyzer and artifact-validation boundaries. */
export function canonicalizeBitmapDescriptor(strikes: readonly number[], coverage?: unknown): BitmapDescriptor {
  const normalizedCoverage = normalizeRasterCoverage(coverage);
  return Object.freeze({
    ...(normalizedCoverage === undefined ? {} : { coverage: normalizedCoverage }),
    generatorVersion: BITMAP_GENERATOR_VERSION,
    strikes: canonicalStrikes(strikes),
  });
}

/** Derive a key from a descriptor that has already crossed package-owned validation. */
export function bitmapDescriptorRasterKey(descriptor: BitmapDescriptor): RasterKey {
  return deriveRasterKey({
    descriptor,
    extension: BITMAP_EXTENSION,
    kind: BITMAP_KIND,
    version: BITMAP_FORMAT_VERSION,
  });
}

/** Derive the bitmap raster key shared by discovery, bakers, and runtimes. */
export async function bitmapRasterKey<const Strikes extends readonly [number, ...number[]]>(
  options: BitmapOptions<Strikes>,
): Promise<RasterKey> {
  return bitmapDescriptorRasterKey(bitmapDescriptor(options));
}
