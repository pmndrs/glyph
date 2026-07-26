import { describe, expect, it } from 'vitest'
import baseline from '../../fixtures/results/bake-host-baseline-v0.json'

describe('offline and Worker bake-host baseline', () => {
  it('records canonical byte parity and separate positive cold/warm phases', () => {
    expect(baseline.schemaVersion).toBe(0)
    expect(baseline.artifact.bytes).toBe(172_140)
    expect(baseline.artifact.sha256).toBe(
      '296f23ff52aa50bdec3662b1037cd3648be814de089e122e828f88bd8f29c4f8',
    )
    for (const host of [baseline.offline, baseline.worker]) {
      expect(host.samples).toHaveLength(3)
      expect(host.coldMedianMs).toBeGreaterThan(0)
      expect(host.warmMedianMs).toBeGreaterThan(0)
      for (const sample of host.samples) {
        expect(sample.coldMs).toBeGreaterThan(0)
        expect(sample.warmMs).toBeGreaterThan(0)
      }
    }
  })
})
