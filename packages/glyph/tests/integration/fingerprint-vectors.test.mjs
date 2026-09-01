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
  assert.ok(
    [...lengths].some((length) => length > 32),
    'corpus must cover multi-block accumulation',
  );
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

test('the compatibility digest matches its published canonical form', async () => {
  // Pinned against a value mmh3 produced outside this repository, and against the identical
  // assertion in rust/raster-artifact. The canonical form is published contract: a build pipeline
  // records the digest beside its inputs and recomputes it later from its own manifest.
  const { compatibilityFingerprint } = await import('../../dist/internal/raster-identity.js');
  assert.equal(
    compatibilityFingerprint({
      glyphCount: 2937,
      glyphIdWidth: 16,
      kind: 'bitmap',
      rasterKey: 'd1dcd31304f795b5f2c497c579aa29f0',
      shaping: '0c522d6ea0db73ba74bcc389dc50263b',
      version: 0,
    }),
    '8b23c028dd6cd2d31a61b00c35bbcbe0',
  );
  assert.equal(corpus.seeds.compatibility ?? 0x636d7030, fingerprintDomain.compatibility);
});
