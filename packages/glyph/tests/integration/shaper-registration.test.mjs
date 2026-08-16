import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { FontRegistry } from '@pmndrs/glyph';
import { createRuntimeShaper } from '../../dist/shaper.js';
import { createFontBaker } from '@pmndrs/glyph/bake';
import { validateFontArtifact } from '@pmndrs/glyph/bake';
import { fontBindingBytes, renderPolicyBytes, renderPolicyBytesFromPrograms } from '../support/engine-abi.mjs';

const fixtureDirectory = new URL('../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/', import.meta.url);
const shaperWasmUrl = new URL('../../dist/text_shaper.wasm', import.meta.url);
const shaperAbiUrl = new URL('../../dist/text-shaper-abi-v0.json', import.meta.url);
async function fixture() {
  const [source, bakerWasm, shaperWasm] = await Promise.all([
    readFile(new URL('Inter-Regular.ttf', fixtureDirectory)),
    readFile(new URL('../../dist/font_baker.wasm', import.meta.url)),
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
  const [wasm, published] = await Promise.all([readFile(shaperWasmUrl), readFile(shaperAbiUrl, 'utf8')]);
  const module = await WebAssembly.compile(wasm);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  assert.equal(
    WebAssembly.Module.exports(module).some(({ name }) => name.includes('abi_')),
    false,
  );
  const generated = await import('../../dist/generated/text-shaper-abi.js');
  assert.deepEqual(generated.textShaperAbi, JSON.parse(published));
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

test('compiled Wasm retains ordered font stacks and prevents dangling font disposal', async () => {
  const { artifact, shaperWasm } = await fixture();
  const [validated, abi] = await Promise.all([
    validateFontArtifact(artifact),
    readFile(shaperAbiUrl, 'utf8').then(JSON.parse),
  ]);
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
  assert.equal(fn.registerFontBinding(101, 101, binding.pointer, binding.length), abi.status.policyConflict);
  assert.equal(
    fn.registerFontBinding(102, 101, binding.pointer, binding.length),
    abi.status.ok,
    'one shaping font may carry another independently selectable raster binding',
  );
  fn.deallocate(binding.pointer, binding.length);
  assert.equal(fn.fontBindingCount(), 2, 'binding state must not borrow the registration allocation');

  const stack = copyToWasm(memory, fn.allocate, Uint8Array.of(101, 0, 0, 0));
  assert.equal(fn.registerFontStack(17, stack.pointer, 1), abi.status.ok);
  fn.deallocate(stack.pointer, stack.length);
  assert.equal(fn.fontStackCount(), 1);

  const policyBytes = renderPolicyBytes(abi);
  const policy = copyToWasm(memory, fn.allocate, policyBytes);
  assert.equal(fn.registerPolicy(23, policy.pointer, policy.length), abi.status.ok);
  fn.deallocate(policy.pointer, policy.length);
  assert.equal(fn.createSession(29, 2048, 64 * 1024, 4), abi.status.ok);
  const styleWarmBuffer = memory.buffer;
  const initialUpdate = engineStyleUpdateBytes(abi, {
    sessionId: 29,
    policyHandle: 23,
    fontStackHandle: 17,
    text: [0x61, 0x62, 0x63, 0x64],
    geometry: true,
  });
  assert.equal(fn.planCount(), 0);
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
  assert.equal(fn.planCount(), 1, 'text_update must shape retained runs through HarfRust');

  const warmUpdate = engineStyleUpdateBytes(abi, {
    sessionId: 29,
    policyHandle: 23,
    fontStackHandle: 17,
    expectedEngineRevision: 1,
    consumedPlanRevision: 1,
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
    sessionId: 29,
    policyHandle: 23,
    fontStackHandle: 17,
    expectedEngineRevision: 2,
    consumedPlanRevision: 2,
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
  assert.equal(fn.planCount(), 1, 'an aborted update must not perform another shape');
  assert.equal(fn.disposeSession(29), abi.status.ok);
  assert.equal(fn.disposePolicy(23), abi.status.ok);

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
    readFile(shaperAbiUrl, 'utf8').then(JSON.parse),
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
  const policyBytes = twoTechniquePolicyBytes(abi);
  const policy = copyToWasm(memory, fn.allocate, policyBytes);
  assert.equal(fn.registerPolicy(23, policy.pointer, policy.length), abi.status.ok);
  fn.deallocate(policy.pointer, policy.length);
  assert.equal(fn.createSession(29, 2048, 64 * 1024, 0), abi.status.ok);

  const update = engineStyleUpdateBytes(abi, {
    sessionId: 29,
    policyHandle: 23,
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
    'the fallback glyph must retain its own raster technique in the Rust render plan',
  );
  assert.equal(
    fn.planCount(),
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
    readFile(shaperAbiUrl, 'utf8').then(JSON.parse),
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
  const policyBytes = renderPolicyBytes(abi);
  const policy = copyToWasm(memory, fn.allocate, policyBytes);
  assert.equal(fn.registerPolicy(23, policy.pointer, policy.length), abi.status.ok);
  fn.deallocate(policy.pointer, policy.length);
  assert.equal(fn.createSession(29, 16 * 1024, 256 * 1024, 64), abi.status.ok);

  const prefix = 'कर्म क्षेत्र में प्रगति निरंतर चलती है। प्र';
  const appended = 'त्ये';
  assert.equal(prefix.length, 43);
  assert.equal(appended.length, 4);
  const initial = engineStyleUpdateBytes(abi, {
    sessionId: 29,
    policyHandle: 23,
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
    sessionId: 29,
    policyHandle: 23,
    fontStackHandle: 17,
    expectedEngineRevision: 1,
    consumedPlanRevision: 1,
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

function twoTechniquePolicyBytes(abi) {
  const program = (techniqueId, programId) => ({
    techniqueId,
    programId,
    f32InputCount: 1,
    u32InputCount: 0,
    buffers: [{ id: 1, scalar: abi.policy.scalarTypes.f32, vectorWidth: 1 }],
    operations: [
      { opcode: abi.policy.opcodes.loadF32, target: 0, operand0: 0 },
      { opcode: abi.policy.opcodes.storeF32, operand0: 0, immediate0: 1 },
    ],
  });
  return renderPolicyBytesFromPrograms(abi, [program(1, 1), program(2, 2)]);
}

function engineStyleUpdateBytes(
  abi,
  {
    sessionId,
    policyHandle,
    fontStackHandle,
    expectedEngineRevision = 0,
    consumedPlanRevision = 0,
    acknowledgedPublicationGeneration = 0,
    text = [],
    textStart = 0,
    textEnd = text.length,
    deleteCount = 0,
    maxClusters = 2,
    removeRoot = false,
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
  view.setUint32(request.sessionId, sessionId, true);
  view.setUint32(request.expectedEngineRevision, expectedEngineRevision, true);
  view.setUint32(request.consumedPlanRevision, consumedPlanRevision, true);
  view.setUint32(request.acknowledgedPublicationGeneration, acknowledgedPublicationGeneration, true);
  view.setUint32(request.policyHandle, policyHandle, true);
  view.setUint32(request.capabilitySet, 1, true);
  view.setUint32(request.maxParagraphs, 1, true);
  for (const field of [
    'maxClusters',
    'maxLines',
    'maxRegions',
    'maxExclusions',
    'maxInlineObjects',
    'maxSlotsPerBand',
  ]) {
    view.setUint32(request[field], field === 'maxClusters' ? maxClusters : 1, true);
  }
  view.setUint32(request.maxOutputBytes, 64 * 1024, true);
  view.setUint32(request.paragraphMutationsOffset, paragraphRecordOffset, true);
  view.setUint32(request.paragraphMutationCount, 1, true);
  view.setUint32(request.textMutationsOffset, textRecordOffset, true);
  view.setUint32(request.textMutationCount, text.length === 0 ? 0 : 1, true);
  view.setUint32(request.styleMutationsOffset, styleRecordOffset, true);
  view.setUint32(request.styleMutationCount, 1, true);
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

  view.setUint8(
    styleRecordOffset + styleRecord.opcode,
    removeRoot ? abi.engine.styleMutationOpcodes.remove : abi.engine.styleMutationOpcodes.upsert,
  );
  view.setUint32(styleRecordOffset + styleRecord.paragraphId, 1, true);
  view.setUint32(styleRecordOffset + styleRecord.styleId, 1, true);
  if (!removeRoot) {
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
    view.setUint32(constraintOffset + constraint.paragraphId, 1, true);
    view.setUint32(constraintOffset + constraint.flowThreadId, 1, true);
    view.setFloat32(constraintOffset + constraint.width, 100, true);
    view.setFloat32(constraintOffset + constraint.height, 100, true);
    view.setFloat32(constraintOffset + constraint.viewportBlockEnd, 100, true);
    view.setUint32(constraintOffset + constraint.maxLines, 1, true);
    view.setUint16(constraintOffset + constraint.regionCount, 1, true);
    view.setUint8(constraintOffset + constraint.widthMode, abi.engine.axisModes.exact);
    view.setUint8(constraintOffset + constraint.heightMode, abi.engine.axisModes.exact);
    view.setUint8(constraintOffset + constraint.wrap, abi.engine.wrapModes.word);
    view.setUint8(constraintOffset + constraint.align, abi.engine.inlineAlignments.start);
    view.setUint8(constraintOffset + constraint.overflow, abi.engine.overflowModes.clip);
    view.setUint8(constraintOffset + constraint.blockAlign, abi.engine.blockAlignments.start);

    view.setUint32(regionOffset + region.id, 1, true);
    view.setUint32(regionOffset + region.geometryRevision, 1, true);
    view.setUint32(regionOffset + region.transformIndex, 1, true);
    view.setUint8(regionOffset + region.shape, abi.engine.flowShapeKinds.rectangle);
    view.setUint8(regionOffset + region.writingMode, abi.engine.writingModes.horizontalTb);
    view.setUint8(regionOffset + region.textOrientation, abi.engine.textOrientations.mixed);
    for (const field of ['inlineEnd', 'blockEnd', 'clipInlineEnd', 'clipBlockEnd']) {
      view.setFloat32(regionOffset + region[field], 100, true);
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
