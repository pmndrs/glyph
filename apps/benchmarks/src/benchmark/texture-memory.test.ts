import { describe, expect, it } from 'vitest'

import { exactMipmappedTextureArrayBytes } from './texture-memory'

describe('exact mipmapped texture-array accounting', () => {
  it('sums every power-of-two mip level exactly', () => {
    expect(exactMipmappedTextureArrayBytes(1024, 1024, 10, 4)).toBe(55_924_040)
  })

  it('floor-halves non-power-of-two dimensions at every level', () => {
    expect(exactMipmappedTextureArrayBytes(1024, 1023, 24, 4)).toBe(134_021_280)
    expect(exactMipmappedTextureArrayBytes(1024, 1017, 44, 4)).toBe(244_308_944)
  })

  it('counts the sole level of a one-texel array', () => {
    expect(exactMipmappedTextureArrayBytes(1, 1, 3, 4)).toBe(12)
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid dimensions and unsafe arithmetic (%s)',
    (value) => {
      expect(() => exactMipmappedTextureArrayBytes(value, 1, 1, 4)).toThrow(RangeError)
    },
  )

  it('rejects a mip level whose byte length exceeds safe integer range', () => {
    expect(() => exactMipmappedTextureArrayBytes(Number.MAX_SAFE_INTEGER, 1, 2, 4)).toThrow(
      'mip byte length exceeds safe integer range',
    )
  })
})
