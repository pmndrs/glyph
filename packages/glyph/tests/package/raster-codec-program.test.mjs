import assert from 'node:assert/strict';
import test from 'node:test';

import { defineRasterFormat } from '@pmndrs/glyph';
import {
  createRasterCodecProgram,
  defineCodecBuffers,
  defineTechniqueSchema,
  registerRasterPlanProgram,
  techniqueProgram,
  id,
} from '../../dist/index.js';

const TEST_PROGRAM_VARIANT = 3;
const TEST_PROGRAM_NAMESPACE = 'test-renderer';
const ORIGIN_BUFFER_ID = id.buffer('test.raster-codec-program/origin');
const SYSTEM_BUFFER_ID = id.buffer('test.raster-codec-program/system/stable-glyph-id');
const OTHER_SYSTEM_BUFFER_ID = id.buffer('test.raster-codec-program/system/other-stable-glyph-id');

const technique = defineRasterFormat({
  id: 'test.raster-codec-program',
  kind: 'test',
  extension: 'TEST_codec_program',
  version: 0,
  textEffects: [],
  descriptor: () => ({}),
  async decode() {
    return {};
  },
  dispose() {},
});
const wrongSystemTechnique = defineRasterFormat({
  ...technique,
  id: 'test.raster-codec-program-wrong-system',
});
const schema = defineTechniqueSchema({
  technique: technique.id,
  scope: 'glyph',
  binding: {},
  buffers: { origin: { id: ORIGIN_BUFFER_ID, scalar: 'f32', lanes: ['x', 'y'] } },
  resources: { payload: { kind: 'buffer' } },
  render: { resource: 'payload', geometry: { kind: 'synthetic-quad' } },
});
const wrongSystemSchema = defineTechniqueSchema({
  technique: wrongSystemTechnique.id,
  scope: 'glyph',
  binding: {},
  buffers: { origin: { id: ORIGIN_BUFFER_ID, scalar: 'f32', lanes: ['x', 'y'] } },
  resources: { payload: { kind: 'buffer' } },
  render: { resource: 'payload', geometry: { kind: 'synthetic-quad' } },
});
const system = defineCodecBuffers({
  stableGlyphId: { id: SYSTEM_BUFFER_ID, scalar: 'u32', lanes: ['stableGlyphId'] },
});
const otherSystem = defineCodecBuffers({
  stableGlyphId: { id: OTHER_SYSTEM_BUFFER_ID, scalar: 'u32', lanes: ['stableGlyphId'] },
});
const capabilitySet = {
  capabilities: ['ordered-direct'],
  maxBufferBytes: 1024,
  updateAlignment: 4,
  coalesceGapBytes: 0,
  rangeCallPenaltyBytes: 0,
  maxBuffersPerDraw: 4,
  maxResourcesPerDraw: 1,
  maxIndirectDraws: 0,
  fragmentationBudget: 1,
  wholeBufferThresholdBasisPoints: 10_000,
};

function plan(codecBody) {
  return registerRasterPlanProgram({
    raster: technique,
    schema,
    programVariant: TEST_PROGRAM_VARIANT,
    codecBody,
    compileFont() {
      throw new Error('not used by codec assembly');
    },
  });
}

let codecBodyCalls = 0;
let receivedFrozenHostInputs = false;
const portable = plan((hostSystem, hostCapabilitySet) => {
  codecBodyCalls += 1;
  receivedFrozenHostInputs =
    Object.isFrozen(hostSystem) && Object.isFrozen(hostSystem.stableGlyphId) && Object.isFrozen(hostCapabilitySet);
  const p = techniqueProgram(schema, { system: hostSystem });
  return p.compile({ origin: [p.semantics.inlineOrigin, p.semantics.blockOrigin] });
});
const wrongSystemPortable = registerRasterPlanProgram({
  raster: wrongSystemTechnique,
  schema: wrongSystemSchema,
  programVariant: TEST_PROGRAM_VARIANT,
  codecBody() {
    const p = techniqueProgram(wrongSystemSchema, { system: otherSystem });
    return p.compile({ origin: [p.semantics.inlineOrigin, p.semantics.blockOrigin] });
  },
  compileFont() {
    throw new Error('not used by codec assembly');
  },
});

test('portable codec assembly rejects host inputs before invoking technique code', () => {
  const calls = codecBodyCalls;
  const valid = {
    namespace: TEST_PROGRAM_NAMESPACE,
    system,
    capabilitySet,
    transformMode: 'direct',
    allocationMode: 'ordered',
  };
  const invalid = [
    [{ ...valid, namespace: '' }, /namespace/],
    [{ ...valid, programName: '' }, /programName/],
    [{ ...valid, transformMode: 'sideways' }, /transform mode/],
    [{ ...valid, allocationMode: 'recycling' }, /allocation mode/],
    [{ ...valid, system: {} }, /stableGlyphId system buffer/],
    [{ ...valid, capabilitySet: { ...capabilitySet, capabilities: [] } }, /supports no allocation strategy/],
    [{ ...valid, ids: {} }, /ids/],
    [{ ...valid, identityRegistry: id }, /renamed to ids/],
  ];
  for (const [options, message] of invalid) {
    assert.throws(() => createRasterCodecProgram(portable, options), message);
  }
  assert.equal(codecBodyCalls, calls);
});

test('portable codec assembly owns host identities, system buffers, and variant metadata', () => {
  const compiled = createRasterCodecProgram(portable, {
    namespace: TEST_PROGRAM_NAMESPACE,
    system,
    capabilitySet,
    transformMode: 'direct',
    allocationMode: 'ordered',
  });
  assert.equal(compiled.techniqueId, id.technique(technique));
  assert.equal(compiled.programId, id.program(technique, TEST_PROGRAM_NAMESPACE));
  assert.deepEqual(compiled.capabilitySet, capabilitySet);
  assert.equal(Object.isFrozen(compiled.capabilitySet), true);
  assert.equal(compiled.variant, TEST_PROGRAM_VARIANT);
  assert.equal(receivedFrozenHostInputs, true);
  assert.deepEqual(
    compiled.buffers.map((buffer) => buffer.id),
    [schema.buffers.origin.id, system.stableGlyphId.id],
  );
});

test('portable codec assembly rejects a body compiled for different host system lanes', () => {
  assert.throws(
    () =>
      createRasterCodecProgram(wrongSystemPortable, {
        namespace: TEST_PROGRAM_NAMESPACE,
        system,
        capabilitySet,
        transformMode: 'direct',
        allocationMode: 'ordered',
      }),
    /does not use the requested system buffers/,
  );
});

test('portable codec assembly rejects structurally copied programs', () => {
  assert.throws(
    () =>
      createRasterCodecProgram(
        { ...portable },
        {
          namespace: TEST_PROGRAM_NAMESPACE,
          system,
          capabilitySet,
          transformMode: 'direct',
          allocationMode: 'ordered',
        },
      ),
    /needs the registered portable plan program/,
  );
});
