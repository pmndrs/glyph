import assert from 'node:assert/strict';
import test from 'node:test';

import { compileWasmResponse } from '../../dist/internal/compile-wasm-response.js';

// The smallest valid module: the `\0asm` magic and version 1.
const emptyModule = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const invalidModule = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x02, 0x00, 0x00, 0x00]);

async function compileCountingStreams(response) {
  const streaming = WebAssembly.compileStreaming;
  const outcomes = [];
  WebAssembly.compileStreaming = (source) => {
    const attempt = streaming.call(WebAssembly, source);
    attempt.then(
      () => outcomes.push('streamed'),
      () => outcomes.push('declined'),
    );
    return attempt;
  };
  try {
    return { module: await compileWasmResponse(response), outcomes };
  } finally {
    WebAssembly.compileStreaming = streaming;
  }
}

test('an application/wasm response streams into the compiler', async () => {
  const { module, outcomes } = await compileCountingStreams(
    new Response(emptyModule, { headers: { 'content-type': 'application/wasm' } }),
  );
  assert.ok(module instanceof WebAssembly.Module);
  assert.deepEqual(outcomes, ['streamed']);
});

test('a response the engine declines to stream is buffered and compiled', async () => {
  // Streaming compile rejects these before reading the body, so the same response still compiles.
  for (const headers of [{ 'content-type': 'application/octet-stream' }, { 'content-type': 'application/wasm;' }, {}]) {
    const { module, outcomes } = await compileCountingStreams(new Response(emptyModule, { headers }));
    assert.ok(module instanceof WebAssembly.Module);
    assert.deepEqual(outcomes, ['declined']);
  }
});

test('invalid bytes reject with a compile error whether or not they streamed', async () => {
  for (const type of ['application/wasm', 'application/octet-stream']) {
    await assert.rejects(
      compileWasmResponse(new Response(invalidModule, { headers: { 'content-type': type } })),
      WebAssembly.CompileError,
    );
  }
});

test('compiles buffered bytes when streaming compilation is unavailable', async () => {
  const streaming = WebAssembly.compileStreaming;
  WebAssembly.compileStreaming = undefined;
  try {
    const module = await compileWasmResponse(new Response(emptyModule));
    assert.ok(module instanceof WebAssembly.Module);
  } finally {
    WebAssembly.compileStreaming = streaming;
  }
});

test('a stream failure propagates without buffering the consumed response again', async () => {
  const failure = new Error('Wasm transport failed');
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(emptyModule.slice(0, 4));
      },
      pull(controller) {
        controller.error(failure);
      },
    }),
    { headers: { 'content-type': 'application/wasm' } },
  );
  await assert.rejects(compileWasmResponse(response), (error) => error === failure);
  assert.equal(response.bodyUsed, true);
});
