import assert from 'node:assert/strict';
import test from 'node:test';

import { compileWasmResponse } from '../../dist/internal/compile-wasm-response.js';

// The smallest valid module: the `\0asm` magic and version 1.
const emptyModule = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

async function compileCountingStreams(response) {
  const streaming = WebAssembly.compileStreaming;
  let streamed = 0;
  WebAssembly.compileStreaming = (source) => {
    streamed += 1;
    return streaming.call(WebAssembly, source);
  };
  try {
    return { module: await compileWasmResponse(response), streamed };
  } finally {
    WebAssembly.compileStreaming = streaming;
  }
}

test('an application/wasm response streams into the compiler', async () => {
  const { module, streamed } = await compileCountingStreams(
    new Response(emptyModule, { headers: { 'content-type': 'application/wasm' } }),
  );
  assert.ok(module instanceof WebAssembly.Module);
  assert.equal(streamed, 1);
});

test('any other content type is buffered, because streaming compile would reject it', async () => {
  // compileStreaming rejects these outright, so streaming them would turn a served module into a load failure.
  for (const headers of [
    { 'content-type': 'application/octet-stream' },
    { 'content-type': 'Application/Wasm; charset=binary' },
    {},
  ]) {
    const { module, streamed } = await compileCountingStreams(new Response(emptyModule, { headers }));
    assert.ok(module instanceof WebAssembly.Module);
    assert.equal(streamed, 0);
  }
});

test('invalid bytes reject on either path', async () => {
  const invalid = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x02, 0x00, 0x00, 0x00]);
  for (const type of ['application/wasm', 'application/octet-stream']) {
    await assert.rejects(
      compileWasmResponse(new Response(invalid, { headers: { 'content-type': type } })),
      WebAssembly.CompileError,
    );
  }
});
