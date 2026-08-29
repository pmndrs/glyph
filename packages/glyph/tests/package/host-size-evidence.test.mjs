import assert from 'node:assert/strict';
import test from 'node:test';

import { assertHostSizeEvidenceFresh } from '../../scripts/support/host-size-evidence.mjs';

const budgets = { rawBytes: 78_000, optimizedBytes: 71_000, gzipBytes: 31_000, brotliBytes: 26_000 };
const recorded = evidence('darwin', 'arm64', 67_000, 'a'.repeat(64));

test('requires exact size evidence freshness on the recorded host', () => {
  assert.doesNotThrow(() => assertHostSizeEvidenceFresh(recorded, structuredClone(recorded), budgets));
  const stale = structuredClone(recorded);
  stale.optimizedBytes += 1;
  assert.throws(() => assertHostSizeEvidenceFresh(recorded, stale, budgets), /same-host.*stale/);
});

test('accepts complete foreign-host evidence only within reviewed ceilings', () => {
  const foreign = evidence('linux', 'x64', 67_500, 'b'.repeat(64));
  assert.doesNotThrow(() => assertHostSizeEvidenceFresh(recorded, foreign, budgets));
  foreign.rawBytes = budgets.rawBytes + 1;
  assert.throws(() => assertHostSizeEvidenceFresh(recorded, foreign, budgets), /rawBytes budget/);
});

test('keeps the portable admission contract exact on every host', () => {
  const changed = evidence('linux', 'x64', 67_500, 'b'.repeat(64));
  changed.wasmImportCount = 1;
  assert.throws(() => assertHostSizeEvidenceFresh(recorded, changed, budgets), /contract is stale/);
});

function evidence(platform, architecture, rawBytes, optimizedSha256) {
  return {
    schemaVersion: 0,
    kind: 'test-size-evidence',
    toolchain: { rust: '1.97.1', binaryen: '129.0.0', target: 'wasm32-unknown-unknown' },
    syntheticOutputFnv1a32: '4f1de5a5',
    wasmImportCount: 0,
    measurementHost: { platform, architecture },
    rawBytes,
    optimizedBytes: 60_000,
    gzipBytes: 26_000,
    brotliBytes: 22_000,
    optimizedSha256,
  };
}
