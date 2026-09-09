const FLOAT32_BITS = new DataView(new ArrayBuffer(4));

export const placementCandidates = Object.freeze({
  plainF32(local, translation) {
    return Math.fround(Math.fround(local) + Math.fround(translation));
  },
  highLowTranslation(local, translation) {
    const high = Math.fround(translation);
    const low = Math.fround(translation - high);
    return Math.fround(high + Math.fround(Math.fround(local) + low));
  },
  breakAnchor(local, translation, anchor) {
    const localFromAnchor = Math.fround(Math.fround(local) - Math.fround(anchor));
    const lineOrigin = Math.fround(anchor + translation);
    return Math.fround(localFromAnchor + lineOrigin);
  },
});

export function oneNarrowPlacement(local, translation) {
  assertFinite(local, 'local');
  assertFinite(translation, 'translation');
  const narrowed = Math.fround(local + translation);
  if (!Number.isFinite(narrowed)) throw new RangeError('placement must fit finite f32');
  return narrowed;
}

export function evaluatePlacementSample(placementSample) {
  assertFinite(placementSample.local, 'local');
  assertFinite(placementSample.translation, 'translation');
  assertFinite(placementSample.anchor, 'anchor');
  const expected = oneNarrowPlacement(placementSample.local, placementSample.translation);
  return Object.freeze({
    expected,
    plainF32: placementCandidates.plainF32(placementSample.local, placementSample.translation),
    highLowTranslation: placementCandidates.highLowTranslation(placementSample.local, placementSample.translation),
    breakAnchor: placementCandidates.breakAnchor(
      placementSample.local,
      placementSample.translation,
      placementSample.anchor,
    ),
  });
}

export function deterministicPlacementCorpus(randomCount = 4096) {
  if (!Number.isSafeInteger(randomCount) || randomCount < 0) {
    throw new RangeError('randomCount must be a non-negative safe integer');
  }
  const samples = [
    sample('tiny-world-positive', 0.000_123_456_789, 0.000_987_654_321, 0.000_1),
    sample('tiny-world-cancellation', 2 ** -80, -(2 ** -80) + 2 ** -120, 2 ** -81),
    sample('large-positive', 2 ** 40 + 0.375, 2 ** 42 + 0.625, 2 ** 40),
    sample('large-negative', -(2 ** 39 + 0.75), -(2 ** 41 + 0.125), -(2 ** 39)),
    sample('negative-cancellation', -(2 ** 24 + 1), 2 ** 24, -(2 ** 24)),
    sample('f32-boundary-double-rounding', 16_777_217, -16_777_216, 16_777_216),
    sample('high-low-recovers-translation-tail', 1, 16_777_217, 0),
    sample('positive-subnormal-boundary', 2 ** -149, 2 ** -150, 0),
    sample('negative-subnormal-boundary', -(2 ** -149), -(2 ** -150), 0),
    ...justificationLikeSamples(),
  ];
  const random = xorshift32(0x5eed_1234);
  for (let index = 0; index < randomCount; index += 1) {
    const local = randomFinite(random, -120, 120);
    const translation = randomFinite(random, -120, 120);
    const anchorDelta = randomFinite(random, -30, 10);
    samples.push(sample(`random-${index}`, local, translation, local - anchorDelta));
  }
  return Object.freeze(samples);
}

export function summarizePlacementCandidates(samples) {
  const candidates = Object.keys(placementCandidates);
  const summaries = Object.fromEntries(candidates.map((candidate) => [candidate, emptySummary()]));
  let finiteReferences = 0;
  for (const placementSample of samples) {
    const result = evaluatePlacementSample(placementSample);
    finiteReferences += 1;
    for (const candidate of candidates) {
      includeResult(summaries[candidate], candidate, placementSample, result);
    }
  }
  return Object.freeze({
    samples: samples.length,
    finiteReferences,
    candidates: Object.freeze(
      Object.fromEntries(candidates.map((candidate) => [candidate, Object.freeze(summaries[candidate])])),
    ),
  });
}

export function float32Bits(value) {
  FLOAT32_BITS.setFloat32(0, value, false);
  return FLOAT32_BITS.getUint32(0, false);
}

function includeResult(summary, candidate, placementSample, result) {
  const expected = result.expected;
  const actual = result[candidate];
  if (float32Bits(expected) === float32Bits(actual)) summary.bitExact += 1;
  else summary.bitMismatches += 1;
  if (!Number.isFinite(actual)) {
    summary.falseOverflows += 1;
    return;
  }
  const absoluteError = Math.abs(expected - actual);
  const ulpError = float32UlpDistance(expected, actual);
  if (absoluteError > summary.maxAbsoluteError) {
    summary.maxAbsoluteError = absoluteError;
    summary.maxAbsoluteErrorSample = placementSample.name;
  }
  if (ulpError > summary.maxUlpError) {
    summary.maxUlpError = ulpError;
    summary.maxUlpErrorSample = placementSample.name;
  }
}

function emptySummary() {
  return {
    bitExact: 0,
    bitMismatches: 0,
    falseOverflows: 0,
    maxAbsoluteError: 0,
    maxAbsoluteErrorSample: undefined,
    maxUlpError: 0,
    maxUlpErrorSample: undefined,
  };
}

function float32UlpDistance(left, right) {
  return Math.abs(orderedFloat32Bits(left) - orderedFloat32Bits(right));
}

function orderedFloat32Bits(value) {
  const bits = float32Bits(value);
  const magnitude = bits & 0x7fff_ffff;
  return bits >>> 31 === 0 ? 0x8000_0000 + magnitude : 0x8000_0000 - magnitude;
}

function justificationLikeSamples() {
  const unit = 1 / 65_536;
  const quotient = 12_345;
  const remainder = 7;
  return [0, 1, 6, 7, 31, 255].map((ordinal) => {
    const displacement = (ordinal * quotient + Math.min(ordinal, remainder)) * unit;
    const local = 1_024.125 + displacement;
    return sample(`justification-ordinal-${ordinal}`, local, -511.75, 1_024.125);
  });
}

function randomFinite(random, minimumExponent, maximumExponent) {
  const sign = random() & 1 ? -1 : 1;
  const exponent = minimumExponent + (random() % (maximumExponent - minimumExponent + 1));
  const fraction = random() / 0x1_0000_0000;
  return sign * (1 + fraction) * 2 ** exponent;
}

function xorshift32(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function sample(name, local, translation, anchor) {
  return Object.freeze({ name, local, translation, anchor });
}

function assertFinite(value, label) {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
}
