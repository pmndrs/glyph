import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { GlyphFontError, FontRegistry } from '../../dist/loader.js';
import { createFontBaker } from '@pmndrs/glyph/bake';

import { mutateArtifact } from '../support/artifact-mutations.mjs';

test('fixed-seed loader artifact mutations fail safely, purely, and deterministically', async () => {
  const [source, wasm] = await Promise.all([
    readFile(new URL('../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url)),
    readFile(new URL('../../dist/font-baker.wasm', import.meta.url)),
  ]);
  const baker = await createFontBaker(wasm);
  const artifact = baker.bake({
    source,
    descriptor: { formatVersion: 0, fontFaceIndex: 0 },
  }).artifacts[0].bytes;

  for (const mutation of mutateArtifact(artifact, 128)) {
    const before = Buffer.from(mutation.bytes);
    const first = await outcome(mutation.bytes);
    const second = await outcome(mutation.bytes);
    assert.deepEqual(second, first, `mutation ${mutation.id} from seed ${mutation.seed}`);
    assert.deepEqual(Buffer.from(mutation.bytes), before, `mutation ${mutation.id} changed input`);
    if (mutation.mode === 1 || mutation.mode === 3 || mutation.mode === 4) {
      assert.equal(first.ok, false, `length-changing mutation ${mutation.id} must violate the GLB envelope`);
    }
  }
});

async function outcome(bytes) {
  try {
    const font = await new FontRegistry().registerAsset(Buffer.from(bytes));
    return {
      ok: true,
      sourceFingerprint: font.sourceFingerprint,
      shapingFingerprint: font.shapingFingerprint,
      glyphCount: font.glyphCount,
      rasters: font.rasterReferences.length,
    };
  } catch (error) {
    assert(error instanceof GlyphFontError);
    return {
      ok: false,
      code: error.reason,
      cause: error.cause?.name,
      issues: error.cause?.issues?.map(({ code }) => code),
    };
  }
}
