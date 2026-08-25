import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileRenderPolicy,
  createProgram,
  programId,
  RenderWireIdentityRegistry,
  techniqueId,
  textShaperAbi,
} from '../../dist/core.js';

const opcodes = textShaperAbi.policy.opcodes;
const scalarTypes = textShaperAbi.policy.scalarTypes;
const capabilityFlags = textShaperAbi.policy.capabilityFlags;

function capabilitySet() {
  return {
    id: 1,
    flags: capabilityFlags.storageBuffers | capabilityFlags.orderedDirect | capabilityFlags.stableIndirect,
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

const FIRST_TECHNIQUE_ID = 101;
const SECOND_TECHNIQUE_ID = 102;
const SHARED_PROGRAM_ID = 201;
const ZERO_WIRE_ID = 0;
// Smallest engine-valid body: one u32 lane written by one constant store.
const body = {
  inputs: [],
  operations: [
    { opcode: opcodes.constantU32, target: 0, immediate0: 7 },
    { opcode: opcodes.storeU32, operand0: 0, operand1: 0, immediate0: 1 },
  ],
  f32InputCount: 0,
  u32InputCount: 0,
};
const buffers = [{ id: 1, scalar: scalarTypes.u32, vectorWidth: 1 }];

test('semantic ID helpers are stable and namespace program variants', () => {
  const MSDF_TECHNIQUE_ID = techniqueId('pmndrs.msdf');
  const MSDF_PROGRAM_ID = programId('pmndrs.msdf', 'three');
  const MSDF_SHADOW_PROGRAM_ID = programId('pmndrs.msdf', 'three', 'shadow');
  assert.equal(techniqueId('pmndrs.msdf'), MSDF_TECHNIQUE_ID);
  assert.equal(programId('pmndrs.msdf', 'three'), MSDF_PROGRAM_ID);
  assert.notEqual(MSDF_PROGRAM_ID, MSDF_SHADOW_PROGRAM_ID);
  assert.notEqual(MSDF_TECHNIQUE_ID, MSDF_PROGRAM_ID);
});

test('identity registries reject colliding program names at assembly', () => {
  const identities = new RenderWireIdentityRegistry();
  const first = identities.programId('v4gawj', 'three', '1y4hsl2');
  assert.equal(first, programId('v4gawj', 'three', '1y4hsl2'));
  assert.equal(first, programId('3boc7l', 'three', '74ae4c'));
  assert.throws(() => identities.programId('3boc7l', 'three', '74ae4c'), /render wire identity collision/);
});

function program(wireTechniqueId, wireProgramId, transformMode = 'direct') {
  return createProgram(wireTechniqueId, wireProgramId, body, buffers, transformMode, 'ordered');
}

test('program construction rejects reserved zero wire identities', () => {
  assert.throws(() => program(ZERO_WIRE_ID, SHARED_PROGRAM_ID), /technique id needs a nonzero u32/);
  assert.throws(() => program(FIRST_TECHNIQUE_ID, ZERO_WIRE_ID), /program id needs a nonzero u32/);
});

test('program construction rejects unknown host modes immediately', () => {
  assert.throws(() => program(FIRST_TECHNIQUE_ID, SHARED_PROGRAM_ID, 'sideways'), /transform mode/);
  assert.throws(
    () => createProgram(FIRST_TECHNIQUE_ID, SHARED_PROGRAM_ID, body, buffers, 'direct', 'recycling'),
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
  const compiled = createProgram(
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
  assert.equal(compiled.buffers[0].id, 1);
  assert.ok(Object.isFrozen(compiled));
  assert.ok(Object.isFrozen(compiled.operations));
  assert.ok(Object.isFrozen(compiled.buffers));
});

test('policy compilation rejects a program id shared by different techniques', () => {
  assert.throws(
    () =>
      compileRenderPolicy({
        capabilitySets: [capabilitySet()],
        programs: [program(FIRST_TECHNIQUE_ID, SHARED_PROGRAM_ID), program(SECOND_TECHNIQUE_ID, SHARED_PROGRAM_ID)],
      }),
    /repeats program id 201/,
  );
});
