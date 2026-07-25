import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createRuntimeShaper, FontRegistry } from "@pmndrs/text";
import { createFontBaker } from "@pmndrs/text-font-baker";
import { validateFontArtifact } from "@pmndrs/text-font-baker/validate";

const fixtureDirectory = new URL(
  "../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/",
  import.meta.url,
);
const shaperWasmUrl = new URL("../../dist/text_shaper.wasm", import.meta.url);
const shaperAbiUrl = new URL("../../dist/text-shaper-abi-v0.json", import.meta.url);

async function fixture() {
  const [source, bakerWasm, shaperWasm] = await Promise.all([
    readFile(new URL("Inter-Regular.ttf", fixtureDirectory)),
    readFile(new URL("../../../font-baker/dist/font_baker.wasm", import.meta.url)),
    readFile(shaperWasmUrl),
  ]);
  const baker = await createFontBaker(bakerWasm);
  const artifact = baker.bake({
    source,
    descriptor: { formatVersion: 0, fontFaceIndex: 0 },
  }).artifacts[0].bytes;
  return { artifact, shaperWasm };
}

test("ships a zero-import optimized shaper module with its generated ABI", async () => {
  const [wasm, published] = await Promise.all([
    readFile(shaperWasmUrl),
    readFile(shaperAbiUrl, "utf8"),
  ]);
  const module = await WebAssembly.compile(wasm);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const instance = await WebAssembly.instantiate(module, {});
  const memory = instance.exports.memory;
  const pointer = instance.exports.pmndrs_text_shaper_abi_ptr;
  const length = instance.exports.pmndrs_text_shaper_abi_len;
  assert.ok(memory instanceof WebAssembly.Memory);
  assert.equal(typeof pointer, "function");
  assert.equal(typeof length, "function");
  const embedded = JSON.parse(
    new TextDecoder().decode(new Uint8Array(memory.buffer, pointer(), length())),
  );
  assert.deepEqual(embedded, JSON.parse(published));
  assert.deepEqual(embedded.versions, {
    fontFormat: 0,
    harfrust: "0.12.0",
    harfrustCommit: "60b28ea22b5261710018d69c168a762bcb28794c",
    shaper: "0.0.0",
    unicode: "17.0.0",
  });
});

test("the shaper registers only the exact shaping views retained from the validated GLB", async () => {
  const { artifact, shaperWasm } = await fixture();
  const validated = await validateFontArtifact(artifact);
  const registry = new FontRegistry();
  const font = await registry.registerAsset(artifact);
  const shaper = await createRuntimeShaper({ registry, wasm: shaperWasm });

  const initial = shaper.memoryReport();
  assert.deepEqual(initial, {
    fontCount: 0,
    retainedFontBytes: 0,
    planCount: 0,
    wasmMemoryBytes: initial.wasmMemoryBytes,
  });
  shaper.registerFont(font);
  const expectedBytes =
    validated.shapingSfnt.byteLength +
    validated.glyphExtents.byteLength +
    validated.glyphExtentsAvailability.byteLength;
  assert.equal(expectedBytes, 171_056);
  assert.equal(shaper.memoryReport().fontCount, 1);
  assert.equal(shaper.memoryReport().retainedFontBytes, expectedBytes);
  assert.equal(shaper.memoryReport().planCount, 0);

  shaper.registerFont(font);
  assert.equal(shaper.memoryReport().retainedFontBytes, expectedBytes);
  font.dispose();
  assert.equal(shaper.memoryReport().fontCount, 0);
  assert.equal(shaper.memoryReport().retainedFontBytes, 0);
  assert.throws(() => shaper.registerFont(font), /not active/);
  shaper.dispose();
  assert.throws(() => shaper.memoryReport(), /disposed/);
});

test("shaper ownership stays scoped to its FontRegistry", async () => {
  const { artifact, shaperWasm } = await fixture();
  const firstRegistry = new FontRegistry();
  const secondRegistry = new FontRegistry();
  const foreign = await firstRegistry.registerAsset(artifact);
  const shaper = await createRuntimeShaper({ registry: secondRegistry, wasm: shaperWasm });

  assert.throws(() => shaper.registerFont(foreign), /not active in this shaper's registry/);
  shaper.dispose();
  foreign.dispose();
});
