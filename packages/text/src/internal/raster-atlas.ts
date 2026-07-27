import { KHR_SUPERCOMPRESSION_NONE, read as readKtx2, type KTX2Container } from 'ktx-parse'
import * as THREE from 'three/webgpu'

import type { JsonValue, RegisteredRaster } from '../raster.js'

export const DENSE_GLYPH_RECORD_STRIDE = 20 as const
export const ABSENT_GLYPH_PAGE = 0xffff as const

export interface RasterAtlasPage {
  readonly width: number
  readonly height: number
  readonly texture: THREE.DataTexture
}

export interface LosslessAtlasFormat {
  readonly gpuFormat: string
  readonly vkFormat: number
  readonly bytesPerPixel: number
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
  const container = parseKtx2(bytes, path)
  const expectedBytes = checkedProduct(
    checkedProduct(width, height, path),
    format.bytesPerPixel,
    path,
  )
  const level = container.levels[0]
  if (
    container.vkFormat !== format.vkFormat ||
    container.typeSize !== 1 ||
    container.pixelWidth !== width ||
    container.pixelHeight !== height ||
    container.pixelDepth !== 0 ||
    container.layerCount !== 0 ||
    container.faceCount !== 1 ||
    container.levelCount !== 1 ||
    container.levels.length !== 1 ||
    container.supercompressionScheme !== KHR_SUPERCOMPRESSION_NONE ||
    level === undefined ||
    level.levelData.byteLength !== expectedBytes ||
    level.uncompressedByteLength !== expectedBytes
  ) {
    throw new TypeError(
      `${path} KTX2 payload does not match its declared ${format.gpuFormat} dimensions`,
    )
  }
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
): void {
  const view = new DataView(records.buffer, records.byteOffset, records.byteLength)
  for (let offset = 0; offset < records.byteLength; offset += DENSE_GLYPH_RECORD_STRIDE) {
    const pageIndex = view.getUint16(offset + 16, true)
    const flags = view.getUint16(offset + 18, true)
    if (flags !== 0) throw new TypeError(`${label} record contains unsupported flags`)
    if (pageIndex === ABSENT_GLYPH_PAGE) {
      if (records.subarray(offset, offset + 16).some((value) => value !== 0)) {
        throw new TypeError(`absent ${label} record contains payload data`)
      }
      continue
    }
    const page = pages[pageIndex]
    if (page === undefined) throw new TypeError(`${label} record references a missing page`)
    const planeLeft = view.getInt16(offset, true)
    const planeBottom = view.getInt16(offset + 2, true)
    const planeRight = view.getInt16(offset + 4, true)
    const planeTop = view.getInt16(offset + 6, true)
    const atlasLeft = view.getUint16(offset + 8, true)
    const atlasTop = view.getUint16(offset + 10, true)
    const atlasRight = view.getUint16(offset + 12, true)
    const atlasBottom = view.getUint16(offset + 14, true)
    if (
      planeLeft > planeRight ||
      planeBottom > planeTop ||
      atlasLeft >= atlasRight ||
      atlasTop >= atlasBottom ||
      atlasRight > page.width ||
      atlasBottom > page.height
    ) {
      throw new TypeError(`${label} record is outside its validated plane or atlas bounds`)
    }
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

function parseKtx2(bytes: Uint8Array, path: string): KTX2Container {
  try {
    return readKtx2(bytes)
  } catch (error) {
    throw new TypeError(`${path} contains invalid KTX2: ${errorMessage(error)}`, { cause: error })
  }
}

function checkedProduct(left: number, right: number, path: string): number {
  const product = left * right
  if (!Number.isSafeInteger(product)) throw new RangeError(`${path} texture size overflowed`)
  return product
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
