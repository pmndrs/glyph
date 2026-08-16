import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { renderPolicyBytes } from '../support/engine-abi.mjs';

const wasmUrl = new URL('../../dist/text_shaper.wasm', import.meta.url);
const abiUrl = new URL('../../dist/text-shaper-abi-v0.json', import.meta.url);

test('registers compiler-mapped render policies as retained typed Wasm state', async () => {
  const [wasm, abi] = await Promise.all([readFile(wasmUrl), readFile(abiUrl, 'utf8').then(JSON.parse)]);
  const module = await WebAssembly.compile(wasm);
  const instance = await WebAssembly.instantiate(module, {});
  const memory = instance.exports[abi.memory];
  const initialize = instance.exports[abi.functions.initialize];
  const allocate = instance.exports[abi.functions.allocate];
  const deallocate = instance.exports[abi.functions.deallocate];
  const register = instance.exports[abi.functions.registerPolicy];
  const dispose = instance.exports[abi.functions.disposePolicy];
  const count = instance.exports[abi.functions.policyCount];
  assert.ok(memory instanceof WebAssembly.Memory);
  const initialMemoryBytes = memory.buffer.byteLength;
  assert.equal(initialize(), abi.status.ok);
  const initializedMemoryBytes = memory.buffer.byteLength;
  assert.ok(initializedMemoryBytes > initialMemoryBytes, 'initialization must prewarm the shared record workspace');
  assert.equal(initialize(), abi.status.ok);
  assert.equal(memory.buffer.byteLength, initializedMemoryBytes, 'repeated initialization must not grow memory');
  assert.equal(typeof allocate, 'function');
  assert.equal(typeof deallocate, 'function');
  assert.equal(typeof register, 'function');
  assert.equal(typeof dispose, 'function');
  assert.equal(typeof count, 'function');
  assert.equal(abi.layouts.policyRequest.size, 44);
  assert.equal(abi.layouts.policyProgram.size, 64);
  assert.deepEqual(abi.layouts.policyInput, { alignment: 2, field: 1, reserved: 2, scope: 0, size: 4 });
  assert.deepEqual(abi.policy.inputScopes, { glyph: 2, resource: 3, semantic: 1, strike: 4 });

  const bytes = renderPolicyBytes(abi);
  const pointer = allocate(bytes.byteLength);
  assert.notEqual(pointer, 0);
  new Uint8Array(memory.buffer, pointer, bytes.byteLength).set(bytes);
  const beforePolicyMemoryBytes = memory.buffer.byteLength;

  assert.equal(count(), 0);
  assert.equal(register(7, pointer, bytes.byteLength), abi.status.ok);
  const registeredPolicyMemoryBytes = memory.buffer.byteLength;
  assert.ok(registeredPolicyMemoryBytes > beforePolicyMemoryBytes, 'policy registration must prewarm its exact lanes');
  assert.equal(register(7, pointer, bytes.byteLength), abi.status.ok, 'identical registration is idempotent');
  assert.equal(memory.buffer.byteLength, registeredPolicyMemoryBytes, 'idempotent registration must not grow memory');
  assert.equal(count(), 1);

  const request = abi.layouts.policyRequest;
  const program = abi.layouts.policyProgram;
  const input = abi.layouts.policyInput;
  const inputsOffset = new DataView(bytes.buffer).getUint32(request.inputsOffset, true);
  new DataView(memory.buffer).setUint8(pointer + inputsOffset + input.scope, abi.policy.inputScopes.glyph);
  assert.equal(register(7, pointer, bytes.byteLength), abi.status.policyConflict);
  new DataView(memory.buffer).setUint8(pointer + inputsOffset + input.scope, abi.policy.inputScopes.semantic);
  const programsOffset = new DataView(bytes.buffer).getUint32(request.programsOffset, true);
  new DataView(memory.buffer).setUint32(pointer + programsOffset + program.techniqueId, 2, true);
  assert.equal(register(7, pointer, bytes.byteLength), abi.status.policyConflict);
  assert.equal(count(), 1);

  deallocate(pointer, bytes.byteLength);
  assert.equal(count(), 1, 'validated policy state must not borrow the registration allocation');
  assert.equal(dispose(7), abi.status.ok);
  assert.equal(dispose(7), abi.status.policyMissing);
  assert.equal(count(), 0);
  assert.equal(register(8, pointer, bytes.byteLength), abi.status.invalidRequest);
});
