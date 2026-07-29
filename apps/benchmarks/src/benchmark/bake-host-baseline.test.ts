import { describe, expect, it } from 'vitest';
import baseline from '../../fixtures/results/bake-host-baseline-v0.json';

describe('offline and Worker bake-host baseline', () => {
  it('records canonical byte parity and separate positive cold/warm phases', () => {
    expect(baseline.schemaVersion).toBe(0);
    expect(baseline.artifact.bytes).toBe(172_156);
    expect(baseline.artifact.sha256).toBe('af7bfb85f04a6a63c6462735a6e8ec6d739576adb354c07ca51e744814db2f7b');
    for (const host of [baseline.offline, baseline.worker]) {
      expect(host.samples).toHaveLength(3);
      expect(host.coldMedianMs).toBeGreaterThan(0);
      expect(host.warmMedianMs).toBeGreaterThan(0);
      for (const sample of host.samples) {
        expect(sample.coldMs).toBeGreaterThan(0);
        expect(sample.warmMs).toBeGreaterThan(0);
      }
    }
  });
});
