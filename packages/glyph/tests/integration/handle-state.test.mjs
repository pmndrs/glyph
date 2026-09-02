import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { FontRegistry } from '../../dist/loader.js';
import { createGlyphEngine, createGlyphHandleState } from '../../dist/glyph-engine.js';
import { validateFontArtifact } from '@pmndrs/glyph/bake';
import { GlyphHandleState } from '../../dist/internal/handle-state.js';
import { assertGlyphId, id } from '../../dist/config/codec.js';
import { threeCodecBytes } from '../../dist/three/codec.js';
import { createRuntimeShaper } from '../../dist/shaper.js';
import { engineUpdateBytes, fontBindingBytes, renderCodecBytes } from '../support/engine-abi.mjs';
import { textShaperAbi } from '../../dist/text-shaper-abi.js';

const wasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);
const THREE_CODEC_HANDLE = id.codec('test.text-engine-handle-state/three');

test('a glyph engine owns every configured-handle state it creates', async () => {
  const glyphEngine = await createGlyphEngine({ wasm: await readFile(wasmUrl) });
  assert.throws(() => createGlyphHandleState(glyphEngine, { integration: '' }), /nonempty string/u);
  const handleState = createGlyphHandleState(glyphEngine, { integration: 'test.glyphEngine-owner' });
  const plannerHandle = handleState.id('planner', 'test.glyphEngine-owner/transport');
  const codecHandle = handleState.id('codec', 'test.glyphEngine-owner/codec');
  handleState.registerCodec(codecHandle, renderCodecBytes(textShaperAbi));
  const request = engineUpdateBytes(textShaperAbi, {
    plannerId: plannerHandle,
    codecHandle,
    expectedEngineRevision: 0,
    consumedPlanRevision: 0,
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
  assert.throws(() => assertGlyphId(handle, 'planner', 'transport handle'), /must come from id/);
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
    assert.throws(() => handleState.disposeFontBinding(bindingHandle), /must come from id/u);
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
