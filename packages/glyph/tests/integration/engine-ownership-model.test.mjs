import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { GlyphHandleState } from '../../dist/internal/handle-state.js';
import { assertGlyphId, id } from '../../dist/config/codec.js';
import { createRuntimeShaper } from '../../dist/shaper.js';
import { textShaperAbi } from '../../dist/text-shaper-abi.js';
import { engineUpdateBytes, renderCodecBytes } from '../support/engine-abi.mjs';

const wasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);

test('one Wasm engine rejects double ownership and cross-handle codec resolution', async () => {
  const shaper = await createRuntimeShaper({ wasm: await readFile(wasmUrl) });
  const first = new GlyphHandleState(shaper);
  const second = new GlyphHandleState(shaper);
  const sharedCodec = id.codec('engine-ownership/shared-codec');
  const firstCodec = first.id('codec', 'engine-ownership/first-codec');
  const secondCodec = second.id('codec', 'engine-ownership/second-codec');
  const plannerHandle = first.id('planner', 'engine-ownership/first-transport');
  try {
    first.registerCodec(sharedCodec, renderCodecBytes(textShaperAbi));
    assert.throws(
      () => second.registerCodec(sharedCodec, renderCodecBytes(textShaperAbi)),
      /already owned by another Glyph handle state/u,
    );
    first.registerCodec(firstCodec, renderCodecBytes(textShaperAbi));
    second.registerCodec(secondCodec, renderCodecBytes(textShaperAbi));
    const transport = first._createPlanTransport({
      handle: plannerHandle,
      requestCapacity: 4096,
      resultCapacity: 4096,
    });
    const accepted = transport.update(
      engineUpdateBytes(textShaperAbi, {
        plannerId: plannerHandle,
        codecHandle: firstCodec,
        expectedEngineRevision: 0,
        consumedPlanRevision: 0,
      }),
    );
    const foreign = engineUpdateBytes(textShaperAbi, {
      plannerId: plannerHandle,
      codecHandle: secondCodec,
      expectedEngineRevision: accepted.engineRevision,
      consumedPlanRevision: accepted.planRevision,
    });
    assert.throws(() => transport.update(foreign), /not owned by this Glyph handle state/u);
    assert.equal(
      transport.isExpired(accepted),
      false,
      'ownership rejection must preserve the last accepted publication',
    );
  } finally {
    first.dispose();
    second.dispose();
    shaper.dispose();
  }
});

test('registration retains a scoped ID independently of the scope that minted it', async () => {
  const shaper = await createRuntimeShaper({ wasm: await readFile(wasmUrl) });
  const minter = new GlyphHandleState(shaper);
  const owner = new GlyphHandleState(shaper);
  const codecHandle = minter.id('codec', 'engine-ownership/adopted-codec');
  const plannerHandle = owner.id('planner', 'engine-ownership/adopted-transport');
  try {
    owner.registerCodec(codecHandle, renderCodecBytes(textShaperAbi));
    minter.dispose();
    assert.equal(assertGlyphId(codecHandle, 'codec', 'codec handle'), codecHandle);
    const request = engineUpdateBytes(textShaperAbi, {
      plannerId: plannerHandle,
      codecHandle,
      expectedEngineRevision: 0,
      consumedPlanRevision: 0,
    });
    const transport = owner._createPlanTransport({
      handle: plannerHandle,
      requestCapacity: request.byteLength,
      resultCapacity: textShaperAbi.layouts.engineResult.size,
    });
    assert.equal(transport.update(request).codecHandle, codecHandle);
  } finally {
    owner.dispose();
    minter.dispose();
    shaper.dispose();
  }
  assert.throws(() => assertGlyphId(codecHandle, 'codec', 'codec handle'), /must come from id/u);
});

test('successful individual disposal releases registration ID provenance', async () => {
  const shaper = await createRuntimeShaper({ wasm: await readFile(wasmUrl) });
  const handleState = new GlyphHandleState(shaper);
  const codecHandle = handleState.id('codec', 'engine-ownership/disposed-codec');
  try {
    handleState.registerCodec(codecHandle, renderCodecBytes(textShaperAbi));
    handleState.disposeCodec(codecHandle);
    assert.throws(() => assertGlyphId(codecHandle, 'codec', 'codec handle'), /must come from id/u);
  } finally {
    handleState.dispose();
    shaper.dispose();
  }
});
