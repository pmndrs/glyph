import { describe, expect, it } from 'vitest'

import { ladderDeviceSizes } from './comparison-workload'

describe('text ladder scale selection', () => {
  it('fills a tall viewport with the complete ordered scale', () => {
    expect(ladderDeviceSizes(1_700, 1)).toEqual([
      8, 10, 12, 14, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 160, 192, 256, 512,
    ])
  })

  it('keeps the complete physical range on a small viewport and at both DPRs', () => {
    expect(ladderDeviceSizes(360, 1)).toEqual(ladderDeviceSizes(360, 2))
    expect(ladderDeviceSizes(360, 1).at(0)).toBe(8)
    expect(ladderDeviceSizes(360, 1).at(-1)).toBe(512)
  })

  it('rejects invalid physical viewport inputs', () => {
    expect(() => ladderDeviceSizes(0, 1)).toThrow('text ladder viewport height must be positive')
    expect(() => ladderDeviceSizes(360, 0)).toThrow('text ladder DPR must be positive')
  })
})
