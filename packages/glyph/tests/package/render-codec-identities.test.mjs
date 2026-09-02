import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertGlyphId,
  compileCodec,
  createCodecProgram,
  GlyphIdScope,
  id,
  selectCodecCapabilitySet,
} from '../../dist/config/codec.js';
import { textShaperAbi } from '../../dist/generated/text-shaper-abi.js';

const opcodes = textShaperAbi.codec.opcodes;

function capabilitySet() {
  return {
    capabilities: ['storage-buffers', 'ordered-direct', 'stable-indirect'],
    maxBufferBytes: 1024 * 1024,
    updateAlignment: 4,
    coalesceGapBytes: 128,
    rangeCallPenaltyBytes: 256,
    maxBuffersPerDraw: 8,
    maxResourcesPerDraw: 4,
    maxIndirectDraws: 0,
    fragmentationBudget: 8,
    wholeBufferThresholdBasisPoints: 7500,
  };
}

const FIRST_TECHNIQUE_ID = id.technique('test.identities.first');
const SECOND_TECHNIQUE_ID = id.technique('test.identities.second');
const SHARED_PROGRAM_ID = id.program('test.identities.shared', 'test');
const BUFFER_ID = id.buffer('test.identities.value');
const ZERO_WIRE_ID = 0;
// Smallest engine-valid body: one u32 lane written by one constant store.
const body = {
  inputs: [],
  operations: [
    { opcode: opcodes.constantU32, target: 0, immediate0: 7 },
    { opcode: opcodes.storeU32, operand0: 0, operand1: 0, immediate0: BUFFER_ID },
  ],
  f32InputCount: 0,
  u32InputCount: 0,
};
const buffers = [{ id: BUFFER_ID, scalar: 'u32', vectorWidth: 1 }];

test('semantic ID helpers are stable and namespace program variants', () => {
  const MSDF_TECHNIQUE_ID = id.technique('pmndrs.msdf');
  const MSDF_PROGRAM_ID = id.program('pmndrs.msdf', 'three');
  const MSDF_SHADOW_PROGRAM_ID = id.program('pmndrs.msdf', 'three', 'shadow');
  assert.equal(id.technique('pmndrs.msdf'), MSDF_TECHNIQUE_ID);
  assert.equal(id.program('pmndrs.msdf', 'three'), MSDF_PROGRAM_ID);
  assert.notEqual(MSDF_PROGRAM_ID, MSDF_SHADOW_PROGRAM_ID);
  assert.notEqual(MSDF_TECHNIQUE_ID, MSDF_PROGRAM_ID);
});

test('host ID helpers are stable, nonzero, domain-separated, and collision-checked', () => {
  assert.equal(id.codec('example/default'), id.codec('example/default'));
  assert.notEqual(id.codec('example/default'), id.planner('example/default'));
  assert.ok(id.buffer('example/origin') > 0 && id.buffer('example/origin') <= 0xffff);
  assert.throws(() => id.codec(''), /nonempty string/);
  assert.throws(() => id('unknown', 'example'), /exactly one stable name/);
  id.buffer('collision-36');
  assert.throws(() => id.buffer('collision-326'), /ID collision/);
});

test('runtime ID scopes retain shared provenance until their last owner is disposed', () => {
  const first = new GlyphIdScope();
  const second = new GlyphIdScope();
  const firstId = first.id('paragraph', 'test.identities/scoped-paragraph');
  const secondId = second.id('paragraph', 'test.identities/scoped-paragraph');
  assert.equal(firstId, secondId);
  first.dispose();
  assert.equal(assertGlyphId(secondId, 'paragraph', 'scoped paragraph'), secondId);
  second.dispose();
  assert.throws(() => assertGlyphId(firstId, 'paragraph', 'scoped paragraph'), /must come from id/);
  assert.throws(() => second.id('paragraph', 'test.identities/after-dispose'), /scope has been disposed/);
});

test('identity registries reject colliding program names at assembly', () => {
  const first = id.program('v4gawj', 'three', '1y4hsl2');
  assert.equal(first, id.program('v4gawj', 'three', '1y4hsl2'));
  assert.throws(() => id.program('3boc7l', 'three', '74ae4c'), /render wire identity collision/);
});

test('capability profiles are selected from descriptors without exposing wire ordinals', () => {
  const codecHandle = id.codec('test.identities/capability-profile');
  const first = capabilitySet();
  const second = { ...capabilitySet(), maxBufferBytes: 2 * 1024 * 1024 };
  const descriptor = {
    capabilitySets: [first, second],
    programs: [program(FIRST_TECHNIQUE_ID, SHARED_PROGRAM_ID)],
  };
  const selection = selectCodecCapabilitySet(codecHandle, descriptor, second);
  assert.equal(typeof selection, 'object');
  assert.ok(Object.isFrozen(selection));
  assert.throws(
    () => selectCodecCapabilitySet(codecHandle, descriptor, { ...second, maxBufferBytes: 3 * 1024 * 1024 }),
    /not declared/,
  );
});

function program(wireTechniqueId, wireProgramId, transformMode = 'direct') {
  return createCodecProgram(wireTechniqueId, wireProgramId, body, buffers, transformMode, 'ordered');
}

test('program construction rejects reserved zero wire identities', () => {
  assert.throws(() => program(ZERO_WIRE_ID, SHARED_PROGRAM_ID), /technique id needs a nonzero u32/);
  assert.throws(() => program(FIRST_TECHNIQUE_ID, ZERO_WIRE_ID), /program id needs a nonzero u32/);
});

test('program construction rejects unknown host modes immediately', () => {
  assert.throws(() => program(FIRST_TECHNIQUE_ID, SHARED_PROGRAM_ID, 'sideways'), /transform mode/);
  assert.throws(
    () => createCodecProgram(FIRST_TECHNIQUE_ID, SHARED_PROGRAM_ID, body, buffers, 'direct', 'recycling'),
    /allocation mode/,
  );
});

test('program construction snapshots accepted body and buffer records', () => {
  const mutableBody = {
    ...body,
    inputs: [],
    operations: body.operations.map((operation) => ({ ...operation })),
  };
  const mutableBuffers = buffers.map((buffer) => ({ ...buffer }));
  const compiled = createCodecProgram(
    FIRST_TECHNIQUE_ID,
    SHARED_PROGRAM_ID,
    mutableBody,
    mutableBuffers,
    'direct',
    'ordered',
  );
  mutableBody.operations[0].opcode = 255;
  mutableBuffers[0].id = 999;
  assert.equal(compiled.operations[0].opcode, opcodes.constantU32);
  assert.equal(compiled.buffers[0].id, BUFFER_ID);
  assert.ok(Object.isFrozen(compiled));
  assert.ok(Object.isFrozen(compiled.operations));
  assert.ok(Object.isFrozen(compiled.buffers));
});

test('codec compilation rejects a program id shared by different techniques', () => {
  assert.throws(
    () =>
      compileCodec({
        capabilitySets: [capabilitySet()],
        programs: [program(FIRST_TECHNIQUE_ID, SHARED_PROGRAM_ID), program(SECOND_TECHNIQUE_ID, SHARED_PROGRAM_ID)],
      }),
    new RegExp(`repeats program id ${SHARED_PROGRAM_ID}`),
  );
});
