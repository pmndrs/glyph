import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { FontRegistry } from '../../dist/loader.js';
import { createRuntimeShaper } from '../../dist/shaper.js';
import { createFontBaker } from '@pmndrs/glyph/bake';
import { validateFontArtifact } from '@pmndrs/glyph/bake';
import { fontBindingBytes, renderCodecBytes, renderCodecBytesFromPrograms } from '../support/engine-abi.mjs';
import { textShaperAbi } from '../../dist/text-shaper-abi.js';

const fixtureDirectory = new URL('../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/', import.meta.url);
const shaperWasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);
async function fixture() {
  const [source, bakerWasm, shaperWasm] = await Promise.all([
    readFile(new URL('Inter-Regular.ttf', fixtureDirectory)),
    readFile(new URL('../../dist/font-baker.wasm', import.meta.url)),
    readFile(shaperWasmUrl),
  ]);
  const baker = await createFontBaker(bakerWasm);
  const artifact = baker.bake({
    source,
    descriptor: { formatVersion: 0, fontFaceIndex: 0 },
  }).artifacts[0].bytes;
  return { artifact, shaperWasm };
}

test('ships a zero-import optimized shaper module whose published ABI is generated', async () => {
  const wasm = await readFile(shaperWasmUrl);
  const module = await WebAssembly.compile(wasm);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  assert.equal(
    WebAssembly.Module.exports(module).some(({ name }) => name.includes('abi_')),
    false,
  );
  const generated = await import('../../dist/generated/text-shaper-abi.js');
  // The published subpath must surface the generated module itself, not a copy of it. Identity is
  // the assertion that matters: a copy is what would let the two drift.
  assert.equal(textShaperAbi, generated.textShaperAbi);
  assert.deepEqual(generated.textShaperAbi.versions, {
    fontFormat: 0,
    harfrust: '0.12.0',
    harfrustCommit: '60b28ea22b5261710018d69c168a762bcb28794c',
    shaper: '0.0.0',
    unicode: '17.0.0',
  });
});

test('the shaper registers only the exact shaping views retained from the validated GLB', async () => {
  const { artifact, shaperWasm } = await fixture();
  const validated = await validateFontArtifact(artifact);
  const registry = new FontRegistry();
  const font = await registry.registerAsset(artifact);
  const shaper = await createRuntimeShaper({ registry, wasm: shaperWasm });

  const initial = shaper.memoryReport();
  assert.deepEqual(initial, {
    fontCount: 0,
    retainedFontBytes: 0,
    shapePlanCount: 0,
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
  assert.equal(shaper.memoryReport().shapePlanCount, 0);

  shaper.registerFont(font);
  assert.equal(shaper.memoryReport().retainedFontBytes, expectedBytes);
  font.dispose();
  assert.equal(shaper.memoryReport().fontCount, 0);
  assert.equal(shaper.memoryReport().retainedFontBytes, 0);
  assert.throws(() => shaper.registerFont(font), /not active/);
  shaper.dispose();
  assert.throws(() => shaper.memoryReport(), /disposed/);
});

test('compiled Wasm retains ordered font stacks and prevents dangling font disposal', async () => {
  const { artifact, shaperWasm } = await fixture();
  const [validated, abi] = await Promise.all([validateFontArtifact(artifact), textShaperAbi]);
  const instance = await WebAssembly.instantiate(await WebAssembly.compile(shaperWasm), {});
  const memory = instance.exports[abi.memory];
  const fn = Object.fromEntries(
    Object.entries(abi.functions).map(([name, exported]) => [name, instance.exports[exported]]),
  );
  assert.equal(fn.initialize(), abi.status.ok);
  const allocations = [
    copyToWasm(memory, fn.allocate, validated.shapingSfnt),
    copyToWasm(memory, fn.allocate, validated.glyphExtents),
    copyToWasm(memory, fn.allocate, validated.glyphExtentsAvailability),
  ];
  assert.equal(
    fn.registerFont(
      101,
      allocations[0].pointer,
      allocations[0].length,
      allocations[1].pointer,
      allocations[1].length,
      allocations[2].pointer,
      allocations[2].length,
    ),
    abi.status.ok,
  );
  for (const allocation of allocations) fn.deallocate(allocation.pointer, allocation.length);

  assert.deepEqual(abi.layouts.fontBindingStrike, { alignment: 4, ppem: 0, reserved: 4, size: 8 });
  assert.deepEqual(abi.layouts.fontBindingResource, {
    alignment: 4,
    generation: 4,
    id: 0,
    kind: 8,
    reference: 12,
    reserved: 10,
    size: 16,
  });
  const bindingBytes = fontBindingBytes(abi, {
    techniqueId: 1,
    glyphCount: validated.glyphExtents.byteLength / 8,
    strikes: [0],
    resources: [{ id: 71, generation: 1, kind: 1, reference: 19 }],
    resourceIndices: new Array(validated.glyphExtents.byteLength / 8).fill(0),
    glyphF32: [new Array(validated.glyphExtents.byteLength / 8).fill(1)],
  });
  const binding = copyToWasm(memory, fn.allocate, bindingBytes);
  assert.equal(fn.fontBindingCount(), 0);
  assert.equal(fn.registerFontBinding(101, 101, binding.pointer, binding.length), abi.status.ok);
  assert.equal(fn.registerFontBinding(101, 101, binding.pointer, binding.length), abi.status.ok);
  assert.equal(fn.fontBindingCount(), 1);
  new DataView(memory.buffer).setUint32(binding.pointer + abi.layouts.fontBindingRequest.techniqueId, 2, true);
  assert.equal(fn.registerFontBinding(101, 101, binding.pointer, binding.length), abi.status.codecConflict);
  assert.equal(
    fn.registerFontBinding(102, 101, binding.pointer, binding.length),
    abi.status.ok,
    'one shaping font may carry another independently selectable raster binding',
  );
  fn.deallocate(binding.pointer, binding.length);
  assert.equal(fn.fontBindingCount(), 2, 'binding state must not borrow the registration allocation');
  assert.equal(fn.disposeFontBinding(102), abi.status.ok);
  assert.equal(fn.fontBindingCount(), 1);

  const stack = copyToWasm(memory, fn.allocate, Uint8Array.of(101, 0, 0, 0));
  assert.equal(fn.registerFontStack(17, stack.pointer, 1), abi.status.ok);
  fn.deallocate(stack.pointer, stack.length);
  assert.equal(fn.fontStackCount(), 1);

  const codecBytes = renderCodecBytes(abi);
  const codec = copyToWasm(memory, fn.allocate, codecBytes);
  assert.equal(fn.registerCodec(23, codec.pointer, codec.length), abi.status.ok);
  fn.deallocate(codec.pointer, codec.length);
  assert.equal(fn.createRoot(29, 2048, 64 * 1024, 4), abi.status.ok);
  const styleWarmBuffer = memory.buffer;
  const initialUpdate = engineStyleUpdateBytes(abi, {
    rootId: 29,
    codecHandle: 23,
    fontStackHandle: 17,
    text: [0x61, 0x62, 0x63, 0x64],
    geometry: true,
  });
  assert.equal(fn.shapePlanCount(), 0);
  let requestPointer = fn.requestPointer(29);
  new Uint8Array(memory.buffer, requestPointer, initialUpdate.byteLength).set(initialUpdate);
  let resultPointer = fn.textUpdate(29, requestPointer, initialUpdate.byteLength);
  assert.strictEqual(memory.buffer, styleWarmBuffer, 'the pre-reserved first style update must not grow Wasm memory');
  let result = new DataView(memory.buffer, resultPointer, abi.layouts.engineResult.size);
  assert.equal(result.getUint32(abi.layouts.engineResult.status, true), abi.status.ok);
  assert.equal(result.getUint32(abi.layouts.engineResult.engineRevision, true), 1);
  for (const field of ['resourceCount', 'bufferCount', 'patchCount', 'primitiveCount', 'drawCount']) {
    assert.ok(result.getUint32(abi.layouts.engineResult[field], true) > 0, `${field} must be nonempty`);
  }
  assert.equal(fn.shapePlanCount(), 1, 'text_update must shape retained runs through HarfRust');

  const warmUpdate = engineStyleUpdateBytes(abi, {
    rootId: 29,
    codecHandle: 23,
    fontStackHandle: 17,
    expectedEngineRevision: 1,
    consumedRevision: 1,
    acknowledgedPublicationGeneration: 1,
    textEnd: 4,
    geometry: true,
  });
  requestPointer = fn.requestPointer(29);
  new Uint8Array(memory.buffer, requestPointer, warmUpdate.byteLength).set(warmUpdate);
  resultPointer = fn.textUpdate(29, requestPointer, warmUpdate.byteLength);
  assert.strictEqual(memory.buffer, styleWarmBuffer, 'the identical nonempty frame must stay allocation-free');
  result = new DataView(memory.buffer, resultPointer, abi.layouts.engineResult.size);
  assert.equal(result.getUint32(abi.layouts.engineResult.status, true), abi.status.ok);
  assert.equal(result.getUint32(abi.layouts.engineResult.engineRevision, true), 2);
  assert.equal(result.getUint32(abi.layouts.engineResult.patchCount, true), 0);

  const removeRoot = engineStyleUpdateBytes(abi, {
    rootId: 29,
    codecHandle: 23,
    fontStackHandle: 17,
    expectedEngineRevision: 2,
    consumedRevision: 2,
    acknowledgedPublicationGeneration: 2,
    removeRoot: true,
  });
  requestPointer = fn.requestPointer(29);
  new Uint8Array(memory.buffer, requestPointer, removeRoot.byteLength).set(removeRoot);
  resultPointer = fn.textUpdate(29, requestPointer, removeRoot.byteLength);
  assert.strictEqual(memory.buffer, styleWarmBuffer, 'an invalid retained style update must not grow Wasm memory');
  result = new DataView(memory.buffer, resultPointer, abi.layouts.engineResult.size);
  assert.equal(result.getUint32(abi.layouts.engineResult.status, true), abi.status.invalidRequest);
  assert.equal(result.getUint32(abi.layouts.engineResult.engineRevision, true), 2);
  assert.equal(fn.shapePlanCount(), 1, 'an aborted update must not perform another shape');
  assert.equal(fn.disposeRoot(29), abi.status.ok);
  assert.equal(fn.disposeCodec(23), abi.status.ok);

  assert.equal(fn.disposeFont(101), abi.status.fontInUse);
  assert.equal(fn.disposeFontStack(17), abi.status.ok);
  assert.equal(fn.disposeFontStack(17), abi.status.fontStackMissing);
  assert.equal(fn.disposeFont(101), abi.status.ok);
  assert.equal(fn.fontBindingCount(), 0);
});

test('text_update advances missing clusters through an ordered font stack', async () => {
  const [interArtifact, devanagariArtifact, shaperWasm, abi] = await Promise.all([
    readFile(new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url)),
    readFile(
      new URL(
        '../../../../apps/benchmarks/fixtures/rendering/noto-sans-devanagari-bitmap-16.font.glb',
        import.meta.url,
      ),
    ),
    readFile(shaperWasmUrl),
    textShaperAbi,
  ]);
  const [inter, devanagari] = await Promise.all([
    validateFontArtifact(interArtifact),
    validateFontArtifact(devanagariArtifact),
  ]);
  const instance = await WebAssembly.instantiate(await WebAssembly.compile(shaperWasm), {});
  const memory = instance.exports[abi.memory];
  const fn = Object.fromEntries(
    Object.entries(abi.functions).map(([name, exported]) => [name, instance.exports[exported]]),
  );
  assert.equal(fn.initialize(), abi.status.ok);
  registerValidatedFont({ abi, fn, memory }, 101, inter);
  registerValidatedFont({ abi, fn, memory }, 202, devanagari);
  registerSimpleBinding({ abi, fn, memory }, 1001, 101, inter, 71, 1);
  registerSimpleBinding({ abi, fn, memory }, 1002, 202, devanagari, 72, 2);

  const stack = copyToWasm(memory, fn.allocate, Uint8Array.of(0xe9, 3, 0, 0, 0xea, 3, 0, 0));
  assert.equal(fn.registerFontStack(17, stack.pointer, 2), abi.status.ok);
  fn.deallocate(stack.pointer, stack.length);
  const codecBytes = twoTechniqueCodecBytes(abi);
  const codec = copyToWasm(memory, fn.allocate, codecBytes);
  assert.equal(fn.registerCodec(23, codec.pointer, codec.length), abi.status.ok);
  fn.deallocate(codec.pointer, codec.length);
  assert.equal(fn.createRoot(29, 2048, 64 * 1024, 0), abi.status.ok);

  const update = engineStyleUpdateBytes(abi, {
    rootId: 29,
    codecHandle: 23,
    fontStackHandle: 17,
    text: [0x0915],
    geometry: true,
  });
  const requestPointer = fn.requestPointer(29);
  new Uint8Array(memory.buffer, requestPointer, update.byteLength).set(update);
  const resultPointer = fn.textUpdate(29, requestPointer, update.byteLength);
  const result = new DataView(memory.buffer, resultPointer, abi.layouts.engineResult.size);
  assert.equal(result.getUint32(abi.layouts.engineResult.status, true), abi.status.ok);
  const primitivesOffset = result.getUint32(abi.layouts.engineResult.primitivesOffset, true);
  assert.equal(
    new DataView(memory.buffer).getUint32(
      resultPointer + primitivesOffset + abi.layouts.enginePrimitive.techniqueId,
      true,
    ),
    2,
    'the fallback glyph must retain its own raster format in the Rust render plan',
  );
  assert.equal(
    fn.shapePlanCount(),
    2,
    'Inter must shape .notdef before the Devanagari cluster advances to the fallback font',
  );
});

test('text_update appends a reordered Devanagari grapheme after a conjunct', async () => {
  const [artifact, shaperWasm, abi] = await Promise.all([
    readFile(
      new URL(
        '../../../../apps/benchmarks/fixtures/rendering/noto-sans-devanagari-bitmap-16.font.glb',
        import.meta.url,
      ),
    ),
    readFile(shaperWasmUrl),
    textShaperAbi,
  ]);
  const validated = await validateFontArtifact(artifact);
  const instance = await WebAssembly.instantiate(await WebAssembly.compile(shaperWasm), {});
  const memory = instance.exports[abi.memory];
  const fn = Object.fromEntries(
    Object.entries(abi.functions).map(([name, exported]) => [name, instance.exports[exported]]),
  );
  assert.equal(fn.initialize(), abi.status.ok);
  registerValidatedFont({ abi, fn, memory }, 202, validated);
  registerSimpleBinding({ abi, fn, memory }, 1002, 202, validated, 72, 1);

  const stack = copyToWasm(memory, fn.allocate, Uint8Array.of(0xea, 3, 0, 0));
  assert.equal(fn.registerFontStack(17, stack.pointer, 1), abi.status.ok);
  fn.deallocate(stack.pointer, stack.length);
  const codecBytes = renderCodecBytes(abi);
  const codec = copyToWasm(memory, fn.allocate, codecBytes);
  assert.equal(fn.registerCodec(23, codec.pointer, codec.length), abi.status.ok);
  fn.deallocate(codec.pointer, codec.length);
  assert.equal(fn.createRoot(29, 16 * 1024, 256 * 1024, 64), abi.status.ok);

  const prefix = 'कर्म क्षेत्र में प्रगति निरंतर चलती है। प्र';
  const appended = 'त्ये';
  assert.equal(prefix.length, 43);
  assert.equal(appended.length, 4);
  const initial = engineStyleUpdateBytes(abi, {
    rootId: 29,
    codecHandle: 23,
    fontStackHandle: 17,
    text: utf16Units(prefix),
    textEnd: prefix.length,
    maxClusters: 86,
    geometry: true,
  });
  let requestPointer = fn.requestPointer(29);
  new Uint8Array(memory.buffer, requestPointer, initial.byteLength).set(initial);
  let resultPointer = fn.textUpdate(29, requestPointer, initial.byteLength);
  let result = new DataView(memory.buffer, resultPointer, abi.layouts.engineResult.size);
  assert.equal(result.getUint32(abi.layouts.engineResult.status, true), abi.status.ok);

  const update = engineStyleUpdateBytes(abi, {
    rootId: 29,
    codecHandle: 23,
    fontStackHandle: 17,
    expectedEngineRevision: 1,
    consumedRevision: 1,
    acknowledgedPublicationGeneration: 1,
    text: utf16Units(appended),
    textStart: prefix.length,
    textEnd: prefix.length + appended.length,
    maxClusters: 94,
  });
  requestPointer = fn.requestPointer(29);
  new Uint8Array(memory.buffer, requestPointer, update.byteLength).set(update);
  resultPointer = fn.textUpdate(29, requestPointer, update.byteLength);
  result = new DataView(memory.buffer, resultPointer, abi.layouts.engineResult.size);
  assert.equal(result.getUint32(abi.layouts.engineResult.status, true), abi.status.ok);
});

test('shaper ownership stays scoped to its FontRegistry', async () => {
  const { artifact, shaperWasm } = await fixture();
  const firstRegistry = new FontRegistry();
  const secondRegistry = new FontRegistry();
  const foreign = await firstRegistry.registerAsset(artifact);
  const shaper = await createRuntimeShaper({ registry: secondRegistry, wasm: shaperWasm });

  assert.throws(() => shaper.registerFont(foreign), /not active in this shaper's registry/);
  shaper.dispose();
  foreign.dispose();
});

function copyToWasm(memory, allocate, source) {
  const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  const pointer = allocate(bytes.byteLength);
  assert.notEqual(pointer, 0);
  new Uint8Array(memory.buffer, pointer, bytes.byteLength).set(bytes);
  return { pointer, length: bytes.byteLength };
}

function registerValidatedFont({ abi, fn, memory }, handle, validated) {
  const allocations = [
    copyToWasm(memory, fn.allocate, validated.shapingSfnt),
    copyToWasm(memory, fn.allocate, validated.glyphExtents),
    copyToWasm(memory, fn.allocate, validated.glyphExtentsAvailability),
  ];
  assert.equal(
    fn.registerFont(
      handle,
      allocations[0].pointer,
      allocations[0].length,
      allocations[1].pointer,
      allocations[1].length,
      allocations[2].pointer,
      allocations[2].length,
    ),
    abi.status.ok,
  );
  for (const allocation of allocations) fn.deallocate(allocation.pointer, allocation.length);
}

function registerSimpleBinding({ abi, fn, memory }, bindingHandle, shapingHandle, validated, resourceId, techniqueId) {
  const glyphCount = validated.glyphExtents.byteLength / 8;
  const bytes = fontBindingBytes(abi, {
    techniqueId,
    glyphCount,
    strikes: [0],
    resources: [{ id: resourceId, generation: 1, kind: 1, reference: resourceId }],
    resourceIndices: new Array(glyphCount).fill(0),
    glyphF32: [new Array(glyphCount).fill(1)],
  });
  const allocation = copyToWasm(memory, fn.allocate, bytes);
  assert.equal(
    fn.registerFontBinding(bindingHandle, shapingHandle, allocation.pointer, allocation.length),
    abi.status.ok,
  );
  fn.deallocate(allocation.pointer, allocation.length);
}

function twoTechniqueCodecBytes(abi) {
  const program = (techniqueId, programId) => ({
    techniqueId,
    programId,
    f32InputCount: 1,
    u32InputCount: 0,
    buffers: [{ id: 1, scalar: abi.codec.scalarTypes.f32, vectorWidth: 1 }],
    operations: [
      { opcode: abi.codec.opcodes.loadF32, target: 0, operand0: 0 },
      { opcode: abi.codec.opcodes.storeF32, operand0: 0, immediate0: 1 },
    ],
  });
  return renderCodecBytesFromPrograms(abi, [program(1, 1), program(2, 2)]);
}

function engineStyleUpdateBytes(
  abi,
  {
    rootId,
    codecHandle,
    fontStackHandle,
    expectedEngineRevision = 0,
    consumedRevision = 0,
    acknowledgedPublicationGeneration = 0,
    text = [],
    textStart = 0,
    textEnd = text.length,
    deleteCount = 0,
    maxClusters = 2,
    removeRoot = false,
    styles = true,
    geometry = false,
  },
) {
  const request = abi.layouts.engineUpdateRequest;
  const paragraphRecord = abi.layouts.engineParagraphMutation;
  const textRecord = abi.layouts.engineTextMutation;
  const styleRecord = abi.layouts.engineStyleMutation;
  const paragraphRecordOffset = align(request.size, paragraphRecord.alignment);
  const textRecordOffset = text.length === 0 ? 0 : paragraphRecordOffset + paragraphRecord.size;
  const styleRecordOffset = align(
    paragraphRecordOffset + paragraphRecord.size + (text.length === 0 ? 0 : textRecord.size),
    styleRecord.alignment,
  );
  const textPayloadOffset = styleRecordOffset + styleRecord.size;
  const textPayloadEnd = textPayloadOffset + text.length * 2;
  const constraint = abi.layouts.engineConstraint;
  const region = abi.layouts.engineRegion;
  const constraintOffset = geometry ? align(textPayloadEnd, constraint.alignment) : 0;
  const regionOffset = geometry ? align(constraintOffset + constraint.size, region.alignment) : 0;
  const byteLength = geometry ? regionOffset + region.size : textPayloadEnd;
  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(request.abiVersion, abi.version, true);
  view.setUint32(request.byteLength, bytes.byteLength, true);
  view.setUint32(request.rootId, rootId, true);
  view.setUint32(request.expectedEngineRevision, expectedEngineRevision, true);
  view.setUint32(request.consumedRevision, consumedRevision, true);
  view.setUint32(request.acknowledgedPublicationGeneration, acknowledgedPublicationGeneration, true);
  view.setUint32(request.codecHandle, codecHandle, true);
  view.setUint32(request.capabilitySet, 1, true);
  view.setUint32(request.maxParagraphs, 1, true);
  const requestBox = geometry === true ? {} : geometry || {};
  const limits = { maxClusters, maxLines: requestBox.maxLines ?? 1 };
  for (const field of [
    'maxClusters',
    'maxLines',
    'maxRegions',
    'maxExclusions',
    'maxInlineObjects',
    'maxSlotsPerBand',
  ]) {
    view.setUint32(request[field], limits[field] ?? 1, true);
  }
  view.setUint32(request.maxOutputBytes, 64 * 1024, true);
  view.setUint32(request.paragraphMutationsOffset, paragraphRecordOffset, true);
  view.setUint32(request.paragraphMutationCount, 1, true);
  view.setUint32(request.textMutationsOffset, textRecordOffset, true);
  view.setUint32(request.textMutationCount, text.length === 0 ? 0 : 1, true);
  view.setUint32(request.styleMutationsOffset, styles ? styleRecordOffset : 0, true);
  view.setUint32(request.styleMutationCount, styles ? 1 : 0, true);
  if (geometry) {
    view.setUint32(request.constraintsOffset, constraintOffset, true);
    view.setUint32(request.constraintCount, 1, true);
    view.setUint32(request.regionsOffset, regionOffset, true);
    view.setUint32(request.regionCount, 1, true);
  }

  view.setUint8(paragraphRecordOffset + paragraphRecord.opcode, abi.engine.paragraphMutationOpcodes.upsert);
  view.setUint32(paragraphRecordOffset + paragraphRecord.paragraphId, 1, true);

  if (text.length > 0) {
    view.setUint8(textRecordOffset + textRecord.opcode, abi.engine.textMutationOpcodes.replaceUtf16);
    view.setUint8(textRecordOffset + textRecord.encoding, abi.engine.textEncodings.utf16Le);
    view.setUint32(textRecordOffset + textRecord.paragraphId, 1, true);
    view.setUint32(textRecordOffset + textRecord.textStart, textStart, true);
    view.setUint32(textRecordOffset + textRecord.deleteCount, deleteCount, true);
    view.setUint32(textRecordOffset + textRecord.insertOffset, textPayloadOffset, true);
    view.setUint32(textRecordOffset + textRecord.insertCount, text.length, true);
    for (const [index, unit] of text.entries()) view.setUint16(textPayloadOffset + index * 2, unit, true);
  }

  if (styles) {
    view.setUint8(
      styleRecordOffset + styleRecord.opcode,
      removeRoot ? abi.engine.styleMutationOpcodes.remove : abi.engine.styleMutationOpcodes.upsert,
    );
    view.setUint32(styleRecordOffset + styleRecord.paragraphId, 1, true);
    view.setUint32(styleRecordOffset + styleRecord.styleId, 1, true);
  }
  if (styles && !removeRoot) {
    view.setUint8(styleRecordOffset + styleRecord.flags, abi.engine.styleFlags.root);
    view.setUint32(
      styleRecordOffset + styleRecord.fieldMask,
      abi.engine.styleFields.fontStack |
        abi.engine.styleFields.fontSize |
        abi.engine.styleFields.lineHeight |
        abi.engine.styleFields.rasterPixelRatio,
      true,
    );
    view.setUint32(styleRecordOffset + styleRecord.textEnd, textEnd, true);
    view.setUint32(styleRecordOffset + styleRecord.fontStackHandle, fontStackHandle, true);
    view.setFloat32(styleRecordOffset + styleRecord.fontSize, 16, true);
    view.setFloat32(styleRecordOffset + styleRecord.lineHeight, 1.2, true);
    view.setFloat32(styleRecordOffset + styleRecord.rasterPixelRatio, 1, true);
  }
  if (geometry) {
    const box = geometry === true ? {} : geometry;
    view.setUint32(constraintOffset + constraint.paragraphId, 1, true);
    view.setUint32(constraintOffset + constraint.flowThreadId, 1, true);
    view.setFloat32(constraintOffset + constraint.width, box.width ?? 100, true);
    view.setFloat32(constraintOffset + constraint.height, box.height ?? 100, true);
    view.setFloat32(constraintOffset + constraint.viewportBlockEnd, box.height ?? 100, true);
    view.setUint32(constraintOffset + constraint.maxLines, box.maxLines ?? 1, true);
    view.setUint16(constraintOffset + constraint.regionCount, 1, true);
    view.setUint8(constraintOffset + constraint.widthMode, abi.engine.axisModes.exact);
    view.setUint8(constraintOffset + constraint.heightMode, abi.engine.axisModes.exact);
    view.setUint8(constraintOffset + constraint.wrap, abi.engine.wrapModes.word);
    view.setUint8(constraintOffset + constraint.align, abi.engine.inlineAlignments.start);
    view.setUint8(constraintOffset + constraint.overflow, abi.engine.overflowModes.clip);
    view.setUint8(constraintOffset + constraint.blockAlign, abi.engine.blockAlignments.start);
    view.setUint8(constraintOffset + constraint.lastLine, abi.engine.lastLinePolicies.auto);

    view.setUint32(regionOffset + region.id, 1, true);
    view.setUint32(regionOffset + region.geometryRevision, 1, true);
    view.setUint32(regionOffset + region.transformIndex, 1, true);
    view.setUint8(regionOffset + region.shape, abi.engine.flowShapeKinds.rectangle);
    view.setUint8(regionOffset + region.writingMode, abi.engine.writingModes.horizontalTb);
    view.setUint8(regionOffset + region.textOrientation, abi.engine.textOrientations.mixed);
    for (const field of ['inlineEnd', 'clipInlineEnd']) {
      view.setFloat32(regionOffset + region[field], box.width ?? 100, true);
    }
    for (const field of ['blockEnd', 'clipBlockEnd']) {
      view.setFloat32(regionOffset + region[field], box.height ?? 100, true);
    }
  }
  return bytes;
}

function utf16Units(value) {
  const units = new Uint16Array(value.length);
  for (let index = 0; index < value.length; index += 1) units[index] = value.charCodeAt(index);
  return units;
}

function align(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

/** measureParagraph writes its semantic table to the inactive result slot without publishing — no revision advance, no publication-generation bump. */
test('measure_paragraph answers synchronously without publishing or burning revisions', async () => {
  const [interArtifact, shaperWasm, abi] = await Promise.all([
    readFile(new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url)),
    readFile(shaperWasmUrl),
    textShaperAbi,
  ]);
  const inter = await validateFontArtifact(interArtifact);
  const instance = await WebAssembly.instantiate(await WebAssembly.compile(shaperWasm), {});
  const memory = instance.exports[abi.memory];
  const fn = Object.fromEntries(
    Object.entries(abi.functions).map(([name, exported]) => [name, instance.exports[exported]]),
  );
  assert.equal(fn.initialize(), abi.status.ok);
  assert.equal(typeof fn.measureParagraph, 'function', 'the ABI declares the synchronous measure entry');
  registerValidatedFont({ abi, fn, memory }, 101, inter);
  registerSimpleBinding({ abi, fn, memory }, 1001, 101, inter, 71, 1);
  const stack = copyToWasm(memory, fn.allocate, Uint8Array.of(0xe9, 3, 0, 0));
  assert.equal(fn.registerFontStack(17, stack.pointer, 1), abi.status.ok);
  fn.deallocate(stack.pointer, stack.length);
  const codecBytes = twoTechniqueCodecBytes(abi);
  const codec = copyToWasm(memory, fn.allocate, codecBytes);
  assert.equal(fn.registerCodec(23, codec.pointer, codec.length), abi.status.ok);
  fn.deallocate(codec.pointer, codec.length);
  assert.equal(fn.createRoot(29, 4096, 128 * 1024, 0), abi.status.ok);

  const resultLayout = abi.layouts.engineResult;
  const record = abi.layouts.engineSemanticView;
  const run = (bytes, entry, paragraphId) => {
    const pointer = fn.requestPointer(29);
    new Uint8Array(memory.buffer, pointer, bytes.byteLength).set(bytes);
    const resultPointer =
      entry === 'measure'
        ? fn.measureParagraph(29, pointer, bytes.byteLength, paragraphId)
        : fn.textUpdate(29, pointer, bytes.byteLength);
    const view = new DataView(memory.buffer, resultPointer, resultLayout.size);
    return {
      pointer: resultPointer,
      status: view.getUint32(resultLayout.status, true),
      engineRevision: view.getUint32(resultLayout.engineRevision, true),
      publicationGeneration: view.getUint32(resultLayout.publicationGeneration, true),
      semanticViewsOffset: view.getUint32(resultLayout.semanticViewsOffset, true),
      semanticViewCount: view.getUint32(resultLayout.semanticViewCount, true),
    };
  };
  const measurementFor = (result, paragraphId) => {
    for (let index = 0; index < result.semanticViewCount; index += 1) {
      const offset = result.pointer + result.semanticViewsOffset + index * record.size;
      const view = new DataView(memory.buffer, offset, record.size);
      if (
        view.getUint8(record.kind) === abi.engine.semanticKinds.paragraphMeasurement &&
        view.getUint32(record.id, true) === paragraphId
      ) {
        return {
          lineCount: view.getUint32(record.itemCount, true),
          inlineExtent: view.getFloat32(record.inlineExtent, true),
        };
      }
    }
    return undefined;
  };

  const text = Array.from('alpha beta gamma delta', (character) => character.charCodeAt(0));
  const seeded = run(
    engineStyleUpdateBytes(abi, {
      rootId: 29,
      codecHandle: 23,
      fontStackHandle: 17,
      text,
      maxClusters: 64,
      geometry: { width: 300, height: 200, maxLines: 16 },
    }),
    'update',
  );
  assert.equal(seeded.status, abi.status.ok);

  // The narrow measure reflects the queried constraint, not the committed one.
  const measureRequest = engineStyleUpdateBytes(abi, {
    rootId: 29,
    codecHandle: 23,
    fontStackHandle: 17,
    expectedEngineRevision: seeded.engineRevision,
    consumedRevision: seeded.engineRevision,
    acknowledgedPublicationGeneration: seeded.publicationGeneration,
    maxClusters: 64,
    styles: false,
    geometry: { width: 90, height: 400, maxLines: 32 },
  });
  new DataView(measureRequest.buffer).setUint32(
    abi.layouts.engineUpdateRequest.semanticViewMask,
    abi.engine.semanticViewMasks.measurement,
    true,
  );
  const measured = run(measureRequest, 'measure', 1);
  assert.equal(measured.status, abi.status.ok);
  const narrow = measurementFor(measured, 1);
  assert.ok(narrow, 'the query returns a measurement record for the queried paragraph');
  assert.ok(narrow.lineCount >= 2, 'the narrow measure wraps');
  assert.ok(narrow.inlineExtent <= 90 + 1e-3, 'the measure reflects the queried width');
  assert.equal(measured.publicationGeneration, seeded.publicationGeneration, 'no publication flip');
  assert.equal(measured.engineRevision, seeded.engineRevision, 'no revision burn');

  // Sequential queries extend one retained speculative transaction: a repeated
  // identical query answers identically, and a new width relayouts correctly from
  // the retained prefix without touching publication or revision state.
  const repeated = run(measureRequest.slice(), 'measure', 1);
  assert.equal(repeated.status, abi.status.ok);
  assert.deepEqual(measurementFor(repeated, 1), narrow, 'a repeated query answers identically');
  const widerRequest = engineStyleUpdateBytes(abi, {
    rootId: 29,
    codecHandle: 23,
    fontStackHandle: 17,
    expectedEngineRevision: seeded.engineRevision,
    consumedRevision: seeded.engineRevision,
    acknowledgedPublicationGeneration: seeded.publicationGeneration,
    maxClusters: 64,
    styles: false,
    geometry: { width: 150, height: 400, maxLines: 32 },
  });
  new DataView(widerRequest.buffer).setUint32(
    abi.layouts.engineUpdateRequest.semanticViewMask,
    abi.engine.semanticViewMasks.measurement,
    true,
  );
  const wider = run(widerRequest, 'measure', 1);
  assert.equal(wider.status, abi.status.ok);
  const relaxed = measurementFor(wider, 1);
  assert.ok(relaxed, 'the extended transaction re-answers for the new constraint');
  assert.ok(relaxed.inlineExtent <= 150 + 1e-3, 'the new measure reflects the new width');
  assert.ok(relaxed.inlineExtent > narrow.inlineExtent, 'the wider constraint relaxes the wrap');
  assert.ok(relaxed.lineCount < narrow.lineCount, 'the wider constraint uses fewer lines');
  assert.equal(wider.publicationGeneration, seeded.publicationGeneration, 'still no publication flip');
  assert.equal(wider.engineRevision, seeded.engineRevision, 'still no revision burn');

  // Reverting to the committed constraint must revert the speculative layout
  // tail: the answer comes from committed flow, not the narrow query's leftovers.
  const committedWidthRequest = engineStyleUpdateBytes(abi, {
    rootId: 29,
    codecHandle: 23,
    fontStackHandle: 17,
    expectedEngineRevision: seeded.engineRevision,
    consumedRevision: seeded.engineRevision,
    acknowledgedPublicationGeneration: seeded.publicationGeneration,
    maxClusters: 64,
    styles: false,
    geometry: { width: 300, height: 200, maxLines: 16 },
  });
  new DataView(committedWidthRequest.buffer).setUint32(
    abi.layouts.engineUpdateRequest.semanticViewMask,
    abi.engine.semanticViewMasks.measurement,
    true,
  );
  const reverted = run(committedWidthRequest, 'measure', 1);
  assert.equal(reverted.status, abi.status.ok);
  const committedMeasure = measurementFor(reverted, 1);
  assert.ok(committedMeasure, 'the reverted query answers');
  assert.equal(committedMeasure.lineCount, 1, 'the committed width lays out one line again');
  assert.ok(
    committedMeasure.inlineExtent > relaxed.inlineExtent,
    'the committed-width answer reflects committed flow, not the retained narrow tail',
  );

  // Committed state is intact: an ordinary follow-up frame continues from the
  // pre-measure revisions.
  const followUp = run(
    engineStyleUpdateBytes(abi, {
      rootId: 29,
      codecHandle: 23,
      fontStackHandle: 17,
      expectedEngineRevision: seeded.engineRevision,
      consumedRevision: seeded.engineRevision,
      acknowledgedPublicationGeneration: seeded.publicationGeneration,
      maxClusters: 64,
      styles: false,
      geometry: { width: 260, height: 200, maxLines: 16 },
    }),
    'update',
  );
  assert.equal(followUp.status, abi.status.ok);
  assert.equal(followUp.engineRevision, seeded.engineRevision + 1);
  assert.equal(fn.disposeRoot(29), abi.status.ok);
});

/** On a fingerprint hit, the committing frame adopts the retained speculative transaction's pending state and reserved glyph ids rather than rolling them back. */
test('the committing frame adopts the speculative transaction and its reserved glyph identities', async () => {
  const [interArtifact, shaperWasm, abi] = await Promise.all([
    readFile(new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url)),
    readFile(shaperWasmUrl),
    textShaperAbi,
  ]);
  const inter = await validateFontArtifact(interArtifact);
  const instance = await WebAssembly.instantiate(await WebAssembly.compile(shaperWasm), {});
  const memory = instance.exports[abi.memory];
  const fn = Object.fromEntries(
    Object.entries(abi.functions).map(([name, exported]) => [name, instance.exports[exported]]),
  );
  assert.equal(fn.initialize(), abi.status.ok);
  registerValidatedFont({ abi, fn, memory }, 101, inter);
  registerSimpleBinding({ abi, fn, memory }, 1001, 101, inter, 71, 1);
  const stack = copyToWasm(memory, fn.allocate, Uint8Array.of(0xe9, 3, 0, 0));
  assert.equal(fn.registerFontStack(17, stack.pointer, 1), abi.status.ok);
  fn.deallocate(stack.pointer, stack.length);
  const codecBytes = twoTechniqueCodecBytes(abi);
  const codec = copyToWasm(memory, fn.allocate, codecBytes);
  assert.equal(fn.registerCodec(23, codec.pointer, codec.length), abi.status.ok);
  fn.deallocate(codec.pointer, codec.length);
  assert.equal(fn.createRoot(29, 4096, 256 * 1024, 0), abi.status.ok);

  const resultLayout = abi.layouts.engineResult;
  const record = abi.layouts.engineSemanticView;
  const run = (bytes, entry, paragraphId) => {
    new DataView(bytes.buffer).setUint32(
      abi.layouts.engineUpdateRequest.semanticViewMask,
      abi.engine.semanticViewMasks.all,
      true,
    );
    const pointer = fn.requestPointer(29);
    new Uint8Array(memory.buffer, pointer, bytes.byteLength).set(bytes);
    const resultPointer =
      entry === 'measure'
        ? fn.measureParagraph(29, pointer, bytes.byteLength, paragraphId)
        : fn.textUpdate(29, pointer, bytes.byteLength);
    const view = new DataView(memory.buffer, resultPointer, resultLayout.size);
    const result = {
      status: view.getUint32(resultLayout.status, true),
      engineRevision: view.getUint32(resultLayout.engineRevision, true),
      publicationGeneration: view.getUint32(resultLayout.publicationGeneration, true),
      glyphIds: [],
    };
    const semanticViewsOffset = view.getUint32(resultLayout.semanticViewsOffset, true);
    const semanticViewCount = view.getUint32(resultLayout.semanticViewCount, true);
    for (let index = 0; index < semanticViewCount; index += 1) {
      const entryView = new DataView(
        memory.buffer,
        resultPointer + semanticViewsOffset + index * record.size,
        record.size,
      );
      if (entryView.getUint8(record.kind) === abi.engine.semanticKinds.glyph) {
        result.glyphIds.push(entryView.getUint32(record.id, true));
      }
    }
    result.glyphIds.sort((left, right) => left - right);
    return result;
  };

  const base = Array.from('alpha beta', (character) => character.charCodeAt(0));
  const geometry = { width: 300, height: 200, maxLines: 16 };
  const seeded = run(
    engineStyleUpdateBytes(abi, {
      rootId: 29,
      codecHandle: 23,
      fontStackHandle: 17,
      text: base,
      maxClusters: 64,
      geometry,
    }),
    'update',
  );
  assert.equal(seeded.status, abi.status.ok);
  assert.ok(seeded.glyphIds.length > 0, 'the seeded frame reports committed glyphs');

  const appended = (suffix) => ({
    rootId: 29,
    codecHandle: 23,
    fontStackHandle: 17,
    expectedEngineRevision: seeded.engineRevision,
    consumedRevision: seeded.engineRevision,
    acknowledgedPublicationGeneration: seeded.publicationGeneration,
    text: Array.from(suffix, (character) => character.charCodeAt(0)),
    textStart: base.length,
    textEnd: base.length + suffix.length,
    maxClusters: 64,
    geometry,
  });
  const newIds = (result) => result.glyphIds.filter((id) => !seeded.glyphIds.includes(id));

  const first = run(engineStyleUpdateBytes(abi, appended(' gamma')), 'measure', 1);
  assert.equal(first.status, abi.status.ok);
  const firstNew = newIds(first);
  assert.ok(firstNew.length > 0, 'the first query reserves identities for its speculative glyphs');

  const second = run(engineStyleUpdateBytes(abi, appended(' delta')), 'measure', 1);
  assert.equal(second.status, abi.status.ok);
  const secondNew = newIds(second);
  assert.ok(secondNew.length > 0, 'the second query reserves identities for its speculative glyphs');
  assert.ok(
    Math.min(...secondNew) > Math.max(...firstNew),
    'identity reservation is linear across queries: the rebuilt speculation never reuses reported ids',
  );

  const committed = run(engineStyleUpdateBytes(abi, appended(' delta')), 'update');
  assert.equal(committed.status, abi.status.ok);
  assert.equal(committed.engineRevision, seeded.engineRevision + 1);
  assert.deepEqual(
    newIds(committed),
    secondNew,
    'the committing frame adopts the exact glyph identities the query reported',
  );
  assert.equal(fn.disposeRoot(29), abi.status.ok);
});

/** Measurement-only queries skip per-glyph positioning (derived at line level instead); committing then runs exactly that missing tail, proved by byte-identical output vs. a never-measured control. */
test('measurement-only queries leave the committing frame byte-identical to a never-measured control', async () => {
  const [interArtifact, shaperWasm, abi] = await Promise.all([
    readFile(new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url)),
    readFile(shaperWasmUrl),
    textShaperAbi,
  ]);
  const inter = await validateFontArtifact(interArtifact);
  const createEngine = async () => {
    const instance = await WebAssembly.instantiate(await WebAssembly.compile(shaperWasm), {});
    const memory = instance.exports[abi.memory];
    const fn = Object.fromEntries(
      Object.entries(abi.functions).map(([name, exported]) => [name, instance.exports[exported]]),
    );
    assert.equal(fn.initialize(), abi.status.ok);
    registerValidatedFont({ abi, fn, memory }, 101, inter);
    registerSimpleBinding({ abi, fn, memory }, 1001, 101, inter, 71, 1);
    const stack = copyToWasm(memory, fn.allocate, Uint8Array.of(0xe9, 3, 0, 0));
    assert.equal(fn.registerFontStack(17, stack.pointer, 1), abi.status.ok);
    fn.deallocate(stack.pointer, stack.length);
    const codecBytes = twoTechniqueCodecBytes(abi);
    const codec = copyToWasm(memory, fn.allocate, codecBytes);
    assert.equal(fn.registerCodec(23, codec.pointer, codec.length), abi.status.ok);
    fn.deallocate(codec.pointer, codec.length);
    assert.equal(fn.createRoot(37, 4096, 256 * 1024, 0), abi.status.ok);
    const resultLayout = abi.layouts.engineResult;
    const run = (bytes, entry, mask, paragraphId) => {
      new DataView(bytes.buffer).setUint32(abi.layouts.engineUpdateRequest.semanticViewMask, mask, true);
      const pointer = fn.requestPointer(37);
      new Uint8Array(memory.buffer, pointer, bytes.byteLength).set(bytes);
      const resultPointer =
        entry === 'measure'
          ? fn.measureParagraph(37, pointer, bytes.byteLength, paragraphId)
          : fn.textUpdate(37, pointer, bytes.byteLength);
      const view = new DataView(memory.buffer, resultPointer, resultLayout.size);
      const semanticViewsOffset = view.getUint32(resultLayout.semanticViewsOffset, true);
      const semanticViewCount = view.getUint32(resultLayout.semanticViewCount, true);
      return {
        status: view.getUint32(resultLayout.status, true),
        engineRevision: view.getUint32(resultLayout.engineRevision, true),
        publicationGeneration: view.getUint32(resultLayout.publicationGeneration, true),
        semanticBytes: new Uint8Array(
          memory.buffer,
          resultPointer + semanticViewsOffset,
          semanticViewCount * abi.layouts.engineSemanticView.size,
        ).slice(),
      };
    };
    return { fn, run };
  };

  const text = Array.from('alpha beta gamma delta', (character) => character.charCodeAt(0));
  const request = (geometryWidth, seeded, withText) =>
    engineStyleUpdateBytes(abi, {
      rootId: 37,
      codecHandle: 23,
      fontStackHandle: 17,
      ...(seeded === undefined
        ? {}
        : {
            expectedEngineRevision: seeded.engineRevision,
            consumedRevision: seeded.engineRevision,
            acknowledgedPublicationGeneration: seeded.publicationGeneration,
          }),
      ...(withText ? { text } : { styles: false }),
      maxClusters: 64,
      geometry: { width: geometryWidth, height: 200, maxLines: 16 },
    });
  const all = abi.engine.semanticViewMasks.all;
  const measurement = abi.engine.semanticViewMasks.measurement;

  const measuring = await createEngine();
  const measuredSeed = measuring.run(request(300, undefined, true), 'update', all);
  assert.equal(measuredSeed.status, abi.status.ok);
  for (const width of [150, 96, 96]) {
    const query = measuring.run(request(width, measuredSeed, false), 'measure', measurement, 1);
    assert.equal(query.status, abi.status.ok, `measure at width ${width}`);
  }
  const measuredCommit = measuring.run(request(96, measuredSeed, false), 'update', all);
  assert.equal(measuredCommit.status, abi.status.ok);

  const control = await createEngine();
  const controlSeed = control.run(request(300, undefined, true), 'update', all);
  assert.equal(controlSeed.status, abi.status.ok);
  const controlCommit = control.run(request(96, controlSeed, false), 'update', all);
  assert.equal(controlCommit.status, abi.status.ok);

  assert.equal(measuredCommit.engineRevision, controlCommit.engineRevision);
  assert.deepEqual(
    measuredCommit.semanticBytes,
    controlCommit.semanticBytes,
    'the adopted commit publishes the exact semantic table a never-measured commit publishes',
  );

  // The presentation-surface regression: an inspection query positions the
  // speculative flow, and a following measurement-only query at a NEW width
  // re-runs flow without positioning — the stale pending positioning must
  // drop rather than mismatch the superseded flow.
  const inspected = measuring.run(
    request(
      220,
      { engineRevision: measuredCommit.engineRevision, publicationGeneration: measuredCommit.publicationGeneration },
      false,
    ),
    'measure',
    all,
    1,
  );
  assert.equal(inspected.status, abi.status.ok, 'inspection query after commit');
  const remeasured = measuring.run(
    request(
      150,
      { engineRevision: measuredCommit.engineRevision, publicationGeneration: measuredCommit.publicationGeneration },
      false,
    ),
    'measure',
    measurement,
    1,
  );
  assert.equal(remeasured.status, abi.status.ok, 'measurement-only re-query over a positioned transaction');
});

/** A width change that preserves committed line breaks adopts committed positioning and publishes nothing; one that moves breaks still relayouts fully. */
test('resize equivalence adopts committed positioning and still relayouts on break changes', async () => {
  const [interArtifact, shaperWasm, abi] = await Promise.all([
    readFile(new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url)),
    readFile(shaperWasmUrl),
    textShaperAbi,
  ]);
  const inter = await validateFontArtifact(interArtifact);
  const instance = await WebAssembly.instantiate(await WebAssembly.compile(shaperWasm), {});
  const memory = instance.exports[abi.memory];
  const fn = Object.fromEntries(
    Object.entries(abi.functions).map(([name, exported]) => [name, instance.exports[exported]]),
  );
  assert.equal(fn.initialize(), abi.status.ok);
  registerValidatedFont({ abi, fn, memory }, 101, inter);
  registerSimpleBinding({ abi, fn, memory }, 1001, 101, inter, 71, 1);
  const stack = copyToWasm(memory, fn.allocate, Uint8Array.of(0xe9, 3, 0, 0));
  assert.equal(fn.registerFontStack(17, stack.pointer, 1), abi.status.ok);
  fn.deallocate(stack.pointer, stack.length);
  const codecBytes = twoTechniqueCodecBytes(abi);
  const codec = copyToWasm(memory, fn.allocate, codecBytes);
  assert.equal(fn.registerCodec(23, codec.pointer, codec.length), abi.status.ok);
  fn.deallocate(codec.pointer, codec.length);
  assert.equal(fn.createRoot(41, 4096, 128 * 1024, 0), abi.status.ok);

  const resultLayout = abi.layouts.engineResult;
  const record = abi.layouts.engineSemanticView;
  const run = (bytes, entry, paragraphId) => {
    new DataView(bytes.buffer).setUint32(
      abi.layouts.engineUpdateRequest.semanticViewMask,
      abi.engine.semanticViewMasks.measurement,
      true,
    );
    const pointer = fn.requestPointer(41);
    new Uint8Array(memory.buffer, pointer, bytes.byteLength).set(bytes);
    const resultPointer =
      entry === 'measure'
        ? fn.measureParagraph(41, pointer, bytes.byteLength, paragraphId)
        : fn.textUpdate(41, pointer, bytes.byteLength);
    const view = new DataView(memory.buffer, resultPointer, resultLayout.size);
    const semanticViewsOffset = view.getUint32(resultLayout.semanticViewsOffset, true);
    const semanticViewCount = view.getUint32(resultLayout.semanticViewCount, true);
    let measurement;
    for (let index = 0; index < semanticViewCount; index += 1) {
      const entryView = new DataView(
        memory.buffer,
        resultPointer + semanticViewsOffset + index * record.size,
        record.size,
      );
      if (entryView.getUint8(record.kind) === abi.engine.semanticKinds.paragraphMeasurement) {
        measurement = {
          lineCount: entryView.getUint32(record.itemCount, true),
          inlineExtent: entryView.getFloat32(record.inlineExtent, true),
        };
      }
    }
    return {
      status: view.getUint32(resultLayout.status, true),
      engineRevision: view.getUint32(resultLayout.engineRevision, true),
      publicationGeneration: view.getUint32(resultLayout.publicationGeneration, true),
      measurement,
    };
  };

  const text = Array.from('alpha beta gamma delta', (character) => character.charCodeAt(0));
  const update = (width, seeded, withText) =>
    run(
      engineStyleUpdateBytes(abi, {
        rootId: 41,
        codecHandle: 23,
        fontStackHandle: 17,
        ...(seeded === undefined
          ? {}
          : {
              expectedEngineRevision: seeded.engineRevision,
              consumedRevision: seeded.engineRevision,
              acknowledgedPublicationGeneration: seeded.publicationGeneration,
            }),
        ...(withText ? { text } : { styles: false }),
        maxClusters: 64,
        geometry: { width, height: 200, maxLines: 16 },
      }),
      'update',
    );

  const seeded = update(300, undefined, true);
  assert.equal(seeded.status, abi.status.ok);
  assert.equal(seeded.measurement?.lineCount, 1);
  // 300 -> 220 keeps the single line: the equivalence path answers with
  // committed positioning and the same pinned extent.
  const widened = update(220, seeded, false);
  assert.equal(widened.status, abi.status.ok);
  assert.equal(widened.measurement?.lineCount, 1);
  assert.equal(widened.measurement?.inlineExtent, 181.3671875);
  // 220 -> 96 moves breaks: the full path must relayout from the retained
  // committed state the short-circuit preserved.
  const narrowed = update(96, widened, false);
  assert.equal(narrowed.status, abi.status.ok);
  assert.equal(narrowed.measurement?.lineCount, 3);
  // Same re-derivation as the pinned table below: the widest wrapped line no
  // longer charges its terminating space, so this drops by exactly one 4.5 px
  // space. The 300 and 220 extents, whose lines end in ink, are unchanged —
  // which is what makes this a layout-contract change rather than drift.
  assert.equal(narrowed.measurement?.inlineExtent, 79.0234375);
  // And back out again across the equivalence boundary.
  const restored = update(300, narrowed, false);
  assert.equal(restored.status, abi.status.ok);
  assert.equal(restored.measurement?.lineCount, 1);
  assert.equal(restored.measurement?.inlineExtent, 181.3671875);
  assert.equal(fn.disposeRoot(41), abi.status.ok);
});

/** f32 extents are pinned exactly per the F16.16 integer rounding contract (layout_units.rs), deterministic across native/Wasm and hosts. A pinned-value change is a layout-contract change — re-derive deliberately, never absorb. */
test('measured f32 extents reproduce exactly at every pinned width', async () => {
  const [interArtifact, shaperWasm, abi] = await Promise.all([
    readFile(new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url)),
    readFile(shaperWasmUrl),
    textShaperAbi,
  ]);
  const inter = await validateFontArtifact(interArtifact);
  const instance = await WebAssembly.instantiate(await WebAssembly.compile(shaperWasm), {});
  const memory = instance.exports[abi.memory];
  const fn = Object.fromEntries(
    Object.entries(abi.functions).map(([name, exported]) => [name, instance.exports[exported]]),
  );
  assert.equal(fn.initialize(), abi.status.ok);
  registerValidatedFont({ abi, fn, memory }, 101, inter);
  registerSimpleBinding({ abi, fn, memory }, 1001, 101, inter, 71, 1);
  const stack = copyToWasm(memory, fn.allocate, Uint8Array.of(0xe9, 3, 0, 0));
  assert.equal(fn.registerFontStack(17, stack.pointer, 1), abi.status.ok);
  fn.deallocate(stack.pointer, stack.length);
  const codecBytes = twoTechniqueCodecBytes(abi);
  const codec = copyToWasm(memory, fn.allocate, codecBytes);
  assert.equal(fn.registerCodec(23, codec.pointer, codec.length), abi.status.ok);
  fn.deallocate(codec.pointer, codec.length);
  assert.equal(fn.createRoot(31, 4096, 128 * 1024, 0), abi.status.ok);

  const resultLayout = abi.layouts.engineResult;
  const record = abi.layouts.engineSemanticView;
  const run = (bytes, entry, paragraphId) => {
    const pointer = fn.requestPointer(31);
    new Uint8Array(memory.buffer, pointer, bytes.byteLength).set(bytes);
    const resultPointer =
      entry === 'measure'
        ? fn.measureParagraph(31, pointer, bytes.byteLength, paragraphId)
        : fn.textUpdate(31, pointer, bytes.byteLength);
    const view = new DataView(memory.buffer, resultPointer, resultLayout.size);
    return {
      pointer: resultPointer,
      status: view.getUint32(resultLayout.status, true),
      engineRevision: view.getUint32(resultLayout.engineRevision, true),
      publicationGeneration: view.getUint32(resultLayout.publicationGeneration, true),
      semanticViewsOffset: view.getUint32(resultLayout.semanticViewsOffset, true),
      semanticViewCount: view.getUint32(resultLayout.semanticViewCount, true),
    };
  };
  const measurementFor = (result, paragraphId) => {
    for (let index = 0; index < result.semanticViewCount; index += 1) {
      const offset = result.pointer + result.semanticViewsOffset + index * record.size;
      const view = new DataView(memory.buffer, offset, record.size);
      if (
        view.getUint8(record.kind) === abi.engine.semanticKinds.paragraphMeasurement &&
        view.getUint32(record.id, true) === paragraphId
      ) {
        return {
          lineCount: view.getUint32(record.itemCount, true),
          inlineExtent: view.getFloat32(record.inlineExtent, true),
        };
      }
    }
    return undefined;
  };

  const text = Array.from('alpha beta gamma delta', (character) => character.charCodeAt(0));
  const seeded = run(
    engineStyleUpdateBytes(abi, {
      rootId: 31,
      codecHandle: 23,
      fontStackHandle: 17,
      text,
      maxClusters: 64,
      geometry: { width: 300, height: 200, maxLines: 16 },
    }),
    'update',
  );
  assert.equal(seeded.status, abi.status.ok);

  // Every pinned extent is the exact f32 publication of the authoritative
  // F16.16 integer fit.
  // Re-derived once when the line-terminating word space began to hang (D-257).
  // The derivation is exact and was predicted before it was measured: a wrapped
  // line no longer charges the space that terminates it, so every multi-line
  // width loses exactly one space advance — 4.50000 px, Inter's space at 16 px —
  // while the single-line widths, whose text ends in ink, do not move at all.
  // Line counts are unchanged at every width. These values were re-pinned when
  // D-291 increased the internal layout precision from F26.6 to F16.16; the test
  // continues to protect exact native/Wasm publication rather than a tolerance.
  const pinned = [
    [300, 1, 181.3671875],
    [220, 1, 181.3671875],
    [150, 2, 139.3359375],
    [96, 3, 79.0234375],
    [73, 4, 55.8125],
  ];
  for (const [width, lineCount, inlineExtent] of pinned) {
    const measureRequest = engineStyleUpdateBytes(abi, {
      rootId: 31,
      codecHandle: 23,
      fontStackHandle: 17,
      expectedEngineRevision: seeded.engineRevision,
      consumedRevision: seeded.engineRevision,
      acknowledgedPublicationGeneration: seeded.publicationGeneration,
      maxClusters: 64,
      styles: false,
      geometry: { width, height: 200, maxLines: 16 },
    });
    new DataView(measureRequest.buffer).setUint32(
      abi.layouts.engineUpdateRequest.semanticViewMask,
      abi.engine.semanticViewMasks.measurement,
      true,
    );
    const measured = run(measureRequest, 'measure', 1);
    assert.equal(measured.status, abi.status.ok, `measure at width ${width}`);
    const measurement = measurementFor(measured, 1);
    assert.ok(measurement, `measurement view at width ${width}`);
    assert.equal(measurement.lineCount, lineCount, `line count at width ${width}`);
    assert.equal(measurement.inlineExtent, inlineExtent, `exact f32 extent at width ${width}`);
  }
  assert.equal(fn.disposeRoot(31), abi.status.ok);
});
