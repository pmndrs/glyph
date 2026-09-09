import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { FontRegistry } from '../../dist/loader.js';
import { createGlyphEngine, createGlyphHandleState } from '../../dist/glyph-engine.js';
import { validateFontArtifact } from '@pmndrs/glyph/bake';
import { GlyphHandleState, PlanTransport } from '../../dist/internal/handle-state.js';
import { id } from '../../dist/config/codec.js';
import { assertGlyphId, permanentGlyphId } from '../../dist/internal/glyph-id.js';
import { threeCodecBytes } from '../../dist/three/codec.js';
import { createRuntimeShaper } from '../../dist/shaper.js';
import { engineUpdateBytes, fontBindingBytes, renderCodecBytes } from '../support/engine-abi.mjs';
import { textShaperAbi } from '../../dist/text-shaper-abi.js';

const wasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);
const THREE_CODEC_HANDLE = permanentGlyphId('codec', 'test.text-engine-handle-state/three');

test('measurement growth compares both asymmetric A/B result capacities', () => {
  const memory = { buffer: new ArrayBuffer(2_048) };
  const resultPointer = 512;
  const requestPointer = 64;
  const layout = textShaperAbi.layouts.engineResult;
  let grown = false;
  let reserves = 0;
  const writeHeader = (status, requiredCapacity, inactiveCapacity) => {
    const header = new DataView(memory.buffer, resultPointer, layout.size);
    new Uint8Array(memory.buffer, resultPointer, layout.size).fill(0);
    header.setUint32(layout.byteLength, layout.size, true);
    header.setUint32(layout.status, status, true);
    header.setUint32(layout.requestCapacity, 64, true);
    header.setUint32(layout.resultCapacity, inactiveCapacity, true);
    header.setUint32(layout.requiredResultCapacity, requiredCapacity, true);
  };
  const exports = {
    memory,
    requestCapacity: () => 64,
    requestPointer: () => requestPointer,
    reserveRoot: (_handle, _requestCapacity, resultCapacity) => {
      reserves += 1;
      grown = resultCapacity >= 100;
      return textShaperAbi.status.ok;
    },
    measureParagraph: () => {
      if (!grown) writeHeader(textShaperAbi.status.resultTooLarge, 100, 500);
      else writeHeader(textShaperAbi.status.ok, 0, 500);
      return resultPointer;
    },
  };
  const transport = new PlanTransport(
    exports,
    1,
    64,
    8,
    0,
    () => undefined,
    () => undefined,
  );
  const paragraph = permanentGlyphId('paragraph', 'test.text-engine-handle-state/asymmetric-query');

  const result = transport.measureParagraph(new Uint8Array([1]), paragraph, 1_000);
  assert.equal(result.bytes.byteLength, layout.size);
  assert.equal(reserves, 1, 'the smaller active slot must trigger one strict growth');
});

test('measurement growth permits at most one bounded capacity repair', () => {
  const memory = { buffer: new ArrayBuffer(2_048) };
  const resultPointer = 512;
  const layout = textShaperAbi.layouts.engineResult;
  let calls = 0;
  let reserves = 0;
  const exports = {
    memory,
    requestCapacity: () => 64,
    requestPointer: () => 64,
    reserveRoot: () => {
      reserves += 1;
      return textShaperAbi.status.ok;
    },
    measureParagraph: () => {
      calls += 1;
      const requiredCapacity = 100 + calls;
      const header = new DataView(memory.buffer, resultPointer, layout.size);
      new Uint8Array(memory.buffer, resultPointer, layout.size).fill(0);
      header.setUint32(layout.byteLength, layout.size, true);
      header.setUint32(layout.status, textShaperAbi.status.resultTooLarge, true);
      header.setUint32(layout.requestCapacity, 64, true);
      header.setUint32(layout.resultCapacity, requiredCapacity - 1, true);
      header.setUint32(layout.requiredResultCapacity, requiredCapacity, true);
      return resultPointer;
    },
  };
  const transport = new PlanTransport(
    exports,
    1,
    64,
    8,
    0,
    () => undefined,
    () => undefined,
  );
  const paragraph = permanentGlyphId('paragraph', 'test.text-engine-handle-state/bounded-query-growth');

  assert.throws(
    () => transport.measureParagraph(new Uint8Array([1]), paragraph, 1_000),
    (error) => {
      assert.equal(error.statusCode, 'result-too-large');
      return true;
    },
  );
  assert.equal(calls, 2, 'one repair permits exactly one retry');
  assert.equal(reserves, 1, 'a second capacity watermark must not trigger another reserve');
});

test('measurement growth rejects capacity beyond the authored output limit without reserving', () => {
  const memory = { buffer: new ArrayBuffer(2_048) };
  const resultPointer = 512;
  const layout = textShaperAbi.layouts.engineResult;
  let calls = 0;
  let reserves = 0;
  const exports = {
    memory,
    requestCapacity: () => 64,
    requestPointer: () => 64,
    reserveRoot: () => {
      reserves += 1;
      return textShaperAbi.status.ok;
    },
    measureParagraph: () => {
      calls += 1;
      const header = new DataView(memory.buffer, resultPointer, layout.size);
      new Uint8Array(memory.buffer, resultPointer, layout.size).fill(0);
      header.setUint32(layout.byteLength, layout.size, true);
      header.setUint32(layout.status, textShaperAbi.status.resultTooLarge, true);
      header.setUint32(layout.requestCapacity, 64, true);
      header.setUint32(layout.resultCapacity, 8, true);
      header.setUint32(layout.requiredResultCapacity, 101, true);
      return resultPointer;
    },
  };
  const transport = new PlanTransport(
    exports,
    1,
    64,
    8,
    0,
    () => undefined,
    () => undefined,
  );
  const paragraph = permanentGlyphId('paragraph', 'test.text-engine-handle-state/over-limit-query-growth');

  assert.throws(
    () => transport.measureParagraph(new Uint8Array([1]), paragraph, 100),
    (error) => {
      assert.equal(error.statusCode, 'result-too-large');
      return true;
    },
  );
  assert.equal(calls, 1);
  assert.equal(reserves, 0, 'an over-limit watermark must not grow either A/B result slot');
});

test('a glyph engine owns every configured-handle state it creates', async () => {
  const glyphEngine = await createGlyphEngine({ wasm: await readFile(wasmUrl) });
  assert.throws(() => createGlyphHandleState(glyphEngine, { integration: '' }), /nonempty string/u);
  const handleState = createGlyphHandleState(glyphEngine, { integration: 'test.glyphEngine-owner' });
  const plannerHandle = handleState.id('planner', 'test.glyphEngine-owner/transport');
  const codecHandle = handleState.id('codec', 'test.glyphEngine-owner/codec');
  handleState.registerCodec(codecHandle, renderCodecBytes(textShaperAbi));
  const request = engineUpdateBytes(textShaperAbi, {
    rootId: plannerHandle,
    codecHandle,
    expectedEngineRevision: 0,
    consumedRevision: 0,
  });
  const transport = handleState._createPlanTransport({
    handle: plannerHandle,
    requestCapacity: request.byteLength,
    resultCapacity: textShaperAbi.layouts.engineResult.size,
  });

  assert.equal(handleState.integration, 'test.glyphEngine-owner');
  glyphEngine.dispose();
  assert.throws(() => handleState.id('planner', 'test.glyphEngine-owner/stale'), /disposed/u);
  assert.throws(() => transport.stageUpdate(request), /disposed/u);
});

test('handle-scoped ID provenance expires with its owning handle state', async () => {
  const shaper = await createRuntimeShaper({ wasm: await readFile(wasmUrl) });
  const handleState = new GlyphHandleState(shaper);
  const handle = handleState.id('planner', 'test.text-engine-handle-state/scoped-transport');
  assert.equal(assertGlyphId(handle, 'planner', 'transport handle'), handle);
  handleState.dispose();
  assert.throws(() => assertGlyphId(handle, 'planner', 'transport handle'), /package-owned Glyph identity/);
  assert.throws(() => handleState.id('planner', 'test.text-engine-handle-state/after-dispose'), /disposed/);
  shaper.dispose();
});

test('font bindings cannot be disposed while an owned stack still references them', async () => {
  const [artifact, wasm] = await Promise.all([
    readFile(new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url)),
    readFile(wasmUrl),
  ]);
  const validated = await validateFontArtifact(artifact);
  const registry = new FontRegistry();
  const font = await registry.registerAsset(artifact);
  const shaper = await createRuntimeShaper({ registry, wasm });
  shaper.registerFont(font);
  const handleState = new GlyphHandleState(shaper);
  const foreignHandle = new GlyphHandleState(shaper);
  const bindingHandle = handleState.id('font-binding', 'test.text-engine-handle-state/lifecycle-binding');
  const stackHandle = handleState.id('font-stack', 'test.text-engine-handle-state/lifecycle-stack');
  const foreignStackHandle = foreignHandle.id('font-stack', 'test.text-engine-handle-state/foreign-lifecycle-stack');
  const glyphCount = validated.glyphExtents.byteLength / 8;
  const binding = fontBindingBytes(textShaperAbi, {
    techniqueId: 1,
    glyphCount,
    strikes: [0],
    resources: [{ id: 1, generation: 1, kind: 1, reference: 1 }],
    resourceIndices: new Array(glyphCount).fill(0),
    glyphF32: [new Array(glyphCount).fill(1)],
  });
  try {
    handleState.registerFontBinding(bindingHandle, font.handle, binding);
    assert.throws(
      () => foreignHandle.registerFontStack(foreignStackHandle, [bindingHandle]),
      /not owned by this Glyph handle state/u,
    );
    handleState.registerFontStack(stackHandle, [bindingHandle]);
    assert.throws(() => handleState.disposeFontBinding(bindingHandle), /still used by font stack/u);
    assert.throws(() => shaper.disposeFont(font), /retained by a registered font stack/u);
    assert.equal(shaper.memoryReport().fontCount, 1, 'a refused disposal must keep the shaper registration owned');
    handleState.disposeFontStack(stackHandle);
    handleState.disposeFontBinding(bindingHandle);
    assert.throws(() => handleState.disposeFontBinding(bindingHandle), /package-owned Glyph identity/u);
    shaper.disposeFont(font);
    assert.equal(shaper.memoryReport().fontCount, 0);
  } finally {
    foreignHandle.dispose();
    handleState.dispose();
    font.dispose();
    shaper.dispose();
  }
});

test('one deterministic Three codec registers Bitmap, MSDF, and Slug with material-directed draws', async () => {
  const wasm = await readFile(wasmUrl);
  const abi = textShaperAbi;
  const wireIds = {
    bitmap: id.technique('pmndrs.bitmap'),
    msdf: id.technique('pmndrs.msdf'),
    slug: id.technique('pmndrs.slug'),
    decoration: id.technique('pmndrs.decoration'),
  };
  assert.deepEqual(wireIds, {
    bitmap: 0x1775_3b8c,
    msdf: 0xf9a7_e4fd,
    slug: 0xf22c_7908,
    decoration: 0x3455fa81,
  });
  const bytes = threeCodecBytes();
  const request = abi.layouts.codecRequest;
  const program = abi.layouts.codecProgram;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(request.programCount, true), 4);
  const programsOffset = view.getUint32(request.programsOffset, true);
  const expectedTechniques = [wireIds.bitmap, wireIds.msdf, wireIds.slug, wireIds.decoration];
  const expectedPrograms = [
    id.program('pmndrs.bitmap', 'three'),
    id.program('pmndrs.msdf', 'three'),
    id.program('pmndrs.slug', 'three'),
    id.program('pmndrs.decoration', 'three'),
  ];
  for (const [index, wireTechniqueId] of expectedTechniques.entries()) {
    const offset = programsOffset + index * program.size;
    assert.equal(view.getUint32(offset + program.techniqueId, true), wireTechniqueId);
    assert.equal(view.getUint32(offset + program.programId, true), expectedPrograms[index]);
    assert.ok(view.getUint32(offset + program.drawKeyMask, true) & abi.codec.batchFields.material);
    assert.equal(view.getUint32(offset + program.storageKeyMask, true) & abi.codec.batchFields.material, 0);
    const expectedKind =
      wireTechniqueId === wireIds.decoration ? abi.engine.primitiveKinds.decoration : abi.engine.primitiveKinds.glyph;
    assert.equal(view.getUint16(offset + program.primitiveKind, true), expectedKind);
  }

  const shaper = await createRuntimeShaper({ wasm });
  const handleState = new GlyphHandleState(shaper);
  handleState.registerCodec(THREE_CODEC_HANDLE, bytes);
  handleState.dispose();
  shaper.dispose();
});
