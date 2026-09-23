import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { assert, bench, group } from '@pmndrs/labs';

import { createMtsdfGenerator } from '../../packages/glyph/dist/internal/mtsdf-generator.js';
import { mtsdfOracleCases } from '../../packages/glyph/tests/fixtures/mtsdf-oracle-cases.mjs';

const wasm = await readFile(new URL('../../packages/glyph/dist/mtsdf-baker.wasm', import.meta.url));
const module = await WebAssembly.compile(wasm);
const verifiedGenerator = await createMtsdfGenerator(module);
verifyCorpus(verifiedGenerator);

group('MTSDF generator @mtsdf-generator @exhaustive', () => {
  bench('compile module @compile', async function* () {
    const byteLength = yield async () => {
      await WebAssembly.compile(wasm);
      return wasm.byteLength;
    };
    assert.equal(byteLength, wasm.byteLength);
  });

  bench('initialize generator @initialize', async function* () {
    const caseCount = yield async () => {
      await createMtsdfGenerator(module);
      return mtsdfOracleCases.length;
    };
    assert.equal(caseCount, mtsdfOracleCases.length);
  });

  bench('initialize and generate oracle corpus @cold-corpus', async function* () {
    const outputBytes = yield async () => generateCorpus(await createMtsdfGenerator(module));
    assert.equal(outputBytes, expectedOutputBytes());
  });

  bench('generate oracle corpus on retained generator @warm-corpus', async function* () {
    const generator = await createMtsdfGenerator(module);
    assert.equal(generateCorpus(generator), expectedOutputBytes());
    const outputBytes = yield () => generateCorpus(generator);
    assert.equal(outputBytes, expectedOutputBytes());
    verifyCorpus(generator);
  });
});

function generateCorpus(generator: Awaited<ReturnType<typeof createMtsdfGenerator>>): number {
  let outputBytes = 0;
  for (const testCase of mtsdfOracleCases) {
    const glyph = generator.generate(testCase.request);
    outputBytes += glyph.rgba.byteLength;
  }
  return outputBytes;
}

function verifyCorpus(generator: Awaited<ReturnType<typeof createMtsdfGenerator>>): void {
  for (const testCase of mtsdfOracleCases) {
    const glyph = generator.generate(testCase.request);
    const hash = createHash('sha256').update(glyph.rgba).digest('hex');
    if (hash !== testCase.candidateSha256) throw new Error(`${testCase.id} changed during MTSDF generation`);
  }
}

function expectedOutputBytes(): number {
  return mtsdfOracleCases.reduce(
    (total, testCase) =>
      total +
      (testCase.request.region.innerWidth + testCase.request.region.paddingX * 2) *
        (testCase.request.region.innerHeight + testCase.request.region.paddingY * 2) *
        4,
    0,
  );
}
