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
  const allocate = instance.exports[abi.functions.allocate];
  const deallocate = instance.exports[abi.functions.deallocate];
  const register = instance.exports[abi.functions.registerPolicy];
  const dispose = instance.exports[abi.functions.disposePolicy];
  const count = instance.exports[abi.functions.policyCount];
  assert.ok(memory instanceof WebAssembly.Memory);
  assert.equal(typeof allocate, 'function');
  assert.equal(typeof deallocate, 'function');
  assert.equal(typeof register, 'function');
  assert.equal(typeof dispose, 'function');
  assert.equal(typeof count, 'function');

  const bytes = renderPolicyBytes(abi);
  const pointer = allocate(bytes.byteLength);
  assert.notEqual(pointer, 0);
  new Uint8Array(memory.buffer, pointer, bytes.byteLength).set(bytes);

  assert.equal(count(), 0);
  assert.equal(register(7, pointer, bytes.byteLength), abi.status.ok);
  assert.equal(register(7, pointer, bytes.byteLength), abi.status.ok, 'identical registration is idempotent');
  assert.equal(count(), 1);

  const request = abi.layouts.policyRequest;
  const program = abi.layouts.policyProgram;
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
