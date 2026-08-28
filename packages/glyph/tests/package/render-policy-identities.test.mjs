import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileRenderPolicy,
  createProgram,
  id,
  programId,
  RenderWireIdentityRegistry,
  selectPolicyCapabilitySet,
  techniqueId,
} from '../../dist/core.js';
import { assertGlyphId, GlyphIdScope } from '../../dist/core/render-policy.js';
import { textShaperAbi } from '../../dist/generated/text-shaper-abi.js';

const opcodes = textShaperAbi.policy.opcodes;

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

const FIRST_TECHNIQUE_ID = techniqueId('test.identities.first');
const SECOND_TECHNIQUE_ID = techniqueId('test.identities.second');
const SHARED_PROGRAM_ID = programId('test.identities.shared', 'test');
const BUFFER_ID = id('buffer', 'test.identities.value');
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
  const MSDF_TECHNIQUE_ID = techniqueId('pmndrs.msdf');
  const MSDF_PROGRAM_ID = programId('pmndrs.msdf', 'three');
  const MSDF_SHADOW_PROGRAM_ID = programId('pmndrs.msdf', 'three', 'shadow');
  assert.equal(techniqueId('pmndrs.msdf'), MSDF_TECHNIQUE_ID);
  assert.equal(programId('pmndrs.msdf', 'three'), MSDF_PROGRAM_ID);
  assert.notEqual(MSDF_PROGRAM_ID, MSDF_SHADOW_PROGRAM_ID);
  assert.notEqual(MSDF_TECHNIQUE_ID, MSDF_PROGRAM_ID);
});

test('host ID helpers are stable, nonzero, domain-separated, and collision-checked', () => {
  assert.equal(id('policy', 'example/default'), id('policy', 'example/default'));
  assert.notEqual(id('policy', 'example/default'), id('retained-plan', 'example/default'));
  assert.ok(id('buffer', 'example/origin') > 0 && id('buffer', 'example/origin') <= 0xffff);
  assert.throws(() => id('policy', ''), /nonempty string/);
  assert.throws(() => id('unknown', 'example'), /kind is not supported/);
  id('buffer', 'collision-36');
  assert.throws(() => id('buffer', 'collision-326'), /ID collision/);
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
  const identities = new RenderWireIdentityRegistry();
  const first = identities.programId('v4gawj', 'three', '1y4hsl2');
  assert.equal(first, programId('v4gawj', 'three', '1y4hsl2'));
  assert.equal(first, programId('3boc7l', 'three', '74ae4c'));
  assert.throws(() => identities.programId('3boc7l', 'three', '74ae4c'), /render wire identity collision/);
});

test('capability profiles are selected from descriptors without exposing wire ordinals', () => {
  const policyHandle = id('policy', 'test.identities/capability-profile');
  const first = capabilitySet();
  const second = { ...capabilitySet(), maxBufferBytes: 2 * 1024 * 1024 };
  const descriptor = {
    capabilitySets: [first, second],
    programs: [program(FIRST_TECHNIQUE_ID, SHARED_PROGRAM_ID)],
  };
  const selection = selectPolicyCapabilitySet(policyHandle, descriptor, second);
  assert.equal(typeof selection, 'object');
  assert.ok(Object.isFrozen(selection));
  assert.throws(
    () => selectPolicyCapabilitySet(policyHandle, descriptor, { ...second, maxBufferBytes: 3 * 1024 * 1024 }),
    /not declared/,
  );
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
  assert.equal(compiled.buffers[0].id, BUFFER_ID);
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
    new RegExp(`repeats program id ${SHARED_PROGRAM_ID}`),
  );
});
