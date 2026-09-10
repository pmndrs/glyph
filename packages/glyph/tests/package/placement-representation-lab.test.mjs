import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deterministicPlacementCorpus,
  evaluatePlacementSample,
  float32Bits,
  oneNarrowPlacement,
  summarizePlacementCandidates,
} from '../../scripts/support/placement-representation-lab.mjs';

const FLOAT32_INPUT = new DataView(new ArrayBuffer(4));

test('plain f32 placement has a pinned double-rounding counterexample', () => {
  const result = evaluatePlacementSample({
    name: 'f32-boundary-double-rounding',
    local: 16_777_217,
    translation: -16_777_216,
    anchor: 16_777_216,
  });
  assert.equal(result.expected, 1);
  assert.equal(result.plainF32, 0);
  assert.notEqual(float32Bits(result.expected), float32Bits(result.plainF32));
});

test('high/low translation can recover a tail without implying universal parity', () => {
  const result = evaluatePlacementSample({
    name: 'high-low-recovers-translation-tail',
    local: 1,
    translation: 16_777_217,
    anchor: 0,
  });
  assert.equal(result.expected, 16_777_218);
  assert.equal(result.plainF32, 16_777_216);
  assert.equal(result.highLowTranslation, result.expected);
});

test('the placement oracle rejects non-finite inputs and finite inputs that overflow f32', () => {
  for (const [local, translation] of [
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [0, Number.NEGATIVE_INFINITY],
  ]) {
    assert.throws(() => oneNarrowPlacement(local, translation), /must be finite/);
  }
  assert.throws(
    () => evaluatePlacementSample({ name: 'invalid-anchor', local: 0, translation: 0, anchor: Number.NaN }),
    /anchor must be finite/,
  );

  for (const sign of [-1, 1]) {
    assert.throws(
      () => oneNarrowPlacement(sign * 3.4028234663852886e38, sign * 3.4028234663852886e38),
      /placement must fit finite f32/,
    );
  }
});

test('the deterministic corpus reports error without claiming an encoding is bit-exact', () => {
  const summary = summarizePlacementCandidates(deterministicPlacementCorpus());
  assert.equal(summary.samples, 4_111);
  assert.equal(summary.finiteReferences, 4_111);
  for (const candidate of Object.values(summary.candidates)) {
    assert.ok(candidate.bitExact < summary.samples);
    assert.ok(candidate.bitMismatches > 0);
    assert.equal(candidate.falseOverflows, 0);
    assert.ok(Number.isFinite(candidate.maxAbsoluteError));
    assert.ok(Number.isSafeInteger(candidate.maxUlpError));
  }
  assert.deepEqual(summary.candidates, {
    plainF32: {
      bitExact: 3_890,
      bitMismatches: 221,
      falseOverflows: 0,
      maxAbsoluteError: 1.5845632502852868e29,
      maxAbsoluteErrorSample: 'random-2970',
      maxUlpError: 1_065_353_216,
      maxUlpErrorSample: 'negative-cancellation',
    },
    highLowTranslation: {
      bitExact: 3_982,
      bitMismatches: 129,
      falseOverflows: 0,
      maxAbsoluteError: 1.5845632502852868e29,
      maxAbsoluteErrorSample: 'random-2970',
      maxUlpError: 1_065_353_216,
      maxUlpErrorSample: 'negative-cancellation',
    },
    breakAnchor: {
      bitExact: 3_196,
      bitMismatches: 915,
      falseOverflows: 0,
      maxAbsoluteError: 4_096,
      maxAbsoluteErrorSample: 'random-66',
      maxUlpError: 1_065_353_216,
      maxUlpErrorSample: 'negative-cancellation',
    },
  });
});

test('direct raster offsets preserve the current f32 origin operation bits', () => {
  const samples = [
    0,
    -0,
    2 ** -149,
    -(2 ** -149),
    1,
    -1,
    16_777_216,
    -16_777_216,
    3.4028234663852886e38,
    -3.4028234663852886e38,
  ];
  let state = 0x7a11_ce55;
  for (let index = 0; index < 65_536; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    samples.push(float32FromBits(state >>> 0));
  }

  for (let index = 0; index + 1 < samples.length; index += 2) {
    const origin = Math.fround(samples[index]);
    const bearing = Math.fround(samples[index + 1]);
    if (!Number.isFinite(origin) || !Number.isFinite(bearing)) continue;

    const legacyInline = Math.fround(origin + bearing);
    const directInline = Math.fround(bearing + origin);
    if (Number.isFinite(legacyInline)) assert.equal(float32Bits(directInline), float32Bits(legacyInline));

    const legacyBlock = Math.fround(origin - bearing);
    const localBlock = Math.fround(0 - bearing);
    const directBlock = Math.fround(localBlock + origin);
    if (Number.isFinite(legacyBlock)) assert.equal(float32Bits(directBlock), float32Bits(legacyBlock));
  }
});

function float32FromBits(bits) {
  FLOAT32_INPUT.setUint32(0, bits, false);
  return FLOAT32_INPUT.getFloat32(0, false);
}
