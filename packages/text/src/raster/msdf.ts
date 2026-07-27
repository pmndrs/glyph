import { VK_FORMAT_R8G8B8A8_UNORM } from 'ktx-parse'
import * as THREE from 'three/webgpu'
import {
  add,
  attribute as tslAttribute,
  clamp,
  div,
  fwidth,
  max,
  min,
  mul,
  positionLocal,
  smoothstep,
  step,
  sub,
  texture,
  uv,
  vec2,
  vec3,
} from 'three/tsl'
import type Node from 'three/src/nodes/core/Node.js'

import type { RegisteredFont } from '../font.js'
import type { RasterKey } from '../identity.js'
import { deriveRasterKey } from '../internal/raster-identity.js'
import {
  ABSENT_GLYPH_PAGE,
  DENSE_GLYPH_RECORD_STRIDE,
  decodeEmbeddedLosslessAtlasPage,
  jsonArray,
  jsonObject,
  nonnegativeSafeInteger,
  validateDenseGlyphRecords,
  type RasterAtlasPage,
} from '../internal/raster-atlas.js'
import {
  assertParallelRasterLayout,
  assertParallelRasterPaint,
  unitRasterQuadGeometry,
} from '../internal/raster-batch.js'
import type { ParagraphLayout } from '../layout.js'
import type { GlyphPaint, ResolvedPaint } from '../paint.js'
import {
  defineRaster,
  type JsonValue,
  type RasterModule,
  type RegisteredRaster,
} from '../raster.js'

export const MSDF_KIND = 'msdf' as const
export const MSDF_EXTENSION = 'PMNDRS_font_distance_field' as const
export const MSDF_FORMAT_VERSION = 0 as const
export const MSDF_GENERATOR_VERSION = '0.0.0' as const
export const MTSDF_EM_SIZE = 64 as const
export const MTSDF_PIXEL_RANGE = 8 as const
export const MTSDF_PLANE_UNITS_PER_EM = 64 as const
/** The encoded true-distance field covers four atlas pixels on either side of the edge. */
export const MTSDF_MAX_OUTLINE_ATLAS_PIXELS: number = MTSDF_PIXEL_RANGE / 2

const MAX_RUNTIME_GPU_BYTES = 256 * 1024 * 1024
const RECORD_STRIDE = DENSE_GLYPH_RECORD_STRIDE
const ABSENT_PAGE = ABSENT_GLYPH_PAGE

export interface MsdfDescriptorV0 {
  readonly [key: string]: JsonValue
  readonly generatorVersion: typeof MSDF_GENERATOR_VERSION
}

export interface MsdfPageResource extends RasterAtlasPage {}

export interface MsdfResource {
  readonly emSize: number
  readonly pixelRange: number
  readonly planeUnitsPerEm: number
  readonly records: Uint8Array
  readonly pages: readonly MsdfPageResource[]
}

interface MsdfBatchRun {
  readonly glyphIndices: Uint32Array
  readonly page: MsdfPageResource
  readonly originAttribute: THREE.InstancedBufferAttribute
  readonly sizeAttribute: THREE.InstancedBufferAttribute
  readonly uvOriginAttribute: THREE.InstancedBufferAttribute
  readonly uvSizeAttribute: THREE.InstancedBufferAttribute
  readonly uvBoundsAttribute: THREE.InstancedBufferAttribute
  readonly shadowOffsetAttribute: THREE.InstancedBufferAttribute
  readonly fillColorAttribute: THREE.InstancedBufferAttribute
  readonly outlineColorAttribute: THREE.InstancedBufferAttribute
  readonly outlineWidthAttribute: THREE.InstancedBufferAttribute
  readonly shadowColorAttribute: THREE.InstancedBufferAttribute
  readonly geometry: THREE.InstancedBufferGeometry
  readonly mesh: THREE.Mesh
}

export interface MsdfDrawBatch {
  readonly object: THREE.Group
  readonly glyphCount: number
  readonly drawCount: number
  updatePaint(paint: GlyphPaint): void
  dispose(): void
}

interface MsdfMaterialState {
  readonly material: THREE.MeshBasicNodeMaterial
}

const descriptor = Object.freeze({
  generatorVersion: MSDF_GENERATOR_VERSION,
}) satisfies MsdfDescriptorV0

const materialByPageTexture = new WeakMap<THREE.DataTexture, MsdfMaterialState>()

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

const msdfModule: RasterModule<typeof MSDF_KIND, MsdfResource, MsdfDrawBatch> = defineRaster({
  kind: MSDF_KIND,
  extension: MSDF_EXTENSION,
  version: MSDF_FORMAT_VERSION,
  descriptor: msdfDescriptor,
  async decode(font, raster, signal) {
    signal?.throwIfAborted()
    const resource = decodeMsdfResource(font, raster)
    signal?.throwIfAborted()
    return resource
  },
  async prepare(_layout, _resource, _fontSlot, signal) {
    signal?.throwIfAborted()
  },
  buildBatches(layout, resource, fontSlot, paint) {
    return buildMsdfBatches(layout, resource, fontSlot, paint)
  },
  validatePaint: assertMsdfPaint,
  updatePaint(batch, paint) {
    batch.updatePaint(paint)
  },
  dispose(resource) {
    disposeMsdfResource(resource)
  },
})

export type MsdfModule = typeof msdfModule

/** Fixed MTSDF raster module for `defineFont(source, msdf)`. */
export const msdf: MsdfModule = msdfModule

function decodeMsdfResource(font: RegisteredFont, raster: RegisteredRaster): MsdfResource {
  if (
    raster.font !== font.handle ||
    raster.kind !== MSDF_KIND ||
    raster.extension !== MSDF_EXTENSION ||
    raster.version !== MSDF_FORMAT_VERSION
  ) {
    throw new TypeError('MTSDF raster is not bound to the supplied font')
  }
  const extension = jsonObject(raster.extensionData, 'MTSDF extension')
  if (
    extension.version !== MSDF_FORMAT_VERSION ||
    extension.rasterKey !== raster.rasterKey ||
    extension.shapingHash !== font.shapingHash ||
    extension.glyphCount !== font.glyphCount ||
    extension.glyphIdWidth !== 16 ||
    extension.encoding !== 'mtsdf' ||
    extension.emSize !== MTSDF_EM_SIZE ||
    extension.pixelRange !== MTSDF_PIXEL_RANGE ||
    extension.planeUnitsPerEm !== MTSDF_PLANE_UNITS_PER_EM ||
    extension.recordStride !== RECORD_STRIDE
  ) {
    throw new TypeError('MTSDF extension does not match the fixed runtime contract')
  }
  const records = raster.view(
    nonnegativeSafeInteger(extension.recordBufferView, 'MTSDF recordBufferView'),
  )
  if (records.byteLength !== font.glyphCount * RECORD_STRIDE) {
    throw new TypeError('MTSDF record table does not match the registered glyph count')
  }
  const pageValues = jsonArray(extension.pages, 'MTSDF pages')
  if (pageValues.length === 0) throw new TypeError('MTSDF raster must contain at least one page')
  if (pageValues.length > 65_535) throw new RangeError('MTSDF raster contains too many pages')
  const pages: MsdfPageResource[] = []
  let gpuBytes = 0
  try {
    for (let pageIndex = 0; pageIndex < pageValues.length; pageIndex += 1) {
      validateMtsdfPageDirectory(pageValues[pageIndex]!, pageIndex)
      const page = decodeEmbeddedLosslessAtlasPage(
        raster,
        pageValues[pageIndex]!,
        `MTSDF page ${pageIndex}`,
        {
          gpuFormat: 'rgba8unorm',
          vkFormat: VK_FORMAT_R8G8B8A8_UNORM,
          bytesPerPixel: 4,
          textureFormat: THREE.RGBAFormat,
          generateMipmaps: true,
          minFilter: THREE.LinearMipmapLinearFilter,
        },
      )
      gpuBytes = checkedGpuBytes(gpuBytes, page)
      pages.push(page)
    }
    validateDenseGlyphRecords(records, pages, 'MTSDF')
    validateMtsdfPlaneSpans(records)
    return {
      emSize: MTSDF_EM_SIZE,
      pixelRange: MTSDF_PIXEL_RANGE,
      planeUnitsPerEm: MTSDF_PLANE_UNITS_PER_EM,
      records,
      pages,
    }
  } catch (error) {
    for (const page of pages) page.texture.dispose()
    throw error
  }
}

function validateMtsdfPageDirectory(value: JsonValue, pageIndex: number): void {
  const page = jsonObject(value, `MTSDF page ${pageIndex}`)
  const variants = jsonArray(page.variants, `MTSDF page ${pageIndex} variants`)
  if (variants.length !== 1) {
    throw new TypeError('MTSDF V0 pages must contain exactly one lossless RGBA8 variant')
  }
  const variant = jsonObject(variants[0], `MTSDF page ${pageIndex} variant`)
  if (variant.gpuFormat !== 'rgba8unorm') {
    throw new TypeError('MTSDF V0 pages accept only the lossless rgba8unorm baseline')
  }
}

function validateMtsdfPlaneSpans(records: Uint8Array): void {
  const view = new DataView(records.buffer, records.byteOffset, records.byteLength)
  for (let offset = 0; offset < records.byteLength; offset += RECORD_STRIDE) {
    if (view.getUint16(offset + 16, true) === ABSENT_PAGE) continue
    if (view.getInt16(offset, true) >= view.getInt16(offset + 4, true)) {
      throw new TypeError('MTSDF record has an empty horizontal plane span')
    }
    if (view.getInt16(offset + 2, true) >= view.getInt16(offset + 6, true)) {
      throw new TypeError('MTSDF record has an empty vertical plane span')
    }
  }
}

function checkedGpuBytes(current: number, page: MsdfPageResource): number {
  const baseBytes = page.width * page.height * 4
  const mipBytes = Math.ceil((baseBytes * 4) / 3)
  const total = current + mipBytes
  if (!Number.isSafeInteger(total) || total > MAX_RUNTIME_GPU_BYTES) {
    page.texture.dispose()
    throw new RangeError('MTSDF pages exceed the runtime GPU-memory limit')
  }
  return total
}

function disposeMsdfResource(resource: MsdfResource): void {
  for (const page of resource.pages) {
    const state = materialByPageTexture.get(page.texture)
    state?.material.dispose()
    materialByPageTexture.delete(page.texture)
    page.texture.dispose()
  }
}

function buildMsdfBatches(
  layout: ParagraphLayout,
  resource: MsdfResource,
  fontSlot: number,
  paint: GlyphPaint,
): MsdfDrawBatch {
  assertParallelRasterLayout(layout, paint)
  assertMsdfPaint(paint)
  const records = new DataView(
    resource.records.buffer,
    resource.records.byteOffset,
    resource.records.byteLength,
  )
  const group = new THREE.Group()
  const runs: MsdfBatchRun[] = []
  let glyphCount = 0
  let pendingPage = -1
  let pendingGlyphs: number[] = []

  const finishRun = (): void => {
    if (pendingGlyphs.length === 0) return
    const page = resource.pages[pendingPage]
    if (page === undefined) throw new TypeError('MTSDF batch references a missing page')
    const run = createMsdfRun(layout, resource, page, pendingGlyphs, paint)
    runs.push(run)
    group.add(run.mesh)
    glyphCount += pendingGlyphs.length
    pendingGlyphs = []
  }

  for (let glyphIndex = 0; glyphIndex < layout.glyphIds.length; glyphIndex += 1) {
    if (layout.glyphFontSlots[glyphIndex] !== fontSlot) continue
    const glyphId = layout.glyphIds[glyphIndex]
    if (glyphId === undefined) continue
    if (glyphId >= resource.records.byteLength / RECORD_STRIDE) {
      throw new TypeError('paragraph layout references an MTSDF glyph outside the registered font')
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
    updatePaint(nextPaint) {
      if (disposed) throw new TypeError('MTSDF draw batch has been disposed')
      assertParallelRasterPaint(layout, nextPaint)
      assertMsdfPaint(nextPaint)
      for (const run of runs) updateMsdfRun(layout, resource, run, nextPaint)
    },
    dispose() {
      if (disposed) return
      disposed = true
      group.clear()
      for (const run of runs) run.geometry.dispose()
    },
  }
}

function createMsdfRun(
  layout: ParagraphLayout,
  resource: MsdfResource,
  page: MsdfPageResource,
  glyphIndices: readonly number[],
  paint: GlyphPaint,
): MsdfBatchRun {
  const count = glyphIndices.length
  const geometry = unitRasterQuadGeometry()
  geometry.instanceCount = count
  const originAttribute = instanceAttribute(geometry, 'msdfOrigin', count, 2)
  const sizeAttribute = instanceAttribute(geometry, 'msdfSize', count, 2)
  const uvOriginAttribute = instanceAttribute(geometry, 'msdfUvOrigin', count, 2)
  const uvSizeAttribute = instanceAttribute(geometry, 'msdfUvSize', count, 2)
  const uvBoundsAttribute = instanceAttribute(geometry, 'msdfUvBounds', count, 4)
  const shadowOffsetAttribute = instanceAttribute(geometry, 'msdfShadowOffset', count, 2)
  const fillColorAttribute = instanceAttribute(geometry, 'msdfFillColor', count, 4)
  const outlineColorAttribute = instanceAttribute(geometry, 'msdfOutlineColor', count, 4)
  const outlineWidthAttribute = instanceAttribute(geometry, 'msdfOutlineWidth', count, 1)
  const shadowColorAttribute = instanceAttribute(geometry, 'msdfShadowColor', count, 4)
  const mesh = new THREE.Mesh(geometry, msdfMaterial(page))
  mesh.frustumCulled = false
  mesh.renderOrder = glyphIndices[0] ?? 0
  const run: MsdfBatchRun = {
    glyphIndices: Uint32Array.from(glyphIndices),
    page,
    originAttribute,
    sizeAttribute,
    uvOriginAttribute,
    uvSizeAttribute,
    uvBoundsAttribute,
    shadowOffsetAttribute,
    fillColorAttribute,
    outlineColorAttribute,
    outlineWidthAttribute,
    shadowColorAttribute,
    geometry,
    mesh,
  }
  updateMsdfRun(layout, resource, run, paint)
  return run
}

function instanceAttribute(
  geometry: THREE.InstancedBufferGeometry,
  name: string,
  count: number,
  itemSize: number,
): THREE.InstancedBufferAttribute {
  const attribute = new THREE.InstancedBufferAttribute(new Float32Array(count * itemSize), itemSize)
  geometry.setAttribute(name, attribute)
  return attribute
}

function updateMsdfRun(
  layout: ParagraphLayout,
  resource: MsdfResource,
  run: MsdfBatchRun,
  paint: GlyphPaint,
): void {
  const records = new DataView(
    resource.records.buffer,
    resource.records.byteOffset,
    resource.records.byteLength,
  )
  for (let instance = 0; instance < run.glyphIndices.length; instance += 1) {
    const glyphIndex = run.glyphIndices[instance]!
    const paintEntry = resolvedPaint(paint, glyphIndex)
    writeMsdfInstance(layout, resource, run, records, instance, glyphIndex, paintEntry)
  }
  for (const attribute of [
    run.originAttribute,
    run.sizeAttribute,
    run.uvOriginAttribute,
    run.uvSizeAttribute,
    run.uvBoundsAttribute,
    run.shadowOffsetAttribute,
    run.fillColorAttribute,
    run.outlineColorAttribute,
    run.outlineWidthAttribute,
    run.shadowColorAttribute,
  ]) {
    attribute.needsUpdate = true
  }
}

function writeMsdfInstance(
  layout: ParagraphLayout,
  resource: MsdfResource,
  run: MsdfBatchRun,
  records: DataView,
  instance: number,
  glyphIndex: number,
  paint: ResolvedPaint,
): void {
  const glyphId = layout.glyphIds[glyphIndex]!
  const record = glyphId * RECORD_STRIDE
  const fontSize = layout.glyphFontSizes[glyphIndex]!
  if (!Number.isFinite(fontSize) || fontSize <= 0) {
    throw new TypeError('MTSDF glyph font sizes must be positive finite values')
  }
  const scale = fontSize / resource.planeUnitsPerEm
  const planeLeft = records.getInt16(record, true)
  const planeBottom = records.getInt16(record + 2, true)
  const planeRight = records.getInt16(record + 4, true)
  const planeTop = records.getInt16(record + 6, true)
  const atlasLeft = records.getUint16(record + 8, true)
  const atlasTop = records.getUint16(record + 10, true)
  const atlasRight = records.getUint16(record + 12, true)
  const atlasBottom = records.getUint16(record + 14, true)
  const baseOriginX = layout.x[glyphIndex]! + planeLeft * scale
  const baseOriginY = -layout.y[glyphIndex]! + planeBottom * scale
  const baseWidth = (planeRight - planeLeft) * scale
  const baseHeight = (planeTop - planeBottom) * scale
  const shadowX = paint.shadow?.offset[0] ?? 0
  const shadowY = -(paint.shadow?.offset[1] ?? 0)
  const originX = baseOriginX + Math.min(0, shadowX)
  const originY = baseOriginY + Math.min(0, shadowY)
  const width = baseWidth + Math.abs(shadowX)
  const height = baseHeight + Math.abs(shadowY)
  const baseUvX = atlasLeft / run.page.width
  const baseUvY = 1 - atlasBottom / run.page.height
  const baseUvWidth = (atlasRight - atlasLeft) / run.page.width
  const baseUvHeight = (atlasBottom - atlasTop) / run.page.height
  const uvPerUnitX = baseUvWidth / baseWidth
  const uvPerUnitY = baseUvHeight / baseHeight
  const uvOriginX = baseUvX + (originX - baseOriginX) * uvPerUnitX
  const uvOriginY = baseUvY + (originY - baseOriginY) * uvPerUnitY
  const outlineAtlasPixels = (paint.outline?.width ?? 0) / scale
  if (outlineAtlasPixels > MTSDF_MAX_OUTLINE_ATLAS_PIXELS) {
    throw new RangeError(
      `MTSDF outline width exceeds the ${MTSDF_MAX_OUTLINE_ATLAS_PIXELS}-atlas-pixel V0 field limit`,
    )
  }
  setAttribute(run.originAttribute, instance, [originX, originY])
  setAttribute(run.sizeAttribute, instance, [width, height])
  setAttribute(run.uvOriginAttribute, instance, [uvOriginX, uvOriginY])
  setAttribute(run.uvSizeAttribute, instance, [width * uvPerUnitX, height * uvPerUnitY])
  setAttribute(run.uvBoundsAttribute, instance, [
    baseUvX,
    baseUvY,
    baseUvX + baseUvWidth,
    baseUvY + baseUvHeight,
  ])
  setAttribute(run.shadowOffsetAttribute, instance, [shadowX * uvPerUnitX, shadowY * uvPerUnitY])
  setAttribute(run.fillColorAttribute, instance, paint.color)
  setAttribute(run.outlineColorAttribute, instance, paint.outline?.color ?? [0, 0, 0, 0])
  setAttribute(run.outlineWidthAttribute, instance, [outlineAtlasPixels / resource.pixelRange])
  setAttribute(run.shadowColorAttribute, instance, paint.shadow?.color ?? [0, 0, 0, 0])
}

function setAttribute(
  attribute: THREE.InstancedBufferAttribute,
  instance: number,
  values: readonly number[],
): void {
  ;(attribute.array as Float32Array).set(values, instance * attribute.itemSize)
}

function resolvedPaint(paint: GlyphPaint, glyphIndex: number): ResolvedPaint {
  const paintIndex = paint.paintIndices[glyphIndex]
  const resolved = paintIndex === undefined ? undefined : paint.palette[paintIndex]
  if (resolved === undefined) throw new TypeError('glyph paint references a missing palette entry')
  return resolved
}

function assertMsdfPaint(paint: GlyphPaint): void {
  for (const entry of paint.palette) {
    assertLinearColor(entry.color, 'MTSDF fill')
    if (entry.outline !== undefined) {
      assertLinearColor(entry.outline.color, 'MTSDF outline')
      if (!Number.isFinite(entry.outline.width) || entry.outline.width < 0) {
        throw new TypeError('MTSDF outline width must be a non-negative finite value')
      }
    }
    if (entry.shadow !== undefined) {
      assertLinearColor(entry.shadow.color, 'MTSDF shadow')
      if (entry.shadow.offset.some((value) => !Number.isFinite(value))) {
        throw new TypeError('MTSDF shadow offsets must be finite values')
      }
    }
  }
}

function assertLinearColor(color: readonly number[], label: string): void {
  if (
    color.length !== 4 ||
    color.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
  ) {
    throw new TypeError(`${label} color must contain four finite linear values in [0, 1]`)
  }
}

function msdfMaterial(page: MsdfPageResource): THREE.MeshBasicNodeMaterial {
  const existing = materialByPageTexture.get(page.texture)
  if (existing !== undefined) return existing.material
  const material = new THREE.MeshBasicNodeMaterial({
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    transparent: true,
  })
  const origin: Node<'vec2'> = tslAttribute<'vec2'>('msdfOrigin', 'vec2')
  const size: Node<'vec2'> = tslAttribute<'vec2'>('msdfSize', 'vec2')
  const uvOrigin: Node<'vec2'> = tslAttribute<'vec2'>('msdfUvOrigin', 'vec2')
  const uvSize: Node<'vec2'> = tslAttribute<'vec2'>('msdfUvSize', 'vec2')
  const uvBounds: Node<'vec4'> = tslAttribute<'vec4'>('msdfUvBounds', 'vec4')
  const shadowOffset: Node<'vec2'> = tslAttribute<'vec2'>('msdfShadowOffset', 'vec2')
  const fillColor: Node<'vec4'> = tslAttribute<'vec4'>('msdfFillColor', 'vec4')
  const outlineColor: Node<'vec4'> = tslAttribute<'vec4'>('msdfOutlineColor', 'vec4')
  const outlineWidth: Node<'float'> = tslAttribute<'float'>('msdfOutlineWidth', 'float')
  const shadowColor: Node<'vec4'> = tslAttribute<'vec4'>('msdfShadowColor', 'vec4')
  const unitUv: Node<'vec2'> = uv()
  const atlasU: Node<'float'> = add(uvOrigin.x, mul(unitUv.x, uvSize.x))
  const atlasV: Node<'float'> = add(uvOrigin.y, mul(unitUv.y, uvSize.y))
  const minimumU: Node<'float'> = add(uvBounds.x, 0.5 / page.width)
  const minimumV: Node<'float'> = add(uvBounds.y, 0.5 / page.height)
  const maximumU: Node<'float'> = sub(uvBounds.z, 0.5 / page.width)
  const maximumV: Node<'float'> = sub(uvBounds.w, 0.5 / page.height)
  const baseInside: Node<'float'> = insideRectangle(atlasU, atlasV, uvBounds)
  const clampedBaseU: Node<'float'> = clamp(atlasU, minimumU, maximumU)
  const clampedBaseV: Node<'float'> = clamp(atlasV, minimumV, maximumV)
  const baseSample: Node<'vec4'> = texture(page.texture, vec2(clampedBaseU, clampedBaseV))
  const fillDistance: Node<'float'> = sub(median3(baseSample.rgb), 0.5)
  const trueDistance: Node<'float'> = sub(baseSample.a, 0.5)
  const fillCoverage: Node<'float'> = mul(antialiasedCoverage(fillDistance), baseInside)
  const outlineDistance: Node<'float'> = add(trueDistance, outlineWidth)
  const outlineCoverage: Node<'float'> = mul(antialiasedCoverage(outlineDistance), baseInside)
  const outlineOnly: Node<'float'> = max(sub(outlineCoverage, fillCoverage), 0)
  const shadowU: Node<'float'> = sub(atlasU, shadowOffset.x)
  const shadowV: Node<'float'> = sub(atlasV, shadowOffset.y)
  const shadowInside: Node<'float'> = insideRectangle(shadowU, shadowV, uvBounds)
  const clampedShadowU: Node<'float'> = clamp(shadowU, minimumU, maximumU)
  const clampedShadowV: Node<'float'> = clamp(shadowV, minimumV, maximumV)
  const shadowSample: Node<'vec4'> = texture(page.texture, vec2(clampedShadowU, clampedShadowV))
  const shadowDistance: Node<'float'> = sub(shadowSample.a, 0.5)
  const shadowCoverage: Node<'float'> = mul(antialiasedCoverage(shadowDistance), shadowInside)
  const shadowAlpha: Node<'float'> = mul(shadowColor.a, shadowCoverage)
  const outlineAlpha: Node<'float'> = mul(outlineColor.a, outlineOnly)
  const fillAlpha: Node<'float'> = mul(fillColor.a, fillCoverage)
  const shadowRemainder: Node<'float'> = mul(shadowAlpha, sub(1, outlineAlpha))
  const outlineOverShadowAlpha: Node<'float'> = add(outlineAlpha, shadowRemainder)
  const outlineOverShadowRed: Node<'float'> = add(
    mul(outlineColor.r, outlineAlpha),
    mul(shadowColor.r, shadowRemainder),
  )
  const outlineOverShadowGreen: Node<'float'> = add(
    mul(outlineColor.g, outlineAlpha),
    mul(shadowColor.g, shadowRemainder),
  )
  const outlineOverShadowBlue: Node<'float'> = add(
    mul(outlineColor.b, outlineAlpha),
    mul(shadowColor.b, shadowRemainder),
  )
  const fillRemainder: Node<'float'> = sub(1, fillAlpha)
  const outputAlpha: Node<'float'> = add(fillAlpha, mul(outlineOverShadowAlpha, fillRemainder))
  const outputRed: Node<'float'> = add(
    mul(fillColor.r, fillAlpha),
    mul(outlineOverShadowRed, fillRemainder),
  )
  const outputGreen: Node<'float'> = add(
    mul(fillColor.g, fillAlpha),
    mul(outlineOverShadowGreen, fillRemainder),
  )
  const outputBlue: Node<'float'> = add(
    mul(fillColor.b, fillAlpha),
    mul(outlineOverShadowBlue, fillRemainder),
  )
  const safeOutputAlpha: Node<'float'> = max(outputAlpha, 1e-6)
  const outputColor: Node<'vec3'> = vec3(
    div(outputRed, safeOutputAlpha),
    div(outputGreen, safeOutputAlpha),
    div(outputBlue, safeOutputAlpha),
  )
  const positionX: Node<'float'> = add(origin.x, mul(positionLocal.x, size.x))
  const positionY: Node<'float'> = add(origin.y, mul(positionLocal.y, size.y))
  material.positionNode = vec3(positionX, positionY, 0)
  material.colorNode = outputColor
  material.opacityNode = outputAlpha
  materialByPageTexture.set(page.texture, { material })
  return material
}

function median3(value: Node<'vec3'>): Node<'float'> {
  const lowerPair: Node<'float'> = min(value.r, value.g)
  const upperPair: Node<'float'> = max(value.r, value.g)
  return max(lowerPair, min(upperPair, value.b))
}

function antialiasedCoverage(distance: Node<'float'>): Node<'float'> {
  const derivative: Node<'float'> = fwidth(distance)
  const halfWidth: Node<'float'> = max(mul(derivative, 0.5), 1 / 256)
  return smoothstep(sub(0, halfWidth), halfWidth, distance)
}

function insideRectangle(
  pointU: Node<'float'>,
  pointV: Node<'float'>,
  bounds: Node<'vec4'>,
): Node<'float'> {
  const insideX: Node<'float'> = mul(step(bounds.x, pointU), step(pointU, bounds.z))
  const insideY: Node<'float'> = mul(step(bounds.y, pointV), step(pointV, bounds.w))
  return mul(insideX, insideY)
}
