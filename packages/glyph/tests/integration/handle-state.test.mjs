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
import {
  engineFrameUpdateBytes,
  engineUpdateBytes,
  fontBindingBytes,
  renderCodecBytes,
} from '../support/engine-abi.mjs';
import { textShaperAbi } from '../../dist/text-shaper-abi.js';

const wasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);
const THREE_CODEC_HANDLE = permanentGlyphId('codec', 'test.text-engine-handle-state/three');

function emptyPlannerFrame(rootId = 1) {
  return {
    rootId,
    codecHandle: 1,
    expectedEngineRevision: 0,
    consumedRevision: 0,
    acknowledgedPublicationGeneration: 0,
    limits: {
      maxParagraphs: 1,
      maxClusters: 1,
      maxLines: 1,
      maxRegions: 1,
      maxExclusions: 1,
      maxInlineObjects: 1,
      maxSlotsPerBand: 1,
      maxOutputBytes: 1_000,
    },
  };
}

test('one transport writes changing frames through its retained arena after reserve growth', () => {
  const abi = textShaperAbi;
  const memory = { buffer: new ArrayBuffer(2_048) };
  let requestPointer = 32;
  let requestCapacity = abi.layouts.engineUpdateRequest.size;
  let reserves = 0;
  const exports = {
    memory,
    requestCapacity: () => requestCapacity,
    requestPointer: () => requestPointer,
    measureParagraph: (_handle, pointer, length) => {
      assert.deepEqual(
        new Uint8Array(memory.buffer, pointer, length),
        engineUpdateBytes(abi, { rootId: 1, codecHandle: 1 }),
      );
      const resultPointer = 3_000;
      const layout = abi.layouts.engineResult;
      const header = new DataView(memory.buffer, resultPointer, layout.size);
      header.setUint32(layout.status, abi.status.resultTooLarge, true);
      header.setUint32(layout.flags, 0, true);
      return resultPointer;
    },
    reserveRoot: (_handle, requested) => {
      reserves++;
      requestCapacity = requested;
      requestPointer = 128;
      memory.buffer = new ArrayBuffer(4_096);
      return abi.status.ok;
    },
  };
  const transport = new PlanTransport(
    exports,
    1,
    requestCapacity,
    abi.layouts.engineResult.size,
    0,
    () => undefined,
    () => undefined,
  );
  const empty = {
    ...emptyPlannerFrame(),
    limits: { ...emptyPlannerFrame().limits, maxOutputBytes: abi.layouts.engineResult.size },
  };
  const firstLength = transport.stageUpdate(empty);
  assert.deepEqual(
    new Uint8Array(memory.buffer, requestPointer, firstLength),
    engineUpdateBytes(abi, { rootId: 1, codecHandle: 1 }),
  );
  transport.discardStagedUpdate();

  const text = 'A😀B';
  const rich = {
    ...empty,
    paragraphMutations: [{ opcode: 'upsert', paragraphId: 1, order: 0 }],
    textMutations: [{ paragraphId: 1, start: 0, deleteCount: 0, insert: text }],
  };
  const oldBuffer = memory.buffer;
  const richLength = transport.stageUpdate(rich);
  assert.equal(reserves, 1, 'the arena grows between planning and writing');
  assert.notStrictEqual(memory.buffer, oldBuffer);
  const expected = engineFrameUpdateBytes(abi, {
    rootId: 1,
    codecHandle: 1,
    textMutation: {
      start: 0,
      deleteCount: 0,
      insert: Array.from({ length: text.length }, (_, index) => text.charCodeAt(index)),
    },
    limits: { maxClusters: 1, maxLines: 1, maxOutputBytes: abi.layouts.engineResult.size },
  });
  assert.equal(richLength, expected.byteLength);
  assert.deepEqual(new Uint8Array(memory.buffer, requestPointer, richLength), expected);
  transport.discardStagedUpdate();
  const repeatedLength = transport.stageUpdate(rich);
  assert.equal(repeatedLength, richLength);
  assert.equal(reserves, 1, 'the same frame reuses the grown arena');
  assert.deepEqual(new Uint8Array(memory.buffer, requestPointer, repeatedLength), expected);
  transport.discardStagedUpdate();

  const styled = {
    ...empty,
    styleMutations: [
      {
        opcode: 'upsert',
        paragraphId: 1,
        styleId: 2,
        cascadeOrder: 0,
        start: 0,
        end: 4,
        value: { language: 'fr-CA', features: [{ tag: 'liga', value: 1, start: 0, end: 4 }] },
      },
    ],
  };
  const styledLength = transport.stageUpdate(styled);
  const styledBytes = new Uint8Array(memory.buffer, requestPointer, styledLength);
  const styledView = new DataView(memory.buffer, requestPointer, styledLength);
  const requestLayout = abi.layouts.engineUpdateRequest;
  const styleLayout = abi.layouts.engineStyleMutation;
  const styleOffset = styledView.getUint32(requestLayout.styleMutationsOffset, true);
  const languageOffset = styledView.getUint32(styleOffset + styleLayout.languageOffset, true);
  assert.deepEqual(styledBytes.subarray(languageOffset, languageOffset + 5), new TextEncoder().encode('fr-CA'));
  assert.equal(styledView.getUint16(styleOffset + styleLayout.featureCount, true), 1);
  transport.discardStagedUpdate();

  new Uint8Array(memory.buffer, requestPointer - 1, Math.max(richLength, styledLength) + 2).fill(0xa5);
  const lastLength = transport.stageUpdate(empty);
  assert.equal(lastLength, firstLength);
  assert.deepEqual(
    new Uint8Array(memory.buffer, requestPointer, lastLength),
    engineUpdateBytes(abi, { rootId: 1, codecHandle: 1 }),
  );
  assert.equal(new Uint8Array(memory.buffer)[requestPointer - 1], 0xa5);
  assert.equal(new Uint8Array(memory.buffer)[requestPointer + lastLength], 0xa5);
  transport.discardStagedUpdate();
  assert.throws(
    () => transport.prepareParagraph(empty, 1),
    (error) => error.statusCode === 'result-too-large',
  );
});

test('measurement capacity failure is surfaced without retrying the mutation', () => {
  const memory = { buffer: new ArrayBuffer(2_048) };
  const resultPointer = 512;
  const requestPointer = 64;
  const layout = textShaperAbi.layouts.engineResult;
  let calls = 0;
  let reserves = 0;
  const writeHeader = (status, requiredCapacity, resultCapacity, flags = 0, byteLength = layout.size) => {
    const header = new DataView(memory.buffer, resultPointer, layout.size);
    new Uint8Array(memory.buffer, resultPointer, layout.size).fill(0);
    header.setUint32(layout.byteLength, byteLength, true);
    header.setUint32(layout.status, status, true);
    header.setUint32(layout.flags, flags, true);
    header.setUint32(layout.requestCapacity, 64, true);
    header.setUint32(layout.resultCapacity, resultCapacity, true);
    header.setUint32(layout.requiredResultCapacity, requiredCapacity, true);
  };
  const exports = {
    memory,
    requestCapacity: () => 512,
    requestPointer: () => requestPointer,
    reserveRoot: () => {
      reserves += 1;
      return textShaperAbi.status.ok;
    },
    measureParagraph: () => {
      calls += 1;
      writeHeader(textShaperAbi.status.resultTooLarge, 100, 8, textShaperAbi.engine.resultFlags.rootInvalidated);
      return resultPointer;
    },
  };
  const transport = new PlanTransport(
    exports,
    1,
    512,
    8,
    0,
    () => undefined,
    () => undefined,
  );
  const paragraph = permanentGlyphId('paragraph', 'test.text-engine-handle-state/asymmetric-query');

  assert.throws(
    () => transport.prepareParagraph(emptyPlannerFrame(), paragraph),
    (error) => {
      assert.equal(error.statusCode, 'result-too-large');
      return true;
    },
  );
  assert.equal(calls, 1, 'the synchronous mutation is attempted exactly once');
  assert.equal(reserves, 0, 'result capacity is not repaired after the mutation begins');
  assert.equal(transport.invalidateUnadoptedMutation(), true, 'a failed mutation invalidates derived state');
});

test('successful Rust preparation stays unadopted when TypeScript result decoding fails', () => {
  const memory = { buffer: new ArrayBuffer(2_048) };
  const resultPointer = 512;
  const requestPointer = 64;
  const layout = textShaperAbi.layouts.engineResult;
  let calls = 0;
  const exports = {
    memory,
    requestCapacity: () => 512,
    requestPointer: () => requestPointer,
    reserveRoot: () => textShaperAbi.status.ok,
    measureParagraph: () => {
      calls += 1;
      const header = new DataView(memory.buffer, resultPointer, layout.size);
      header.setUint32(layout.byteLength, memory.buffer.byteLength, true);
      header.setUint32(layout.status, textShaperAbi.status.ok, true);
      header.setUint32(layout.flags, 0, true);
      header.setUint32(layout.requestCapacity, 64, true);
      header.setUint32(layout.resultCapacity, 64, true);
      return resultPointer;
    },
  };
  const transport = new PlanTransport(
    exports,
    1,
    512,
    64,
    0,
    () => undefined,
    () => undefined,
  );

  assert.throws(
    () =>
      transport.prepareParagraph(
        emptyPlannerFrame(),
        permanentGlyphId('paragraph', 'test.text-engine-handle-state/decode-failure'),
      ),
    /out-of-bounds publication/u,
    'a successful engine response can still fail during local result decoding',
  );
  assert.equal(calls, 1, 'Rust preparation ran exactly once');
  assert.equal(
    transport.invalidateUnadoptedMutation(),
    true,
    'the unadopted Rust candidate is discarded before the next explicit operation',
  );
  assert.equal(transport.invalidateUnadoptedMutation(), false, 'discarding the candidate is one-shot');
});

test('a rejected measurement without the invalidated-root flag does not invalidate the root', () => {
  const memory = { buffer: new ArrayBuffer(2_048) };
  const resultPointer = 512;
  const requestPointer = 64;
  const layout = textShaperAbi.layouts.engineResult;
  const exports = {
    memory,
    requestCapacity: () => 512,
    requestPointer: () => requestPointer,
    reserveRoot: () => textShaperAbi.status.ok,
    measureParagraph: () => {
      const header = new DataView(memory.buffer, resultPointer, layout.size);
      header.setUint32(layout.byteLength, layout.size, true);
      header.setUint32(layout.status, textShaperAbi.status.resultTooLarge, true);
      header.setUint32(layout.flags, 0, true);
      return resultPointer;
    },
  };
  const transport = new PlanTransport(
    exports,
    1,
    512,
    64,
    0,
    () => undefined,
    () => undefined,
  );

  assert.throws(
    () =>
      transport.prepareParagraph(
        emptyPlannerFrame(),
        permanentGlyphId('paragraph', 'test.text-engine-handle-state/rejected-root-preserved'),
      ),
    (error) => {
      assert.equal(error.statusCode, 'result-too-large');
      return true;
    },
  );
  assert.equal(
    transport.invalidateUnadoptedMutation(),
    false,
    'Rust remains authoritative about whether a rejected response invalidated its derived root',
  );
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
  assert.throws(() => transport.stageUpdate(emptyPlannerFrame(plannerHandle)), /disposed/u);
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
    readFile(new URL('../../../../benches/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url)),
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
