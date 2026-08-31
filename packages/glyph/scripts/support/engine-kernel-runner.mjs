const CHUNK_SIZES = [32, 64, 128];

export async function benchmarkKernelArtifact(wasm, name, input, options) {
  const module = await WebAssembly.compile(wasm);
  const instance = await WebAssembly.instantiate(module, {});
  const exports = instance.exports;
  const expectedBackend = name === 'explicit' ? 1 : 0;
  if (exports.pmndrs_glyph_kernel_lab_backend() !== expectedBackend) {
    throw new Error(`${name} artifact selected the wrong compile-time kernel backend`);
  }
  registerPolicy(exports, input.policy);
  const aligned = createMemoryFixture(exports, input, 0);
  const unaligned = createMemoryFixture(exports, input, 4);
  const memoryBefore = exports.memory.buffer;
  const alignedHash = await executeAndHash(exports, aligned, false);
  const verticalHash = await executeAndHash(exports, aligned, true);
  const unalignedHash = await executeAndHash(exports, unaligned, false);
  if (alignedHash !== unalignedHash) throw new Error(`${name} aligned and unaligned outputs differ`);

  const iterations = input.glyphs < 50_000 ? 16 : 8;
  const timings = {
    pack: measure(() => checkedCall(() => callPack(exports, aligned, false)), iterations, options),
    breakMasksX1: measure(() => checkedCall(() => callBreakMasks(exports, aligned, 1)), iterations * 4, options),
    breakMasksX2: measure(() => checkedCall(() => callBreakMasks(exports, aligned, 2)), iterations * 4, options),
    breakMasksX4: measure(() => checkedCall(() => callBreakMasks(exports, aligned, 4)), iterations * 4, options),
    breakMasksX8: measure(() => checkedCall(() => callBreakMasks(exports, aligned, 8)), iterations * 4, options),
    bidiMasksX1: measure(() => checkedCall(() => callBidiMasks(exports, aligned, 1)), iterations * 4, options),
    bidiMasksX2: measure(() => checkedCall(() => callBidiMasks(exports, aligned, 2)), iterations * 4, options),
    bidiMasksX4: measure(() => checkedCall(() => callBidiMasks(exports, aligned, 4)), iterations * 4, options),
    bidiMasksX8: measure(() => checkedCall(() => callBidiMasks(exports, aligned, 8)), iterations * 4, options),
    flaggedScanX1: measure(() => checkedCall(() => callFlaggedScan(exports, aligned, 1)), iterations * 4, options),
    flaggedScanX2: measure(() => checkedCall(() => callFlaggedScan(exports, aligned, 2)), iterations * 4, options),
    flaggedScanX4: measure(() => checkedCall(() => callFlaggedScan(exports, aligned, 4)), iterations * 4, options),
    flaggedScanX8: measure(() => checkedCall(() => callFlaggedScan(exports, aligned, 8)), iterations * 4, options),
    transitionScanX1: measure(
      () => checkedCall(() => callTransitionScan(exports, aligned, 1)),
      iterations * 4,
      options,
    ),
    transitionScanX2: measure(
      () => checkedCall(() => callTransitionScan(exports, aligned, 2)),
      iterations * 4,
      options,
    ),
    transitionScanX4: measure(
      () => checkedCall(() => callTransitionScan(exports, aligned, 4)),
      iterations * 4,
      options,
    ),
    transitionScanX8: measure(
      () => checkedCall(() => callTransitionScan(exports, aligned, 8)),
      iterations * 4,
      options,
    ),
    policy: measure(() => checkedCall(() => callPolicy(exports, aligned, false)), iterations, options),
    chunk32: measure(() => checkedCall(() => callSummaries(exports, aligned, 32)), iterations * 2, options),
    chunk64: measure(() => checkedCall(() => callSummaries(exports, aligned, 64)), iterations * 2, options),
    chunk128: measure(() => checkedCall(() => callSummaries(exports, aligned, 128)), iterations * 2, options),
    i64Chunk64x1: measure(() => checkedCall(() => callI64Summaries(exports, aligned, 64, 1)), iterations * 2, options),
    i64Chunk64x2: measure(() => checkedCall(() => callI64Summaries(exports, aligned, 64, 2)), iterations * 2, options),
    i64Chunk64x4: measure(() => checkedCall(() => callI64Summaries(exports, aligned, 64, 4)), iterations * 2, options),
    i64Chunk64x8: measure(() => checkedCall(() => callI64Summaries(exports, aligned, 64, 8)), iterations * 2, options),
  };
  if (exports.memory.buffer !== memoryBefore) throw new Error(`${name} grew memory during a warm kernel`);
  exports.pmndrs_glyph_shaper_dealloc(aligned.allocationPointer, aligned.allocationLength);
  exports.pmndrs_glyph_shaper_dealloc(unaligned.allocationPointer, unaligned.allocationLength);
  return {
    label: input.label,
    glyphs: input.glyphs,
    outputHash: await hashParts([new TextEncoder().encode(alignedHash), new TextEncoder().encode(verticalHash)]),
    alignedOutputHash: alignedHash,
    unalignedOutputHash: unalignedHash,
    verticalOutputHash: verticalHash,
    warmMemoryGrowth: false,
    timings,
  };
}

function createMemoryFixture(exports, input, skew) {
  const allocationLength = input.glyphs * 112 + 4_096;
  const allocationPointer = exports.pmndrs_glyph_shaper_alloc(allocationLength);
  if (allocationPointer === 0) throw new Error('kernel-lab allocation failed');
  let cursor = alignWithSkew(allocationPointer, 16, skew);
  const reserve = (count, bytesPerElement, alignment) => {
    const addressSkew = skew === 0 ? 0 : alignment === 8 ? 8 : 4;
    cursor = alignWithSkew(cursor, 16, addressSkew);
    const pointer = cursor;
    cursor += count * bytesPerElement;
    return pointer;
  };
  const count = input.glyphs;
  const x = reserve(count, 4, 4);
  const y = reserve(count, 4, 4);
  const fontSize = reserve(count, 4, 4);
  const planeLeft = reserve(count, 4, 4);
  const planeBottom = reserve(count, 4, 4);
  const planeRight = reserve(count, 4, 4);
  const planeTop = reserve(count, 4, 4);
  const advances = reserve(count, 4, 4);
  const advancesI64 = reserve(count, 8, 8);
  const flags = reserve(count, 1, 1);
  const levels = reserve(count, 1, 1);
  const origins = reserve(count * 2, 4, 4);
  const sizes = reserve(count * 2, 4, 4);
  const maskCount = Math.ceil(count / 16);
  const breakMasks = reserve(maskCount, 2, 2);
  const bidiMasks = reserve(maskCount, 2, 2);
  const summaryCapacity = Math.ceil(count / 32);
  const advanceSums = reserve(summaryCapacity, 8, 8);
  const spaceSums = reserve(summaryCapacity, 8, 8);
  const flagsOr = reserve(summaryCapacity, 1, 1);
  const scanChecksum = reserve(1, 8, 8);
  const policyF32 = reserve(count * 4, 4, 4);
  const policyU32 = reserve(count, 4, 4);
  const policyU16 = reserve(count, 2, 2);
  if (cursor > allocationPointer + allocationLength) throw new Error('kernel-lab memory layout exceeds its allocation');

  new Float32Array(exports.memory.buffer, x, count).set(input.x);
  new Float32Array(exports.memory.buffer, y, count).set(input.y);
  new Float32Array(exports.memory.buffer, fontSize, count).set(input.fontSize);
  new Float32Array(exports.memory.buffer, planeLeft, count).set(input.planeLeft);
  new Float32Array(exports.memory.buffer, planeBottom, count).set(input.planeBottom);
  new Float32Array(exports.memory.buffer, planeRight, count).set(input.planeRight);
  new Float32Array(exports.memory.buffer, planeTop, count).set(input.planeTop);
  new Int32Array(exports.memory.buffer, advances, count).set(input.advances);
  const i64Values = new BigInt64Array(exports.memory.buffer, advancesI64, count);
  for (let index = 0; index < count; index += 1) {
    i64Values[index] = BigInt(input.advances[index]) * 1_024n;
  }
  new Uint8Array(exports.memory.buffer, flags, count).set(input.flags);
  new Uint8Array(exports.memory.buffer, levels, count).set(input.levels);
  return {
    count,
    allocationPointer,
    allocationLength,
    x,
    y,
    fontSize,
    planeLeft,
    planeBottom,
    planeRight,
    planeTop,
    advances,
    advancesI64,
    flags,
    levels,
    origins,
    sizes,
    breakMasks,
    bidiMasks,
    advanceSums,
    spaceSums,
    flagsOr,
    scanChecksum,
    policyF32,
    policyU32,
    policyU16,
    summaryCapacity,
    memory: exports.memory,
  };
}

async function executeAndHash(exports, fixture, vertical) {
  checkedCall(() => callPack(exports, fixture, vertical));
  const breakOracle = [];
  const bidiOracle = [];
  for (const groupCount of [1, 2, 4, 8]) {
    checkedCall(() => callBreakMasks(exports, fixture, groupCount));
    const currentBreaks = bytes(fixture, fixture.breakMasks, Math.ceil(fixture.count / 16) * 2);
    if (breakOracle.length === 0) breakOracle.push(currentBreaks);
    else if (!bytesEqual(currentBreaks, breakOracle[0])) {
      throw new Error(`break-mask x${groupCount} output differs from the x1 oracle`);
    }
    checkedCall(() => callBidiMasks(exports, fixture, groupCount));
    const currentBidi = bytes(fixture, fixture.bidiMasks, Math.ceil(fixture.count / 16) * 2);
    if (bidiOracle.length === 0) bidiOracle.push(currentBidi);
    else if (!bytesEqual(currentBidi, bidiOracle[0])) {
      throw new Error(`bidi-mask x${groupCount} output differs from the x1 oracle`);
    }
  }
  checkedCall(() => callPolicy(exports, fixture, vertical));
  const parts = [
    bytes(fixture, fixture.origins, fixture.count * 2 * 4),
    bytes(fixture, fixture.sizes, fixture.count * 2 * 4),
    ...breakOracle,
    ...bidiOracle,
    bytes(fixture, fixture.policyF32, fixture.count * 4 * 4),
    bytes(fixture, fixture.policyU32, fixture.count * 4),
    bytes(fixture, fixture.policyU16, fixture.count * 2),
  ];
  for (const chunkSize of CHUNK_SIZES) {
    checkedCall(() => callSummaries(exports, fixture, chunkSize));
    const summaryCount = Math.ceil(fixture.count / chunkSize);
    parts.push(bytes(fixture, fixture.advanceSums, summaryCount * 8));
    parts.push(bytes(fixture, fixture.spaceSums, summaryCount * 8));
    parts.push(bytes(fixture, fixture.flagsOr, summaryCount));
  }
  const i64Oracle = [];
  for (const accumulatorCount of [1, 2, 4, 8]) {
    checkedCall(() => callI64Summaries(exports, fixture, 64, accumulatorCount));
    const summaryCount = Math.ceil(fixture.count / 64);
    const current = bytes(fixture, fixture.advanceSums, summaryCount * 8);
    const currentSpaces = bytes(fixture, fixture.spaceSums, summaryCount * 8);
    const currentFlags = bytes(fixture, fixture.flagsOr, summaryCount);
    if (i64Oracle.length === 0) i64Oracle.push(current, currentSpaces, currentFlags);
    else if (
      !bytesEqual(current, i64Oracle[0]) ||
      !bytesEqual(currentSpaces, i64Oracle[1]) ||
      !bytesEqual(currentFlags, i64Oracle[2])
    ) {
      throw new Error(`i64 x${accumulatorCount} summaries differ from the x1 oracle`);
    }
  }
  parts.push(...i64Oracle);
  const scanOracles = [];
  for (const groupCount of [1, 2, 4, 8]) {
    checkedCall(() => callFlaggedScan(exports, fixture, groupCount));
    const flagged = bytes(fixture, fixture.scanChecksum, 8);
    checkedCall(() => callTransitionScan(exports, fixture, groupCount));
    const transitions = bytes(fixture, fixture.scanChecksum, 8);
    if (scanOracles.length === 0) scanOracles.push(flagged, transitions);
    else if (!bytesEqual(flagged, scanOracles[0]) || !bytesEqual(transitions, scanOracles[1])) {
      throw new Error(`production scan x${groupCount} output differs from the x1 oracle`);
    }
  }
  parts.push(...scanOracles);
  return hashParts(parts);
}

function callPack(exports, fixture, vertical) {
  return exports.pmndrs_glyph_kernel_lab_pack(
    fixture.count,
    vertical ? fixture.y : fixture.x,
    vertical ? fixture.x : fixture.y,
    fixture.fontSize,
    fixture.planeLeft,
    fixture.planeBottom,
    fixture.planeRight,
    fixture.planeTop,
    1 / 2_048,
    fixture.origins,
    fixture.sizes,
  );
}

function callSummaries(exports, fixture, chunkSize) {
  return exports.pmndrs_glyph_kernel_lab_chunk_summaries(
    fixture.count,
    chunkSize,
    fixture.advances,
    fixture.flags,
    fixture.advanceSums,
    fixture.spaceSums,
    fixture.flagsOr,
  );
}

function callI64Summaries(exports, fixture, chunkSize, accumulatorCount) {
  return exports.pmndrs_glyph_kernel_lab_chunk_summaries_i64(
    fixture.count,
    chunkSize,
    accumulatorCount,
    fixture.advancesI64,
    fixture.flags,
    fixture.advanceSums,
    fixture.spaceSums,
    fixture.flagsOr,
  );
}

function callBreakMasks(exports, fixture, groupCount) {
  return exports.pmndrs_glyph_kernel_lab_break_masks(fixture.count, groupCount, fixture.flags, fixture.breakMasks);
}

function callBidiMasks(exports, fixture, groupCount) {
  return exports.pmndrs_glyph_kernel_lab_bidi_masks(fixture.count, groupCount, fixture.levels, fixture.bidiMasks);
}

function callFlaggedScan(exports, fixture, groupCount) {
  return exports.pmndrs_glyph_kernel_lab_flagged_scan(fixture.count, groupCount, fixture.flags, fixture.scanChecksum);
}

function callTransitionScan(exports, fixture, groupCount) {
  return exports.pmndrs_glyph_kernel_lab_transition_scan(
    fixture.count,
    groupCount,
    fixture.levels,
    fixture.scanChecksum,
  );
}

function callPolicy(exports, fixture, vertical) {
  return exports.pmndrs_glyph_kernel_lab_policy(
    1,
    1,
    0,
    fixture.count,
    vertical ? fixture.y : fixture.x,
    vertical ? fixture.x : fixture.y,
    fixture.fontSize,
    fixture.planeLeft,
    fixture.advances,
    fixture.policyF32,
    fixture.policyU32,
    fixture.policyU16,
  );
}

function measure(operation, iterations, options) {
  for (let sample = 0; sample < options.warmup; sample += 1) {
    for (let index = 0; index < iterations; index += 1) operation();
  }
  const values = [];
  for (let sample = 0; sample < options.samples; sample += 1) {
    const started = performance.now();
    for (let index = 0; index < iterations; index += 1) operation();
    values.push((performance.now() - started) / iterations);
  }
  values.sort((left, right) => left - right);
  return {
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
  };
}

function checkedCall(operation) {
  const status = operation();
  if (status !== 0) throw new Error(`kernel-lab call failed with status ${status}`);
}

function bytes(fixture, pointer, length) {
  return new Uint8Array(fixture.memory.buffer, pointer, length).slice();
}

function bytesEqual(left, right) {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

async function hashParts(parts) {
  const byteLength = parts.reduce((total, part) => total + part.byteLength, 0);
  const joined = new Uint8Array(byteLength);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', joined));
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function percentile(sorted, quantile) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] ?? 0;
}

function alignWithSkew(value, alignment, skew) {
  return Math.ceil((value - skew) / alignment) * alignment + skew;
}

function registerPolicy(exports, policy) {
  const pointer = exports.pmndrs_glyph_shaper_alloc(policy.byteLength);
  if (pointer === 0) throw new Error('kernel-lab policy allocation failed');
  new Uint8Array(exports.memory.buffer, pointer, policy.byteLength).set(policy);
  checkedCall(() => exports.pmndrs_glyph_engine_register_policy(1, pointer, policy.byteLength));
  exports.pmndrs_glyph_shaper_dealloc(pointer, policy.byteLength);
}
