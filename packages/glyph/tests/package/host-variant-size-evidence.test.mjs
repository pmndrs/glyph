import assert from 'node:assert/strict';
import test from 'node:test';

import { assertHostVariantSizeEvidenceFresh } from '../../scripts/support/host-variant-size-evidence.mjs';

const budget = { optimizedBytes: 65_000, gzipBytes: 27_000, brotliBytes: 23_000 };
const recorded = {
  targetFeatures: ['simd128'],
  optimizedBytes: 63_549,
  gzipBytes: 25_910,
  brotliBytes: 21_904,
  optimizedSha256: 'a'.repeat(64),
};

test('requires exact experimental Wasm identity on the recorded host', () => {
  assert.doesNotThrow(() =>
    assertHostVariantSizeEvidenceFresh('darwin-arm64', 'darwin-arm64', recorded, structuredClone(recorded), budget),
  );
  const stale = structuredClone(recorded);
  stale.optimizedSha256 = 'b'.repeat(64);
  assert.throws(
    () => assertHostVariantSizeEvidenceFresh('darwin-arm64', 'darwin-arm64', recorded, stale, budget),
    /same-host.*stale/,
  );
});

test('accepts complete bounded foreign-host measurements without weakening the variant contract', () => {
  const foreign = {
    ...recorded,
    gzipBytes: recorded.gzipBytes + 1,
    optimizedSha256: 'b'.repeat(64),
  };
  assert.doesNotThrow(() => assertHostVariantSizeEvidenceFresh('darwin-arm64', 'linux-x64', recorded, foreign, budget));
  foreign.brotliBytes = budget.brotliBytes + 1;
  assert.throws(
    () => assertHostVariantSizeEvidenceFresh('darwin-arm64', 'linux-x64', recorded, foreign, budget),
    /brotliBytes budget/,
  );
  foreign.brotliBytes = recorded.brotliBytes;
  foreign.targetFeatures = [];
  assert.throws(
    () => assertHostVariantSizeEvidenceFresh('darwin-arm64', 'linux-x64', recorded, foreign, budget),
    /target-feature contract/,
  );
});
