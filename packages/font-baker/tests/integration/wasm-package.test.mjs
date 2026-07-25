import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { FontBakeError, createFontBaker, readFontBakerAbi } from "../../dist/index.js";

const [wasm, rustReleaseWasm] = await Promise.all([
  readFile(new URL("../../dist/font_baker.wasm", import.meta.url)),
  readFile(
    new URL(
      "../../rust/target/wasm32-unknown-unknown/release/pmndrs_text_font_baker.wasm",
      import.meta.url,
    ),
  ),
]);

test("the distributed module is the pinned size-optimized zero-import release module", async () => {
  assert(wasm.byteLength < rustReleaseWasm.byteLength);
  const [distributed, rustRelease] = await Promise.all([
    WebAssembly.compile(wasm),
    WebAssembly.compile(rustReleaseWasm),
  ]);
  assert.deepEqual(WebAssembly.Module.imports(distributed), []);
  assert.deepEqual(WebAssembly.Module.imports(rustRelease), []);
});

test("the published and embedded ABI contracts are identical", async () => {
  const module = await WebAssembly.compile(wasm);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const instance = await WebAssembly.instantiate(module, {});
  const embedded = readFontBakerAbi(instance);
  assert.equal(embedded.versions.binaryen, "129.0.0");
  const published = JSON.parse(
    await readFile(new URL("../../dist/font-baker-abi-v0.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(embedded, published);
});

test("the direct-memory shim rejects incompatible version pins", async () => {
  const module = await WebAssembly.compile(wasm);
  const instance = await WebAssembly.instantiate(module, {});
  const pointer = instance.exports.pmndrs_font_baker_abi_ptr();
  const length = instance.exports.pmndrs_font_baker_abi_len();
  const bytes = new Uint8Array(instance.exports.memory.buffer, pointer, length);
  const text = new TextDecoder().decode(bytes);
  const incompatible = new TextEncoder().encode(
    text.replace('"harfrust": "0.12.0"', '"harfrust": "0.11.0"'),
  );
  assert.equal(incompatible.byteLength, bytes.byteLength);
  bytes.set(incompatible);

  assert.throws(() => readFontBakerAbi(instance), /unsupported font baker ABI/);
});

test("the TypeScript wrapper returns structured Rust errors", async () => {
  const baker = await createFontBaker(wasm);
  assert.throws(
    () =>
      baker.bake({
        source: new Uint8Array([0, 1, 2, 3]),
        descriptor: { formatVersion: 0, fontFaceIndex: 0 },
      }),
    (error) => error instanceof FontBakeError && error.code === "INVALID_FONT",
  );
});

test("direct-memory allocations reject forged releases and recover after invalid requests", async () => {
  const module = await WebAssembly.compile(wasm);
  const instance = await WebAssembly.instantiate(module, {});
  const { memory, pmndrs_font_baker_alloc: allocate, pmndrs_font_baker_dealloc: deallocate } =
    instance.exports;
  const bake = instance.exports.pmndrs_font_baker_bake;
  const resultLength = instance.exports.pmndrs_font_baker_result_len;
  assert.ok(memory instanceof WebAssembly.Memory);
  assert.equal(typeof allocate, "function");
  assert.equal(typeof deallocate, "function");
  assert.equal(typeof bake, "function");
  assert.equal(typeof resultLength, "function");

  assert.equal(allocate(64 * 1024 * 1024 + 1), 0);
  const pointer = allocate(8);
  assert.notEqual(pointer, 0);
  new Uint8Array(memory.buffer, pointer, 8).fill(0x20);
  deallocate(pointer + 1, 7);
  deallocate(pointer, 7);
  const response = bake(pointer, 8, pointer, 8);
  const responseLength = resultLength();
  assert.notEqual(response, 0);
  assert.ok(responseLength > 0);
  deallocate(pointer, 8);
  deallocate(pointer, 8);
  deallocate(response, responseLength - 1);
  assert.equal(resultLength(), responseLength);
  deallocate(response, responseLength);
  assert.equal(resultLength(), 0);

  const recovered = allocate(8);
  assert.notEqual(recovered, 0);
  deallocate(recovered, 8);
});
