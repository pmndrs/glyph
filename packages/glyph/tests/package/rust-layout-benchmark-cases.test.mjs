import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertRustLayoutBenchmarkResult,
  parseRustLayoutBenchmarkArguments,
  rustLayoutBenchmarkCases,
  rustLayoutBenchmarkGeometry,
  rustLayoutBenchmarkInitialGeometry,
} from '../../scripts/support/rust-layout-benchmark-cases.mjs';

test('the maintained benchmark case registry keeps specialized corpus requirements explicit', () => {
  assert.equal(rustLayoutBenchmarkCases('latin').includes('justify'), true);
  assert.equal(rustLayoutBenchmarkCases('latin').includes('active-column-resize'), true);
  assert.equal(rustLayoutBenchmarkCases('latin').includes('position-query'), true);
  assert.equal(rustLayoutBenchmarkCases('latin').includes('equivalent-width'), true);
  assert.equal(rustLayoutBenchmarkCases('latin').includes('bidi-resize'), false);
  assert.equal(rustLayoutBenchmarkCases('bidi').includes('bidi-resize'), true);

  assert.equal(parseRustLayoutBenchmarkArguments(['--case', 'bidi-resize']).corpus, 'bidi');
  assert.throws(
    () => parseRustLayoutBenchmarkArguments(['--case', 'bidi-resize', '--corpus', 'latin']),
    /bidi-resize requires the bidi corpus/u,
  );
  assert.throws(() => parseRustLayoutBenchmarkArguments(['--case', 'unknown']), /unknown benchmark case/u);
});

test('reflow cases produce deterministic geometry shapes', () => {
  const base = { width: 600, height: 1_000, maxLines: 100, revision: 1 };
  assert.deepEqual(rustLayoutBenchmarkInitialGeometry('justify', base), { ...base, align: 'justify' });
  assert.deepEqual(rustLayoutBenchmarkGeometry('justify', 3, base), {
    ...base,
    width: 441,
    revision: 5,
    align: 'justify',
  });
  assert.deepEqual(rustLayoutBenchmarkGeometry('bidi-resize', 3, base), {
    ...base,
    width: 441,
    revision: 5,
  });
  assert.deepEqual(rustLayoutBenchmarkInitialGeometry('active-column-resize', base), {
    ...base,
    width: 434,
  });
  assert.deepEqual(rustLayoutBenchmarkGeometry('active-column-resize', 2, base), {
    ...base,
    width: 420,
    revision: 4,
  });
  assert.deepEqual(rustLayoutBenchmarkGeometry('active-column-resize', 3, base), {
    ...base,
    width: 434,
    revision: 5,
  });
  assert.deepEqual(rustLayoutBenchmarkGeometry('position-query', 3, base), {
    ...base,
    width: 434,
    revision: 5,
  });

  const first = rustLayoutBenchmarkGeometry('equivalent-width', 0, base);
  const second = rustLayoutBenchmarkGeometry('equivalent-width', 1, base);
  assert.equal(first.width, 600);
  assert.equal(second.width, 600.00006103515625);
  assert.notEqual(
    new Uint32Array(new Float32Array([first.width]).buffer)[0],
    new Uint32Array(new Float32Array([second.width]).buffer)[0],
  );
});

test('equivalent-width rejects render-plan writes while retaining publication generation attribution', () => {
  const settled = { publicationGeneration: 7, patchCount: 0, writeBytes: 0 };
  assert.doesNotThrow(() =>
    assertRustLayoutBenchmarkResult('equivalent-width', settled, {
      publicationGeneration: 8,
      patchCount: 0,
      writeBytes: 0,
    }),
  );
  assert.throws(
    () =>
      assertRustLayoutBenchmarkResult('equivalent-width', settled, {
        publicationGeneration: 8,
        patchCount: 1,
        writeBytes: 8,
      }),
    /equivalent-width emitted 1 render-plan patches \/ 8 bytes between publication generations 7 and 8/u,
  );
  assert.doesNotThrow(() =>
    assertRustLayoutBenchmarkResult('column-resize', settled, {
      publicationGeneration: 8,
      patchCount: 1,
      writeBytes: 8,
    }),
  );
});

test('active-column-resize requires every measured update to publish', () => {
  const settled = { publicationGeneration: 7, patchCount: 1, writeBytes: 8 };
  assert.doesNotThrow(() =>
    assertRustLayoutBenchmarkResult('active-column-resize', settled, {
      publicationGeneration: 8,
      patchCount: 1,
      writeBytes: 8,
    }),
  );
  assert.throws(
    () =>
      assertRustLayoutBenchmarkResult('active-column-resize', settled, {
        publicationGeneration: 8,
        patchCount: 0,
        writeBytes: 0,
      }),
    /active-column-resize did not publish a changed layout at generation 8/u,
  );
});
