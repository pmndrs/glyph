import type { ParagraphLayout } from '@pmndrs/text'
import type { MsdfResource } from '@pmndrs/text/raster/msdf'

const RECORD_STRIDE = 20
const ABSENT_PAGE = 0xffff

export interface MtsdfCpuReferenceBounds {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

export interface MtsdfCpuReference {
  readonly width: number
  readonly height: number
  /** Top-to-bottom, straight-alpha RGBA8 pixels composited over opaque black. */
  readonly pixels: Uint8Array
  /** Clipped physical-pixel bounds visited by renderable glyph quads. */
  readonly bounds: MtsdfCpuReferenceBounds | undefined
  readonly glyphCount: number
}

export interface Rgba8CoverageDifference {
  readonly heatmap: Uint8Array
  readonly meanAbsoluteError: number
  readonly maximumError: number
  readonly errorPixels: number
  readonly severeErrorPixels: number
}

/**
 * Compares opaque grayscale coverage frames. Red marks candidate-only coverage,
 * cyan marks reference-only coverage, and black marks agreement.
 */
export function compareRgba8Coverage(
  candidate: Uint8Array,
  reference: Uint8Array,
  amplification = 8,
): Rgba8CoverageDifference {
  if (candidate.byteLength !== reference.byteLength || candidate.byteLength % 4 !== 0) {
    throw new TypeError('RGBA8 coverage frames must have equal four-channel lengths')
  }
  positiveFinite(amplification, 'RGBA8 difference amplification')
  const heatmap = new Uint8Array(candidate.byteLength)
  let absoluteError = 0
  let maximumError = 0
  let errorPixels = 0
  let severeErrorPixels = 0
  for (let offset = 0; offset < candidate.byteLength; offset += 4) {
    let pixelError = 0
    let signedCoverageError = 0
    for (let channel = 0; channel < 3; channel += 1) {
      const signedError = candidate[offset + channel]! - reference[offset + channel]!
      const error = Math.abs(signedError)
      absoluteError += error
      pixelError = Math.max(pixelError, error)
      signedCoverageError += signedError
    }
    const magnitude = byte((Math.abs(signedCoverageError) / 3) * amplification)
    if (signedCoverageError >= 0) {
      heatmap[offset] = magnitude
    } else {
      heatmap[offset + 1] = magnitude
      heatmap[offset + 2] = magnitude
    }
    heatmap[offset + 3] = 255
    maximumError = Math.max(maximumError, pixelError)
    if (pixelError > 2) errorPixels += 1
    if (pixelError > 128) severeErrorPixels += 1
  }
  return {
    heatmap,
    meanAbsoluteError:
      candidate.byteLength === 0 ? 0 : absoluteError / ((candidate.byteLength / 4) * 3),
    maximumError,
    errorPixels,
    severeErrorPixels,
  }
}

export interface FlatMtsdfCpuReferenceOptions {
  /** Physical framebuffer width. */
  readonly width: number
  /** Physical framebuffer height. */
  readonly height: number
  /** Device pixels per paragraph-layout unit. */
  readonly dpr?: number
  /** Paragraph object's X position in layout units. */
  readonly originX?: number
  /** Paragraph object's Y position in the renderer's Y-up local coordinates. */
  readonly originY?: number
  readonly fontSlot?: number
  /** Linear straight-alpha fill color. */
  readonly fill?: readonly [number, number, number, number]
}

/**
 * Reconstructs the fixed, flat MTSDF specimen without invoking Canvas text,
 * Three.js materials, texture sampling, or browser font rendering.
 *
 * The sampler deliberately reads the same immutable RGBA8 base-level texels
 * carried by the decoded resource. It is suitable for an axis-aligned,
 * untransformed fill specimen; outlines, shadows, mip selection, and arbitrary
 * object transforms belong in separate conformance cases.
 */
export function renderFlatMtsdfCpuReference(
  resource: MsdfResource,
  layout: ParagraphLayout,
  options: FlatMtsdfCpuReferenceOptions,
): MtsdfCpuReference {
  const width = positiveInteger(options.width, 'MTSDF CPU reference width')
  const height = positiveInteger(options.height, 'MTSDF CPU reference height')
  const dpr = positiveFinite(options.dpr ?? 1, 'MTSDF CPU reference DPR')
  const originX = finite(options.originX ?? 0, 'MTSDF CPU reference origin X')
  const originY = finite(options.originY ?? 0, 'MTSDF CPU reference origin Y')
  const fontSlot = nonnegativeInteger(options.fontSlot ?? 0, 'MTSDF CPU reference font slot')
  const fill = linearColor(options.fill ?? [1, 1, 1, 1])
  assertLayoutArrays(layout)

  const atlas = atlasTexels(resource)
  const records = recordView(resource)
  const pixels = opaqueBlack(width, height)
  let glyphCount = 0
  let bounds: MtsdfCpuReferenceBounds | undefined

  for (let glyphIndex = 0; glyphIndex < layout.glyphIds.length; glyphIndex += 1) {
    if (layout.glyphFontSlots[glyphIndex] !== fontSlot) continue
    const glyphId = layout.glyphIds[glyphIndex]!
    if (glyphId >= resource.records.byteLength / RECORD_STRIDE) {
      throw new TypeError('paragraph layout references an MTSDF glyph outside the resource')
    }
    const recordOffset = glyphId * RECORD_STRIDE
    const pageIndex = records.getUint16(recordOffset + 16, true)
    if (pageIndex === ABSENT_PAGE) continue
    if (pageIndex >= resource.atlas.layers || resource.pages[pageIndex] === undefined) {
      throw new TypeError('MTSDF record references a missing atlas page')
    }

    const planeLeft = records.getInt16(recordOffset, true)
    const planeBottom = records.getInt16(recordOffset + 2, true)
    const planeRight = records.getInt16(recordOffset + 4, true)
    const planeTop = records.getInt16(recordOffset + 6, true)
    const atlasLeft = records.getUint16(recordOffset + 8, true)
    const atlasTop = records.getUint16(recordOffset + 10, true)
    const atlasRight = records.getUint16(recordOffset + 12, true)
    const atlasBottom = records.getUint16(recordOffset + 14, true)
    const page = resource.pages[pageIndex]!
    if (
      atlasRight > page.width ||
      atlasBottom > page.height ||
      atlasLeft >= atlasRight ||
      atlasTop >= atlasBottom
    ) {
      throw new TypeError('MTSDF record atlas rectangle exceeds its page')
    }
    const fontSize = positiveFinite(
      layout.glyphFontSizes[glyphIndex]!,
      'MTSDF CPU reference glyph font size',
    )
    const scale = fontSize / positiveFinite(resource.planeUnitsPerEm, 'MTSDF plane units per em')
    const left = (originX + layout.x[glyphIndex]! + planeLeft * scale) * dpr
    const right = (originX + layout.x[glyphIndex]! + planeRight * scale) * dpr
    const top = -(originY - layout.y[glyphIndex]! + planeTop * scale) * dpr
    const bottom = -(originY - layout.y[glyphIndex]! + planeBottom * scale) * dpr
    if (!(right > left && bottom > top && atlasRight > atlasLeft && atlasBottom > atlasTop)) {
      throw new TypeError('MTSDF record contains an empty or inverted glyph rectangle')
    }

    const pixelBounds = clippedPixelBounds(left, top, right, bottom, width, height)
    if (pixelBounds === undefined) continue
    glyphCount += 1
    bounds = unionBounds(bounds, pixelBounds)

    // This is the scalar form of the canonical MSDF screen-space range:
    // pxRange * 0.5 * (device pixels / atlas texel in X + the same in Y).
    const screenRange = Math.max(
      1,
      positiveFinite(resource.pixelRange, 'MTSDF pixel range') *
        0.5 *
        ((right - left) / (atlasRight - atlasLeft) + (bottom - top) / (atlasBottom - atlasTop)),
    )
    const sampleBounds = {
      minX: atlasLeft,
      minY: resource.atlas.height - atlasBottom,
      maxX: atlasRight - 1,
      maxY: resource.atlas.height - atlasTop - 1,
    }
    for (let y = pixelBounds.minY; y <= pixelBounds.maxY; y += 1) {
      const unitY = (y + 0.5 - top) / (bottom - top)
      const atlasY = resource.atlas.height - atlasTop - unitY * (atlasBottom - atlasTop) - 0.5
      for (let x = pixelBounds.minX; x <= pixelBounds.maxX; x += 1) {
        const unitX = (x + 0.5 - left) / (right - left)
        const atlasX = atlasLeft + unitX * (atlasRight - atlasLeft) - 0.5
        const red = bilinearChannel(atlas, resource, pageIndex, atlasX, atlasY, 0, sampleBounds)
        const green = bilinearChannel(atlas, resource, pageIndex, atlasX, atlasY, 1, sampleBounds)
        const blue = bilinearChannel(atlas, resource, pageIndex, atlasX, atlasY, 2, sampleBounds)
        const distance = median(red, green, blue) / 255 - 0.5
        const coverage = clamp01(distance * screenRange + 0.5)
        compositeFill(pixels, (y * width + x) * 4, fill, coverage)
      }
    }
  }

  return { width, height, pixels, bounds, glyphCount }
}

function atlasTexels(resource: MsdfResource): Uint8Array {
  const data: unknown = resource.atlas.texture.image.data
  if (!(data instanceof Uint8Array)) {
    throw new TypeError('MTSDF CPU reference requires unsigned-byte RGBA atlas texels')
  }
  const expected = resource.atlas.width * resource.atlas.height * resource.atlas.layers * 4
  if (data.byteLength !== expected) {
    throw new TypeError('MTSDF CPU reference atlas byte length does not match its dimensions')
  }
  return data
}

function recordView(resource: MsdfResource): DataView {
  if (resource.records.byteLength % RECORD_STRIDE !== 0) {
    throw new TypeError('MTSDF CPU reference record table is not densely packed')
  }
  return new DataView(
    resource.records.buffer,
    resource.records.byteOffset,
    resource.records.byteLength,
  )
}

function assertLayoutArrays(layout: ParagraphLayout): void {
  const count = layout.glyphIds.length
  if (
    layout.glyphFontSlots.length !== count ||
    layout.glyphFontSizes.length !== count ||
    layout.x.length !== count ||
    layout.y.length !== count
  ) {
    throw new TypeError('MTSDF CPU reference requires parallel paragraph glyph arrays')
  }
  for (let glyphIndex = 0; glyphIndex < count; glyphIndex += 1) {
    finite(layout.x[glyphIndex]!, 'MTSDF CPU reference glyph X')
    finite(layout.y[glyphIndex]!, 'MTSDF CPU reference glyph Y')
  }
}

function clippedPixelBounds(
  left: number,
  top: number,
  right: number,
  bottom: number,
  width: number,
  height: number,
): MtsdfCpuReferenceBounds | undefined {
  // Include exactly the pixels whose centers are covered by the half-open quad.
  const minX = Math.max(0, Math.ceil(left - 0.5))
  const minY = Math.max(0, Math.ceil(top - 0.5))
  const maxX = Math.min(width - 1, Math.ceil(right - 0.5) - 1)
  const maxY = Math.min(height - 1, Math.ceil(bottom - 0.5) - 1)
  return minX > maxX || minY > maxY ? undefined : { minX, minY, maxX, maxY }
}

function unionBounds(
  current: MtsdfCpuReferenceBounds | undefined,
  next: MtsdfCpuReferenceBounds,
): MtsdfCpuReferenceBounds {
  if (current === undefined) return next
  return {
    minX: Math.min(current.minX, next.minX),
    minY: Math.min(current.minY, next.minY),
    maxX: Math.max(current.maxX, next.maxX),
    maxY: Math.max(current.maxY, next.maxY),
  }
}

function bilinearChannel(
  texels: Uint8Array,
  resource: MsdfResource,
  layer: number,
  x: number,
  y: number,
  channel: number,
  bounds: MtsdfCpuReferenceBounds,
): number {
  const clampedX = Math.min(bounds.maxX, Math.max(bounds.minX, x))
  const clampedY = Math.min(bounds.maxY, Math.max(bounds.minY, y))
  const x0 = Math.floor(clampedX)
  const y0 = Math.floor(clampedY)
  const x1 = Math.min(bounds.maxX, x0 + 1)
  const y1 = Math.min(bounds.maxY, y0 + 1)
  const fractionX = clampedX - x0
  const fractionY = clampedY - y0
  const rowStride = resource.atlas.width * 4
  const layerOffset = layer * resource.atlas.height * rowStride
  const sample = (sampleX: number, sampleY: number): number =>
    texels[layerOffset + sampleY * rowStride + sampleX * 4 + channel]!
  const top = sample(x0, y0) * (1 - fractionX) + sample(x1, y0) * fractionX
  const bottom = sample(x0, y1) * (1 - fractionX) + sample(x1, y1) * fractionX
  return top * (1 - fractionY) + bottom * fractionY
}

function compositeFill(
  pixels: Uint8Array,
  offset: number,
  fill: readonly [number, number, number, number],
  coverage: number,
): void {
  const sourceAlpha = fill[3] * coverage
  const destinationScale = 1 - sourceAlpha
  pixels[offset] = byte(fill[0] * sourceAlpha * 255 + pixels[offset]! * destinationScale)
  pixels[offset + 1] = byte(fill[1] * sourceAlpha * 255 + pixels[offset + 1]! * destinationScale)
  pixels[offset + 2] = byte(fill[2] * sourceAlpha * 255 + pixels[offset + 2]! * destinationScale)
}

function opaqueBlack(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4)
  for (let alpha = 3; alpha < pixels.byteLength; alpha += 4) pixels[alpha] = 255
  return pixels
}

function median(a: number, b: number, c: number): number {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c))
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function byte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)))
}

function linearColor(
  color: readonly [number, number, number, number],
): readonly [number, number, number, number] {
  if (color.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new TypeError('MTSDF CPU reference fill must contain four linear values in [0, 1]')
  }
  return color
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`)
  return value
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive`)
  return value
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`)
  }
  return value
}

function nonnegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer`)
  }
  return value
}
