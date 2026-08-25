import { createProgram, programId, resourceId, techniqueId, textShaperAbi } from '../../dist/core.js';
import { defineRasterResourceId } from '../../dist/index.js';

const technique = techniqueId('vendor.example');
const program = programId('vendor.example', 'renderer');
const resource = resourceId(defineRasterResourceId('vendor.example/resource'));
const body = {
  inputs: [],
  operations: [
    { opcode: textShaperAbi.policy.opcodes.constantU32, target: 0, immediate0: 0 },
    { opcode: textShaperAbi.policy.opcodes.storeU32, operand0: 0, operand1: 0, immediate0: 1 },
  ],
  f32InputCount: 0,
  u32InputCount: 0,
};
const buffers = [{ id: 1, scalar: textShaperAbi.policy.scalarTypes.u32, vectorWidth: 1 }];

createProgram(technique, program, body, buffers, 'direct', 'ordered');

// @ts-expect-error Authored wire identities must come from the semantic helpers.
createProgram(1, program, body, buffers, 'direct', 'ordered');
// @ts-expect-error Program and technique identities are distinct even though both serialize as u32.
createProgram(program, technique, body, buffers, 'direct', 'ordered');
// @ts-expect-error Resource identities cannot stand in for technique identities.
createProgram(resource, program, body, buffers, 'direct', 'ordered');
