import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { fingerprint128, fingerprintDomain, isFingerprint } from '../../dist/internal/fingerprint.js';

// This hash is implemented twice: in Rust at `rust/raster-artifact/src/lib.rs`, and here in
// TypeScript. Rust stamps external page filenames at bake time and TypeScript recomputes them at
// load time, so one divergent bit makes every external page 404. Both implementations verify
// against the same corpus, which mmh3 produced outside this repository — checking the ports
// against an outside implementation catches a bug they share, which comparing them to each other
// cannot.
const corpus = JSON.parse(
  await readFile(new URL('../../rust/raster-artifact/evidence/fingerprint-vectors-v0.json', import.meta.url), 'utf8'),
);

test('the corpus seeds are this package’s domain seeds', () => {
  // The corpus is only evidence about this package while its seeds are this package's seeds.
  for (const [domain, seed] of Object.entries(fingerprintDomain)) {
    assert.equal(corpus.seeds[domain], seed, `${domain} seed drifted from the corpus`);
  }
  assert.equal(corpus.seeds.zero, 0);
});

test('fingerprint128 matches independent reference vectors', () => {
  const lengths = new Set();
  let checked = 0;
  for (const entry of corpus.cases) {
    const input = Uint8Array.from(Buffer.from(entry.input, 'hex'));
    assert.equal(input.byteLength, entry.length, 'case length disagrees with its payload');
    lengths.add(entry.length);
    for (const [domain, expected] of Object.entries(entry.fingerprints)) {
      const produced = fingerprint128(input, corpus.seeds[domain]);
      assert.equal(produced, expected, `length ${entry.length} seed ${domain}`);
      assert.ok(isFingerprint(produced), 'a fingerprint must be 32 lowercase hex digits');
      checked += 1;
    }
  }

  // Lengths 0..=32 walk every arm of the 15-branch tail and both block boundaries. Without this
  // the corpus can pass while one arm is wrong.
  for (let length = 0; length <= 32; length += 1) {
    assert.ok(lengths.has(length), `corpus is missing length ${length}`);
  }
  assert.ok([...lengths].some((length) => length > 32), 'corpus must cover multi-block accumulation');
  assert.equal(checked, corpus.cases.length * Object.keys(corpus.seeds).length, 'corpus is ragged');
});

test('fingerprint128 reads a subarray by its own bounds', () => {
  // Every caller hands this function a view, not a whole buffer. A port that reaches through to
  // the underlying ArrayBuffer passes the corpus above and still corrupts real bakes.
  const backing = new Uint8Array(64).fill(0xab);
  const payload = Uint8Array.from(Buffer.from(corpus.cases[20].input, 'hex'));
  backing.set(payload, 16);
  const view = backing.subarray(16, 16 + payload.byteLength);
  assert.equal(fingerprint128(view, fingerprintDomain.artifact), corpus.cases[20].fingerprints.artifact);
});
