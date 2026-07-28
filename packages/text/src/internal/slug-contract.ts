import type { RasterKey } from '../identity.js'
import type { JsonValue } from '../raster.js'
import { deriveRasterKey } from './raster-identity.js'

export const SLUG_KIND = 'slug' as const
export const SLUG_EXTENSION = 'PMNDRS_font_slug' as const
export const SLUG_FORMAT_VERSION = 0 as const
export const SLUG_GENERATOR_VERSION = '0.0.0' as const
export const SLUG_PLANE_UNITS_PER_EM = 2048 as const
export const SLUG_DEFAULT_BAND_COUNT = 16 as const
export const SLUG_GLYPH_RECORD_STRIDE = 40 as const

export interface SlugDescriptorV0 {
  readonly [key: string]: JsonValue
  readonly generatorVersion: typeof SLUG_GENERATOR_VERSION
}

const descriptor = Object.freeze({
  generatorVersion: SLUG_GENERATOR_VERSION,
}) satisfies SlugDescriptorV0

/** Return the fixed, quality-preserving Slug V0 payload descriptor. */
export function slugDescriptor(): SlugDescriptorV0 {
  return descriptor
}

/** Derive the key shared by the fixed baker and runtime module. */
export function slugDescriptorRasterKey(): Promise<RasterKey> {
  return deriveRasterKey({
    descriptor,
    extension: SLUG_EXTENSION,
    kind: SLUG_KIND,
    version: SLUG_FORMAT_VERSION,
  })
}
