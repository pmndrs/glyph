import { describe, expect, it } from 'vitest'

import { liveTextPosition } from './live-text-style'

describe('live text position', () => {
  it('centers the stable typewriter measure without centering its changing text bounds', () => {
    expect(liveTextPosition('top-start', 900, 640, 640, 20)).toEqual([130, -48])
    expect(liveTextPosition('top-start', 900, 640, 640, 260)).toEqual([130, -48])
  })

  it('centers ordinary live specimens from their committed layout bounds', () => {
    expect(liveTextPosition('center', 900, 640, 640, 260)).toEqual([130, -190])
  })
})
