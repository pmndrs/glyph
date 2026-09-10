import assert from 'node:assert/strict';
import test from 'node:test';

import { techniqueProgram } from '../../dist/config/codec-program.js';
import { id } from '../../dist/config/codec.js';
import { defineTechniqueSchema } from '../../dist/config/schema.js';

const ORIGIN_BUFFER_ID = id.buffer('test.codec-contract/origin');
const PAGE_BUFFER_ID = id.buffer('test.codec-contract/page');

const schema = defineTechniqueSchema({
  technique: 'test.codec-contract',
  scope: 'glyph',
  binding: {},
  buffers: {
    origin: { id: ORIGIN_BUFFER_ID, scalar: 'f32', lanes: ['x', 'y'] },
    page: { id: PAGE_BUFFER_ID, scalar: 'u32', lanes: ['page'] },
  },
});

function program() {
  return techniqueProgram(schema);
}

test('schema-keyed codec compilation requires every declared buffer exactly once', () => {
  const missing = program();
  assert.throws(
    () => missing.compile({ origin: [missing.semantics.inlineOrigin, missing.semantics.blockOrigin] }),
    /omits declared buffer "page"/,
  );

  const extra = program();
  assert.throws(
    () =>
      extra.compile({
        origin: [extra.semantics.inlineOrigin, extra.semantics.blockOrigin],
        page: [extra.semantics.stableGlyphId],
        foreign: [extra.semantics.fontSize],
      }),
    /undeclared buffer "foreign"/,
  );
});

test('codec values reject wrong widths and scalar kinds at the compile call', () => {
  const width = program();
  assert.throws(
    () => width.compile({ origin: [width.semantics.inlineOrigin], page: [width.semantics.stableGlyphId] }),
    /declares 2 lanes/,
  );

  const scalar = program();
  assert.throws(
    () =>
      scalar.compile({
        origin: [scalar.semantics.inlineOrigin, scalar.semantics.blockOrigin],
        page: [scalar.semantics.fontSize],
      }),
    /needs u32; got f32/,
  );
});

test('technique authors cannot declare host system memory layout', () => {
  assert.throws(
    () =>
      techniqueProgram(schema, {
        system: { stableGlyphId: { id: ORIGIN_BUFFER_ID, scalar: 'u32', lanes: ['stableGlyphId'] } },
      }),
    /system buffers are host-owned/,
  );
});
