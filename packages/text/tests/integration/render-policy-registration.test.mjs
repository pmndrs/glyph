import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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

function renderPolicyBytes(abi) {
  const request = abi.layouts.policyRequest;
  const program = abi.layouts.policyProgram;
  const buffer = abi.layouts.policyBuffer;
  const operation = abi.layouts.policyOperation;
  const programsOffset = align(request.size, program.alignment);
  const buffersOffset = align(programsOffset + program.size, buffer.alignment);
  const operationsOffset = align(buffersOffset + buffer.size, operation.alignment);
  const operationCount = 2;
  const bytes = new Uint8Array(operationsOffset + operation.size * operationCount);
  const view = new DataView(bytes.buffer);

  view.setUint32(request.byteLength, bytes.byteLength, true);
  view.setUint32(request.programsOffset, programsOffset, true);
  view.setUint32(request.programCount, 1, true);
  view.setUint32(request.buffersOffset, buffersOffset, true);
  view.setUint32(request.bufferCount, 1, true);
  view.setUint32(request.operationsOffset, operationsOffset, true);
  view.setUint32(request.operationCount, operationCount, true);

  view.setUint32(programsOffset + program.techniqueId, 1, true);
  view.setUint32(programsOffset + program.programId, 1, true);
  view.setUint8(programsOffset + program.f32InputCount, 1);
  view.setUint16(programsOffset + program.bufferCount, 1, true);
  view.setUint16(programsOffset + program.operationCount, operationCount, true);

  view.setUint16(buffersOffset + buffer.id, 1, true);
  view.setUint8(buffersOffset + buffer.scalar, abi.policy.scalarTypes.f32);
  view.setUint8(buffersOffset + buffer.vectorWidth, 1);

  view.setUint8(operationsOffset + operation.opcode, abi.policy.opcodes.loadF32);
  view.setUint8(operationsOffset + operation.target, 0);
  view.setUint8(operationsOffset + operation.operand0, 0);

  const storeOffset = operationsOffset + operation.size;
  view.setUint8(storeOffset + operation.opcode, abi.policy.opcodes.storeF32);
  view.setUint8(storeOffset + operation.operand0, 0);
  view.setUint32(storeOffset + operation.immediate0, 1, true);
  return bytes;
}

function align(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}
