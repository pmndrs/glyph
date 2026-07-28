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
  add,
  attribute,
  bool,
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
  resolvedGlyphColor,
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
import { slugDilate, slugRender, type SlugShaderPage } from '../internal/slug-shaders/index.js'
import type { ParagraphLayout } from '../layout.js'
import type { GlyphPaint } from '../paint.js'
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
  /** Exact uploaded bytes: RGBA16F curves + R32UI headers + R16UI references. */
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
  readonly colorAttribute: THREE.InstancedBufferAttribute
  readonly geometry: THREE.InstancedBufferGeometry
  readonly mesh: THREE.Mesh
}

export interface SlugDrawBatch {
  readonly object: THREE.Group
  readonly glyphCount: number
  readonly drawCount: number
  updatePaint(paint: GlyphPaint): void
  dispose(): void
}

const materialStateByCurveTexture = new WeakMap<THREE.DataTexture, SlugMaterialState>()

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

/** Fixed analytic Slug raster module for `defineFont(source, slug)`. */
export const slug: SlugModule = slugModule

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
  const referenceTexture = dataTexture(
    ownedUint16(referenceBytes),
    referenceWidth,
    referenceHeight,
    THREE.RedIntegerFormat,
    THREE.UnsignedShortType,
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
    referenceWidth,
    referenceHeight,
    referenceTexture,
    gpuBytes: checkedGpuBytes(
      checkedProduct(curveWidth, curveHeight, `${path} curve dimensions`) * 8,
      headerCapacity * 4 + referenceCapacity * 2,
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
): SlugDrawBatch {
  assertParallelRasterLayout(layout, paint)
  assertSlugPaint(paint)
  const records = recordView(resource)
  const group = new THREE.Group()
  group.name = 'pmndrs.text.slug'
  const runs: SlugBatchRun[] = []
  let pageIndex: number | undefined
  let glyphIndices: number[] = []

  const finishRun = (): void => {
    if (pageIndex === undefined || glyphIndices.length === 0) return
    const run = createSlugRun(layout, resource, pageIndex, glyphIndices, paint)
    runs.push(run)
    group.add(run.mesh)
    glyphIndices = []
  }

  for (let glyphIndex = 0; glyphIndex < layout.glyphIds.length; glyphIndex += 1) {
    if (layout.glyphFontSlots[glyphIndex] !== fontSlot) continue
    const glyphId = layout.glyphIds[glyphIndex]
    if (
      glyphId === undefined ||
      glyphId >= resource.records.byteLength / SLUG_GLYPH_RECORD_STRIDE
    ) {
      throw new TypeError('paragraph layout references a Slug glyph outside the registered font')
    }
    const nextPage = records.getUint16(glyphId * SLUG_GLYPH_RECORD_STRIDE + 8, true)
    if (nextPage === ABSENT_PAGE) continue
    if (resource.pages[nextPage] === undefined) {
      throw new TypeError('Slug batch references a missing page')
    }
    if (pageIndex !== undefined && pageIndex !== nextPage) finishRun()
    pageIndex = nextPage
    glyphIndices.push(glyphIndex)
  }
  finishRun()

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
      for (const run of runs) updateRunPaint(run, nextPaint)
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
): SlugBatchRun {
  const count = glyphIndices.length
  const geometry = unitRasterQuadGeometry()
  geometry.instanceCount = count
  const origin = new Float32Array(count * 2)
  const size = new Float32Array(count * 2)
  const emOrigin = new Float32Array(count * 2)
  const emSize = new Float32Array(count * 2)
  const inverseScale = new Float32Array(count)
  const bandTransform = new Float32Array(count * 4)
  const curveBase = new Uint32Array(count)
  const horizontalHeaderBase = new Uint32Array(count)
  const verticalHeaderBase = new Uint32Array(count)
  const referenceBase = new Uint32Array(count)
  const horizontalBandCount = new Uint16Array(count)
  const verticalBandCount = new Uint16Array(count)
  const colors = new Float32Array(count * 4)
  const records = recordView(resource)

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
    origin.set(
      [layout.x[glyphIndex]! + left * scale, -layout.y[glyphIndex]! + bottom * scale],
      instance * 2,
    )
    size.set([(right - left) * scale, (top - bottom) * scale], instance * 2)
    emOrigin.set([normalizedLeft, normalizedBottom], instance * 2)
    emSize.set([normalizedWidth, normalizedHeight], instance * 2)
    inverseScale[instance] = 1 / fontSize
    const bandScaleX = verticalBands / normalizedWidth
    const bandScaleY = horizontalBands / normalizedHeight
    bandTransform.set(
      [bandScaleX, bandScaleY, -normalizedLeft * bandScaleX, -normalizedBottom * bandScaleY],
      instance * 4,
    )
    curveBase[instance] = records.getUint32(record + 16, true)
    horizontalHeaderBase[instance] = records.getUint32(record + 24, true)
    verticalHeaderBase[instance] = records.getUint32(record + 28, true)
    referenceBase[instance] = records.getUint32(record + 32, true)
    horizontalBandCount[instance] = horizontalBands
    verticalBandCount[instance] = verticalBands
    colors.set(resolvedGlyphColor(paint, glyphIndex), instance * 4)
  }

  geometry.setAttribute('slugOrigin', new THREE.InstancedBufferAttribute(origin, 2))
  geometry.setAttribute('slugSize', new THREE.InstancedBufferAttribute(size, 2))
  geometry.setAttribute('slugEmOrigin', new THREE.InstancedBufferAttribute(emOrigin, 2))
  geometry.setAttribute('slugEmSize', new THREE.InstancedBufferAttribute(emSize, 2))
  geometry.setAttribute('slugInverseScale', new THREE.InstancedBufferAttribute(inverseScale, 1))
  geometry.setAttribute('slugBandTransform', new THREE.InstancedBufferAttribute(bandTransform, 4))
  setIntegerAttribute(geometry, 'slugCurveBase', curveBase)
  setIntegerAttribute(geometry, 'slugHorizontalHeaderBase', horizontalHeaderBase)
  setIntegerAttribute(geometry, 'slugVerticalHeaderBase', verticalHeaderBase)
  setIntegerAttribute(geometry, 'slugReferenceBase', referenceBase)
  setIntegerAttribute(geometry, 'slugHorizontalBandCount', horizontalBandCount)
  setIntegerAttribute(geometry, 'slugVerticalBandCount', verticalBandCount)
  const colorAttribute = new THREE.InstancedBufferAttribute(colors, 4)
  geometry.setAttribute('slugColor', colorAttribute)

  const page = resource.pages[pageIndex]!
  const state = slugMaterialState(page)
  const mesh = new THREE.Mesh(geometry, state.material)
  mesh.frustumCulled = false
  mesh.renderOrder = glyphIndices[0] ?? 0
  mesh.onBeforeRender = (renderer, _scene, camera): void => {
    renderer.getDrawingBufferSize(drawingBufferSize)
    state.viewport.value.copy(drawingBufferSize)
    updateMvpUniforms(state, mesh, camera)
  }
  return {
    glyphIndices: Uint32Array.from(glyphIndices),
    colorAttribute,
    geometry,
    mesh,
  }
}

function setIntegerAttribute(
  geometry: THREE.InstancedBufferGeometry,
  name: string,
  values: Uint16Array | Uint32Array,
): void {
  const value = new THREE.InstancedBufferAttribute(values, 1)
  value.gpuType = THREE.IntType
  geometry.setAttribute(name, value)
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

function updateRunPaint(run: SlugBatchRun, paint: GlyphPaint): void {
  const colors = run.colorAttribute.array as Float32Array
  for (let instance = 0; instance < run.glyphIndices.length; instance += 1) {
    colors.set(resolvedGlyphColor(paint, run.glyphIndices[instance]!), instance * 4)
  }
  run.colorAttribute.needsUpdate = true
}

function assertSlugPaint(paint: GlyphPaint): void {
  for (const entry of paint.palette) {
    if (entry.outline !== undefined || entry.shadow !== undefined) {
      throw new TypeError('Slug V0 supports fill paint only; outline and shadow are not supported')
    }
    if (
      entry.color.length !== 4 ||
      entry.color.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
    ) {
      throw new TypeError('Slug fill color must contain four finite linear values in [0, 1]')
    }
  }
}

function disposeSlugResource(resource: SlugResource): void {
  for (const page of resource.pages) disposeSlugPage(page)
}

function disposeSlugPage(page: SlugPageResource): void {
  const state = materialStateByCurveTexture.get(page.curveTexture)
  state?.material.dispose()
  materialStateByCurveTexture.delete(page.curveTexture)
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
