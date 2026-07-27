import { describe, expect, it } from 'vitest'

import { sparklineSampleX } from './sparkline'

describe('sparklineSampleX', () => {
  it('streams partial history in from the right without rescaling its width', () => {
    expect(sparklineSampleX(0, 1, 4, 300)).toBe(300)
    expect(sparklineSampleX(0, 2, 4, 300)).toBe(200)
    expect(sparklineSampleX(1, 2, 4, 300)).toBe(300)
  })

  it('uses the full fixed domain once the history window is full', () => {
    expect(sparklineSampleX(0, 4, 4, 300)).toBe(0)
    expect(sparklineSampleX(1, 4, 4, 300)).toBe(100)
    expect(sparklineSampleX(3, 4, 4, 300)).toBe(300)
  })
})
