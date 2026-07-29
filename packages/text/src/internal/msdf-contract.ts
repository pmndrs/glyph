import type { RasterKey } from '../identity.js'
import type { JsonValue } from '../raster.js'
import { deriveRasterKey } from './raster-identity.js'

export const MSDF_KIND = 'msdf' as const
export const MSDF_EXTENSION = 'PMNDRS_font_distance_field' as const
export const MSDF_FORMAT_VERSION = 0 as const
export const MSDF_GENERATOR_VERSION = '0.0.0' as const
export const MTSDF_EM_SIZE = 64 as const
export const MTSDF_PIXEL_RANGE = 8 as const
export const MTSDF_PLANE_UNITS_PER_EM = 64 as const
/** Largest em grid that can fit between the fixed 1024-page outer gaps. */
export const MTSDF_MAX_EM_SIZE = 1_022 as const
/** Largest full range that can leave at least one inner texel in a fixed 1024 page. */
export const MTSDF_MAX_PIXEL_RANGE = 1_020 as const
/** The encoded true-distance field covers four atlas pixels on either side of the edge. */
export const MTSDF_MAX_OUTLINE_ATLAS_PIXELS: number = MTSDF_PIXEL_RANGE / 2

export interface MsdfOptions {
  /** Atlas texels per font em. Defaults to 64. */
  readonly emSize?: number
  /** Full encoded signed-distance range in atlas pixels. Defaults to 8. */
  readonly pixelRange?: number
}

export interface MsdfConfiguration {
  readonly emSize: number
  readonly pixelRange: number
  readonly planeUnitsPerEm: number
}

export interface DefaultMsdfDescriptorV0 {
  readonly [key: string]: JsonValue
  readonly generatorVersion: typeof MSDF_GENERATOR_VERSION
}

export interface ConfiguredMsdfDescriptorV0 {
  readonly [key: string]: JsonValue
  readonly emSize: number
  readonly generatorVersion: typeof MSDF_GENERATOR_VERSION
  readonly pixelRange: number
}

export type MsdfDescriptorV0 = DefaultMsdfDescriptorV0 | ConfiguredMsdfDescriptorV0

const defaultDescriptor = Object.freeze({
  generatorVersion: MSDF_GENERATOR_VERSION,
}) satisfies DefaultMsdfDescriptorV0

/** Return the complete payload-changing MTSDF descriptor. */
export function msdfDescriptor(options?: MsdfOptions): MsdfDescriptorV0 {
  const normalized = normalizeMsdfOptions(options)
  if (normalized === undefined) return defaultDescriptor
  const emSize = normalized.emSize ?? MTSDF_EM_SIZE
  const pixelRange = normalized.pixelRange ?? MTSDF_PIXEL_RANGE
  if (emSize === MTSDF_EM_SIZE && pixelRange === MTSDF_PIXEL_RANGE) return defaultDescriptor
  return Object.freeze({ emSize, generatorVersion: MSDF_GENERATOR_VERSION, pixelRange })
}

/** Resolve the authenticated generation policy represented by a descriptor. */
export function msdfDescriptorConfiguration(descriptor: MsdfDescriptorV0): MsdfConfiguration {
  const keys = Object.keys(descriptor)
  if (
    descriptor.generatorVersion !== MSDF_GENERATOR_VERSION ||
    (keys.length !== 1 && keys.length !== 3)
  ) {
    throw new TypeError('invalid MTSDF descriptor')
  }
  if (keys.length === 1) {
    if (keys[0] !== 'generatorVersion') throw new TypeError('invalid MTSDF descriptor')
    return defaultConfiguration
  }
  if (
    !Object.hasOwn(descriptor, 'emSize') ||
    !Object.hasOwn(descriptor, 'pixelRange') ||
    keys.some((key) => key !== 'emSize' && key !== 'generatorVersion' && key !== 'pixelRange')
  ) {
    throw new TypeError('invalid MTSDF descriptor')
  }
  const emSize = Reflect.get(descriptor, 'emSize')
  const pixelRange = Reflect.get(descriptor, 'pixelRange')
  if (typeof emSize !== 'number' || typeof pixelRange !== 'number') {
    throw new TypeError('invalid MTSDF descriptor')
  }
  validateEmSize(emSize)
  validatePixelRange(pixelRange)
  if (emSize === MTSDF_EM_SIZE && pixelRange === MTSDF_PIXEL_RANGE) {
    throw new TypeError('default MTSDF values must use the canonical default descriptor')
  }
  return Object.freeze({
    emSize,
    pixelRange,
    planeUnitsPerEm: emSize,
  })
}

const defaultConfiguration = Object.freeze({
  emSize: MTSDF_EM_SIZE,
  pixelRange: MTSDF_PIXEL_RANGE,
  planeUnitsPerEm: MTSDF_PLANE_UNITS_PER_EM,
}) satisfies MsdfConfiguration

/** Derive a key from a descriptor that has crossed package-owned validation. */
export function msdfDescriptorRasterKey(
  descriptor: MsdfDescriptorV0 = defaultDescriptor,
): Promise<RasterKey> {
  msdfDescriptorConfiguration(descriptor)
  return deriveRasterKey({
    descriptor,
    extension: MSDF_EXTENSION,
    kind: MSDF_KIND,
    version: MSDF_FORMAT_VERSION,
  })
}

/** Derive the MTSDF raster key shared by discovery, bakers, and runtimes. */
export function msdfRasterKey(options?: MsdfOptions): Promise<RasterKey> {
  return msdfDescriptorRasterKey(msdfDescriptor(options))
}

/** Validate options crossing JavaScript, JSON, or Worker boundaries. */
export function normalizeMsdfOptions(value: unknown): MsdfOptions | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('MTSDF options must be an object')
  }
  const keys = Object.keys(value)
  if (keys.some((key) => key !== 'emSize' && key !== 'pixelRange')) {
    throw new TypeError('MTSDF options contain an unknown property')
  }
  let emSize: number | undefined
  if (Object.hasOwn(value, 'emSize')) {
    const candidate = Reflect.get(value, 'emSize')
    if (typeof candidate !== 'number') throw new TypeError('MTSDF emSize must be a number')
    validateEmSize(candidate)
    emSize = candidate
  }
  let pixelRange: number | undefined
  if (Object.hasOwn(value, 'pixelRange')) {
    const candidate = Reflect.get(value, 'pixelRange')
    if (typeof candidate !== 'number') throw new TypeError('MTSDF pixelRange must be a number')
    validatePixelRange(candidate)
    pixelRange = candidate
  }
  return Object.freeze({
    ...(emSize === undefined ? {} : { emSize }),
    ...(pixelRange === undefined ? {} : { pixelRange }),
  })
}

function validateEmSize(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MTSDF_MAX_EM_SIZE) {
    throw new TypeError(`MTSDF emSize must be an integer in 1..=${MTSDF_MAX_EM_SIZE}`)
  }
}

function validatePixelRange(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MTSDF_MAX_PIXEL_RANGE) {
    throw new TypeError(`MTSDF pixelRange must be an integer in 1..=${MTSDF_MAX_PIXEL_RANGE}`)
  }
}
