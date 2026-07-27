import * as THREE from 'three/webgpu'

import {
  RasterKtxValidationError,
  validateNativeKtx2,
  type NativeKtx2Format,
} from './raster-ktx.js'
import {
  DENSE_GLYPH_RECORD_STRIDE,
  DenseGlyphRecordError,
  validateDenseGlyphRecordTable,
} from './raster-records.js'
import type { JsonValue, RegisteredRaster } from '../raster.js'

export { ABSENT_GLYPH_PAGE, DENSE_GLYPH_RECORD_STRIDE } from './raster-records.js'

export interface RasterAtlasPage {
  readonly width: number
  readonly height: number
  readonly texture: THREE.DataTexture
}

export interface LosslessAtlasFormat extends NativeKtx2Format {
  readonly gpuFormat: string
  readonly textureFormat: THREE.PixelFormat
  readonly generateMipmaps: boolean
  readonly minFilter: THREE.MinificationTextureFilter
}

export function decodeEmbeddedLosslessAtlasPage(
  raster: RegisteredRaster,
  value: JsonValue,
  path: string,
  format: LosslessAtlasFormat,
): RasterAtlasPage {
  const page = jsonObject(value, path)
  const width = positiveSafeInteger(page.width, `${path} width`)
  const height = positiveSafeInteger(page.height, `${path} height`)
  if (width > 16_384 || height > 16_384) {
    throw new RangeError(`${path} exceeds the 16384-pixel runtime texture limit`)
  }
  if (page.mipLevelCount !== 1 || page.colorSpace !== 'linear') {
    throw new TypeError(`${path} must be a single-level linear texture resource`)
  }
  const baseline = jsonArray(page.variants, `${path} variants`).find((variantValue) => {
    const variant = jsonObject(variantValue, `${path} variant`)
    return variant.gpuFormat === format.gpuFormat
  })
  if (baseline === undefined) {
    throw new TypeError(`${path} has no lossless ${format.gpuFormat} variant`)
  }
  const variant = jsonObject(baseline, `${path} ${format.gpuFormat} variant`)
  if (variant.container !== 'ktx2' || variant.quality !== 'lossless') {
    throw new TypeError(`${path} ${format.gpuFormat} variant is not the lossless KTX2 baseline`)
  }
  if (variant.requiredFeature !== undefined) {
    throw new TypeError(`${path} lossless baseline must not require an optional GPU feature`)
  }
  const source = jsonObject(variant.source, `${path} ${format.gpuFormat} source`)
  if (source.type !== 'bufferView') {
    throw new TypeError(`${path} uses an external page; lazy page residency is not available yet`)
  }
  const bytes = raster.view(nonnegativeSafeInteger(source.bufferView, `${path} bufferView`))
  let container
  try {
    container = validateNativeKtx2(bytes, width, height, format)
  } catch (error) {
    if (error instanceof RasterKtxValidationError) {
      throw new TypeError(`${path} contains invalid KTX2: ${error.message}`, { cause: error })
    }
    throw error
  }
  const level = container.levels[0]
  if (level === undefined) throw new TypeError(`${path} KTX2 contains no base level`)
  const texture = new THREE.DataTexture(
    level.levelData.slice(),
    width,
    height,
    format.textureFormat,
    THREE.UnsignedByteType,
  )
  texture.colorSpace = THREE.NoColorSpace
  texture.flipY = true
  texture.generateMipmaps = format.generateMipmaps
  texture.minFilter = format.minFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return { width, height, texture }
}

export function validateDenseGlyphRecords(
  records: Uint8Array,
  pages: readonly Pick<RasterAtlasPage, 'width' | 'height'>[],
  label: string,
  requireNonEmptyPlaneSpans = false,
): void {
  try {
    validateDenseGlyphRecordTable(
      records,
      pages,
      records.byteLength / DENSE_GLYPH_RECORD_STRIDE,
      requireNonEmptyPlaneSpans,
    )
  } catch (error) {
    if (error instanceof DenseGlyphRecordError) {
      throw new TypeError(`${label} record ${error.message}`, { cause: error })
    }
    throw error
  }
}

export function jsonObject(
  value: JsonValue | undefined,
  path: string,
): Readonly<Record<string, JsonValue>> {
  if (typeof value !== 'object' || value === null || isJsonArray(value)) {
    throw new TypeError(`${path} must be an object`)
  }
  return value
}

export function jsonArray(value: JsonValue | undefined, path: string): readonly JsonValue[] {
  if (!isJsonArray(value)) throw new TypeError(`${path} must be an array`)
  return value
}

export function positiveSafeInteger(value: JsonValue | undefined, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${path} must be a positive integer`)
  }
  return value
}

export function nonnegativeSafeInteger(value: JsonValue | undefined, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${path} must be a non-negative integer`)
  }
  return value
}

function isJsonArray(value: JsonValue | undefined): value is readonly JsonValue[] {
  return Array.isArray(value)
}
