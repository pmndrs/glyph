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
/** The encoded true-distance field covers four atlas pixels on either side of the edge. */
export const MTSDF_MAX_OUTLINE_ATLAS_PIXELS: number = MTSDF_PIXEL_RANGE / 2

export interface MsdfDescriptorV0 {
  readonly [key: string]: JsonValue
  readonly generatorVersion: typeof MSDF_GENERATOR_VERSION
}

const descriptor = Object.freeze({
  generatorVersion: MSDF_GENERATOR_VERSION,
}) satisfies MsdfDescriptorV0

/** Return the fixed, complete MTSDF payload descriptor. */
export function msdfDescriptor(): MsdfDescriptorV0 {
  return descriptor
}

/** Derive the key shared by the fixed baker and runtime module. */
export function msdfDescriptorRasterKey(): Promise<RasterKey> {
  return deriveRasterKey({
    descriptor,
    extension: MSDF_EXTENSION,
    kind: MSDF_KIND,
    version: MSDF_FORMAT_VERSION,
  })
}
