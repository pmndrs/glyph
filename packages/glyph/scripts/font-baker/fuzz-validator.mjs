import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';

import { createFontBaker } from '../../dist/font-baker/index.js';
import { FontArtifactValidationError, validateFontArtifact } from '../../dist/font-baker/validator.js';
import {
  FONT_ARTIFACT_FUZZ_SEED,
  mutateFontArtifact,
} from '../../tests/font-baker/support/font-artifact-mutations.mjs';

const arguments_ = process.argv.slice(2);
if (arguments_[0] === '--') arguments_.shift();
const { values } = parseArgs({
  args: arguments_,
  options: {
    runs: { type: 'string', default: '10000' },
    seed: { type: 'string', default: String(FONT_ARTIFACT_FUZZ_SEED) },
  },
  strict: true,
});
const runs = positiveInteger(values.runs, 'runs');
const seed = unsignedInteger(values.seed, 'seed');
const [source, wasm] = await Promise.all([
  readFile(new URL('../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url)),
  readFile(new URL('../../dist/font-baker.wasm', import.meta.url)),
]);
const baker = await createFontBaker(wasm);
const artifact = baker.bake({
  source,
  descriptor: { formatVersion: 0, fontFaceIndex: 0 },
}).artifacts[0].bytes;
let accepted = 0;
let rejected = 0;
for (const mutation of mutateFontArtifact(artifact, runs, seed)) {
  try {
    await validateFontArtifact(mutation.bytes);
    accepted += 1;
  } catch (error) {
    if (!(error instanceof FontArtifactValidationError) || error.issues.length === 0) {
      throw new Error(`mutation ${mutation.id} seed ${seed} escaped structured validation`, {
        cause: error,
      });
    }
    rejected += 1;
  }
}
process.stdout.write(`${JSON.stringify({ seed, runs, accepted, rejected })}\n`);

function positiveInteger(value, name) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw new TypeError(`${name} must be a positive integer`);
  return result;
}

function unsignedInteger(value, name) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0 || result > 0xffff_ffff) {
    throw new TypeError(`${name} must be a u32 integer`);
  }
  return result;
}
