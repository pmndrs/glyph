import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { GlyphHandleState } from '../../dist/internal/handle-state.js';
import { assertGlyphId, id } from '../../dist/config/codec.js';
import { createRuntimeShaper } from '../../dist/shaper.js';
import { textShaperAbi } from '../../dist/text-shaper-abi.js';
import { renderCodecBytes } from '../support/engine-abi.mjs';

const wasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);

test('one Wasm engine rejects double ownership across handle states', async () => {
  const shaper = await createRuntimeShaper({ wasm: await readFile(wasmUrl) });
  const first = new GlyphHandleState(shaper);
  const second = new GlyphHandleState(shaper);
  const sharedCodec = id.codec('engine-ownership/shared-codec');
  try {
    first.registerCodec(sharedCodec, renderCodecBytes(textShaperAbi));
    assert.throws(
      () => second.registerCodec(sharedCodec, renderCodecBytes(textShaperAbi)),
      /already owned by another Glyph handle state/u,
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
  try {
    owner.registerCodec(codecHandle, renderCodecBytes(textShaperAbi));
    minter.dispose();
    assert.equal(assertGlyphId(codecHandle, 'codec', 'codec handle'), codecHandle);
    owner.disposeCodec(codecHandle);
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
