import type { ParagraphLayout } from '@pmndrs/text'
import type { MsdfResource } from '@pmndrs/text/raster/msdf'
import * as THREE from 'three/webgpu'
import { describe, expect, it } from 'vitest'

import { compareRgba8Coverage, renderFlatMtsdfCpuReference } from './mtsdf-cpu-reference'

describe('RGBA8 coverage comparison', () => {
  it('uses red for extra candidate coverage and cyan for extra reference coverage', () => {
    const comparison = compareRgba8Coverage(
      Uint8Array.from([20, 20, 20, 255, 10, 10, 10, 255, 7, 7, 7, 255]),
      Uint8Array.from([10, 10, 10, 255, 20, 20, 20, 255, 7, 7, 7, 255]),
      8,
    )

    expect(Array.from(comparison.heatmap)).toEqual([80, 0, 0, 255, 0, 80, 80, 255, 0, 0, 0, 255])
    expect(comparison).toMatchObject({
      meanAbsoluteError: 20 / 3,
      maximumError: 10,
      errorPixels: 2,
      severeErrorPixels: 0,
    })
  })
})

describe('flat MTSDF CPU reference', () => {
  it('uses the RGB median rather than the true-distance alpha channel', () => {
    const resource = specimenResource([
      255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0,
    ])
    const result = renderFlatMtsdfCpuReference(resource, specimenLayout(), {
      width: 4,
      height: 4,
      fill: [1, 0.5, 0, 1],
    })

    expect(result.bounds).toEqual({ minX: 0, minY: 0, maxX: 3, maxY: 3 })
    expect(result.glyphCount).toBe(1)
    expect(Array.from(result.pixels.slice(0, 4))).toEqual([255, 128, 0, 255])
    expect(channels(result.pixels, 0)).toEqual(new Set([255]))
  })

  it('performs scalar bilinear sampling at physical pixel centers', () => {
    const resource = specimenResource([
      0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255, 0,
    ])
    const result = renderFlatMtsdfCpuReference(resource, specimenLayout(), {
      width: 4,
      height: 4,
    })

    // The 2×2 atlas is magnified to a 4×4 quad. Interior device pixels blend
    // neighboring texels, producing coverage levels unavailable to nearest sampling.
    expect(redRows(result.pixels, 4)).toEqual([
      [0, 64, 191, 255],
      [0, 64, 191, 255],
      [0, 64, 191, 255],
      [0, 64, 191, 255],
    ])
  })

  it('maps top-down paragraph pixels onto the vertically packed texture array', () => {
    const resource = specimenResource([
      0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 0, 255, 255, 255, 0,
    ])
    const result = renderFlatMtsdfCpuReference(resource, specimenLayout(), {
      width: 4,
      height: 4,
    })

    expect(redRows(result.pixels, 4)).toEqual([
      [255, 255, 255, 255],
      [191, 191, 191, 191],
      [64, 64, 64, 64],
      [0, 0, 0, 0],
    ])
  })

  it('accounts for bottom padding when an atlas layer is taller than its page', () => {
    const texels = new Uint8Array(2 * 4 * 4)
    texels.fill(255, 2 * 2 * 4)
    const texture = new THREE.DataArrayTexture(texels, 2, 4, 1)
    const resource: MsdfResource = {
      ...specimenResource(new Array(16).fill(0)),
      pages: [{ width: 2, height: 2 }],
      atlas: { width: 2, height: 4, layers: 1, texture },
      gpuBytes: texels.byteLength,
    }

    const result = renderFlatMtsdfCpuReference(resource, specimenLayout(), {
      width: 4,
      height: 4,
    })

    expect(channels(result.pixels, 0)).toEqual(new Set([255]))
  })

  it('clips deterministic half-open quad bounds and composites overlapping glyphs', () => {
    const records = new Uint8Array(40)
    writeRecord(records, 0, { planeLeft: -1, planeRight: 1 })
    writeRecord(records, 1, { planeLeft: -1, planeRight: 1 })
    const resource = specimenResource(
      [255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255],
      records,
    )
    const layout = specimenLayout({
      glyphIds: new Uint16Array([0, 1]),
      glyphFontSlots: new Uint16Array([0, 0]),
      glyphFontSizes: new Float32Array([2, 2]),
      x: new Float32Array([0, 2]),
      y: new Float32Array([4, 4]),
    })
    const result = renderFlatMtsdfCpuReference(resource, layout, {
      width: 3,
      height: 4,
      originX: -0.5,
      fill: [1, 1, 1, 0.5],
    })

    expect(result.bounds).toEqual({ minX: 0, minY: 0, maxX: 2, maxY: 3 })
    expect(result.glyphCount).toBe(2)
    expect(redRows(result.pixels, 3)).toEqual([
      [192, 128, 128],
      [192, 128, 128],
      [192, 128, 128],
      [192, 128, 128],
    ])
  })

  it('skips absent records and rejects malformed resource boundaries', () => {
    const records = new Uint8Array(20)
    writeRecord(records, 0, { pageIndex: 0xffff })
    expect(
      renderFlatMtsdfCpuReference(
        specimenResource(new Array(16).fill(0), records),
        specimenLayout(),
        {
          width: 4,
          height: 4,
        },
      ),
    ).toMatchObject({ glyphCount: 0, bounds: undefined })

    const malformed = specimenResource(new Array(16).fill(0))
    Object.defineProperty(malformed.atlas.texture.image, 'data', { value: new Uint8Array(3) })
    expect(() =>
      renderFlatMtsdfCpuReference(malformed, specimenLayout(), { width: 4, height: 4 }),
    ).toThrow('atlas byte length')
  })
})

function specimenResource(texels: readonly number[], records = defaultRecords()): MsdfResource {
  const texture = new THREE.DataArrayTexture(Uint8Array.from(texels), 2, 2, 1)
  return {
    emSize: 2,
    pixelRange: 0.25,
    planeUnitsPerEm: 1,
    records,
    pages: [{ width: 2, height: 2 }],
    atlas: { width: 2, height: 2, layers: 1, texture },
    gpuBytes: 16,
  }
}

function defaultRecords(): Uint8Array {
  const records = new Uint8Array(20)
  writeRecord(records, 0, {})
  return records
}

function writeRecord(
  bytes: Uint8Array,
  glyphId: number,
  overrides: {
    readonly planeLeft?: number
    readonly planeRight?: number
    readonly pageIndex?: number
  },
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const offset = glyphId * 20
  view.setInt16(offset, overrides.planeLeft ?? 0, true)
  view.setInt16(offset + 2, 0, true)
  view.setInt16(offset + 4, overrides.planeRight ?? 2, true)
  view.setInt16(offset + 6, 2, true)
  view.setUint16(offset + 8, 0, true)
  view.setUint16(offset + 10, 0, true)
  view.setUint16(offset + 12, 2, true)
  view.setUint16(offset + 14, 2, true)
  view.setUint16(offset + 16, overrides.pageIndex ?? 0, true)
}

function specimenLayout(
  overrides: Partial<
    Pick<ParagraphLayout, 'glyphIds' | 'glyphFontSlots' | 'glyphFontSizes' | 'x' | 'y'>
  > = {},
): ParagraphLayout {
  return {
    width: 4,
    height: 4,
    contentWidth: 4,
    contentHeight: 4,
    firstBaseline: 2,
    lastBaseline: 2,
    overflowed: false,
    fontHandles: new Uint32Array([1]),
    glyphFontSlots: overrides.glyphFontSlots ?? new Uint16Array([0]),
    glyphIds: overrides.glyphIds ?? new Uint16Array([0]),
    clusters: new Uint32Array(overrides.glyphIds?.length ?? 1),
    glyphFontSizes: overrides.glyphFontSizes ?? new Float32Array([2]),
    x: overrides.x ?? new Float32Array([0]),
    y: overrides.y ?? new Float32Array([4]),
    glyphFlags: new Uint16Array(overrides.glyphIds?.length ?? 1),
    lineTextStarts: new Uint32Array([0]),
    lineTextEnds: new Uint32Array([1]),
    lineGlyphStarts: new Uint32Array([0]),
    lineGlyphCounts: new Uint32Array([overrides.glyphIds?.length ?? 1]),
    lineBaselines: new Float32Array([2]),
    lineAdvances: new Float32Array([4]),
  }
}

function channels(pixels: Uint8Array, channel: number): Set<number> {
  const values = new Set<number>()
  for (let offset = channel; offset < pixels.byteLength; offset += 4) values.add(pixels[offset]!)
  return values
}

function redRows(pixels: Uint8Array, width: number): number[][] {
  return Array.from({ length: pixels.byteLength / 4 / width }, (_row, y) =>
    Array.from({ length: width }, (_column, x) => pixels[(y * width + x) * 4]!),
  )
}
