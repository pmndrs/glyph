import assert from 'node:assert/strict';
import test from 'node:test';

import { definePolicyBuffers, defineTechniqueSchema, id, techniqueProgram } from '../../dist/core.js';

const ORIGIN_BUFFER_ID = id('buffer', 'test.policy-contract/origin');
const PAGE_BUFFER_ID = id('buffer', 'test.policy-contract/page');
const SYSTEM_BUFFER_ID = id('buffer', 'test.policy-contract/system/stable-glyph-id');
const OTHER_SYSTEM_BUFFER_ID = id('buffer', 'test.policy-contract/system/other-stable-glyph-id');

const schema = defineTechniqueSchema({
  technique: 'test.policy-contract',
  scope: 'glyph',
  binding: {},
  buffers: {
    origin: { id: ORIGIN_BUFFER_ID, scalar: 'f32', lanes: ['x', 'y'] },
    page: { id: PAGE_BUFFER_ID, scalar: 'u32', lanes: ['page'] },
  },
});

const system = definePolicyBuffers({
  stableGlyphId: { id: SYSTEM_BUFFER_ID, scalar: 'u32', lanes: ['stableGlyphId'] },
});

function program() {
  return techniqueProgram(schema, { system });
}

test('schema-keyed policy compilation requires every declared buffer exactly once', () => {
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

test('policy values reject wrong widths and scalar kinds at the compile call', () => {
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

test('host system lanes are exact and disjoint from technique buffers', () => {
  assert.throws(
    () =>
      techniqueProgram(schema, {
        system: { stableGlyphId: { id: ORIGIN_BUFFER_ID, scalar: 'u32', lanes: ['stableGlyphId'] } },
      }),
    /collides with a technique buffer/,
  );
  assert.throws(
    () =>
      techniqueProgram(schema, {
        system: { stableGlyphId: { id: OTHER_SYSTEM_BUFFER_ID, scalar: 'f32', lanes: ['stableGlyphId'] } },
      }),
    /needs one u32/,
  );
});
