import { deriveRasterKey } from '../internal/raster-identity.js'
import type { RasterKey } from '../identity.js'
import type { JsonValue, StaticNumberTuple } from '../raster.js'

export const BITMAP_KIND = 'bitmap' as const
export const BITMAP_EXTENSION = 'PMNDRS_font_bitmap' as const
export const BITMAP_FORMAT_VERSION = 0 as const
export const BITMAP_GENERATOR_VERSION = '0.0.0' as const

export interface BitmapOptions<Strikes extends readonly [number, ...number[]]> {
  readonly strikes: StaticNumberTuple<Strikes>
}

export interface BitmapDescriptorV0 {
  readonly [key: string]: JsonValue
  readonly generatorVersion: typeof BITMAP_GENERATOR_VERSION
  readonly strikes: readonly number[]
}

function canonicalStrikes(values: readonly number[]): readonly number[] {
  if (values.length === 0) throw new TypeError('bitmap strikes must be a non-empty tuple')

  const unique = new Set<number>()
  for (const value of values) {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0 || value > 65_535) {
      throw new TypeError('bitmap strikes must contain positive integers no greater than 65535')
    }
    if (unique.has(value)) throw new TypeError(`bitmap strike ${value} is duplicated`)
    unique.add(value)
  }
  return Object.freeze([...unique].sort((left, right) => left - right))
}

/** Create the complete payload-changing descriptor owned by the bitmap package. */
export function bitmapDescriptor<const Strikes extends readonly [number, ...number[]]>(
  options: BitmapOptions<Strikes>,
): BitmapDescriptorV0 {
  if (typeof options !== 'object' || options === null || !Array.isArray(options.strikes)) {
    throw new TypeError('bitmap options must provide a strikes tuple')
  }
  return Object.freeze({
    generatorVersion: BITMAP_GENERATOR_VERSION,
    strikes: canonicalStrikes(options.strikes),
  })
}

/** Derive the bitmap raster key shared by discovery, bakers, and runtimes. */
export async function bitmapRasterKey<const Strikes extends readonly [number, ...number[]]>(
  options: BitmapOptions<Strikes>,
): Promise<RasterKey> {
  return deriveRasterKey({
    descriptor: bitmapDescriptor(options),
    extension: BITMAP_EXTENSION,
    kind: BITMAP_KIND,
    version: BITMAP_FORMAT_VERSION,
  })
}
