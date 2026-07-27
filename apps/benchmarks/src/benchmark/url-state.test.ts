import { describe, expect, it } from 'vitest'
import { SELECTABLE_FONT_FIXTURE_IDS } from './font-fixtures'
import { readHarnessLocation, writeHarnessLocation } from './url-state'

describe('harness URL state', () => {
  it('round-trips a reproducible selection', () => {
    const value = {
      mode: 'conformance',
      technique: 'bitmap',
      backend: 'webgl2',
      delivery: 'runtime',
      dpr: 2,
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
      dpr: 1,
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
      dpr: 1,
      fontFixture: 'inter',
      workload: 'text-accuracy',
      view: 'scene',
    })
  })

  it('uses the device default only when a link does not select a DPR', () => {
    expect(readHarnessLocation('?dpr=1', 2).dpr).toBe(1)
    expect(readHarnessLocation('', 2).dpr).toBe(2)
    expect(readHarnessLocation('?dpr=3', 2).dpr).toBe(2)
  })

  it('accepts every fixture from the canonical selectable inventory', () => {
    for (const fontFixture of SELECTABLE_FONT_FIXTURE_IDS) {
      expect(readHarnessLocation(`?font=${fontFixture}`).fontFixture).toBe(fontFixture)
    }
  })
})
