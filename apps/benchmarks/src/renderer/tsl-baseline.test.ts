import { describe, expect, it } from 'vitest'

import { assertTslBaselinePixels, compactRgba8Readback } from './tsl-baseline'

describe('TSL renderer baseline oracle', () => {
  it('accepts the exact fixed red readback', () => {
    const pixels = new Uint8Array(4 * 4 * 4)
    for (let offset = 0; offset < pixels.byteLength; offset += 4) {
      pixels.set([255, 0, 0, 255], offset)
    }
    expect(() => assertTslBaselinePixels(pixels)).not.toThrow()
  })

  it('rejects an intentional wrong-pixel negative control', () => {
    const pixels = new Uint8Array(4 * 4 * 4)
    for (let offset = 0; offset < pixels.byteLength; offset += 4) {
      pixels.set([255, 0, 0, 255], offset)
    }
    pixels[17] = 1
    expect(() => assertTslBaselinePixels(pixels)).toThrow('pixel 4 channel 1')
  })

  it('removes the row alignment returned by the WebGPU readback path', () => {
    const padded = new Uint8Array(256 * 3 + 16)
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        padded.set([255, 0, 0, 255], row * 256 + column * 4)
      }
    }
    const compact = compactRgba8Readback(padded, 4, 4)
    expect(compact).toHaveLength(64)
    expect(() => assertTslBaselinePixels(compact)).not.toThrow()
  })
})
