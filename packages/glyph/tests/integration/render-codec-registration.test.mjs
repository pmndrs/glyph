import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { renderCodecBytes } from '../support/engine-abi.mjs';
import { textShaperAbi } from '../../dist/text-shaper-abi.js';

const wasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);

test('registers compiler-mapped render codecs as retained typed Wasm state', async () => {
  const wasm = await readFile(wasmUrl);
  const abi = textShaperAbi;
  const module = await WebAssembly.compile(wasm);
  const instance = await WebAssembly.instantiate(module, {});
  const memory = instance.exports[abi.memory];
  const initialize = instance.exports[abi.functions.initialize];
  const allocate = instance.exports[abi.functions.allocate];
  const deallocate = instance.exports[abi.functions.deallocate];
  const register = instance.exports[abi.functions.registerCodec];
  const dispose = instance.exports[abi.functions.disposeCodec];
  const count = instance.exports[abi.functions.codecCount];
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
  assert.equal(abi.layouts.codecRequest.size, 44);
  assert.equal(abi.layouts.codecProgram.size, 64);
  assert.deepEqual(abi.layouts.codecInput, { alignment: 2, field: 1, reserved: 2, scope: 0, size: 4 });
  assert.deepEqual(abi.codec.inputScopes, { glyph: 2, resource: 3, semantic: 1, strike: 4 });

  const bytes = renderCodecBytes(abi);
  const pointer = allocate(bytes.byteLength);
  assert.notEqual(pointer, 0);
  new Uint8Array(memory.buffer, pointer, bytes.byteLength).set(bytes);
  const beforeCodecMemoryBytes = memory.buffer.byteLength;

  assert.equal(count(), 0);
  assert.equal(register(7, pointer, bytes.byteLength), abi.status.ok);
  const registeredCodecMemoryBytes = memory.buffer.byteLength;
  assert.ok(registeredCodecMemoryBytes > beforeCodecMemoryBytes, 'codec registration must prewarm its exact lanes');
  assert.equal(register(7, pointer, bytes.byteLength), abi.status.ok, 'identical registration is idempotent');
  assert.equal(memory.buffer.byteLength, registeredCodecMemoryBytes, 'idempotent registration must not grow memory');
  assert.equal(count(), 1);

  const request = abi.layouts.codecRequest;
  const program = abi.layouts.codecProgram;
  const input = abi.layouts.codecInput;
  const inputsOffset = new DataView(bytes.buffer).getUint32(request.inputsOffset, true);
  new DataView(memory.buffer).setUint8(pointer + inputsOffset + input.scope, abi.codec.inputScopes.glyph);
  assert.equal(register(7, pointer, bytes.byteLength), abi.status.codecConflict);
  new DataView(memory.buffer).setUint8(pointer + inputsOffset + input.scope, abi.codec.inputScopes.semantic);
  const programsOffset = new DataView(bytes.buffer).getUint32(request.programsOffset, true);
  new DataView(memory.buffer).setUint32(pointer + programsOffset + program.techniqueId, 2, true);
  assert.equal(register(7, pointer, bytes.byteLength), abi.status.codecConflict);
  assert.equal(count(), 1);

  deallocate(pointer, bytes.byteLength);
  assert.equal(count(), 1, 'validated codec state must not borrow the registration allocation');
  assert.equal(dispose(7), abi.status.ok);
  assert.equal(dispose(7), abi.status.codecMissing);
  assert.equal(count(), 0);
  assert.equal(register(8, pointer, bytes.byteLength), abi.status.invalidRequest);
});
