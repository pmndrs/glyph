import { describe, expect, it } from 'vitest'

import { liveTextPosition } from './live-text-style'

describe('live text position', () => {
  it('keeps a stable typewriter measure at a fixed top inset', () => {
    expect(liveTextPosition('top-start', 900, 640, 640, 20)).toEqual([130, -48])
    expect(liveTextPosition('top-start', 900, 640, 640, 260)).toEqual([130, -48])
  })

  it('centers a stable paragraph measure in both axes', () => {
    expect(liveTextPosition('measure-center', 900, 640, 640, 260)).toEqual([130, -190])
  })

  it('centers ordinary live specimens from their committed layout bounds', () => {
    expect(liveTextPosition('center', 900, 640, 640, 260)).toEqual([130, -190])
  })
})
