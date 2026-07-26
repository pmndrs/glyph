import { KHR_SUPERCOMPRESSION_NONE, VK_FORMAT_R8_UNORM, read as readKtx2 } from 'ktx-parse'
import * as THREE from 'three/webgpu'
import {
  add,
  attribute,
  modelViewProjection,
  mul,
  positionLocal,
  reciprocal,
  round,
  screenSize,
  sub,
  texture,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import type Node from 'three/src/nodes/core/Node.js'

import { deriveRasterKey } from '../internal/raster-identity.js'
import type { RegisteredFont } from '../font.js'
import type { RasterKey } from '../identity.js'
import type { ParagraphLayout } from '../layout.js'
import type { GlyphPaint, LinearRgba } from '../paint.js'
import {
  defineRaster,
  type JsonValue,
  type RasterModule,
  type RasterRequest,
  type RegisteredRaster,
  type StaticNumberTuple,
} from '../raster.js'

export const BITMAP_KIND = 'bitmap' as const
export const BITMAP_EXTENSION = 'PMNDRS_font_bitmap' as const
export const BITMAP_FORMAT_VERSION = 0 as const
export const BITMAP_GENERATOR_VERSION = '0.0.0' as const
export const MAX_BITMAP_PPEM = 1022 as const

export interface BitmapOptions<Strikes extends readonly [number, ...number[]]> {
  readonly strikes: StaticNumberTuple<Strikes>
}

interface BitmapRuntimeOptions {
  readonly strikes: readonly [number, ...number[]]
}

export interface BitmapDescriptorV0 {
  readonly [key: string]: JsonValue
  readonly generatorVersion: typeof BITMAP_GENERATOR_VERSION
  readonly strikes: readonly number[]
}

export interface BitmapPageResource {
  readonly width: number
  readonly height: number
  readonly texture: THREE.DataTexture
}

export interface BitmapStrikeResource {
  readonly ppem: number
  readonly planeUnitsPerEm: number
  readonly records: Uint8Array
  readonly pages: readonly BitmapPageResource[]
}

export interface BitmapResource {
  readonly strikes: readonly BitmapStrikeResource[]
}

interface BitmapBatchRun {
  readonly glyphIndices: Uint32Array
  readonly colorAttribute: THREE.InstancedBufferAttribute
  readonly geometry: THREE.InstancedBufferGeometry
  readonly mesh: THREE.Mesh
}

export interface BitmapDrawBatch {
  readonly object: THREE.Group
  readonly glyphCount: number
  readonly drawCount: number
  /** Selected baked strike in pixels per em. */
  readonly strikePpem: number
  updatePaint(paint: GlyphPaint): void
  dispose(): void
}

const RECORD_STRIDE = 20
const ABSENT_PAGE = 0xffff

function canonicalStrikes(values: readonly number[]): readonly number[] {
  if (values.length === 0) throw new TypeError('bitmap strikes must be a non-empty tuple')

  const unique = new Set<number>()
  for (const value of values) {
    if (
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value <= 0 ||
      value > MAX_BITMAP_PPEM
    ) {
      throw new TypeError(
        `bitmap strikes must contain positive integers no greater than ${MAX_BITMAP_PPEM}`,
      )
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
  return canonicalizeBitmapDescriptor(options.strikes)
}

/** Canonicalize JSON strike data at analyzer and artifact-validation boundaries. */
export function canonicalizeBitmapDescriptor(strikes: readonly number[]): BitmapDescriptorV0 {
  return Object.freeze({
    generatorVersion: BITMAP_GENERATOR_VERSION,
    strikes: canonicalStrikes(strikes),
  })
}

/** Derive a key from a descriptor that has already crossed package-owned validation. */
export function bitmapDescriptorRasterKey(descriptor: BitmapDescriptorV0): Promise<RasterKey> {
  return deriveRasterKey({
    descriptor,
    extension: BITMAP_EXTENSION,
    kind: BITMAP_KIND,
    version: BITMAP_FORMAT_VERSION,
  })
}

/** Derive the bitmap raster key shared by discovery, bakers, and runtimes. */
export async function bitmapRasterKey<const Strikes extends readonly [number, ...number[]]>(
  options: BitmapOptions<Strikes>,
): Promise<RasterKey> {
  return bitmapDescriptorRasterKey(bitmapDescriptor(options))
}

const bitmapModule: RasterModule<
  typeof BITMAP_KIND,
  BitmapResource,
  BitmapDrawBatch,
  BitmapRuntimeOptions
> = defineRaster({
  kind: BITMAP_KIND,
  extension: BITMAP_EXTENSION,
  version: BITMAP_FORMAT_VERSION,
  descriptor: bitmapDescriptor,
  async decode(font, raster, signal) {
    signal?.throwIfAborted()
    const resource = decodeBitmapResource(font, raster)
    signal?.throwIfAborted()
    return resource
  },
  async prepare(_layout, _resource, _fontSlot, signal) {
    signal?.throwIfAborted()
  },
  buildBatches(layout, resource, fontSlot, paint) {
    return buildBitmapBatches(layout, resource, fontSlot, paint)
  },
  updatePaint(batch, paint) {
    batch.updatePaint(paint)
  },
  dispose(resource) {
    disposeBitmapStrikes(resource.strikes)
  },
})

export type BitmapModule = typeof bitmapModule

/** Select deterministic bitmap strikes without exposing caller-authored raster keys. */
export function bitmap<const Strikes extends readonly [number, ...number[]]>(
  options: BitmapOptions<Strikes>,
): RasterRequest<BitmapModule> {
  bitmapDescriptor(options)
  return { module: bitmapModule, options }
}

function decodeBitmapResource(font: RegisteredFont, raster: RegisteredRaster): BitmapResource {
  if (
    raster.font !== font.handle ||
    raster.kind !== BITMAP_KIND ||
    raster.extension !== BITMAP_EXTENSION ||
    raster.version !== BITMAP_FORMAT_VERSION
  ) {
    throw new TypeError('bitmap raster is not bound to the supplied font')
  }
  const extension = objectValue(raster.extensionData, 'bitmap extension')
  if (
    extension.version !== BITMAP_FORMAT_VERSION ||
    extension.rasterKey !== raster.rasterKey ||
    extension.shapingHash !== font.shapingHash ||
    extension.glyphCount !== font.glyphCount ||
    extension.glyphIdWidth !== 16
  ) {
    throw new TypeError('bitmap extension identity does not match its registered font and raster')
  }
  const strikes: BitmapStrikeResource[] = []
  try {
    const strikeValues = arrayValue(extension.strikes, 'bitmap strikes')
    if (strikeValues.length === 0)
      throw new TypeError('bitmap raster must contain at least one strike')
    for (let strikeIndex = 0; strikeIndex < strikeValues.length; strikeIndex += 1) {
      const strike = objectValue(strikeValues[strikeIndex], `bitmap strike ${strikeIndex}`)
      const ppem = positiveInteger(strike.ppemX, `bitmap strike ${strikeIndex} ppemX`)
      if (strike.ppemY !== ppem) throw new TypeError('bitmap runtime requires square strikes')
      const planeUnitsPerEm = positiveInteger(
        strike.planeUnitsPerEm,
        `bitmap strike ${strikeIndex} planeUnitsPerEm`,
      )
      if (strike.recordStride !== RECORD_STRIDE) {
        throw new TypeError(`bitmap records must use ${RECORD_STRIDE}-byte stride`)
      }
      const records = raster.view(
        nonnegativeInteger(
          strike.recordBufferView,
          `bitmap strike ${strikeIndex} recordBufferView`,
        ),
      )
      if (records.byteLength !== font.glyphCount * RECORD_STRIDE) {
        throw new TypeError('bitmap record table does not match the registered glyph count')
      }
      const pages: BitmapPageResource[] = []
      try {
        for (const [pageIndex, pageValue] of arrayValue(
          strike.pages,
          `bitmap strike ${strikeIndex} pages`,
        ).entries()) {
          pages.push(
            decodeBitmapPage(raster, pageValue, `bitmap strike ${strikeIndex} page ${pageIndex}`),
          )
        }
        validateBitmapRecords(records, pages)
        strikes.push({ ppem, planeUnitsPerEm, records, pages })
      } catch (error) {
        for (const page of pages) page.texture.dispose()
        throw error
      }
    }
    return { strikes }
  } catch (error) {
    disposeBitmapStrikes(strikes)
    throw error
  }
}

function disposeBitmapStrikes(strikes: readonly BitmapStrikeResource[]): void {
  for (const strike of strikes) {
    for (const page of strike.pages) page.texture.dispose()
  }
}

function decodeBitmapPage(
  raster: RegisteredRaster,
  value: JsonValue,
  path: string,
): BitmapPageResource {
  const page = objectValue(value, path)
  const width = positiveInteger(page.width, `${path} width`)
  const height = positiveInteger(page.height, `${path} height`)
  if (page.mipLevelCount !== 1 || page.colorSpace !== 'linear') {
    throw new TypeError(`${path} must be a single-level linear texture`)
  }
  const baseline = arrayValue(page.variants, `${path} variants`).find((variantValue) => {
    const variant = objectValue(variantValue, `${path} variant`)
    return variant.gpuFormat === 'r8unorm'
  })
  if (baseline === undefined) throw new TypeError(`${path} has no lossless R8 variant`)
  const variant = objectValue(baseline, `${path} R8 variant`)
  if (variant.container !== 'ktx2' || variant.quality !== 'lossless') {
    throw new TypeError(`${path} R8 variant is not the lossless KTX2 baseline`)
  }
  const source = objectValue(variant.source, `${path} R8 source`)
  if (source.type !== 'bufferView') {
    throw new TypeError(`${path} uses an external page; lazy page residency is not available yet`)
  }
  const bytes = raster.view(nonnegativeInteger(source.bufferView, `${path} bufferView`))
  const container = readKtx2(bytes)
  const level = container.levels[0]
  if (
    container.vkFormat !== VK_FORMAT_R8_UNORM ||
    container.typeSize !== 1 ||
    container.pixelWidth !== width ||
    container.pixelHeight !== height ||
    container.pixelDepth !== 0 ||
    container.layerCount !== 0 ||
    container.faceCount !== 1 ||
    container.levelCount !== 1 ||
    container.supercompressionScheme !== KHR_SUPERCOMPRESSION_NONE ||
    level === undefined ||
    level.levelData.byteLength !== width * height ||
    level.uncompressedByteLength !== width * height
  ) {
    throw new TypeError(`${path} KTX2 payload does not match its declared R8 dimensions`)
  }
  const data = level.levelData.slice()
  const pageTexture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  )
  pageTexture.colorSpace = THREE.NoColorSpace
  pageTexture.flipY = true
  pageTexture.generateMipmaps = false
  pageTexture.minFilter = THREE.LinearFilter
  pageTexture.magFilter = THREE.LinearFilter
  pageTexture.needsUpdate = true
  return { width, height, texture: pageTexture }
}

function validateBitmapRecords(records: Uint8Array, pages: readonly BitmapPageResource[]): void {
  const view = new DataView(records.buffer, records.byteOffset, records.byteLength)
  for (let offset = 0; offset < records.byteLength; offset += RECORD_STRIDE) {
    const pageIndex = view.getUint16(offset + 16, true)
    const flags = view.getUint16(offset + 18, true)
    if (flags !== 0) throw new TypeError('bitmap record contains unsupported flags')
    if (pageIndex === ABSENT_PAGE) {
      if (records.subarray(offset, offset + 16).some((value) => value !== 0)) {
        throw new TypeError('absent bitmap record contains payload data')
      }
      continue
    }
    const page = pages[pageIndex]
    if (page === undefined) throw new TypeError('bitmap record references a missing page')
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
      throw new TypeError('bitmap record is outside its validated plane or atlas bounds')
    }
  }
}

function buildBitmapBatches(
  layout: ParagraphLayout,
  resource: BitmapResource,
  fontSlot: number,
  paint: GlyphPaint,
): BitmapDrawBatch {
  assertParallelLayout(layout, paint)
  const strike = selectBitmapStrike(resource.strikes, layout, fontSlot)
  const records = new DataView(
    strike.records.buffer,
    strike.records.byteOffset,
    strike.records.byteLength,
  )
  const group = new THREE.Group()
  const runs: BitmapBatchRun[] = []
  const materials = new Set<THREE.MeshBasicNodeMaterial>()
  let glyphCount = 0
  let pendingPage = -1
  let pendingGlyphs: number[] = []

  const finishRun = (): void => {
    if (pendingGlyphs.length === 0) return
    const page = strike.pages[pendingPage]
    if (page === undefined) throw new TypeError('bitmap batch references a missing page')
    const run = createBitmapRun(layout, strike, page, pendingGlyphs, paint)
    runs.push(run)
    materials.add(run.mesh.material as THREE.MeshBasicNodeMaterial)
    group.add(run.mesh)
    glyphCount += pendingGlyphs.length
    pendingGlyphs = []
  }

  for (let glyphIndex = 0; glyphIndex < layout.glyphIds.length; glyphIndex += 1) {
    if (layout.glyphFontSlots[glyphIndex] !== fontSlot) continue
    const glyphId = layout.glyphIds[glyphIndex]
    if (glyphId === undefined) continue
    if (glyphId >= strike.records.byteLength / RECORD_STRIDE) {
      throw new TypeError('paragraph layout references a bitmap glyph outside the registered font')
    }
    const pageIndex = records.getUint16(glyphId * RECORD_STRIDE + 16, true)
    if (pageIndex === ABSENT_PAGE) continue
    if (pendingPage !== pageIndex) {
      finishRun()
      pendingPage = pageIndex
    }
    pendingGlyphs.push(glyphIndex)
  }
  finishRun()

  let disposed = false
  return {
    object: group,
    glyphCount,
    drawCount: runs.length,
    strikePpem: strike.ppem,
    updatePaint(nextPaint) {
      if (disposed) throw new TypeError('bitmap draw batch has been disposed')
      assertParallelPaint(layout, nextPaint)
      for (const run of runs) updateRunPaint(run, nextPaint)
    },
    dispose() {
      if (disposed) return
      disposed = true
      group.clear()
      for (const run of runs) run.geometry.dispose()
      for (const material of materials) material.dispose()
    },
  }
}

function selectBitmapStrike(
  strikes: readonly BitmapStrikeResource[],
  layout: ParagraphLayout,
  fontSlot: number,
): BitmapStrikeResource {
  let maximumFontSize = 0
  for (let index = 0; index < layout.glyphFontSizes.length; index += 1) {
    if (layout.glyphFontSlots[index] === fontSlot) {
      maximumFontSize = Math.max(maximumFontSize, layout.glyphFontSizes[index] ?? 0)
    }
  }
  let selected = strikes[0]
  if (selected === undefined) throw new TypeError('bitmap resource has no strikes')
  for (const strike of strikes) {
    if (Math.abs(strike.ppem - maximumFontSize) < Math.abs(selected.ppem - maximumFontSize)) {
      selected = strike
    }
  }
  return selected
}

function createBitmapRun(
  layout: ParagraphLayout,
  strike: BitmapStrikeResource,
  page: BitmapPageResource,
  glyphIndices: readonly number[],
  paint: GlyphPaint,
): BitmapBatchRun {
  const count = glyphIndices.length
  const origins = new Float32Array(count * 2)
  const sizes = new Float32Array(count * 2)
  const uvOrigins = new Float32Array(count * 2)
  const uvSizes = new Float32Array(count * 2)
  const colors = new Float32Array(count * 4)
  const records = new DataView(
    strike.records.buffer,
    strike.records.byteOffset,
    strike.records.byteLength,
  )
  for (let instance = 0; instance < count; instance += 1) {
    const glyphIndex = glyphIndices[instance]!
    const glyphId = layout.glyphIds[glyphIndex]!
    const record = glyphId * RECORD_STRIDE
    const scale = layout.glyphFontSizes[glyphIndex]! / strike.planeUnitsPerEm
    const planeLeft = records.getInt16(record, true)
    const planeBottom = records.getInt16(record + 2, true)
    const planeRight = records.getInt16(record + 4, true)
    const planeTop = records.getInt16(record + 6, true)
    const atlasLeft = records.getUint16(record + 8, true)
    const atlasTop = records.getUint16(record + 10, true)
    const atlasRight = records.getUint16(record + 12, true)
    const atlasBottom = records.getUint16(record + 14, true)
    origins.set(
      [layout.x[glyphIndex]! + planeLeft * scale, -layout.y[glyphIndex]! + planeBottom * scale],
      instance * 2,
    )
    sizes.set([(planeRight - planeLeft) * scale, (planeTop - planeBottom) * scale], instance * 2)
    uvOrigins.set([atlasLeft / page.width, 1 - atlasBottom / page.height], instance * 2)
    uvSizes.set(
      [(atlasRight - atlasLeft) / page.width, (atlasBottom - atlasTop) / page.height],
      instance * 2,
    )
    colors.set(paintColor(paint, glyphIndex), instance * 4)
  }

  const geometry = unitQuadGeometry()
  geometry.instanceCount = count
  geometry.setAttribute('bitmapOrigin', new THREE.InstancedBufferAttribute(origins, 2))
  geometry.setAttribute('bitmapSize', new THREE.InstancedBufferAttribute(sizes, 2))
  geometry.setAttribute('bitmapUvOrigin', new THREE.InstancedBufferAttribute(uvOrigins, 2))
  geometry.setAttribute('bitmapUvSize', new THREE.InstancedBufferAttribute(uvSizes, 2))
  const colorAttribute = new THREE.InstancedBufferAttribute(colors, 4)
  geometry.setAttribute('bitmapColor', colorAttribute)
  const material = bitmapMaterial(page.texture)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = glyphIndices[0] ?? 0
  return { glyphIndices: Uint32Array.from(glyphIndices), colorAttribute, geometry, mesh }
}

function unitQuadGeometry(): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], 3),
  )
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2))
  geometry.setIndex([0, 1, 2, 2, 1, 3])
  return geometry
}

function bitmapMaterial(page: THREE.DataTexture): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    transparent: true,
  })
  const origin: Node<'vec2'> = attribute<'vec2'>('bitmapOrigin', 'vec2')
  const size: Node<'vec2'> = attribute<'vec2'>('bitmapSize', 'vec2')
  const uvOrigin: Node<'vec2'> = attribute<'vec2'>('bitmapUvOrigin', 'vec2')
  const uvSize: Node<'vec2'> = attribute<'vec2'>('bitmapUvSize', 'vec2')
  const color: Node<'vec4'> = attribute<'vec4'>('bitmapColor', 'vec4')
  const unitUv: Node<'vec2'> = uv()
  const positionX: Node<'float'> = add(origin.x, mul(positionLocal.x, size.x))
  const positionY: Node<'float'> = add(origin.y, mul(positionLocal.y, size.y))
  const atlasU: Node<'float'> = add(uvOrigin.x, mul(unitUv.x, uvSize.x))
  const atlasV: Node<'float'> = add(uvOrigin.y, mul(unitUv.y, uvSize.y))
  const sampled = texture(page, vec2(atlasU, atlasV))
  material.positionNode = vec3(positionX, positionY, 0)
  material.vertexNode = pixelSnappedClipPosition()
  material.colorNode = color.rgb
  material.opacityNode = mul(color.a, sampled.r)
  return material
}

function pixelSnappedClipPosition(): Node<'vec4'> {
  const clip: Node<'vec4'> = modelViewProjection
  const snappedX = snapClipAxis(clip.x, clip.w, screenSize.x)
  const snappedY = snapClipAxis(clip.y, clip.w, screenSize.y)
  return vec4(snappedX, snappedY, clip.z, clip.w)
}

function snapClipAxis(
  clipAxis: Node<'float'>,
  clipW: Node<'float'>,
  physicalSize: Node<'float'>,
): Node<'float'> {
  const normalizedDevicePosition: Node<'float'> = mul(clipAxis, reciprocal(clipW))
  const halfPhysicalSize: Node<'float'> = mul(physicalSize, 0.5)
  const physicalPosition: Node<'float'> = mul(add(normalizedDevicePosition, 1), halfPhysicalSize)
  const snappedPhysicalPosition: Node<'float'> = round(physicalPosition)
  const normalizedPhysicalPosition: Node<'float'> = mul(
    snappedPhysicalPosition,
    reciprocal(physicalSize),
  )
  const snappedNormalizedDevicePosition: Node<'float'> = sub(mul(normalizedPhysicalPosition, 2), 1)
  return mul(snappedNormalizedDevicePosition, clipW)
}

function updateRunPaint(run: BitmapBatchRun, paint: GlyphPaint): void {
  const values = run.colorAttribute.array as Float32Array
  for (let instance = 0; instance < run.glyphIndices.length; instance += 1) {
    values.set(paintColor(paint, run.glyphIndices[instance]!), instance * 4)
  }
  run.colorAttribute.needsUpdate = true
}

function paintColor(paint: GlyphPaint, glyphIndex: number): LinearRgba {
  const paintIndex = paint.paintIndices[glyphIndex]
  const resolved = paintIndex === undefined ? undefined : paint.palette[paintIndex]
  if (resolved === undefined) throw new TypeError('glyph paint references a missing palette entry')
  return resolved.color
}

function assertParallelLayout(layout: ParagraphLayout, paint: GlyphPaint): void {
  const glyphCount = layout.glyphIds.length
  for (const values of [layout.glyphFontSlots, layout.glyphFontSizes, layout.x, layout.y]) {
    if (values.length !== glyphCount) throw new TypeError('paragraph glyph arrays are not parallel')
  }
  assertParallelPaint(layout, paint)
}

function assertParallelPaint(layout: ParagraphLayout, paint: GlyphPaint): void {
  if (paint.paintIndices.length !== layout.glyphIds.length || paint.palette.length === 0) {
    throw new TypeError('glyph paint does not match the paragraph layout')
  }
}

function objectValue(
  value: JsonValue | undefined,
  path: string,
): Readonly<Record<string, JsonValue>> {
  if (typeof value !== 'object' || value === null || isJsonArray(value)) {
    throw new TypeError(`${path} must be an object`)
  }
  return value
}

function arrayValue(value: JsonValue | undefined, path: string): readonly JsonValue[] {
  if (!isJsonArray(value)) throw new TypeError(`${path} must be an array`)
  return value
}

function isJsonArray(value: JsonValue | undefined): value is readonly JsonValue[] {
  return Array.isArray(value)
}

function positiveInteger(value: JsonValue | undefined, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${path} must be a positive integer`)
  }
  return value
}

function nonnegativeInteger(value: JsonValue | undefined, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${path} must be a non-negative integer`)
  }
  return value
}
