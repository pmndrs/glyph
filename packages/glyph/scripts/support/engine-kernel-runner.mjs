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
    breakMasks: measure(
      () =>
        checkedCall(() => exports.pmndrs_glyph_kernel_lab_break_masks(input.glyphs, aligned.flags, aligned.breakMasks)),
      iterations * 4,
      options,
    ),
    bidiMasks: measure(
      () =>
        checkedCall(() => exports.pmndrs_glyph_kernel_lab_bidi_masks(input.glyphs, aligned.levels, aligned.bidiMasks)),
      iterations * 4,
      options,
    ),
    policy: measure(() => checkedCall(() => callPolicy(exports, aligned, false)), iterations, options),
    chunk32: measure(() => checkedCall(() => callSummaries(exports, aligned, 32)), iterations * 2, options),
    chunk64: measure(() => checkedCall(() => callSummaries(exports, aligned, 64)), iterations * 2, options),
    chunk128: measure(() => checkedCall(() => callSummaries(exports, aligned, 128)), iterations * 2, options),
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
  const allocationLength = input.glyphs * 96 + 4_096;
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
  const flags = reserve(count, 1, 1);
  const levels = reserve(count, 1, 1);
  const origins = reserve(count * 2, 4, 4);
  const sizes = reserve(count * 2, 4, 4);
  const maskCount = Math.ceil(count / 16);
  const breakMasks = reserve(maskCount, 2, 2);
  const bidiMasks = reserve(maskCount, 2, 2);
  const summaryCapacity = Math.ceil(count / 32);
  const advanceSums = reserve(summaryCapacity, 8, 8);
  const breakCounts = reserve(summaryCapacity, 4, 4);
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
    flags,
    levels,
    origins,
    sizes,
    breakMasks,
    bidiMasks,
    advanceSums,
    breakCounts,
    policyF32,
    policyU32,
    policyU16,
    summaryCapacity,
    memory: exports.memory,
  };
}

async function executeAndHash(exports, fixture, vertical) {
  checkedCall(() => callPack(exports, fixture, vertical));
  checkedCall(() => exports.pmndrs_glyph_kernel_lab_break_masks(fixture.count, fixture.flags, fixture.breakMasks));
  checkedCall(() => exports.pmndrs_glyph_kernel_lab_bidi_masks(fixture.count, fixture.levels, fixture.bidiMasks));
  checkedCall(() => callPolicy(exports, fixture, vertical));
  const parts = [
    bytes(fixture, fixture.origins, fixture.count * 2 * 4),
    bytes(fixture, fixture.sizes, fixture.count * 2 * 4),
    bytes(fixture, fixture.breakMasks, Math.ceil(fixture.count / 16) * 2),
    bytes(fixture, fixture.bidiMasks, Math.ceil(fixture.count / 16) * 2),
    bytes(fixture, fixture.policyF32, fixture.count * 4 * 4),
    bytes(fixture, fixture.policyU32, fixture.count * 4),
    bytes(fixture, fixture.policyU16, fixture.count * 2),
  ];
  for (const chunkSize of CHUNK_SIZES) {
    checkedCall(() => callSummaries(exports, fixture, chunkSize));
    const summaryCount = Math.ceil(fixture.count / chunkSize);
    parts.push(bytes(fixture, fixture.advanceSums, summaryCount * 8));
    parts.push(bytes(fixture, fixture.breakCounts, summaryCount * 4));
  }
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
    fixture.breakCounts,
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
