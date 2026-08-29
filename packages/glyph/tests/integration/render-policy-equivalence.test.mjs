import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { id } from '../../dist/core/render-policy.js';
import { textShaperAbi } from '../../dist/generated/text-shaper-abi.js';
import { threeRenderPolicyBytes, threeRenderPolicyDescriptor } from '../../dist/three/render-policy.js';

const fixtureUrl = new URL('../fixtures/render-policy/hand-numbered-policy-bytes.json', import.meta.url);
const THREE_PROGRAM_IDS = new Map([
  [id.technique('pmndrs.bitmap'), id.program('pmndrs.bitmap', 'three')],
  [id.technique('pmndrs.msdf'), id.program('pmndrs.msdf', 'three')],
  [id.technique('pmndrs.slug'), id.program('pmndrs.slug', 'three')],
  [id.technique('pmndrs.decoration'), id.program('pmndrs.decoration', 'three')],
]);

test('Three rejects counterfeit render ID factories at policy assembly', () => {
  assert.throws(() => threeRenderPolicyDescriptor({}), /raster policy ids must be/);
});

/**
 * Semantic equivalence against the hand-numbered programs. Register numbers and
 * operation order are private to a program's execution — the interpreter only
 * requires forward-only writes — so the DSL port may renumber freely. What must
 * never drift: the input tables, buffer shapes, capability sets, program
 * metadata, and the expression each buffer lane receives. This test decodes both
 * byte streams and compares exactly that. Named buffer IDs deliberately differ
 * from the retired hand-numbered fixture, so buffers and stores compare by order.
 */
test('the Three render policy is semantically identical to the hand-numbered fixture', async () => {
  const fixtures = JSON.parse(await readFile(fixtureUrl, 'utf8'));
  for (const transform of ['direct', 'indexed']) {
    for (const allocation of ['ordered', 'stable']) {
      const key = `${transform}/${allocation}`;
      const fixture = decodePolicy(Buffer.from(fixtures[key], 'base64'));
      const current = decodePolicy(threeRenderPolicyBytes(undefined, transform, [], allocation));
      assert.equal(current.programs.length, fixture.programs.length, `${key}: program count`);
      assert.deepEqual(current.capabilitySets, fixture.capabilitySets, `${key}: capability sets`);
      for (const [index, historical] of fixture.programs.entries()) {
        const expected = withMsdfTextEffects(historical);
        const actual = current.programs[index];
        const expectedProgramId = THREE_PROGRAM_IDS.get(expected.metadata.techniqueId);
        assert.notEqual(expectedProgramId, undefined, `${key}: program ${index} technique identity`);
        assert.deepEqual(
          actual.metadata,
          {
            ...expected.metadata,
            programId: expectedProgramId,
            capabilitySetId: expected.metadata.techniqueId === id.technique('pmndrs.decoration') ? 0 : 1,
          },
          `${key}: program ${index} metadata`,
        );
        assert.deepEqual(actual.inputs, expected.inputs, `${key}: program ${index} input table`);
        assert.deepEqual(actual.buffers, expected.buffers, `${key}: program ${index} buffers`);
        assert.deepEqual(actual.stores, expected.stores, `${key}: program ${index} store dataflow`);
      }
    }
  }
});

function withMsdfTextEffects(program) {
  if (program.metadata.techniqueId !== id.technique('pmndrs.msdf')) return program;
  const semantic = textShaperAbi.policy.inputScopes.semantic;
  const binding = textShaperAbi.policy.inputScopes.glyph;
  const fields = textShaperAbi.engine.semanticF32Fields;
  const effectFields = [
    fields.outlineRed,
    fields.outlineGreen,
    fields.outlineBlue,
    fields.outlineAlpha,
    fields.outlineWidth,
    fields.shadowRed,
    fields.shadowGreen,
    fields.shadowBlue,
    fields.shadowAlpha,
    fields.shadowOffsetX,
    fields.shadowOffsetY,
  ];
  const stores = { ...program.stores };
  for (const [lane, field] of [
    [0, fields.outlineRed],
    [1, fields.outlineGreen],
    [2, fields.outlineBlue],
    [3, fields.outlineAlpha],
  ]) {
    stores[`storeF32:buffer4:lane${lane}`] = `f32(${semantic}:${field})`;
  }
  for (const [lane, field] of [
    [0, fields.shadowRed],
    [1, fields.shadowGreen],
    [2, fields.shadowBlue],
    [3, fields.shadowAlpha],
  ]) {
    stores[`storeF32:buffer5:lane${lane}`] = `f32(${semantic}:${field})`;
  }
  stores['storeF32:buffer6:lane0'] = multiply(
    multiply(`f32(${semantic}:${fields.shadowOffsetX})`, `f32(${semantic}:${fields.inverseFontSize})`),
    `f32(${binding}:10)`,
  );
  stores['storeF32:buffer6:lane1'] = multiply(
    multiply(`f32(${semantic}:${fields.shadowOffsetY})`, `f32(${semantic}:${fields.inverseFontSize})`),
    `f32(${binding}:11)`,
  );
  stores['storeF32:buffer6:lane2'] = multiply(
    multiply(`f32(${semantic}:${fields.outlineWidth})`, `f32(${semantic}:${fields.inverseFontSize})`),
    `f32(${binding}:12)`,
  );
  const previousF32Count = program.metadata.f32InputCount;
  return {
    ...program,
    metadata: { ...program.metadata, f32InputCount: previousF32Count + effectFields.length + 4 },
    inputs: [
      ...program.inputs.slice(0, 7),
      ...effectFields.map((field) => ({ scope: semantic, field })),
      { scope: semantic, field: fields.inverseFontSize },
      ...program.inputs.slice(7, previousF32Count),
      { scope: binding, field: 10 },
      { scope: binding, field: 11 },
      { scope: binding, field: 12 },
      ...program.inputs.slice(previousF32Count),
    ],
    stores,
  };
}

function multiply(left, right) {
  if (right < left) [left, right] = [right, left];
  return `multiplyF32(${left}, ${right})`;
}

function decodePolicy(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const request = textShaperAbi.layouts.policyRequest;
  const programLayout = textShaperAbi.layouts.policyProgram;
  const operationLayout = textShaperAbi.layouts.policyOperation;
  const inputLayout = textShaperAbi.layouts.policyInput;
  const bufferLayout = textShaperAbi.layouts.policyBuffer;
  const capabilityLayout = textShaperAbi.layouts.policyCapabilitySet;
  const opcodes = textShaperAbi.policy.opcodes;
  const opcodeNames = new Map(Object.entries(opcodes).map(([name, value]) => [value, name]));

  const capabilitySets = [];
  const capabilityOffset = view.getUint32(request.capabilitySetsOffset, true);
  for (let index = 0; index < view.getUint32(request.capabilitySetCount, true); index += 1) {
    const at = capabilityOffset + index * capabilityLayout.size;
    capabilitySets.push(Buffer.from(bytes.slice(at, at + capabilityLayout.size)).toString('hex'));
  }

  const programs = [];
  const programsOffset = view.getUint32(request.programsOffset, true);
  const operationsOffset = view.getUint32(request.operationsOffset, true);
  const inputsOffset = view.getUint32(request.inputsOffset, true);
  const buffersOffset = view.getUint32(request.buffersOffset, true);
  for (let index = 0; index < view.getUint32(request.programCount, true); index += 1) {
    const at = programsOffset + index * programLayout.size;
    const metadata = {};
    for (const field of [
      'techniqueId',
      'programId',
      'capabilitySetId',
      'resourceKindMask',
      'semanticViewMask',
      'storageKeyMask',
      'paintCapabilities',
      'compositingCapabilities',
      'drawKeyMask',
      'variant',
      'allocationStrategy',
      'primitiveKind',
      'f32InputCount',
      'u32InputCount',
    ]) {
      const offset = at + programLayout[field];
      metadata[field] =
        field === 'allocationStrategy' || field === 'f32InputCount' || field === 'u32InputCount'
          ? view.getUint8(offset)
          : field === 'primitiveKind'
            ? view.getUint16(offset, true)
            : view.getUint32(offset, true);
    }
    const inputStart = view.getUint32(at + programLayout.inputStart, true);
    const inputCount = view.getUint16(at + programLayout.inputCount, true);
    const inputs = [];
    for (let input = 0; input < inputCount; input += 1) {
      const inputAt = inputsOffset + (inputStart + input) * inputLayout.size;
      inputs.push({
        scope: view.getUint8(inputAt + inputLayout.scope),
        field: view.getUint8(inputAt + inputLayout.field),
      });
    }
    const bufferStart = view.getUint32(at + programLayout.bufferStart, true);
    const bufferCount = view.getUint16(at + programLayout.bufferCount, true);
    const buffers = [];
    for (let buffer = 0; buffer < bufferCount; buffer += 1) {
      const bufferAt = buffersOffset + (bufferStart + buffer) * bufferLayout.size;
      buffers.push(Buffer.from(bytes.slice(bufferAt + 2, bufferAt + bufferLayout.size)).toString('hex'));
    }
    const bufferOrder = new Map();
    for (let buffer = 0; buffer < bufferCount; buffer += 1) {
      const bufferAt = buffersOffset + (bufferStart + buffer) * bufferLayout.size;
      bufferOrder.set(view.getUint16(bufferAt + bufferLayout.id, true), buffer);
    }

    const operationStart = view.getUint32(at + programLayout.operationStart, true);
    const operationCount = view.getUint16(at + programLayout.operationCount, true);
    const registers = new Map();
    const stores = new Map();
    const commutative = new Set(['addF32', 'multiplyF32']);
    for (let op = 0; op < operationCount; op += 1) {
      const opAt = operationsOffset + (operationStart + op) * operationLayout.size;
      const name = opcodeNames.get(view.getUint8(opAt + operationLayout.opcode));
      const target = view.getUint8(opAt + operationLayout.target);
      const operand0 = view.getUint8(opAt + operationLayout.operand0);
      const operand1 = view.getUint8(opAt + operationLayout.operand1);
      const immediate0 = view.getUint32(opAt + operationLayout.immediate0, true);
      if (name === 'loadF32') {
        const input = inputs[operand0];
        registers.set(target, `f32(${input.scope}:${input.field})`);
      } else if (name === 'loadU32') {
        const input = inputs[metadata.f32InputCount + operand0];
        registers.set(target, `u32(${input.scope}:${input.field})`);
      } else if (name === 'constantF32' || name === 'constantU32') {
        registers.set(target, `${name}:${immediate0}`);
      } else if (name === 'convertU32ToF32') {
        registers.set(target, `u32ToF32(${required(registers, operand0)})`);
      } else if (name === 'addF32' || name === 'subtractF32' || name === 'multiplyF32') {
        let left = required(registers, operand0);
        let right = required(registers, operand1);
        if (commutative.has(name) && right < left) [left, right] = [right, left];
        registers.set(target, `${name}(${left}, ${right})`);
      } else if (name === 'storeF32' || name === 'storeU32' || name === 'storeU16') {
        stores.set(`${name}:buffer${required(bufferOrder, immediate0)}:lane${operand1}`, required(registers, operand0));
      } else {
        throw new Error(`unexpected policy opcode ${String(name)}`);
      }
    }
    programs.push({ metadata, inputs, buffers, stores: Object.fromEntries([...stores.entries()].sort()) });
  }
  return { capabilitySets, programs };
}

function required(registers, register) {
  const value = registers.get(register);
  if (value === undefined) throw new Error(`register r${register} read before it was written`);
  return value;
}
