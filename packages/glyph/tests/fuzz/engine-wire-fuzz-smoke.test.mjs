import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { copyIntoAllocation, engineUpdateBytes, renderPolicyBytes } from '../support/engine-abi.mjs';

const wasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);
const abiUrl = new URL('../../dist/text-shaper-abi-v0.json', import.meta.url);
const mutationCount = 64;

test('fixed-seed policy and frame mutations fail safely, deterministically, and recoverably', async () => {
  const [wasm, abi] = await Promise.all([readFile(wasmUrl), readFile(abiUrl, 'utf8').then(JSON.parse)]);
  const module = await WebAssembly.compile(wasm);
  const policyCases = mutations(renderPolicyBytes(abi), 0x504f_4c59);
  const frameCases = mutations(frameBytes(abi, 1), 0x4652_414d);
  const first = await execute(module, abi, policyCases, frameCases);
  const second = await execute(module, abi, policyCases, frameCases);

  assert.deepEqual(second, first);
  assert.ok(
    first.some(({ policyStatus }) => policyStatus === abi.status.ok),
    'mutations must retain valid policy paths',
  );
  assert.ok(
    first.some(({ policyStatus }) => policyStatus !== abi.status.ok),
    'mutations must retain malformed policy paths',
  );
  assert.ok(
    first.some(({ frameStatus }) => frameStatus === abi.status.ok),
    'mutations must retain valid frame paths',
  );
  assert.ok(
    first.some(({ frameStatus }) => frameStatus !== abi.status.ok),
    'mutations must retain malformed frame paths',
  );
});

async function execute(module, abi, policyCases, frameCases) {
  const statuses = new Set(Object.values(abi.status));
  const outcomes = [];
  for (let index = 0; index < mutationCount; index += 1) {
    const instance = await WebAssembly.instantiate(module, {});
    const memory = instance.exports[abi.memory];
    const fn = Object.fromEntries(
      Object.entries(abi.functions).map(([name, exported]) => [name, instance.exports[exported]]),
    );
    assert.equal(fn.initialize(), abi.status.ok);

    const validPolicy = renderPolicyBytes(abi);
    const validPolicyPointer = copyIntoAllocation(memory, fn.allocate, validPolicy);
    assert.equal(fn.registerPolicy(1, validPolicyPointer, validPolicy.byteLength), abi.status.ok);
    fn.deallocate(validPolicyPointer, validPolicy.byteLength);

    const policyCase = policyCases[index];
    const policyPointer = copyIntoAllocation(memory, fn.allocate, policyCase.bytes);
    const policyStatus = fn.registerPolicy(2, policyPointer, policyCase.length);
    fn.deallocate(policyPointer, policyCase.bytes.byteLength);
    assert.ok(statuses.has(policyStatus));

    const frameCase = frameCases[index];
    const requestCapacity = Math.max(abi.layouts.engineUpdateRequest.size, frameCase.bytes.byteLength);
    assert.equal(fn.createSession(1, requestCapacity, abi.layouts.engineResult.size, 0), abi.status.ok);
    const requestPointer = fn.requestPointer(1);
    new Uint8Array(memory.buffer, requestPointer, frameCase.bytes.byteLength).set(frameCase.bytes);
    const resultPointer = fn.textUpdate(1, requestPointer, frameCase.length);
    const frameStatus = new DataView(memory.buffer).getUint32(resultPointer + abi.layouts.engineResult.status, true);
    assert.ok(statuses.has(frameStatus));
    assert.equal(fn.disposeSession(1), abi.status.ok);

    const recovery = frameBytes(abi, 3);
    assert.equal(fn.createSession(3, recovery.byteLength, abi.layouts.engineResult.size, 0), abi.status.ok);
    const recoveryPointer = fn.requestPointer(3);
    new Uint8Array(memory.buffer, recoveryPointer, recovery.byteLength).set(recovery);
    const recoveredResult = fn.textUpdate(3, recoveryPointer, recovery.byteLength);
    const recoveryStatus = new DataView(memory.buffer).getUint32(
      recoveredResult + abi.layouts.engineResult.status,
      true,
    );
    assert.equal(recoveryStatus, abi.status.ok, `mutation ${index} poisoned the next valid transaction`);
    assert.equal(fn.disposeSession(3), abi.status.ok);
    outcomes.push({ policyStatus, frameStatus });
  }
  return outcomes;
}

function frameBytes(abi, sessionId) {
  return engineUpdateBytes(abi, {
    sessionId,
    policyHandle: 1,
    expectedEngineRevision: 0,
    consumedPlanRevision: 0,
  });
}

function mutations(base, seed) {
  const result = [{ bytes: base.slice(), length: base.byteLength }];
  let state = seed >>> 0;
  while (result.length < mutationCount) {
    const bytes = base.slice();
    state = next(state);
    const offset = state % bytes.byteLength;
    state = next(state);
    bytes[offset] ^= state & 0xff || 1;
    state = next(state);
    const length = state % 4 === 0 ? state % (bytes.byteLength + 1) : bytes.byteLength;
    result.push({ bytes, length });
  }
  return result;
}

function next(value) {
  return (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
}
