import { describe, expect, it } from 'vitest'

import { createCanvasGridPositions } from './canvas-surface'

describe('canvas surface grid', () => {
  it('builds fixed one-CSS-pixel grid quads at the sixteen-pixel design rhythm', () => {
    const positions = createCanvasGridPositions(32, 32)
    expect(positions).toHaveLength(4 * 6 * 3)
    expect(Array.from(positions.slice(0, 18))).toEqual([
      15, 0, 0, 15, -32, 0, 16, 0, 0, 15, -32, 0, 16, -32, 0, 16, 0, 0,
    ])
  })

  it('rejects invalid viewport dimensions before allocating geometry', () => {
    expect(() => createCanvasGridPositions(0, 32)).toThrow(RangeError)
    expect(() => createCanvasGridPositions(32, Number.NaN)).toThrow(RangeError)
  })
})
