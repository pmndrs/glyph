import assert from 'node:assert/strict';
import { test } from 'node:test';

import { archiveBenchmarkLoaderResolution } from './support/archive-benchmark-loader.mts';

const benches = '/work/repo/benches';
const installed = '/tmp/cold-main/node_modules/@pmndrs/glyph';
const library = `${benches}/src/workloads/font-assets/library.ts`;
const sourceLoader = '/work/repo/packages/glyph/src/loader.js';

test('archive presentation resolves only the benchmark font library loader to installed dist', () => {
  assert.equal(
    archiveBenchmarkLoaderResolution('../../../../packages/glyph/src/loader.js', library, benches, installed),
    `${installed}/dist/loader.js`,
  );
  assert.equal(
    archiveBenchmarkLoaderResolution(sourceLoader, `/@fs${library}?v=1`, benches, installed),
    `${installed}/dist/loader.js`,
  );
  assert.equal(
    archiveBenchmarkLoaderResolution(
      '../../../../packages/glyph/src/loader.js',
      `${benches}/src/v1-msdf-distance-proof.ts`,
      benches,
      installed,
    ),
    undefined,
  );
  assert.equal(
    archiveBenchmarkLoaderResolution('../../../../packages/glyph/src/glyph.js', library, benches, installed),
    undefined,
  );
  assert.equal(archiveBenchmarkLoaderResolution('@pmndrs/glyph', library, benches, installed), undefined);
});
