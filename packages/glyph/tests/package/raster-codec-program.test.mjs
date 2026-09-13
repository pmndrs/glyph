import assert from 'node:assert/strict';
import test from 'node:test';

import { techniqueProgram, u32 } from '../../dist/config/codec-program.js';
import { id } from '../../dist/config/codec.js';
import { defineRasterFormat } from '../../dist/config/raster-format.js';
import { createRasterCodecProgram, registerRasterCodec } from '../../dist/config/raster.js';
import { defineCodecBuffers, defineTechniqueSchema } from '../../dist/config/schema.js';
import { textShaperAbi } from '../../dist/generated/text-shaper-abi.js';

const TEST_PROGRAM_VARIANT = 3;
const TEST_PROGRAM_NAMESPACE = 'test-renderer';
const ORIGIN_BUFFER_ID = id.buffer('test.raster-codec-program/origin');
const PACKED_BUFFER_ID = id.buffer('test.raster-codec-program/packed');
const SYSTEM_BUFFER_ID = id.buffer('test.raster-codec-program/system/stable-glyph-id');
const PLACEMENT_BUFFER_ID = id.buffer('test.raster-codec-program/system/placement-slot');

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
const schema = defineTechniqueSchema({
  technique: technique.id,
  scope: 'glyph',
  binding: {},
  buffers: {
    origin: { id: ORIGIN_BUFFER_ID, scalar: 'f32', lanes: ['x', 'y'] },
    packed: { id: PACKED_BUFFER_ID, scalar: 'u32', lanes: ['value', 'unused1'] },
  },
  resources: { payload: { kind: 'buffer' } },
  render: { resource: 'payload', geometry: { kind: 'synthetic-quad' } },
});
const system = defineCodecBuffers({
  stableGlyphId: { id: SYSTEM_BUFFER_ID, scalar: 'u32', lanes: ['stableGlyphId'] },
  placementSlot: { id: PLACEMENT_BUFFER_ID, scalar: 'u32', lanes: ['placementSlot'] },
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
  return registerRasterCodec({
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
let codecBodyArgumentCount = 0;
let receivedFrozenCapabilitySet = false;
const portable = plan((...hostInputs) => {
  codecBodyArgumentCount = hostInputs.length;
  const [hostCapabilitySet] = hostInputs;
  codecBodyCalls += 1;
  receivedFrozenCapabilitySet = Object.isFrozen(hostCapabilitySet);
  const p = techniqueProgram(schema);
  return p.compile({
    origin: [p.semantics.inlineOrigin, p.semantics.blockOrigin],
    packed: [u32.const(7), u32.const(0)],
  });
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
    [{ ...valid, system: { stableGlyphId: system.stableGlyphId } }, /placementSlot/],
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
  assert.equal(codecBodyArgumentCount, 1);
  assert.equal(receivedFrozenCapabilitySet, true);
  assert.deepEqual(
    compiled.buffers.map((buffer) => buffer.id),
    [schema.buffers.origin.id, schema.buffers.packed.id, system.stableGlyphId.id, system.placementSlot.id],
  );
  const opcodes = textShaperAbi.codec.opcodes;
  assert.deepEqual(compiled.operations.slice(-4), [
    { opcode: opcodes.loadU32, target: 0, operand0: 1 },
    { opcode: opcodes.storeU32, operand0: 0, operand1: 0, immediate0: system.stableGlyphId.id },
    { opcode: opcodes.loadU32, target: 0, operand0: 2 },
    { opcode: opcodes.storeU32, operand0: 0, operand1: 0, immediate0: system.placementSlot.id },
  ]);
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
    /needs a registered RasterCodec/,
  );
});
