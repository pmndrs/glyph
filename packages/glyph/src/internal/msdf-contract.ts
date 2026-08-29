import type { RasterKey } from '../identity.js';
import { normalizeRasterCoverage, type RasterCoverage } from '../raster-coverage.js';
import { deriveRasterKey } from './raster-identity.js';

export const MSDF_KIND = 'msdf' as const;
export const MSDF_EXTENSION = 'PMNDRS_font_distance_field' as const;
export const MSDF_FORMAT_VERSION = 0 as const;
export const MSDF_GENERATOR_VERSION = '0.0.0' as const;
export const MSDF_EM_SIZE = 64 as const;
export const MSDF_PIXEL_RANGE = 8 as const;
export const MSDF_PLANE_UNITS_PER_EM = 64 as const;
/** Largest em grid that can fit between the fixed 1024-page outer gaps. */
export const MSDF_MAX_EM_SIZE = 1_022 as const;
/** Largest full range that can leave at least one inner texel in a fixed 1024 page. */
export const MSDF_MAX_PIXEL_RANGE = 1_020 as const;
/** Default 64/8 MTSDF field limit; configured resources derive their limit as `pixelRange / 2`. */
export const MSDF_MAX_OUTLINE_ATLAS_PIXELS: number = MSDF_PIXEL_RANGE / 2;

export interface MsdfOptions {
  /** Atlas texels per font em. Defaults to 64. */
  readonly emSize?: number;
  /** Full encoded signed-distance range in atlas pixels. Defaults to 8. */
  readonly pixelRange?: number;
  readonly coverage?: RasterCoverage;
}

export interface MsdfConfiguration {
  readonly emSize: number;
  readonly pixelRange: number;
  readonly planeUnitsPerEm: number;
}

export type DefaultMsdfDescriptor = Readonly<{
  readonly generatorVersion: typeof MSDF_GENERATOR_VERSION;
  readonly coverage?: RasterCoverage;
}>;

export type ConfiguredMsdfDescriptor = Readonly<{
  readonly emSize: number;
  readonly generatorVersion: typeof MSDF_GENERATOR_VERSION;
  readonly pixelRange: number;
  readonly coverage?: RasterCoverage;
}>;

export type MsdfDescriptor = DefaultMsdfDescriptor | ConfiguredMsdfDescriptor;

const defaultDescriptor = Object.freeze({
  generatorVersion: MSDF_GENERATOR_VERSION,
}) satisfies DefaultMsdfDescriptor;

/** Return the complete payload-changing MTSDF descriptor. */
export function msdfDescriptor(options?: MsdfOptions): MsdfDescriptor {
  const normalized = normalizeMsdfOptions(options);
  if (normalized === undefined) return defaultDescriptor;
  const emSize = normalized.emSize ?? MSDF_EM_SIZE;
  const pixelRange = normalized.pixelRange ?? MSDF_PIXEL_RANGE;
  const coverage = normalizeRasterCoverage(normalized.coverage);
  if (emSize === MSDF_EM_SIZE && pixelRange === MSDF_PIXEL_RANGE) {
    return coverage === undefined
      ? defaultDescriptor
      : Object.freeze({ coverage, generatorVersion: MSDF_GENERATOR_VERSION });
  }
  return Object.freeze({
    ...(coverage === undefined ? {} : { coverage }),
    emSize,
    generatorVersion: MSDF_GENERATOR_VERSION,
    pixelRange,
  });
}

/** Resolve the canonical generation policy represented by a descriptor. */
export function msdfDescriptorConfiguration(descriptor: MsdfDescriptor): MsdfConfiguration {
  const keys = Object.keys(descriptor);
  if (
    descriptor.generatorVersion !== MSDF_GENERATOR_VERSION ||
    keys.some((key) => key !== 'coverage' && key !== 'emSize' && key !== 'generatorVersion' && key !== 'pixelRange')
  ) {
    throw new TypeError('invalid MTSDF descriptor');
  }
  normalizeRasterCoverage(descriptor.coverage);
  const hasEmSize = Object.hasOwn(descriptor, 'emSize');
  const hasPixelRange = Object.hasOwn(descriptor, 'pixelRange');
  if (!hasEmSize && !hasPixelRange) {
    return defaultConfiguration;
  }
  if (!hasEmSize || !hasPixelRange) {
    throw new TypeError('invalid MTSDF descriptor');
  }
  const emSize = Reflect.get(descriptor, 'emSize');
  const pixelRange = Reflect.get(descriptor, 'pixelRange');
  if (typeof emSize !== 'number' || typeof pixelRange !== 'number') {
    throw new TypeError('invalid MTSDF descriptor');
  }
  validateEmSize(emSize);
  validatePixelRange(pixelRange);
  if (emSize === MSDF_EM_SIZE && pixelRange === MSDF_PIXEL_RANGE) {
    throw new TypeError('default MTSDF values must use the canonical default descriptor');
  }
  return Object.freeze({
    emSize,
    pixelRange,
    planeUnitsPerEm: emSize,
  });
}

const defaultConfiguration = Object.freeze({
  emSize: MSDF_EM_SIZE,
  pixelRange: MSDF_PIXEL_RANGE,
  planeUnitsPerEm: MSDF_PLANE_UNITS_PER_EM,
}) satisfies MsdfConfiguration;

/** Derive a key from a descriptor that has crossed package-owned validation. */
export function msdfDescriptorRasterKey(descriptor: MsdfDescriptor = defaultDescriptor): RasterKey {
  msdfDescriptorConfiguration(descriptor);
  return deriveRasterKey({
    descriptor,
    extension: MSDF_EXTENSION,
    kind: MSDF_KIND,
    version: MSDF_FORMAT_VERSION,
  });
}

/** Derive the MTSDF raster key shared by discovery, bakers, and runtimes. */
export async function msdfRasterKey(options?: MsdfOptions): Promise<RasterKey> {
  return msdfDescriptorRasterKey(msdfDescriptor(options));
}

/** Validate options crossing JavaScript, JSON, or Worker boundaries. */
export function normalizeMsdfOptions(value: unknown): MsdfOptions | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('MTSDF options must be an object');
  }
  const keys = Object.keys(value);
  if (keys.some((key) => key !== 'coverage' && key !== 'emSize' && key !== 'pixelRange')) {
    throw new TypeError('MTSDF options contain an unknown property');
  }
  let emSize: number | undefined;
  if (Object.hasOwn(value, 'emSize')) {
    const candidate = Reflect.get(value, 'emSize');
    if (typeof candidate !== 'number') throw new TypeError('MTSDF emSize must be a number');
    validateEmSize(candidate);
    emSize = candidate;
  }
  let pixelRange: number | undefined;
  if (Object.hasOwn(value, 'pixelRange')) {
    const candidate = Reflect.get(value, 'pixelRange');
    if (typeof candidate !== 'number') throw new TypeError('MTSDF pixelRange must be a number');
    validatePixelRange(candidate);
    pixelRange = candidate;
  }
  const coverage = Object.hasOwn(value, 'coverage')
    ? normalizeRasterCoverage(Reflect.get(value, 'coverage'))
    : undefined;
  return Object.freeze({
    ...(coverage === undefined ? {} : { coverage }),
    ...(emSize === undefined ? {} : { emSize }),
    ...(pixelRange === undefined ? {} : { pixelRange }),
  });
}

function validateEmSize(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MSDF_MAX_EM_SIZE) {
    throw new TypeError(`MTSDF emSize must be an integer in 1..=${MSDF_MAX_EM_SIZE}`);
  }
}

function validatePixelRange(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MSDF_MAX_PIXEL_RANGE) {
    throw new TypeError(`MTSDF pixelRange must be an integer in 1..=${MSDF_MAX_PIXEL_RANGE}`);
  }
}
