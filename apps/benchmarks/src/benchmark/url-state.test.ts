import { describe, expect, it } from 'vitest'
import { readHarnessLocation, writeHarnessLocation } from './url-state'

describe('harness URL state', () => {
  it('round-trips a reproducible selection', () => {
    const value = {
      mode: 'conformance',
      technique: 'bitmap',
      backend: 'webgl2',
      delivery: 'runtime',
      fontFixture: 'source-serif-4',
      workload: 'text-accuracy',
      view: 'report',
    } as const
    expect(readHarnessLocation(writeHarnessLocation(value))).toEqual(value)
  })

  it('rejects unknown axes without losing the human-facing workload', () => {
    expect(
      readHarnessLocation(
        '?mode=unknown&technique=unknown&backend=unknown&font=unknown&workload=text-ladder&view=unknown',
      ),
    ).toEqual({
      mode: 'benchmark',
      technique: 'bitmap',
      backend: 'webgpu',
      delivery: 'baked',
      fontFixture: 'inter',
      workload: 'text-ladder',
      view: 'scene',
    })
  })

  it('maps old bitmap target and scenario links into conformance', () => {
    expect(readHarnessLocation('?target=bitmap-text-webgl2&scenario=bitmap-text-frame')).toEqual({
      mode: 'conformance',
      technique: 'bitmap',
      backend: 'webgl2',
      delivery: 'baked',
      fontFixture: 'inter',
      workload: 'text-accuracy',
      view: 'scene',
    })
  })
})
