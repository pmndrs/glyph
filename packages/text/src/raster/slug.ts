import {
  KHR_DF_CHANNEL_RGBSDA_ALPHA,
  KHR_DF_CHANNEL_RGBSDA_BLUE,
  KHR_DF_CHANNEL_RGBSDA_GREEN,
  KHR_DF_CHANNEL_RGBSDA_RED,
  VK_FORMAT_R16G16B16A16_SFLOAT,
} from 'ktx-parse'
import * as THREE from 'three/webgpu'
import type { Node, UniformNode } from 'three/webgpu'
import {
  Fn,
  If,
  add,
  attribute,
  bool,
  float,
  mul,
  positionLocal,
  sub,
  uniform,
  varyingProperty,
  vec2,
  vec3,
} from 'three/tsl'

import type { RegisteredFont } from '../font.js'
import type { Sha256Hex } from '../identity.js'
import {
  assertParallelRasterLayout,
  assertParallelRasterPaint,
  unitRasterQuadGeometry,
} from '../internal/raster-batch.js'
import {
  jsonArray,
  jsonObject,
  nonnegativeSafeInteger,
  positiveSafeInteger,
} from '../internal/raster-atlas.js'
import { validateNativeKtx2 } from '../internal/raster-ktx.js'
import {
  SLUG_EXTENSION,
  SLUG_FORMAT_VERSION,
  SLUG_GLYPH_RECORD_STRIDE,
  SLUG_KIND,
  SLUG_PLANE_UNITS_PER_EM,
  slugDescriptor,
} from '../internal/slug-contract.js'
import {
  slugDilate,
  slugRender,
  slugStroke,
  type SlugShaderPage,
} from '../internal/slug-shaders/index.js'
import {
  boolAnd,
  floatAdd,
  floatDiv,
  floatGreaterThan,
  floatLessThan,
  floatMax,
  floatMul,
  floatSub,
  vec3Add,
  vec3DivFloat,
  vec3MulFloat,
  vec4FromVec3Float,
} from '../internal/slug-shaders/tsl-compat.js'
import type { ParagraphLayout } from '../layout.js'
import type { GlyphPaint, ResolvedPaint } from '../paint.js'
import {
  defineRaster,
  type JsonValue,
  type RasterModule,
  type RasterResourceSource,
  type RegisteredRaster,
} from '../raster.js'

export {
  SLUG_DEFAULT_BAND_COUNT,
  SLUG_EXTENSION,
  SLUG_FORMAT_VERSION,
  SLUG_GENERATOR_VERSION,
  SLUG_GLYPH_RECORD_STRIDE,
  SLUG_KIND,
  SLUG_PLANE_UNITS_PER_EM,
  slugDescriptor,
  slugDescriptorRasterKey,
  type SlugDescriptorV0,
} from '../internal/slug-contract.js'

const ABSENT_PAGE = 0xffff
const MAX_TEXTURE_DIMENSION = 16_384
const MAX_RUNTIME_GPU_BYTES = 256 * 1024 * 1024
const SLUG_MAX_OUTLINE_EM = 0.05
const SLUG_FLOAT_INSTANCE_STRIDE = 17
const SLUG_FLOAT_INSTANCE_OFFSETS = {
  origin: 0,
  size: 2,
  emOrigin: 4,
  emSize: 6,
  inverseScale: 8,
  bandTransform: 9,
  color: 13,
} as const
const SLUG_OUTLINE_INSTANCE_STRIDE = 5
const SLUG_OUTLINE_INSTANCE_OFFSETS = { color: 0, halfWidth: 4 } as const
const SLUG_UINT_INSTANCE_STRIDE = 6
const SLUG_UINT_INSTANCE_OFFSETS = {
  curveBase: 0,
  horizontalHeaderBase: 1,
  verticalHeaderBase: 2,
  referenceBase: 3,
  horizontalBandCount: 4,
  verticalBandCount: 5,
} as const
const drawingBufferSize = new THREE.Vector2()
const modelViewProjectionMatrix = new THREE.Matrix4()

interface SlugMaterialState {
  readonly material: THREE.MeshBasicNodeMaterial
  readonly viewport: UniformNode<'vec2', THREE.Vector2>
  readonly mvpRow0: UniformNode<'vec4', THREE.Vector4>
  readonly mvpRow1: UniformNode<'vec4', THREE.Vector4>
  readonly mvpRow3: UniformNode<'vec4', THREE.Vector4>
}

export interface SlugPageResource extends SlugShaderPage {
  readonly curveHeight: number
  readonly headerCount: number
  readonly headerHeight: number
  readonly referenceCount: number
  readonly referenceHeight: number
  /** Exact uploaded bytes: RGBA16F curves + R32UI headers + packed reference pairs in R32UI. */
  readonly gpuBytes: number
}

export interface SlugResource {
  readonly planeUnitsPerEm: number
  readonly records: Uint8Array
  readonly pages: readonly SlugPageResource[]
  readonly gpuBytes: number
}

interface SlugBatchRun {
  readonly glyphIndices: Uint32Array
  readonly floatData: THREE.InstancedInterleavedBuffer
  readonly colorAttribute: THREE.InterleavedBufferAttribute
  outlineData: THREE.InstancedInterleavedBuffer | undefined
  geometry: THREE.InstancedBufferGeometry
  readonly page: SlugPageResource
  readonly fillMesh: THREE.Mesh
  readonly outlineExperimentVariant: SlugOutlineExperimentVariant
  materialState: SlugMaterialState
}

export interface SlugDrawBatch {
  readonly object: THREE.Group
  readonly glyphCount: number
  readonly drawCount: number
  updatePaint(paint: GlyphPaint): void
  dispose(): void
}

const materialStateByCurveTexture = new WeakMap<THREE.DataTexture, SlugMaterialState>()
const outlinedMaterialStateByCurveTexture = new WeakMap<
  THREE.DataTexture,
  Map<SlugOutlineExperimentVariant, SlugMaterialState>
>()

const slugModule: RasterModule<typeof SLUG_KIND, SlugResource, SlugDrawBatch> = defineRaster({
  kind: SLUG_KIND,
  extension: SLUG_EXTENSION,
  version: SLUG_FORMAT_VERSION,
  runtimeBaker: () => import('../runtime-bakers/slug.js'),
  descriptor: slugDescriptor,
  async decode(font, raster, signal) {
    signal?.throwIfAborted()
    const resource = await decodeSlugResource(font, raster, signal)
    signal?.throwIfAborted()
    return resource
  },
  async prepare(_layout, _resource, _fontSlot, signal) {
    signal?.throwIfAborted()
  },
  buildBatches(layout, resource, fontSlot, paint) {
    return buildSlugBatches(layout, resource, fontSlot, paint)
  },
  validatePaint: assertSlugPaint,
  updatePaint(batch, paint) {
    batch.updatePaint(paint)
  },
  dispose(resource) {
    disposeSlugResource(resource)
  },
})

export type SlugModule = typeof slugModule

/** Temporary graph-build selector for the nonshipping Slug outline A/B. */
export type SlugOutlineExperimentVariant = 'multiply-zero' | 'zero-width-branch'

/** Fixed analytic Slug raster module for `defineFont(source, slug)`. */
export const slug: SlugModule = slugModule

/**
 * Create a Slug module with one outlined graph selected before pipeline construction.
 * The selector is deliberately not a uniform: the benchmark needs two independently
 * compiled graphs while preserving one draw and the ordinary per-instance paint contract.
 */
export function createSlugOutlineExperimentRaster(
  variant: SlugOutlineExperimentVariant,
): SlugModule {
  if (variant === 'multiply-zero') return slugModule
  if (variant !== 'zero-width-branch') {
    throw new TypeError(`Unknown Slug outline experiment variant: ${String(variant)}`)
  }
  return defineRaster({
    ...slugModule,
    buildBatches(layout, resource, fontSlot, paint) {
      return buildSlugBatches(layout, resource, fontSlot, paint, variant)
    },
  })
}

async function decodeSlugResource(
  font: RegisteredFont,
  raster: RegisteredRaster,
  signal?: AbortSignal,
): Promise<SlugResource> {
  if (
    raster.font !== font.handle ||
    raster.kind !== SLUG_KIND ||
    raster.extension !== SLUG_EXTENSION ||
    raster.version !== SLUG_FORMAT_VERSION
  ) {
    throw new TypeError('Slug raster is not bound to the supplied font')
  }
  const extension = jsonObject(raster.extensionData, 'Slug extension')
  if (
    extension.version !== SLUG_FORMAT_VERSION ||
    extension.rasterKey !== raster.rasterKey ||
    extension.shapingHash !== font.shapingHash ||
    extension.glyphCount !== font.glyphCount ||
    extension.glyphIdWidth !== 16 ||
    extension.planeUnitsPerEm !== SLUG_PLANE_UNITS_PER_EM ||
    extension.recordStride !== SLUG_GLYPH_RECORD_STRIDE
  ) {
    throw new TypeError('Slug extension does not match the fixed runtime contract')
  }
  const records = raster.view(
    nonnegativeSafeInteger(extension.recordBufferView, 'Slug recordBufferView'),
  )
  if (records.byteLength !== font.glyphCount * SLUG_GLYPH_RECORD_STRIDE) {
    throw new TypeError('Slug record table does not match the registered glyph count')
  }
  const pageValues = jsonArray(extension.pages, 'Slug pages')
  if (pageValues.length === 0 || pageValues.length > 65_535) {
    throw new TypeError('Slug raster must contain 1..=65535 pages')
  }

  const pages: SlugPageResource[] = []
  try {
    let gpuBytes = 0
    for (let pageIndex = 0; pageIndex < pageValues.length; pageIndex += 1) {
      const page = await decodeSlugPage(raster, pageValues[pageIndex]!, pageIndex, signal)
      pages.push(page)
      gpuBytes = checkedGpuBytes(gpuBytes, page.gpuBytes)
    }
    validateSlugRecordTable(records, pages, font.glyphCount)
    return {
      planeUnitsPerEm: SLUG_PLANE_UNITS_PER_EM,
      records,
      pages,
      gpuBytes,
    }
  } catch (error) {
    for (const page of pages) disposeSlugPage(page)
    throw error
  }
}

async function decodeSlugPage(
  raster: RegisteredRaster,
  value: JsonValue,
  pageIndex: number,
  signal?: AbortSignal,
): Promise<SlugPageResource> {
  const path = `Slug page ${pageIndex}`
  const page = jsonObject(value, path)
  const curve = jsonObject(page.curve, `${path} curve`)
  const curveWidth = textureDimension(curve.width, `${path} curve width`)
  const curveHeight = textureDimension(curve.height, `${path} curve height`)
  if (curve.mipLevelCount !== 1 || curve.colorSpace !== 'linear') {
    throw new TypeError(`${path} curve must be a single-level linear texture`)
  }
  const variants = jsonArray(curve.variants, `${path} curve variants`)
  if (variants.length !== 1) throw new TypeError(`${path} must contain one curve variant`)
  const variant = jsonObject(variants[0], `${path} curve variant`)
  if (
    variant.container !== 'ktx2' ||
    variant.gpuFormat !== 'rgba16float' ||
    variant.quality !== 'lossless' ||
    variant.requiredFeature !== undefined
  ) {
    throw new TypeError(`${path} curve does not match the lossless RGBA16F baseline`)
  }

  const curveBytes = await rasterResourceBytes(
    raster,
    variant.source,
    `${path} curve source`,
    signal,
  )
  const curveContainer = validateNativeKtx2(curveBytes, curveWidth, curveHeight, {
    vkFormat: VK_FORMAT_R16G16B16A16_SFLOAT,
    typeSize: 2,
    blockWidth: 1,
    blockHeight: 1,
    bytesPerBlock: 8,
    float16ChannelTypes: [
      KHR_DF_CHANNEL_RGBSDA_RED,
      KHR_DF_CHANNEL_RGBSDA_GREEN,
      KHR_DF_CHANNEL_RGBSDA_BLUE,
      KHR_DF_CHANNEL_RGBSDA_ALPHA,
    ],
  })
  const curveLevel = curveContainer.levels[0]
  if (curveLevel === undefined) throw new TypeError(`${path} curve has no base level`)

  const headerWidth = textureDimension(page.headerWidth, `${path} header width`)
  const headerHeight = textureDimension(page.headerHeight, `${path} header height`)
  const headerCapacity = checkedProduct(headerWidth, headerHeight, `${path} header dimensions`)
  const headerCount = boundedCount(page.headerCount, headerCapacity, `${path} header count`)
  const headerResource = jsonObject(page.headerResource, `${path} header resource`)
  const headerBytes = await rasterResourceBytes(
    raster,
    headerResource.source,
    `${path} header source`,
    signal,
  )
  assertGridLength(headerBytes, headerCapacity, 4, `${path} header`)

  const referenceWidth = textureDimension(page.referenceWidth, `${path} reference width`)
  const referenceHeight = textureDimension(page.referenceHeight, `${path} reference height`)
  const referenceCapacity = checkedProduct(
    referenceWidth,
    referenceHeight,
    `${path} reference dimensions`,
  )
  const referenceCount = boundedCount(
    page.referenceCount,
    referenceCapacity,
    `${path} reference count`,
  )
  const referenceResource = jsonObject(page.referenceResource, `${path} reference resource`)
  const referenceBytes = await rasterResourceBytes(
    raster,
    referenceResource.source,
    `${path} reference source`,
    signal,
  )
  assertGridLength(referenceBytes, referenceCapacity, 2, `${path} reference`)

  const curveTexture = dataTexture(
    ownedUint16(curveLevel.levelData),
    curveWidth,
    curveHeight,
    THREE.RGBAFormat,
    THREE.HalfFloatType,
  )
  const headerTexture = dataTexture(
    ownedUint32(headerBytes),
    headerWidth,
    headerHeight,
    THREE.RedIntegerFormat,
    THREE.UnsignedIntType,
  )
  const packedReferences = packReferencePairs(ownedUint16(referenceBytes), referenceWidth)
  const referenceTexture = dataTexture(
    packedReferences.data,
    packedReferences.width,
    packedReferences.height,
    THREE.RedIntegerFormat,
    THREE.UnsignedIntType,
  )
  return {
    curveWidth,
    curveHeight,
    curveTexture,
    headerCount,
    headerWidth,
    headerHeight,
    headerTexture,
    referenceCount,
    referenceWidth: packedReferences.width,
    referenceHeight: packedReferences.height,
    referenceTexture,
    gpuBytes: checkedGpuBytes(
      checkedProduct(curveWidth, curveHeight, `${path} curve dimensions`) * 8,
      headerCapacity * 4 + packedReferences.data.byteLength,
    ),
  }
}

async function rasterResourceBytes(
  raster: RegisteredRaster,
  value: JsonValue | undefined,
  path: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const source = jsonObject(value, path)
  let resource: RasterResourceSource
  if (source.type === 'bufferView') {
    resource = {
      type: 'bufferView',
      bufferView: nonnegativeSafeInteger(source.bufferView, `${path} bufferView`),
    }
  } else if (source.type === 'external') {
    resource = {
      type: 'external',
      uri: nonemptyString(source.uri, `${path} uri`),
      byteLength: positiveSafeInteger(source.byteLength, `${path} byteLength`),
      artifactHash: sha256Hex(source.artifactHash, `${path} artifactHash`),
    }
  } else {
    throw new TypeError(`${path} must be a bufferView or authenticated external resource`)
  }
  return raster.resource(resource, signal)
}

function nonemptyString(value: JsonValue | undefined, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${path} must be a nonempty string`)
  }
  return value
}

function sha256Hex(value: JsonValue | undefined, path: string): Sha256Hex {
  const text = nonemptyString(value, path)
  if (!/^[0-9a-f]{64}$/.test(text)) throw new TypeError(`${path} must be lowercase SHA-256`)
  return text as Sha256Hex
}

function dataTexture(
  data: Uint16Array | Uint32Array,
  width: number,
  height: number,
  format: THREE.PixelFormat,
  type: THREE.TextureDataType,
): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, width, height, format, type)
  texture.colorSpace = THREE.NoColorSpace
  texture.flipY = false
  texture.generateMipmaps = false
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.needsUpdate = true
  return texture
}

function packReferencePairs(
  references: Uint16Array,
  preferredWidth: number,
): { readonly data: Uint32Array; readonly width: number; readonly height: number } {
  const texelCount = Math.ceil(references.length / 2)
  const width = Math.min(preferredWidth, texelCount)
  const height = Math.ceil(texelCount / width)
  const data = new Uint32Array(width * height)
  for (let index = 0; index < references.length; index += 1) {
    data[index >>> 1] = data[index >>> 1]! | (references[index]! << ((index & 1) * 16))
  }
  return { data, width, height }
}

function validateSlugRecordTable(
  records: Uint8Array,
  pages: readonly SlugPageResource[],
  glyphCount: number,
): void {
  const view = new DataView(records.buffer, records.byteOffset, records.byteLength)
  for (let glyphId = 0; glyphId < glyphCount; glyphId += 1) {
    const offset = glyphId * SLUG_GLYPH_RECORD_STRIDE
    const pageIndex = view.getUint16(offset + 8, true)
    if (pageIndex === ABSENT_PAGE) {
      if (!absentRecordIsCanonical(records, offset)) {
        throw new TypeError(`Slug glyph ${glyphId} has non-canonical absent data`)
      }
      continue
    }
    const page = pages[pageIndex]
    if (page === undefined) throw new TypeError(`Slug glyph ${glyphId} references a missing page`)
    const planeLeft = view.getInt16(offset, true)
    const planeBottom = view.getInt16(offset + 2, true)
    const planeRight = view.getInt16(offset + 4, true)
    const planeTop = view.getInt16(offset + 6, true)
    const horizontalBandCount = view.getUint16(offset + 10, true)
    const verticalBandCount = view.getUint16(offset + 12, true)
    if (
      planeLeft >= planeRight ||
      planeBottom >= planeTop ||
      horizontalBandCount === 0 ||
      verticalBandCount === 0 ||
      view.getUint16(offset + 14, true) !== 0
    ) {
      throw new TypeError(`Slug glyph ${glyphId} has invalid bounds, bands, or flags`)
    }
    const curveBase = view.getUint32(offset + 16, true)
    const curveSpan = view.getUint32(offset + 20, true)
    const horizontalHeaderBase = view.getUint32(offset + 24, true)
    const verticalHeaderBase = view.getUint32(offset + 28, true)
    const referenceBase = view.getUint32(offset + 32, true)
    const referenceCount = view.getUint32(offset + 36, true)
    assertAddressRange(
      curveBase,
      curveSpan,
      page.curveWidth * page.curveHeight,
      `Slug glyph ${glyphId} curve`,
    )
    assertAddressRange(
      horizontalHeaderBase,
      horizontalBandCount,
      page.headerCount,
      `Slug glyph ${glyphId} horizontal headers`,
    )
    assertAddressRange(
      verticalHeaderBase,
      verticalBandCount,
      page.headerCount,
      `Slug glyph ${glyphId} vertical headers`,
    )
    assertAddressRange(
      referenceBase,
      referenceCount,
      page.referenceCount,
      `Slug glyph ${glyphId} references`,
    )
  }
}

function absentRecordIsCanonical(records: Uint8Array, offset: number): boolean {
  for (let byte = 0; byte < SLUG_GLYPH_RECORD_STRIDE; byte += 1) {
    if (byte === 8 || byte === 9) continue
    if (records[offset + byte] !== 0) return false
  }
  return true
}

function assertAddressRange(base: number, count: number, capacity: number, label: string): void {
  if (count === 0 || base > capacity - count) {
    throw new TypeError(`${label} range is empty or outside its page resource`)
  }
}

function buildSlugBatches(
  layout: ParagraphLayout,
  resource: SlugResource,
  fontSlot: number,
  paint: GlyphPaint,
  outlineExperimentVariant: SlugOutlineExperimentVariant = 'multiply-zero',
): SlugDrawBatch {
  assertParallelRasterLayout(layout, paint)
  assertSlugPaint(paint)
  assertSlugGlyphInputs(layout, resource, fontSlot, paint)
  const records = recordView(resource)
  const group = new THREE.Group()
  group.name = 'pmndrs.text.slug'
  const runs: SlugBatchRun[] = []
  let pageIndex: number | undefined
  let glyphIndices: number[] = []

  const finishRun = (): void => {
    if (pageIndex === undefined || glyphIndices.length === 0) return
    const run = createSlugRun(
      layout,
      resource,
      pageIndex,
      glyphIndices,
      paint,
      outlineExperimentVariant,
    )
    runs.push(run)
    group.add(run.fillMesh)
    glyphIndices = []
  }

  try {
    for (let glyphIndex = 0; glyphIndex < layout.glyphIds.length; glyphIndex += 1) {
      if (layout.glyphFontSlots[glyphIndex] !== fontSlot) continue
      const glyphId = layout.glyphIds[glyphIndex]!
      const nextPage = records.getUint16(glyphId * SLUG_GLYPH_RECORD_STRIDE + 8, true)
      if (nextPage === ABSENT_PAGE) continue
      if (pageIndex !== undefined && pageIndex !== nextPage) finishRun()
      pageIndex = nextPage
      glyphIndices.push(glyphIndex)
    }
    finishRun()
  } catch (error) {
    group.clear()
    for (const run of runs) run.geometry.dispose()
    throw error
  }

  let disposed = false
  const glyphCount = runs.reduce((count, run) => count + run.glyphIndices.length, 0)
  return {
    object: group,
    glyphCount,
    drawCount: runs.length,
    updatePaint(nextPaint) {
      if (disposed) throw new TypeError('Slug draw batch has been disposed')
      assertParallelRasterPaint(layout, nextPaint)
      assertSlugPaint(nextPaint)
      for (const run of runs) assertSlugRunPaint(layout, run.glyphIndices, nextPaint)
      for (const run of runs) updateRunPaint(run, layout, nextPaint)
    },
    dispose() {
      if (disposed) return
      disposed = true
      group.clear()
      for (const run of runs) run.geometry.dispose()
    },
  }
}

function createSlugRun(
  layout: ParagraphLayout,
  resource: SlugResource,
  pageIndex: number,
  glyphIndices: readonly number[],
  paint: GlyphPaint,
  outlineExperimentVariant: SlugOutlineExperimentVariant,
): SlugBatchRun {
  const geometry = unitRasterQuadGeometry()
  try {
    return populateSlugRun(
      geometry,
      layout,
      resource,
      pageIndex,
      glyphIndices,
      paint,
      outlineExperimentVariant,
    )
  } catch (error) {
    geometry.dispose()
    throw error
  }
}

function populateSlugRun(
  geometry: THREE.InstancedBufferGeometry,
  layout: ParagraphLayout,
  resource: SlugResource,
  pageIndex: number,
  glyphIndices: readonly number[],
  paint: GlyphPaint,
  outlineExperimentVariant: SlugOutlineExperimentVariant,
): SlugBatchRun {
  const count = glyphIndices.length
  geometry.instanceCount = count
  const floatData = new THREE.InstancedInterleavedBuffer(
    new Float32Array(count * SLUG_FLOAT_INSTANCE_STRIDE),
    SLUG_FLOAT_INSTANCE_STRIDE,
    1,
  )
  const uintData = new THREE.InstancedInterleavedBuffer(
    new Uint32Array(count * SLUG_UINT_INSTANCE_STRIDE),
    SLUG_UINT_INSTANCE_STRIDE,
    1,
  )
  const records = recordView(resource)
  let outlineData: THREE.InstancedInterleavedBuffer | undefined
  let outlineVisible = false

  for (let instance = 0; instance < count; instance += 1) {
    const glyphIndex = glyphIndices[instance]!
    const glyphId = layout.glyphIds[glyphIndex]!
    const record = glyphId * SLUG_GLYPH_RECORD_STRIDE
    const fontSize = layout.glyphFontSizes[glyphIndex]!
    if (!Number.isFinite(fontSize) || fontSize <= 0) {
      throw new TypeError('Slug glyph font sizes must be positive finite values')
    }
    const scale = fontSize / resource.planeUnitsPerEm
    const left = records.getInt16(record, true)
    const bottom = records.getInt16(record + 2, true)
    const right = records.getInt16(record + 4, true)
    const top = records.getInt16(record + 6, true)
    const horizontalBands = records.getUint16(record + 10, true)
    const verticalBands = records.getUint16(record + 12, true)
    const normalizedLeft = left / resource.planeUnitsPerEm
    const normalizedBottom = bottom / resource.planeUnitsPerEm
    const normalizedWidth = (right - left) / resource.planeUnitsPerEm
    const normalizedHeight = (top - bottom) / resource.planeUnitsPerEm
    setInstanceValues(floatData, instance, SLUG_FLOAT_INSTANCE_OFFSETS.origin, [
      layout.x[glyphIndex]! + left * scale,
      -layout.y[glyphIndex]! + bottom * scale,
    ])
    setInstanceValues(floatData, instance, SLUG_FLOAT_INSTANCE_OFFSETS.size, [
      (right - left) * scale,
      (top - bottom) * scale,
    ])
    setInstanceValues(floatData, instance, SLUG_FLOAT_INSTANCE_OFFSETS.emOrigin, [
      normalizedLeft,
      normalizedBottom,
    ])
    setInstanceValues(floatData, instance, SLUG_FLOAT_INSTANCE_OFFSETS.emSize, [
      normalizedWidth,
      normalizedHeight,
    ])
    setInstanceValues(floatData, instance, SLUG_FLOAT_INSTANCE_OFFSETS.inverseScale, [1 / fontSize])
    const bandScaleX = verticalBands / normalizedWidth
    const bandScaleY = horizontalBands / normalizedHeight
    setInstanceValues(floatData, instance, SLUG_FLOAT_INSTANCE_OFFSETS.bandTransform, [
      bandScaleX,
      bandScaleY,
      -normalizedLeft * bandScaleX,
      -normalizedBottom * bandScaleY,
    ])
    const resolvedPaint = resolvedSlugPaint(paint, glyphIndex)
    setInstanceValues(floatData, instance, SLUG_FLOAT_INSTANCE_OFFSETS.color, resolvedPaint.color)
    const outline = slugOutlineValues(fontSize, resolvedPaint)
    if (outline.visible && outlineData === undefined) {
      outlineData = createSlugOutlineData(geometry, count)
    }
    if (outlineData !== undefined) writeSlugOutlineInstance(outlineData, instance, outline)
    outlineVisible = outline.visible || outlineVisible
    setInstanceValues(uintData, instance, SLUG_UINT_INSTANCE_OFFSETS.curveBase, [
      records.getUint32(record + 16, true),
    ])
    setInstanceValues(uintData, instance, SLUG_UINT_INSTANCE_OFFSETS.horizontalHeaderBase, [
      records.getUint32(record + 24, true),
    ])
    setInstanceValues(uintData, instance, SLUG_UINT_INSTANCE_OFFSETS.verticalHeaderBase, [
      records.getUint32(record + 28, true),
    ])
    setInstanceValues(uintData, instance, SLUG_UINT_INSTANCE_OFFSETS.referenceBase, [
      records.getUint32(record + 32, true),
    ])
    setInstanceValues(uintData, instance, SLUG_UINT_INSTANCE_OFFSETS.horizontalBandCount, [
      horizontalBands,
    ])
    setInstanceValues(uintData, instance, SLUG_UINT_INSTANCE_OFFSETS.verticalBandCount, [
      verticalBands,
    ])
  }

  instanceAttribute(geometry, floatData, 'slugOrigin', 2, SLUG_FLOAT_INSTANCE_OFFSETS.origin)
  instanceAttribute(geometry, floatData, 'slugSize', 2, SLUG_FLOAT_INSTANCE_OFFSETS.size)
  instanceAttribute(geometry, floatData, 'slugEmOrigin', 2, SLUG_FLOAT_INSTANCE_OFFSETS.emOrigin)
  instanceAttribute(geometry, floatData, 'slugEmSize', 2, SLUG_FLOAT_INSTANCE_OFFSETS.emSize)
  instanceAttribute(
    geometry,
    floatData,
    'slugInverseScale',
    1,
    SLUG_FLOAT_INSTANCE_OFFSETS.inverseScale,
  )
  instanceAttribute(
    geometry,
    floatData,
    'slugBandTransform',
    4,
    SLUG_FLOAT_INSTANCE_OFFSETS.bandTransform,
  )
  instanceAttribute(geometry, uintData, 'slugCurveBase', 1, SLUG_UINT_INSTANCE_OFFSETS.curveBase)
  instanceAttribute(
    geometry,
    uintData,
    'slugHorizontalHeaderBase',
    1,
    SLUG_UINT_INSTANCE_OFFSETS.horizontalHeaderBase,
  )
  instanceAttribute(
    geometry,
    uintData,
    'slugVerticalHeaderBase',
    1,
    SLUG_UINT_INSTANCE_OFFSETS.verticalHeaderBase,
  )
  instanceAttribute(
    geometry,
    uintData,
    'slugReferenceBase',
    1,
    SLUG_UINT_INSTANCE_OFFSETS.referenceBase,
  )
  instanceAttribute(
    geometry,
    uintData,
    'slugHorizontalBandCount',
    1,
    SLUG_UINT_INSTANCE_OFFSETS.horizontalBandCount,
  )
  instanceAttribute(
    geometry,
    uintData,
    'slugVerticalBandCount',
    1,
    SLUG_UINT_INSTANCE_OFFSETS.verticalBandCount,
  )
  const colorAttribute = instanceAttribute(
    geometry,
    floatData,
    'slugColor',
    4,
    SLUG_FLOAT_INSTANCE_OFFSETS.color,
  )

  const page = resource.pages[pageIndex]!
  const initialState = outlineVisible
    ? slugOutlinedMaterialState(page, outlineExperimentVariant)
    : slugMaterialState(page)
  const fillMesh = new THREE.Mesh(geometry, initialState.material)
  fillMesh.frustumCulled = false
  fillMesh.renderOrder = glyphIndices[0] ?? 0
  const run: SlugBatchRun = {
    glyphIndices: Uint32Array.from(glyphIndices),
    floatData,
    colorAttribute,
    outlineData,
    geometry,
    page,
    fillMesh,
    outlineExperimentVariant,
    materialState: initialState,
  }
  fillMesh.onBeforeRender = (renderer, _scene, camera): void => {
    renderer.getDrawingBufferSize(drawingBufferSize)
    run.materialState.viewport.value.copy(drawingBufferSize)
    updateMvpUniforms(run.materialState, fillMesh, camera)
  }
  return run
}

function instanceAttribute(
  geometry: THREE.InstancedBufferGeometry,
  data: THREE.InstancedInterleavedBuffer,
  name: string,
  itemSize: number,
  offset: number,
): THREE.InterleavedBufferAttribute {
  const bufferAttribute = new THREE.InterleavedBufferAttribute(data, itemSize, offset, false)
  geometry.setAttribute(name, bufferAttribute)
  return bufferAttribute
}

function setInstanceValues(
  data: THREE.InstancedInterleavedBuffer,
  instance: number,
  offset: number,
  values: readonly number[],
): void {
  ;(data.array as Float32Array | Uint32Array).set(values, instance * data.stride + offset)
}

function resolvedSlugPaint(paint: GlyphPaint, glyphIndex: number): ResolvedPaint {
  const paintIndex = paint.paintIndices[glyphIndex]
  const resolved = paintIndex === undefined ? undefined : paint.palette[paintIndex]
  if (resolved === undefined) throw new TypeError('glyph paint references a missing palette entry')
  return resolved
}

function assertSlugGlyphInputs(
  layout: ParagraphLayout,
  resource: SlugResource,
  fontSlot: number,
  paint: GlyphPaint,
): void {
  const records = recordView(resource)
  const recordCount = resource.records.byteLength / SLUG_GLYPH_RECORD_STRIDE
  const glyphIndices: number[] = []
  for (let glyphIndex = 0; glyphIndex < layout.glyphIds.length; glyphIndex += 1) {
    if (layout.glyphFontSlots[glyphIndex] !== fontSlot) continue
    const glyphId = layout.glyphIds[glyphIndex]
    if (glyphId === undefined || glyphId >= recordCount) {
      throw new TypeError('paragraph layout references a Slug glyph outside the registered font')
    }
    const pageIndex = records.getUint16(glyphId * SLUG_GLYPH_RECORD_STRIDE + 8, true)
    if (pageIndex !== ABSENT_PAGE && resource.pages[pageIndex] === undefined) {
      throw new TypeError('Slug batch references a missing page')
    }
    glyphIndices.push(glyphIndex)
  }
  assertSlugRunPaint(layout, glyphIndices, paint)
}

function assertSlugRunPaint(
  layout: ParagraphLayout,
  glyphIndices: ArrayLike<number>,
  paint: GlyphPaint,
): void {
  for (let instance = 0; instance < glyphIndices.length; instance += 1) {
    const glyphIndex = glyphIndices[instance]!
    const fontSize = layout.glyphFontSizes[glyphIndex]!
    if (!Number.isFinite(fontSize) || fontSize <= 0) {
      throw new TypeError('Slug glyph font sizes must be positive finite values')
    }
    slugOutlineValues(fontSize, resolvedSlugPaint(paint, glyphIndex))
  }
}

interface SlugOutlineValues {
  readonly color: readonly number[]
  readonly halfWidth: number
  readonly visible: boolean
}

function slugOutlineValues(fontSize: number, paint: ResolvedPaint): SlugOutlineValues {
  const outlineWidth = paint.outline?.width ?? 0
  const halfWidth = outlineWidth / fontSize
  if (halfWidth > SLUG_MAX_OUTLINE_EM) {
    throw new RangeError(`Slug outline width exceeds ${SLUG_MAX_OUTLINE_EM} em`)
  }
  const visible = outlineWidth > 0 && (paint.outline?.color[3] ?? 0) > 0
  return {
    color: visible && paint.outline !== undefined ? paint.outline.color : [0, 0, 0, 0],
    halfWidth,
    visible,
  }
}

function createSlugOutlineData(
  geometry: THREE.InstancedBufferGeometry,
  instanceCount: number,
): THREE.InstancedInterleavedBuffer {
  const data = new THREE.InstancedInterleavedBuffer(
    new Float32Array(instanceCount * SLUG_OUTLINE_INSTANCE_STRIDE),
    SLUG_OUTLINE_INSTANCE_STRIDE,
    1,
  )
  instanceAttribute(geometry, data, 'slugOutlineColor', 4, SLUG_OUTLINE_INSTANCE_OFFSETS.color)
  instanceAttribute(
    geometry,
    data,
    'slugOutlineHalfWidth',
    1,
    SLUG_OUTLINE_INSTANCE_OFFSETS.halfWidth,
  )
  return data
}

function restoreSlugFillOnlyGeometry(run: SlugBatchRun): void {
  const previous = run.geometry
  const geometry = unitRasterQuadGeometry()
  geometry.instanceCount = previous.instanceCount
  for (const [name, geometryAttribute] of Object.entries(previous.attributes)) {
    if (
      name !== 'position' &&
      name !== 'uv' &&
      name !== 'slugOutlineColor' &&
      name !== 'slugOutlineHalfWidth'
    ) {
      geometry.setAttribute(name, geometryAttribute)
    }
  }

  // Three.js releases attribute buffers only when their owning geometry is disposed. Dispose
  // while the mesh still points at the outlined geometry, then publish the fill-only replacement.
  previous.dispose()
  run.fillMesh.geometry = geometry
  run.geometry = geometry
  run.outlineData = undefined
}

function writeSlugOutlineInstance(
  data: THREE.InstancedInterleavedBuffer,
  instance: number,
  outline: SlugOutlineValues,
): void {
  setInstanceValues(data, instance, SLUG_OUTLINE_INSTANCE_OFFSETS.color, outline.color)
  setInstanceValues(data, instance, SLUG_OUTLINE_INSTANCE_OFFSETS.halfWidth, [outline.halfWidth])
}

function slugMaterialState(page: SlugPageResource): SlugMaterialState {
  const existing = materialStateByCurveTexture.get(page.curveTexture)
  if (existing !== undefined) return existing
  const material = new THREE.MeshBasicNodeMaterial({
    blending: THREE.NormalBlending,
    depthTest: false,
    depthWrite: false,
    side: THREE.FrontSide,
    transparent: true,
  })
  const viewport: UniformNode<'vec2', THREE.Vector2> = uniform(new THREE.Vector2(1, 1))
  const mvpRow0: UniformNode<'vec4', THREE.Vector4> = uniform(new THREE.Vector4(1, 0, 0, 0))
  const mvpRow1: UniformNode<'vec4', THREE.Vector4> = uniform(new THREE.Vector4(0, 1, 0, 0))
  const mvpRow3: UniformNode<'vec4', THREE.Vector4> = uniform(new THREE.Vector4(0, 0, 0, 1))
  const renderCoordinate = varyingProperty('vec2', 'slugRenderCoordinate')
  const origin: Node<'vec2'> = attribute<'vec2'>('slugOrigin', 'vec2')
  const size: Node<'vec2'> = attribute<'vec2'>('slugSize', 'vec2')
  const emOrigin: Node<'vec2'> = attribute<'vec2'>('slugEmOrigin', 'vec2')
  const emSize: Node<'vec2'> = attribute<'vec2'>('slugEmSize', 'vec2')
  const inverseScale: Node<'float'> = attribute<'float'>('slugInverseScale', 'float')
  const bandTransform: Node<'vec4'> = attribute<'vec4'>('slugBandTransform', 'vec4')
  const curveBaseTexel: Node<'uint'> = attribute<'uint'>('slugCurveBase', 'uint')
  const horizontalHeaderBase: Node<'uint'> = attribute<'uint'>('slugHorizontalHeaderBase', 'uint')
  const verticalHeaderBase: Node<'uint'> = attribute<'uint'>('slugVerticalHeaderBase', 'uint')
  const referenceBase: Node<'uint'> = attribute<'uint'>('slugReferenceBase', 'uint')
  const horizontalBandCount: Node<'uint'> = attribute<'uint'>('slugHorizontalBandCount', 'uint')
  const verticalBandCount: Node<'uint'> = attribute<'uint'>('slugVerticalBandCount', 'uint')
  const color: Node<'vec4'> = attribute<'vec4'>('slugColor', 'vec4')

  material.positionNode = Fn(() => {
    const localPosition = vec2(
      add(origin.x, mul(positionLocal.x, size.x)),
      add(origin.y, mul(positionLocal.y, size.y)),
    )
    const outwardNormal = vec2(
      mul(sub(positionLocal.x, 0.5), size.x),
      mul(sub(positionLocal.y, 0.5), size.y),
    )
    const emCoordinate = vec2(
      add(emOrigin.x, mul(positionLocal.x, emSize.x)),
      add(emOrigin.y, mul(positionLocal.y, emSize.y)),
    )
    const dilated = slugDilate(
      localPosition,
      outwardNormal,
      emCoordinate,
      inverseScale,
      mvpRow0,
      mvpRow1,
      mvpRow3,
      viewport,
    )
    renderCoordinate.assign(dilated.textureCoordinate)
    return vec3(dilated.position.x, dilated.position.y, 0)
  })()
  material.colorNode = color.rgb
  material.opacityNode = Fn(() => {
    const coverage = slugRender(
      page,
      {
        curveBaseTexel,
        horizontalHeaderBase,
        verticalHeaderBase,
        referenceBase,
        horizontalBandCount,
        verticalBandCount,
        bandTransform,
      },
      renderCoordinate,
      { evenOdd: bool(false), weightBoost: bool(false) },
    )
    return mul(color.a, coverage)
  })()

  const state = { material, viewport, mvpRow0, mvpRow1, mvpRow3 }
  materialStateByCurveTexture.set(page.curveTexture, state)
  return state
}

/** Copied analytic stroke, composed with fill in one specialized draw. */
function slugOutlinedMaterialState(
  page: SlugPageResource,
  variant: SlugOutlineExperimentVariant,
): SlugMaterialState {
  const existing = outlinedMaterialStateByCurveTexture.get(page.curveTexture)?.get(variant)
  if (existing !== undefined) return existing
  const material = new THREE.MeshBasicNodeMaterial({
    blending: THREE.NormalBlending,
    depthTest: false,
    depthWrite: false,
    side: THREE.FrontSide,
    transparent: true,
  })
  const viewport: UniformNode<'vec2', THREE.Vector2> = uniform(new THREE.Vector2(1, 1))
  const mvpRow0: UniformNode<'vec4', THREE.Vector4> = uniform(new THREE.Vector4(1, 0, 0, 0))
  const mvpRow1: UniformNode<'vec4', THREE.Vector4> = uniform(new THREE.Vector4(0, 1, 0, 0))
  const mvpRow3: UniformNode<'vec4', THREE.Vector4> = uniform(new THREE.Vector4(0, 0, 0, 1))
  const renderCoordinate = varyingProperty('vec2', 'slugStrokeRenderCoordinate')
  const origin: Node<'vec2'> = attribute<'vec2'>('slugOrigin', 'vec2')
  const size: Node<'vec2'> = attribute<'vec2'>('slugSize', 'vec2')
  const emOrigin: Node<'vec2'> = attribute<'vec2'>('slugEmOrigin', 'vec2')
  const emSize: Node<'vec2'> = attribute<'vec2'>('slugEmSize', 'vec2')
  const inverseScale: Node<'float'> = attribute<'float'>('slugInverseScale', 'float')
  const bandTransform: Node<'vec4'> = attribute<'vec4'>('slugBandTransform', 'vec4')
  const curveBaseTexel: Node<'uint'> = attribute<'uint'>('slugCurveBase', 'uint')
  const horizontalHeaderBase: Node<'uint'> = attribute<'uint'>('slugHorizontalHeaderBase', 'uint')
  const verticalHeaderBase: Node<'uint'> = attribute<'uint'>('slugVerticalHeaderBase', 'uint')
  const referenceBase: Node<'uint'> = attribute<'uint'>('slugReferenceBase', 'uint')
  const horizontalBandCount: Node<'uint'> = attribute<'uint'>('slugHorizontalBandCount', 'uint')
  const verticalBandCount: Node<'uint'> = attribute<'uint'>('slugVerticalBandCount', 'uint')
  const color: Node<'vec4'> = attribute<'vec4'>('slugColor', 'vec4')
  const outlineColor: Node<'vec4'> = attribute<'vec4'>('slugOutlineColor', 'vec4')
  const outlineHalfWidth: Node<'float'> = attribute<'float'>('slugOutlineHalfWidth', 'float')

  material.positionNode = Fn(() => {
    const directionX = sub(mul(positionLocal.x, 2), 1)
    const directionY = sub(mul(positionLocal.y, 2), 1)
    const objectHalfWidth = floatDiv(outlineHalfWidth, inverseScale)
    const localPosition = vec2(
      add(add(origin.x, mul(positionLocal.x, size.x)), mul(directionX, objectHalfWidth)),
      add(add(origin.y, mul(positionLocal.y, size.y)), mul(directionY, objectHalfWidth)),
    )
    const emCoordinate = vec2(
      add(add(emOrigin.x, mul(positionLocal.x, emSize.x)), mul(directionX, outlineHalfWidth)),
      add(add(emOrigin.y, mul(positionLocal.y, emSize.y)), mul(directionY, outlineHalfWidth)),
    )
    const expandedWidth = add(size.x, mul(objectHalfWidth, 2))
    const expandedHeight = add(size.y, mul(objectHalfWidth, 2))
    const outwardNormal = vec2(
      mul(sub(positionLocal.x, 0.5), expandedWidth),
      mul(sub(positionLocal.y, 0.5), expandedHeight),
    )
    const dilated = slugDilate(
      localPosition,
      outwardNormal,
      emCoordinate,
      inverseScale,
      mvpRow0,
      mvpRow1,
      mvpRow3,
      viewport,
    )
    renderCoordinate.assign(dilated.textureCoordinate)
    return vec3(dilated.position.x, dilated.position.y, 0)
  })()
  const composedColor = Fn(() => {
    const glyph = {
      curveBaseTexel,
      horizontalHeaderBase,
      verticalHeaderBase,
      referenceBase,
      horizontalBandCount,
      verticalBandCount,
      bandTransform,
    }
    const fillCoverage = slugRender(page, glyph, renderCoordinate, {
      evenOdd: bool(false),
      weightBoost: bool(false),
    })
    const fillAlpha = floatMul(color.a, fillCoverage).toVar('slugOutlinedFillAlpha')
    const outlineAlpha = floatMul(outlineColor.a, float(0)).toVar('slugOutlinedOutlineAlpha')
    const evaluateStroke = (): void => {
      const strokeCoverage = slugStroke(page, glyph, renderCoordinate, outlineHalfWidth)
      outlineAlpha.assign(floatMul(outlineColor.a, strokeCoverage))
    }
    const fillNeedsStroke = floatLessThan(fillAlpha, float(1))
    const strokeCondition =
      variant === 'multiply-zero'
        ? fillNeedsStroke
        : boolAnd(
            fillNeedsStroke,
            boolAnd(
              floatGreaterThan(outlineHalfWidth, float(0)),
              floatGreaterThan(outlineColor.a, float(0)),
            ),
          )
    If(strokeCondition, evaluateStroke)
    const outlineContribution = floatMul(outlineAlpha, floatSub(float(1), fillAlpha)).toVar(
      'slugOutlinedContribution',
    )
    const alpha = floatAdd(fillAlpha, outlineContribution).toVar('slugOutlinedAlpha')
    const premultipliedColor = vec3Add(
      vec3MulFloat(color.rgb, fillAlpha),
      vec3MulFloat(outlineColor.rgb, outlineContribution),
    )
    return vec4FromVec3Float(
      vec3DivFloat(premultipliedColor, floatMax(alpha, float(1 / 65_536))),
      alpha,
    )
  })()
  material.colorNode = composedColor.rgb
  material.opacityNode = composedColor.a

  const state = { material, viewport, mvpRow0, mvpRow1, mvpRow3 }
  const variants = outlinedMaterialStateByCurveTexture.get(page.curveTexture) ?? new Map()
  variants.set(variant, state)
  outlinedMaterialStateByCurveTexture.set(page.curveTexture, variants)
  return state
}

function updateMvpUniforms(
  state: SlugMaterialState,
  object: THREE.Object3D,
  camera: THREE.Camera,
): void {
  modelViewProjectionMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  modelViewProjectionMatrix.multiply(object.matrixWorld)
  const values = modelViewProjectionMatrix.elements
  state.mvpRow0.value.set(values[0]!, values[4]!, values[8]!, values[12]!)
  state.mvpRow1.value.set(values[1]!, values[5]!, values[9]!, values[13]!)
  state.mvpRow3.value.set(values[3]!, values[7]!, values[11]!, values[15]!)
}

function updateRunPaint(run: SlugBatchRun, layout: ParagraphLayout, paint: GlyphPaint): void {
  let outlineVisible = false
  for (let instance = 0; instance < run.glyphIndices.length; instance += 1) {
    const glyphIndex = run.glyphIndices[instance]!
    const resolvedPaint = resolvedSlugPaint(paint, glyphIndex)
    setInstanceValues(
      run.floatData,
      instance,
      SLUG_FLOAT_INSTANCE_OFFSETS.color,
      resolvedPaint.color,
    )
    const outline = slugOutlineValues(layout.glyphFontSizes[glyphIndex]!, resolvedPaint)
    if (outline.visible && run.outlineData === undefined) {
      run.outlineData = createSlugOutlineData(run.geometry, run.glyphIndices.length)
    }
    if (run.outlineData !== undefined) {
      writeSlugOutlineInstance(run.outlineData, instance, outline)
    }
    outlineVisible = outline.visible || outlineVisible
  }
  run.floatData.needsUpdate = true
  if (run.outlineData !== undefined) run.outlineData.needsUpdate = true
  if (outlineVisible) {
    run.materialState = slugOutlinedMaterialState(run.page, run.outlineExperimentVariant)
    run.fillMesh.material = run.materialState.material
  } else {
    if (run.outlineData !== undefined) restoreSlugFillOnlyGeometry(run)
    run.materialState = slugMaterialState(run.page)
    run.fillMesh.material = run.materialState.material
  }
}

function assertSlugPaint(paint: GlyphPaint): void {
  for (const entry of paint.palette) {
    assertSlugColor(entry.color, 'Slug fill')
    if (entry.outline !== undefined) {
      assertSlugColor(entry.outline.color, 'Slug outline')
      if (!Number.isFinite(entry.outline.width) || entry.outline.width < 0) {
        throw new TypeError('Slug outline width must be a non-negative finite value')
      }
    }
    if (entry.shadow !== undefined) {
      throw new TypeError('Slug V0 does not support shadow paint')
    }
  }
}

function assertSlugColor(color: readonly number[], label: string): void {
  if (
    color.length !== 4 ||
    color.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
  ) {
    throw new TypeError(`${label} color must contain four finite linear values in [0, 1]`)
  }
}

function disposeSlugResource(resource: SlugResource): void {
  for (const page of resource.pages) disposeSlugPage(page)
}

function disposeSlugPage(page: SlugPageResource): void {
  const state = materialStateByCurveTexture.get(page.curveTexture)
  state?.material.dispose()
  const outlinedStates = outlinedMaterialStateByCurveTexture.get(page.curveTexture)
  if (outlinedStates !== undefined) {
    for (const outlinedState of outlinedStates.values()) outlinedState.material.dispose()
  }
  materialStateByCurveTexture.delete(page.curveTexture)
  outlinedMaterialStateByCurveTexture.delete(page.curveTexture)
  page.curveTexture.dispose()
  page.headerTexture.dispose()
  page.referenceTexture.dispose()
}

function recordView(resource: SlugResource): DataView {
  return new DataView(
    resource.records.buffer,
    resource.records.byteOffset,
    resource.records.byteLength,
  )
}

function textureDimension(value: JsonValue | undefined, path: string): number {
  const dimension = positiveSafeInteger(value, path)
  if (dimension > MAX_TEXTURE_DIMENSION) throw new RangeError(`${path} exceeds 16384`)
  return dimension
}

function boundedCount(value: JsonValue | undefined, capacity: number, path: string): number {
  const count = nonnegativeSafeInteger(value, path)
  if (count > capacity) throw new RangeError(`${path} exceeds its texture capacity`)
  return count
}

function assertGridLength(
  bytes: Uint8Array,
  texels: number,
  bytesPerTexel: number,
  path: string,
): void {
  if (bytes.byteLength !== checkedProduct(texels, bytesPerTexel, path)) {
    throw new TypeError(`${path} byte length does not match its dimensions`)
  }
}

function checkedProduct(left: number, right: number, path: string): number {
  const product = left * right
  if (!Number.isSafeInteger(product)) throw new RangeError(`${path} exceeds safe integer range`)
  return product
}

function checkedGpuBytes(left: number, right: number): number {
  const total = left + right
  if (!Number.isSafeInteger(total) || total > MAX_RUNTIME_GPU_BYTES) {
    throw new RangeError('Slug pages exceed the runtime GPU-memory limit')
  }
  return total
}

function ownedUint16(bytes: Uint8Array): Uint16Array {
  const copy = bytes.slice()
  return new Uint16Array(copy.buffer, copy.byteOffset, copy.byteLength / 2)
}

function ownedUint32(bytes: Uint8Array): Uint32Array {
  const copy = bytes.slice()
  return new Uint32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4)
}
