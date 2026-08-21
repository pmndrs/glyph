import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { copyIntoAllocation, engineUpdateBytes, renderPolicyBytes } from '../support/engine-abi.mjs';

const wasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);
const abiUrl = new URL('../../dist/text-shaper-abi-v0.json', import.meta.url);
const sessionId = 5;
const policyHandle = 11;

test('publishes retained frame transactions through aligned A/B Wasm arenas', async () => {
  const [wasm, abi] = await Promise.all([readFile(wasmUrl), readFile(abiUrl, 'utf8').then(JSON.parse)]);
  const instance = await WebAssembly.instantiate(await WebAssembly.compile(wasm), {});
  const memory = instance.exports[abi.memory];
  const fn = Object.fromEntries(
    Object.entries(abi.functions).map(([name, exported]) => [name, instance.exports[exported]]),
  );
  assert.ok(memory instanceof WebAssembly.Memory);
  assert.equal(fn.initialize(), abi.status.ok);

  const policy = renderPolicyBytes(abi);
  const policyPointer = copyIntoAllocation(memory, fn.allocate, policy);
  assert.equal(fn.registerPolicy(policyHandle, policyPointer, policy.byteLength), abi.status.ok);
  fn.deallocate(policyPointer, policy.byteLength);

  const requestLayout = abi.layouts.engineUpdateRequest;
  const resultLayout = abi.layouts.engineResult;
  assert.equal(resultLayout.size, 144);
  assert.equal(requestLayout.size, 136);
  assert.equal(resultLayout.alignment, 16);
  assert.equal(abi.layouts.engineBuffer.size, 36);
  assert.equal(abi.layouts.enginePatch.size, 36);
  assert.equal(abi.layouts.enginePrimitive.size, 64);
  assert.equal(abi.layouts.engineDraw.size, 64);
  assert.deepEqual(
    [
      abi.layouts.engineTextMutation.size,
      abi.layouts.engineStyleMutation.size,
      abi.layouts.engineConstraint.size,
      abi.layouts.engineFlowVertex.size,
      abi.layouts.engineRegion.size,
      abi.layouts.engineExclusion.size,
      abi.layouts.engineInlineObject.size,
    ],
    // Constraint records grew 56 -> 84 for the typography tier: first-line indent,
    // paragraph space before/after, word-space ratio bounds, letter-space
    // expansion, and the last-line policy byte.
    [24, 92, 84, 8, 60, 48, 60],
  );
  assert.equal(abi.layouts.engineInlineObject.alignment, 4);
  assert.equal(abi.layouts.engineInlineObject.baselineAlignment, 52);
  assert.equal(abi.engine.textMutationOpcodes.replaceUtf16, 1);
  assert.equal(abi.engine.textEncodings.utf16Le, 1);
  assert.equal(abi.engine.styleMutationOpcodes.upsert, 1);
  assert.equal(abi.engine.styleMutationOpcodes.remove, 2);
  assert.deepEqual(abi.engine.styleFlags, { root: 1 });
  assert.deepEqual(abi.engine.decorationStyles, {
    dashed: 4,
    dotted: 3,
    double: 2,
    none: 0,
    solid: 1,
    wavy: 5,
  });
  assert.deepEqual(abi.engine.decorationFlags, {
    all: 15,
    lineThrough: 4,
    overline: 2,
    skipInk: 8,
    underline: 1,
  });
  assert.equal(abi.engine.styleFields.all, 8191);
  assert.equal(abi.layouts.engineStyleMutation.cascadeOrder, 8);
  assert.equal(abi.layouts.engineStyleMutation.rasterPixelRatio, 64);
  assert.deepEqual(abi.engine.flowShapeKinds, { polygon: 2, rectangle: 1 });
  assert.deepEqual(abi.engine.writingModes, { horizontalTb: 1, verticalLr: 3, verticalRl: 2 });
  assert.deepEqual(abi.engine.textOrientations, { mixed: 1, sideways: 3, upright: 2 });
  assert.deepEqual(abi.engine.axisModes, { atMost: 2, exact: 3, unconstrained: 1 });
  assert.deepEqual(abi.engine.wrapModes, { character: 3, none: 1, word: 2 });
  assert.deepEqual(abi.engine.inlineAlignments, { center: 2, end: 3, justify: 4, start: 1 });
  assert.deepEqual(abi.engine.overflowModes, { clip: 2, ellipsis: 3, visible: 1 });
  assert.deepEqual(abi.engine.blockAlignments, { center: 2, end: 3, start: 1 });
  assert.deepEqual(abi.engine.exclusionWrapSides, { both: 1, inlineEnd: 3, inlineStart: 2, largest: 4 });
  assert.deepEqual(abi.engine.inlineObjectBaselines, { alphabetic: 1, middle: 3, textBottom: 4, textTop: 2 });
  assert.equal(abi.engine.defaultSessionTextCapacity, 1024);
  assert.deepEqual(abi.engine.semanticF32Fields, {
    blockExtent: 3,
    blockOrigin: 7,
    blockStart: 1,
    fontSize: 4,
    foregroundAlpha: 11,
    foregroundBlue: 10,
    foregroundGreen: 9,
    foregroundRed: 8,
    inlineExtent: 2,
    inlineOrigin: 6,
    inlineStart: 0,
    inverseFontSize: 12,
    rasterPixelRatio: 5,
  });
  assert.deepEqual(abi.engine.semanticU32Fields, {
    clusterId: 1,
    flowThreadId: 3,
    foregroundRgba: 0,
    regionId: 2,
    stableGlyphId: 5,
    transformIndex: 4,
  });
  assert.equal(fn.createSession(sessionId, requestLayout.size, resultLayout.size, 0), abi.status.ok);
  assert.equal(fn.sessionCount(), 1);
  let requestPointer = fn.requestPointer(sessionId);
  assert.notEqual(requestPointer, 0);
  assert.equal(requestPointer % 16, 0);
  assert.ok(fn.requestCapacity(sessionId) >= requestLayout.size);

  writeRequest(memory, requestPointer, abi, 0, 0);
  const firstPointer = fn.textUpdate(sessionId, requestPointer, requestLayout.size);
  assert.notEqual(firstPointer, 0);
  assert.equal(firstPointer % resultLayout.alignment, 0);
  assertResult(memory, firstPointer, abi, {
    status: abi.status.ok,
    engineRevision: 1,
    planRevision: 1,
    requiredBaseRevision: 0,
    publicationGeneration: 1,
    outputSlot: 0,
    flags: abi.engine.resultFlags.checkpoint,
  });
  const firstHeader = resultBytes(memory, firstPointer, resultLayout).slice();

  const warmBuffer = memory.buffer;
  writeRequest(memory, requestPointer, abi, 1, 1, 1);
  const secondPointer = fn.textUpdate(sessionId, requestPointer, requestLayout.size);
  assert.strictEqual(memory.buffer, warmBuffer, 'a warm empty transaction must not grow Wasm memory');
  assert.notEqual(secondPointer, firstPointer);
  assertResult(memory, secondPointer, abi, {
    status: abi.status.ok,
    engineRevision: 2,
    planRevision: 2,
    requiredBaseRevision: 1,
    publicationGeneration: 2,
    outputSlot: 1,
    flags: 0,
  });
  assert.deepEqual(resultBytes(memory, firstPointer, resultLayout), firstHeader);
  const secondHeader = resultBytes(memory, secondPointer, resultLayout).slice();

  writeRequest(memory, requestPointer, abi, 2, 2, 3);
  const futureFencePointer = fn.textUpdate(sessionId, requestPointer, requestLayout.size);
  assertResult(memory, futureFencePointer, abi, {
    status: abi.status.revisionConflict,
    engineRevision: 2,
    planRevision: 2,
    requiredBaseRevision: 2,
    publicationGeneration: 2,
    outputSlot: 0,
    flags: 0,
  });
  assert.deepEqual(resultBytes(memory, secondPointer, resultLayout), secondHeader);

  writeRequest(memory, requestPointer, abi, 1, 2, 1);
  const failedPointer = fn.textUpdate(sessionId, requestPointer, requestLayout.size);
  assert.notEqual(failedPointer, secondPointer);
  assertResult(memory, failedPointer, abi, {
    status: abi.status.revisionConflict,
    engineRevision: 2,
    planRevision: 2,
    requiredBaseRevision: 2,
    publicationGeneration: 2,
    outputSlot: 0,
    flags: 0,
  });
  assert.deepEqual(resultBytes(memory, secondPointer, resultLayout), secondHeader);

  writeRequest(memory, requestPointer, abi, 2, 0, 2);
  const checkpointPointer = fn.textUpdate(sessionId, requestPointer, requestLayout.size);
  assertResult(memory, checkpointPointer, abi, {
    status: abi.status.ok,
    engineRevision: 3,
    planRevision: 3,
    requiredBaseRevision: 0,
    publicationGeneration: 3,
    outputSlot: 0,
    flags: abi.engine.resultFlags.checkpoint,
  });
  const checkpointHeader = resultBytes(memory, checkpointPointer, resultLayout).slice();

  assert.equal(fn.reserveSession(sessionId, 512, resultLayout.size, 8), abi.status.ok);
  requestPointer = fn.requestPointer(sessionId);
  assert.ok(fn.requestCapacity(sessionId) >= 512);
  const textWarmBuffer = memory.buffer;
  const insertLength = writeRequest(memory, requestPointer, abi, 3, 3, 3, [
    { start: 0, deleteCount: 0, insert: [0x61, 0x62, 0x63] },
  ]);
  const insertedPointer = fn.textUpdate(sessionId, requestPointer, insertLength);
  assert.strictEqual(memory.buffer, textWarmBuffer);
  assertResult(memory, insertedPointer, abi, {
    status: abi.status.ok,
    engineRevision: 4,
    planRevision: 4,
    requiredBaseRevision: 3,
    publicationGeneration: 4,
    outputSlot: 1,
    flags: 0,
  });
  assert.deepEqual(resultBytes(memory, checkpointPointer, resultLayout), checkpointHeader);

  const retainedEditLength = writeRequest(memory, requestPointer, abi, 4, 4, 4, [
    { start: 1, deleteCount: 1, insert: [0x58] },
  ]);
  const retainedEditPointer = fn.textUpdate(sessionId, requestPointer, retainedEditLength);
  assert.strictEqual(memory.buffer, textWarmBuffer);
  assertResult(memory, retainedEditPointer, abi, {
    status: abi.status.ok,
    engineRevision: 5,
    planRevision: 5,
    requiredBaseRevision: 4,
    publicationGeneration: 5,
    outputSlot: 0,
    flags: 0,
  });
  const retainedHeader = resultBytes(memory, retainedEditPointer, resultLayout).slice();

  const invalidEditLength = writeRequest(memory, requestPointer, abi, 5, 5, 5, [
    { start: 9, deleteCount: 0, insert: [0x21] },
  ]);
  const invalidEditPointer = fn.textUpdate(sessionId, requestPointer, invalidEditLength);
  assertResult(memory, invalidEditPointer, abi, {
    status: abi.status.invalidRequest,
    engineRevision: 5,
    planRevision: 5,
    requiredBaseRevision: 5,
    publicationGeneration: 5,
    outputSlot: 1,
    flags: 0,
  });
  assert.deepEqual(resultBytes(memory, retainedEditPointer, resultLayout), retainedHeader);

  const geometry = geometryRequestBytes(abi, 5, 5, 5);
  new Uint8Array(memory.buffer, requestPointer, geometry.byteLength).set(geometry);
  const geometryPointer = fn.textUpdate(sessionId, requestPointer, geometry.byteLength);
  assertResult(memory, geometryPointer, abi, {
    status: abi.status.ok,
    engineRevision: 6,
    planRevision: 6,
    requiredBaseRevision: 5,
    publicationGeneration: 6,
    outputSlot: 1,
    flags: 0,
  });
  const geometryHeader = resultBytes(memory, geometryPointer, resultLayout).slice();

  const invalidGeometry = geometryRequestBytes(abi, 6, 6, 6);
  const exclusionOffset = new DataView(invalidGeometry.buffer).getUint32(requestLayout.exclusionsOffset, true);
  new DataView(invalidGeometry.buffer).setUint32(exclusionOffset + abi.layouts.engineExclusion.regionId, 9, true);
  new Uint8Array(memory.buffer, requestPointer, invalidGeometry.byteLength).set(invalidGeometry);
  const invalidGeometryPointer = fn.textUpdate(sessionId, requestPointer, invalidGeometry.byteLength);
  assertResult(memory, invalidGeometryPointer, abi, {
    status: abi.status.invalidRequest,
    engineRevision: 6,
    planRevision: 6,
    requiredBaseRevision: 6,
    publicationGeneration: 6,
    outputSlot: 0,
    flags: 0,
  });
  assert.deepEqual(resultBytes(memory, geometryPointer, resultLayout), geometryHeader);

  const oldBuffer = memory.buffer;
  const grownCapacity = 8 * 1024 * 1024;
  assert.equal(fn.reserveSession(sessionId, grownCapacity, grownCapacity, 0), abi.status.ok);
  assert.notStrictEqual(memory.buffer, oldBuffer);
  assert.equal(oldBuffer.byteLength, 0, 'memory.grow must detach fixed-length views in the pinned runtime');
  requestPointer = fn.requestPointer(sessionId);
  assert.equal(requestPointer % 16, 0);
  assert.ok(fn.requestCapacity(sessionId) >= grownCapacity);

  assert.equal(fn.disposeSession(sessionId), abi.status.ok);
  assert.equal(fn.sessionCount(), 0);
  assert.equal(fn.disposeSession(sessionId), abi.status.sessionMissing);
  assert.equal(fn.textUpdate(sessionId, requestPointer, requestLayout.size), 0);
  assert.equal(fn.disposePolicy(policyHandle), abi.status.ok);
});

function writeRequest(
  memory,
  pointer,
  abi,
  expectedEngineRevision,
  consumedPlanRevision,
  acknowledgedPublicationGeneration = 0,
  textMutations = [],
) {
  const bytes = engineUpdateBytes(abi, {
    sessionId,
    policyHandle,
    expectedEngineRevision,
    consumedPlanRevision,
    acknowledgedPublicationGeneration,
    textMutations,
  });
  new Uint8Array(memory.buffer, pointer, bytes.byteLength).set(bytes);
  return bytes.byteLength;
}

function geometryRequestBytes(abi, expectedEngineRevision, consumedPlanRevision, acknowledgedPublicationGeneration) {
  const request = abi.layouts.engineUpdateRequest;
  const constraint = abi.layouts.engineConstraint;
  const region = abi.layouts.engineRegion;
  const exclusion = abi.layouts.engineExclusion;
  const inlineObject = abi.layouts.engineInlineObject;
  const constraintOffset = request.size;
  const regionOffset = constraintOffset + constraint.size;
  const exclusionOffset = regionOffset + region.size;
  const inlineObjectOffset = exclusionOffset + exclusion.size;
  const bytes = new Uint8Array(inlineObjectOffset + inlineObject.size);
  bytes.set(
    engineUpdateBytes(abi, {
      sessionId,
      policyHandle,
      expectedEngineRevision,
      consumedPlanRevision,
      acknowledgedPublicationGeneration,
    }),
  );
  const view = new DataView(bytes.buffer);
  view.setUint32(request.byteLength, bytes.byteLength, true);
  for (const [offsetField, countField, offset] of [
    ['constraintsOffset', 'constraintCount', constraintOffset],
    ['regionsOffset', 'regionCount', regionOffset],
    ['exclusionsOffset', 'exclusionCount', exclusionOffset],
    ['inlineObjectsOffset', 'inlineObjectCount', inlineObjectOffset],
  ]) {
    view.setUint32(request[offsetField], offset, true);
    view.setUint32(request[countField], 1, true);
  }

  view.setUint32(constraintOffset + constraint.paragraphId, 1, true);
  view.setUint32(constraintOffset + constraint.flowThreadId, 1, true);
  view.setFloat32(constraintOffset + constraint.width, 100, true);
  view.setFloat32(constraintOffset + constraint.height, 100, true);
  view.setFloat32(constraintOffset + constraint.viewportBlockEnd, 100, true);
  view.setUint32(constraintOffset + constraint.maxLines, 1, true);
  view.setUint16(constraintOffset + constraint.regionCount, 1, true);
  view.setUint8(constraintOffset + constraint.widthMode, abi.engine.axisModes.exact);
  view.setUint8(constraintOffset + constraint.heightMode, abi.engine.axisModes.exact);
  view.setUint8(constraintOffset + constraint.wrap, abi.engine.wrapModes.word);
  view.setUint8(constraintOffset + constraint.align, abi.engine.inlineAlignments.start);
  view.setUint8(constraintOffset + constraint.overflow, abi.engine.overflowModes.clip);
  view.setUint8(constraintOffset + constraint.blockAlign, abi.engine.blockAlignments.start);
  view.setUint8(constraintOffset + constraint.lastLine, abi.engine.lastLinePolicies.auto);

  view.setUint32(regionOffset + region.id, 1, true);
  view.setUint32(regionOffset + region.geometryRevision, 1, true);
  view.setUint32(regionOffset + region.transformIndex, 1, true);
  view.setUint16(regionOffset + region.exclusionCount, 1, true);
  view.setUint8(regionOffset + region.shape, abi.engine.flowShapeKinds.rectangle);
  view.setUint8(regionOffset + region.writingMode, abi.engine.writingModes.horizontalTb);
  view.setUint8(regionOffset + region.textOrientation, abi.engine.textOrientations.mixed);
  for (const field of ['inlineEnd', 'blockEnd', 'clipInlineEnd', 'clipBlockEnd']) {
    view.setFloat32(regionOffset + region[field], 100, true);
  }

  view.setUint32(exclusionOffset + exclusion.id, 2, true);
  view.setUint32(exclusionOffset + exclusion.regionId, 1, true);
  view.setUint32(exclusionOffset + exclusion.geometryRevision, 1, true);
  view.setUint8(exclusionOffset + exclusion.shape, abi.engine.flowShapeKinds.rectangle);
  view.setUint8(exclusionOffset + exclusion.wrapSide, abi.engine.exclusionWrapSides.both);
  view.setFloat32(exclusionOffset + exclusion.inlineStart, 20, true);
  view.setFloat32(exclusionOffset + exclusion.blockStart, 20, true);
  view.setFloat32(exclusionOffset + exclusion.inlineEnd, 40, true);
  view.setFloat32(exclusionOffset + exclusion.blockEnd, 40, true);

  view.setUint32(inlineObjectOffset + inlineObject.paragraphId, 1, true);
  view.setUint32(inlineObjectOffset + inlineObject.id, 3, true);
  view.setUint32(inlineObjectOffset + inlineObject.contentRevision, 1, true);
  view.setUint32(inlineObjectOffset + inlineObject.textOffset, 1, true);
  view.setUint32(inlineObjectOffset + inlineObject.materialId, 1, true);
  view.setUint32(inlineObjectOffset + inlineObject.resourceId, 4, true);
  view.setUint32(inlineObjectOffset + inlineObject.resourceGeneration, 1, true);
  view.setFloat32(inlineObjectOffset + inlineObject.inlineExtent, 10, true);
  view.setFloat32(inlineObjectOffset + inlineObject.blockExtent, 10, true);
  view.setUint8(inlineObjectOffset + inlineObject.baselineAlignment, abi.engine.inlineObjectBaselines.alphabetic);
  return bytes;
}

function assertResult(memory, pointer, abi, expected) {
  const layout = abi.layouts.engineResult;
  const view = new DataView(memory.buffer, pointer, layout.size);
  assert.equal(view.getUint32(layout.abiVersion, true), abi.version);
  assert.equal(view.getUint32(layout.byteLength, true), layout.size);
  assert.equal(view.getUint32(layout.sessionId, true), sessionId);
  for (const [field, value] of Object.entries(expected)) {
    assert.equal(view.getUint32(layout[field], true), value, field);
  }
  if (expected.status === abi.status.ok) {
    assert.equal(view.getUint32(layout.policyHandle, true), policyHandle);
    assert.equal(view.getUint32(layout.capabilitySet, true), 1);
    assert.notEqual(
      view.getUint32(layout.policyFingerprintLow, true) | view.getUint32(layout.policyFingerprintHigh, true),
      0,
      'a successful plan identifies its validated policy bytes',
    );
  } else {
    assert.equal(view.getUint32(layout.policyHandle, true), 0);
    assert.equal(view.getUint32(layout.policyFingerprintLow, true), 0);
    assert.equal(view.getUint32(layout.policyFingerprintHigh, true), 0);
  }
  for (const field of [
    'semanticsCount',
    'resourceCount',
    'bufferCount',
    'patchCount',
    'primitiveCount',
    'drawCount',
    'retirementCount',
    'diagnosticCount',
  ]) {
    assert.equal(view.getUint32(layout[field], true), 0, field);
  }
}

function resultBytes(memory, pointer, layout) {
  return new Uint8Array(memory.buffer, pointer, layout.size);
}
