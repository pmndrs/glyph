import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createFontBaker } from '../../../dist/font-baker/index.js';
import { FontArtifactValidationError, validateFontArtifact } from '../../../dist/font-baker/validator.js';
import { FONT_ARTIFACT_FUZZ_SEED, mutateFontArtifact } from '../support/font-artifact-mutations.mjs';

test('fixed-seed font artifact mutations fail safely and deterministically', async () => {
  const [source, wasm] = await Promise.all([
    readFile(new URL('../../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url)),
    readFile(new URL('../../../dist/font_baker.wasm', import.meta.url)),
  ]);
  const baker = await createFontBaker(wasm);
  const artifact = baker.bake({
    source,
    descriptor: { formatVersion: 0, fontFaceIndex: 0 },
  }).artifacts[0].bytes;

  let rejected = 0;
  for (const mutation of mutateFontArtifact(artifact, 128)) {
    const first = await outcome(mutation.bytes);
    const second = await outcome(mutation.bytes);
    assert.deepEqual(second, first, `mutation ${mutation.id} from seed ${mutation.seed}`);
    if (!first.ok) rejected += 1;
  }
  assert(rejected > 100, `seed ${FONT_ARTIFACT_FUZZ_SEED} must exercise hostile paths`);
});

async function outcome(bytes) {
  try {
    const result = await validateFontArtifact(bytes);
    return { ok: true, shapingHash: result.shapingHash };
  } catch (error) {
    assert(error instanceof FontArtifactValidationError);
    assert(error.issues.length > 0);
    return { ok: false, issues: error.issues };
  }
}
