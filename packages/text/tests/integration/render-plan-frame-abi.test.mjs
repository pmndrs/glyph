import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { copyIntoAllocation, engineUpdateBytes, renderPolicyBytes } from '../support/engine-abi.mjs';

const wasmUrl = new URL('../../dist/text_shaper.wasm', import.meta.url);
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

  const policy = renderPolicyBytes(abi);
  const policyPointer = copyIntoAllocation(memory, fn.allocate, policy);
  assert.equal(fn.registerPolicy(policyHandle, policyPointer, policy.byteLength), abi.status.ok);
  fn.deallocate(policyPointer, policy.byteLength);

  const requestLayout = abi.layouts.engineUpdateRequest;
  const resultLayout = abi.layouts.engineResult;
  assert.equal(resultLayout.size, 144);
  assert.equal(resultLayout.alignment, 16);
  assert.equal(abi.layouts.engineBuffer.size, 36);
  assert.equal(abi.layouts.enginePatch.size, 36);
  assert.equal(abi.layouts.enginePrimitive.size, 64);
  assert.equal(fn.createSession(sessionId, requestLayout.size, resultLayout.size), abi.status.ok);
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
  writeRequest(memory, requestPointer, abi, 1, 1);
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

  writeRequest(memory, requestPointer, abi, 1, 2);
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

  writeRequest(memory, requestPointer, abi, 2, 0);
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

  writeRequest(memory, requestPointer, abi, 3, 3);
  new DataView(memory.buffer, requestPointer, requestLayout.size).setUint32(requestLayout.regionCount, 1, true);
  const unsupportedPointer = fn.textUpdate(sessionId, requestPointer, requestLayout.size);
  assertResult(memory, unsupportedPointer, abi, {
    status: abi.status.invalidRequest,
    engineRevision: 3,
    planRevision: 3,
    requiredBaseRevision: 3,
    publicationGeneration: 3,
    outputSlot: 1,
    flags: 0,
  });
  assert.deepEqual(resultBytes(memory, checkpointPointer, resultLayout), checkpointHeader);

  const oldBuffer = memory.buffer;
  const grownCapacity = 8 * 1024 * 1024;
  assert.equal(fn.reserveSession(sessionId, grownCapacity, grownCapacity), abi.status.ok);
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

function writeRequest(memory, pointer, abi, expectedEngineRevision, consumedPlanRevision) {
  const bytes = engineUpdateBytes(abi, {
    sessionId,
    policyHandle,
    expectedEngineRevision,
    consumedPlanRevision,
  });
  new Uint8Array(memory.buffer, pointer, bytes.byteLength).set(bytes);
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
    assert.equal(view.getUint32(layout.capabilitySet, true), 0);
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
