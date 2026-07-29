import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { FontLoadError, FontRegistry } from '../../dist/index.js';
import { createFontBaker } from '@pmndrs/text-font-baker';

import { ARTIFACT_FUZZ_SEED, mutateArtifact } from '../support/artifact-mutations.mjs';

test('fixed-seed loader artifact mutations fail safely, purely, and deterministically', async () => {
  const [source, wasm] = await Promise.all([
    readFile(new URL('../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url)),
    readFile(new URL('../../../font-baker/dist/font_baker.wasm', import.meta.url)),
  ]);
  const baker = await createFontBaker(wasm);
  const artifact = baker.bake({
    source,
    descriptor: { formatVersion: 0, fontFaceIndex: 0 },
  }).artifacts[0].bytes;

  let rejected = 0;
  for (const mutation of mutateArtifact(artifact, 128)) {
    const before = Buffer.from(mutation.bytes);
    const first = await outcome(mutation.bytes);
    const second = await outcome(mutation.bytes);
    assert.deepEqual(second, first, `mutation ${mutation.id} from seed ${mutation.seed}`);
    assert.deepEqual(Buffer.from(mutation.bytes), before, `mutation ${mutation.id} changed input`);
    if (!first.ok) rejected += 1;
  }
  assert(rejected > 100, `seed ${ARTIFACT_FUZZ_SEED} must exercise hostile loader paths`);
});

async function outcome(bytes) {
  try {
    const font = await new FontRegistry().registerAsset(Buffer.from(bytes));
    return {
      ok: true,
      shapingHash: font.shapingHash,
      glyphCount: font.glyphCount,
      rasters: font.rasterReferences.length,
    };
  } catch (error) {
    assert(error instanceof FontLoadError);
    return {
      ok: false,
      code: error.code,
      cause: error.cause?.name,
      issues: error.cause?.issues?.map(({ code }) => code),
    };
  }
}
