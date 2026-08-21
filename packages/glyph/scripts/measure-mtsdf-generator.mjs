/* @workflow
{
  "name": "glyph:mtsdf-generator-profile",
  "summary": "Measure compile, initialization, cold-corpus, and warm-corpus MTSDF generator cost.",
  "requirements": "A built Glyph package.",
  "writes": "Standard output only.",
  "args": []
}
*/

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import { createMtsdfGenerator } from '../dist/internal/mtsdf-generator.js';
import { mtsdfOracleCases } from '../tests/fixtures/mtsdf-oracle-cases.mjs';

const wasm = await readFile(new URL('../dist/mtsdf-baker.wasm', import.meta.url));
const compileStart = performance.now();
const module = await WebAssembly.compile(wasm);
const compileMilliseconds = performance.now() - compileStart;
const initializationStart = performance.now();
const generator = await createMtsdfGenerator(module);
const initializationMilliseconds = performance.now() - initializationStart;

const cold = measureCorpus(generator);
const warm = Array.from({ length: 5 }, () => measureCorpus(generator));
const compositeSha256 = createHash('sha256')
  .update(Buffer.from(warm[0].hashes.join(''), 'hex'))
  .digest('hex');
const warmMilliseconds = warm.map(({ milliseconds }) => milliseconds).sort((left, right) => left - right);

process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: 0,
      kind: 'mtsdf-generator-observation',
      environment: {
        platform: process.platform,
        architecture: process.arch,
        node: process.version,
      },
      corpus: {
        cases: mtsdfOracleCases.length,
        outputBytes: cold.outputBytes,
        compositeSha256,
      },
      milliseconds: {
        compile: compileMilliseconds,
        initialization: initializationMilliseconds,
        coldCorpus: cold.milliseconds,
        warmCorpusMedian: warmMilliseconds[Math.floor(warmMilliseconds.length / 2)],
        warmCorpusSamples: warm.map(({ milliseconds }) => milliseconds),
      },
    },
    null,
    2,
  )}\n`,
);

function measureCorpus(activeGenerator) {
  const hashes = [];
  let outputBytes = 0;
  const start = performance.now();
  for (const testCase of mtsdfOracleCases) {
    const glyph = activeGenerator.generate(testCase.request);
    const hash = createHash('sha256').update(glyph.rgba).digest('hex');
    if (hash !== testCase.candidateSha256) {
      throw new Error(`${testCase.id} changed during MTSDF benchmark measurement`);
    }
    hashes.push(hash);
    outputBytes += glyph.rgba.byteLength;
  }
  return { hashes, outputBytes, milliseconds: performance.now() - start };
}
