import { KHR_DF_CHANNEL_RGBSDA_RED, VK_FORMAT_R8_UNORM } from 'ktx-parse'
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
import type { GlyphPaint } from '../paint.js'
import {
  assertParallelRasterLayout,
  assertParallelRasterPaint,
  resolvedGlyphColor,
  unitRasterQuadGeometry,
} from '../internal/raster-batch.js'
import {
  ABSENT_GLYPH_PAGE,
  DENSE_GLYPH_RECORD_STRIDE,
  decodeEmbeddedLosslessAtlasPage,
  jsonArray,
  jsonObject,
  nonnegativeSafeInteger,
  positiveSafeInteger,
  validateDenseGlyphRecords,
} from '../internal/raster-atlas.js'
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
  readonly originAttribute: THREE.InstancedBufferAttribute
  targetOrigins?: Float32Array
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

declare const bitmapGlyphPositionSnapshotBrand: unique symbol

/** Copied bitmap glyph identities and displayed origins. It retains no renderer resources. */
export interface BitmapGlyphPositionSnapshot {
  readonly glyphCount: number
  readonly [bitmapGlyphPositionSnapshotBrand]: true
}

/** Presentation-only motion toward one authoritative bitmap layout. */
export interface BitmapGlyphPositionTransition {
  readonly matchedGlyphs: number
  readonly targetGlyphs: number
  readonly progress: number
  setProgress(progress: number): void
  finish(): void
  dispose(): void
}

interface PresentableBitmapBatch {
  readonly layout: ParagraphLayout
  readonly runs: readonly BitmapBatchRun[]
  revision: number
  disposed: boolean
}

interface BitmapGlyphPositionSnapshotData {
  readonly fontHandles: Uint32Array
  readonly glyphIds: Uint16Array
  readonly clusters: Uint32Array
  readonly fontSizeBits: Uint32Array
  readonly occurrences: Uint32Array
  readonly origins: Float32Array
}

const RECORD_STRIDE = DENSE_GLYPH_RECORD_STRIDE
const ABSENT_PAGE = ABSENT_GLYPH_PAGE
const materialByPageTexture = new WeakMap<THREE.DataTexture, THREE.MeshBasicNodeMaterial>()
const presentableBatchByObject = new WeakMap<THREE.Object3D, PresentableBitmapBatch>()
const snapshotDataByToken = new WeakMap<
  BitmapGlyphPositionSnapshot,
  BitmapGlyphPositionSnapshotData
>()

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
  validatePaint: assertBitmapPaint,
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

export function captureBitmapGlyphPositions(object: THREE.Object3D): BitmapGlyphPositionSnapshot {
  const batch = presentableBitmapBatch(object)
  const identities = bitmapGlyphIdentities(batch.layout)
  const glyphCount = batch.runs.reduce((count, run) => count + run.glyphIndices.length, 0)
  const fontHandles = new Uint32Array(glyphCount)
  const glyphIds = new Uint16Array(glyphCount)
  const clusters = new Uint32Array(glyphCount)
  const fontSizeBits = new Uint32Array(glyphCount)
  const occurrences = new Uint32Array(glyphCount)
  const origins = new Float32Array(glyphCount * 2)
  let outputIndex = 0
  for (const run of batch.runs) {
    const displayedOrigins = run.originAttribute.array as Float32Array
    for (let instance = 0; instance < run.glyphIndices.length; instance += 1) {
      const glyphIndex = run.glyphIndices[instance]!
      fontHandles[outputIndex] = identities.fontHandles[glyphIndex]!
      glyphIds[outputIndex] = batch.layout.glyphIds[glyphIndex]!
      clusters[outputIndex] = batch.layout.clusters[glyphIndex]!
      fontSizeBits[outputIndex] = identities.fontSizeBits[glyphIndex]!
      occurrences[outputIndex] = identities.occurrences[glyphIndex]!
      origins[outputIndex * 2] = displayedOrigins[instance * 2]!
      origins[outputIndex * 2 + 1] = displayedOrigins[instance * 2 + 1]!
      outputIndex += 1
    }
  }
  const snapshot = Object.freeze({ glyphCount }) as BitmapGlyphPositionSnapshot
  snapshotDataByToken.set(snapshot, {
    fontHandles,
    glyphIds,
    clusters,
    fontSizeBits,
    occurrences,
    origins,
  })
  return snapshot
}

export function createBitmapGlyphPositionTransition(
  object: THREE.Object3D,
  from: BitmapGlyphPositionSnapshot,
): BitmapGlyphPositionTransition {
  const batch = presentableBitmapBatch(object)
  const source = snapshotDataByToken.get(from)
  if (source === undefined) throw new TypeError('invalid bitmap glyph-position snapshot')
  const sourceOrigins = bitmapOriginMap(source)
  const identities = bitmapGlyphIdentities(batch.layout)
  const fromOriginsByRun: Float32Array[] = []
  const targetOriginsByRun: Float32Array[] = []
  let matchedGlyphs = 0
  let targetGlyphs = 0
  for (const run of batch.runs) {
    const displayedOrigins = run.originAttribute.array as Float32Array
    const targetOrigins = run.targetOrigins ?? displayedOrigins.slice()
    run.targetOrigins = targetOrigins
    const fromOrigins = targetOrigins.slice()
    for (let instance = 0; instance < run.glyphIndices.length; instance += 1) {
      const glyphIndex = run.glyphIndices[instance]!
      const key = bitmapGlyphIdentityKey(
        identities.fontHandles[glyphIndex]!,
        batch.layout.glyphIds[glyphIndex]!,
        batch.layout.clusters[glyphIndex]!,
        identities.fontSizeBits[glyphIndex]!,
        identities.occurrences[glyphIndex]!,
      )
      const sourceOrigin = sourceOrigins.get(key)
      if (sourceOrigin !== undefined) {
        fromOrigins[instance * 2] = sourceOrigin[0]
        fromOrigins[instance * 2 + 1] = sourceOrigin[1]
        matchedGlyphs += 1
      }
      targetGlyphs += 1
    }
    fromOriginsByRun.push(fromOrigins)
    targetOriginsByRun.push(targetOrigins)
  }

  batch.revision += 1
  const revision = batch.revision
  let progress = 1
  let disposed = false
  const setProgress = (nextProgress: number): void => {
    if (!Number.isFinite(nextProgress) || nextProgress < 0 || nextProgress > 1) {
      throw new RangeError('bitmap glyph-position transition progress must be in [0, 1]')
    }
    if (disposed || batch.disposed || batch.revision !== revision) {
      throw new DOMException('The bitmap glyph-position transition is stale', 'AbortError')
    }
    for (let runIndex = 0; runIndex < batch.runs.length; runIndex += 1) {
      const run = batch.runs[runIndex]!
      const fromOrigins = fromOriginsByRun[runIndex]!
      const targetOrigins = targetOriginsByRun[runIndex]!
      const displayedOrigins = run.originAttribute.array as Float32Array
      for (let offset = 0; offset < displayedOrigins.length; offset += 1) {
        const start = fromOrigins[offset]!
        displayedOrigins[offset] = start + (targetOrigins[offset]! - start) * nextProgress
      }
      run.originAttribute.needsUpdate = true
    }
    progress = nextProgress
  }
  return {
    matchedGlyphs,
    targetGlyphs,
    get progress() {
      return progress
    },
    setProgress,
    finish() {
      if (disposed) return
      setProgress(1)
      disposed = true
    },
    dispose() {
      disposed = true
    },
  }
}

function presentableBitmapBatch(object: THREE.Object3D): PresentableBitmapBatch {
  const batch = presentableBatchByObject.get(object)
  if (batch === undefined || batch.disposed) {
    throw new TypeError('object is not a live bitmap draw batch')
  }
  return batch
}

function bitmapGlyphIdentities(layout: ParagraphLayout): {
  readonly fontHandles: Uint32Array
  readonly fontSizeBits: Uint32Array
  readonly occurrences: Uint32Array
} {
  assertParallelGlyphIdentity(layout)
  const glyphCount = layout.glyphIds.length
  const fontHandles = new Uint32Array(glyphCount)
  const fontSizeBits = new Uint32Array(glyphCount)
  const occurrences = new Uint32Array(glyphCount)
  const floatBitsBuffer = new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT)
  const floatValue = new Float32Array(floatBitsBuffer)
  const unsignedValue = new Uint32Array(floatBitsBuffer)
  const counts = new Map<string, number>()
  for (let glyphIndex = 0; glyphIndex < glyphCount; glyphIndex += 1) {
    const fontSlot = layout.glyphFontSlots[glyphIndex]!
    const fontHandle = layout.fontHandles[fontSlot]
    if (fontHandle === undefined) {
      throw new TypeError('paragraph layout references a missing bitmap font slot')
    }
    floatValue[0] = layout.glyphFontSizes[glyphIndex]!
    const sizeBits = unsignedValue[0]!
    const baseKey = bitmapGlyphIdentityBaseKey(
      fontHandle,
      layout.glyphIds[glyphIndex]!,
      layout.clusters[glyphIndex]!,
      sizeBits,
    )
    const occurrence = counts.get(baseKey) ?? 0
    counts.set(baseKey, occurrence + 1)
    fontHandles[glyphIndex] = fontHandle
    fontSizeBits[glyphIndex] = sizeBits
    occurrences[glyphIndex] = occurrence
  }
  return { fontHandles, fontSizeBits, occurrences }
}

function bitmapOriginMap(
  snapshot: BitmapGlyphPositionSnapshotData,
): ReadonlyMap<string, readonly [number, number]> {
  const origins = new Map<string, readonly [number, number]>()
  for (let index = 0; index < snapshot.glyphIds.length; index += 1) {
    origins.set(
      bitmapGlyphIdentityKey(
        snapshot.fontHandles[index]!,
        snapshot.glyphIds[index]!,
        snapshot.clusters[index]!,
        snapshot.fontSizeBits[index]!,
        snapshot.occurrences[index]!,
      ),
      [snapshot.origins[index * 2]!, snapshot.origins[index * 2 + 1]!],
    )
  }
  return origins
}

function bitmapGlyphIdentityBaseKey(
  fontHandle: number,
  glyphId: number,
  cluster: number,
  fontSizeBits: number,
): string {
  return `${fontHandle}:${glyphId}:${cluster}:${fontSizeBits}`
}

function bitmapGlyphIdentityKey(
  fontHandle: number,
  glyphId: number,
  cluster: number,
  fontSizeBits: number,
  occurrence: number,
): string {
  return `${bitmapGlyphIdentityBaseKey(fontHandle, glyphId, cluster, fontSizeBits)}:${occurrence}`
}

function assertParallelGlyphIdentity(layout: ParagraphLayout): void {
  const glyphCount = layout.glyphIds.length
  for (const values of [
    layout.glyphFontSlots,
    layout.clusters,
    layout.glyphFontSizes,
    layout.x,
    layout.y,
  ]) {
    if (values.length !== glyphCount) {
      throw new TypeError('paragraph glyph identity arrays are not parallel')
    }
  }
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
  const extension = jsonObject(raster.extensionData, 'bitmap extension')
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
    const strikeValues = jsonArray(extension.strikes, 'bitmap strikes')
    if (strikeValues.length === 0)
      throw new TypeError('bitmap raster must contain at least one strike')
    for (let strikeIndex = 0; strikeIndex < strikeValues.length; strikeIndex += 1) {
      const strike = jsonObject(strikeValues[strikeIndex], `bitmap strike ${strikeIndex}`)
      const ppem = positiveSafeInteger(strike.ppemX, `bitmap strike ${strikeIndex} ppemX`)
      if (strike.ppemY !== ppem) throw new TypeError('bitmap runtime requires square strikes')
      const planeUnitsPerEm = positiveSafeInteger(
        strike.planeUnitsPerEm,
        `bitmap strike ${strikeIndex} planeUnitsPerEm`,
      )
      if (strike.recordStride !== RECORD_STRIDE) {
        throw new TypeError(`bitmap records must use ${RECORD_STRIDE}-byte stride`)
      }
      const records = raster.view(
        nonnegativeSafeInteger(
          strike.recordBufferView,
          `bitmap strike ${strikeIndex} recordBufferView`,
        ),
      )
      if (records.byteLength !== font.glyphCount * RECORD_STRIDE) {
        throw new TypeError('bitmap record table does not match the registered glyph count')
      }
      const pages: BitmapPageResource[] = []
      try {
        for (const [pageIndex, pageValue] of jsonArray(
          strike.pages,
          `bitmap strike ${strikeIndex} pages`,
        ).entries()) {
          pages.push(
            decodeBitmapPage(raster, pageValue, `bitmap strike ${strikeIndex} page ${pageIndex}`),
          )
        }
        validateDenseGlyphRecords(records, pages, 'bitmap')
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
    for (const page of strike.pages) {
      materialByPageTexture.get(page.texture)?.dispose()
      materialByPageTexture.delete(page.texture)
      page.texture.dispose()
    }
  }
}

function decodeBitmapPage(
  raster: RegisteredRaster,
  value: JsonValue,
  path: string,
): BitmapPageResource {
  return decodeEmbeddedLosslessAtlasPage(raster, value, path, {
    gpuFormat: 'r8unorm',
    vkFormat: VK_FORMAT_R8_UNORM,
    blockWidth: 1,
    blockHeight: 1,
    bytesPerBlock: 1,
    uncompressedChannelTypes: [KHR_DF_CHANNEL_RGBSDA_RED],
    textureFormat: THREE.RedFormat,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
  })
}

function buildBitmapBatches(
  layout: ParagraphLayout,
  resource: BitmapResource,
  fontSlot: number,
  paint: GlyphPaint,
): BitmapDrawBatch {
  assertParallelRasterLayout(layout, paint)
  const strike = selectBitmapStrike(resource.strikes, layout, fontSlot)
  const records = new DataView(
    strike.records.buffer,
    strike.records.byteOffset,
    strike.records.byteLength,
  )
  const group = new THREE.Group()
  const runs: BitmapBatchRun[] = []
  let glyphCount = 0
  let pendingPage = -1
  let pendingGlyphs: number[] = []

  const finishRun = (): void => {
    if (pendingGlyphs.length === 0) return
    const page = strike.pages[pendingPage]
    if (page === undefined) throw new TypeError('bitmap batch references a missing page')
    const run = createBitmapRun(layout, strike, page, pendingGlyphs, paint)
    runs.push(run)
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

  const presentation: PresentableBitmapBatch = {
    layout,
    runs,
    revision: 0,
    disposed: false,
  }
  presentableBatchByObject.set(group, presentation)
  let disposed = false
  return {
    object: group,
    glyphCount,
    drawCount: runs.length,
    strikePpem: strike.ppem,
    updatePaint(nextPaint) {
      if (disposed) throw new TypeError('bitmap draw batch has been disposed')
      assertParallelRasterPaint(layout, nextPaint)
      for (const run of runs) updateRunPaint(run, nextPaint)
    },
    dispose() {
      if (disposed) return
      disposed = true
      presentation.disposed = true
      presentation.revision += 1
      presentableBatchByObject.delete(group)
      group.clear()
      for (const run of runs) run.geometry.dispose()
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
    colors.set(resolvedGlyphColor(paint, glyphIndex), instance * 4)
  }

  const geometry = unitRasterQuadGeometry()
  geometry.instanceCount = count
  const originAttribute = new THREE.InstancedBufferAttribute(origins, 2)
  geometry.setAttribute('bitmapOrigin', originAttribute)
  geometry.setAttribute('bitmapSize', new THREE.InstancedBufferAttribute(sizes, 2))
  geometry.setAttribute('bitmapUvOrigin', new THREE.InstancedBufferAttribute(uvOrigins, 2))
  geometry.setAttribute('bitmapUvSize', new THREE.InstancedBufferAttribute(uvSizes, 2))
  const colorAttribute = new THREE.InstancedBufferAttribute(colors, 4)
  geometry.setAttribute('bitmapColor', colorAttribute)
  const material = bitmapMaterial(page.texture)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = glyphIndices[0] ?? 0
  return {
    glyphIndices: Uint32Array.from(glyphIndices),
    originAttribute,
    colorAttribute,
    geometry,
    mesh,
  }
}

function bitmapMaterial(page: THREE.DataTexture): THREE.MeshBasicNodeMaterial {
  const existing = materialByPageTexture.get(page)
  if (existing !== undefined) return existing
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
  materialByPageTexture.set(page, material)
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
    values.set(resolvedGlyphColor(paint, run.glyphIndices[instance]!), instance * 4)
  }
  run.colorAttribute.needsUpdate = true
}

function assertBitmapPaint(paint: GlyphPaint): void {
  for (const entry of paint.palette) {
    if (entry.outline !== undefined || entry.shadow !== undefined) {
      throw new TypeError('bitmap raster does not support outline or shadow paint')
    }
  }
}
