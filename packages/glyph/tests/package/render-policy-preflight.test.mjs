import assert from 'node:assert/strict';
import test from 'node:test';

import { compileRenderPolicy, id, programId, techniqueId, textShaperAbi } from '../../dist/core.js';

const layouts = textShaperAbi.layouts;
const policy = textShaperAbi.policy;
const { batchFields, capabilityFlags, scalarTypes, opcodes } = policy;
const PRIMARY_TECHNIQUE_ID = techniqueId('test.policy-preflight/primary');
const SECONDARY_TECHNIQUE_ID = techniqueId('test.policy-preflight/secondary');
const PRIMARY_PROGRAM_ID = programId('test.policy-preflight/primary', 'test');
const SECONDARY_PROGRAM_ID = programId('test.policy-preflight/secondary', 'test');
const F32_BUFFER_ID = id('buffer', 'test.policy-preflight/f32');
const U16_BUFFER_ID = id('buffer', 'test.policy-preflight/u16');
const U32_BUFFER_ID = id('buffer', 'test.policy-preflight/u32');
const SECONDARY_BUFFER_ID = id('buffer', 'test.policy-preflight/secondary-u32');
const UNKNOWN_BUFFER_ID = id('buffer', 'test.policy-preflight/unknown');

function capabilitySet(overrides = {}) {
  return {
    flags: capabilityFlags.storageBuffers | capabilityFlags.orderedDirect | capabilityFlags.stableIndirect,
    maxBufferBytes: 0xfe_dc_ba_98,
    updateAlignment: 256,
    coalesceGapBytes: 4096,
    rangeCallPenaltyBytes: 512,
    maxBuffersPerDraw: 16,
    maxResourcesPerDraw: 1234,
    maxIndirectDraws: 0,
    fragmentationBudget: 88,
    wholeBufferThresholdBasisPoints: 7500,
    ...overrides,
  };
}

// Straight-line body covering every opcode family and every output lane exactly once.
const FULL_OPERATIONS = [
  { opcode: opcodes.loadF32, target: 0, operand0: 0 },
  { opcode: opcodes.loadF32, target: 1, operand0: 1 },
  { opcode: opcodes.constantF32, target: 2, immediate0: 0x3fc0_0000 },
  { opcode: opcodes.subtractF32, target: 3, operand0: 0, operand1: 1 },
  { opcode: opcodes.constantU32, target: 4, immediate0: 42 },
  { opcode: opcodes.lessThanF32, target: 5, operand0: 0, operand1: 1 },
  { opcode: opcodes.selectF32, target: 6, operand0: 5, operand1: 3, immediate0: 2 },
  { opcode: opcodes.convertU32ToF32, target: 7, operand0: 4 },
  { opcode: opcodes.multiplyF32, target: 8, operand0: 7, operand1: 6 },
  { opcode: opcodes.addF32, target: 9, operand0: 3, operand1: 8 },
  { opcode: opcodes.loadU32, target: 10, operand0: 0 },
  { opcode: opcodes.constantU32, target: 11, immediate0: 0xffff_ffff },
  { opcode: opcodes.storeF32, operand0: 0, operand1: 0, immediate0: F32_BUFFER_ID },
  { opcode: opcodes.storeF32, operand0: 1, operand1: 1, immediate0: F32_BUFFER_ID },
  { opcode: opcodes.storeF32, operand0: 9, operand1: 2, immediate0: F32_BUFFER_ID },
  { opcode: opcodes.storeF32, operand0: 3, operand1: 3, immediate0: F32_BUFFER_ID },
  { opcode: opcodes.storeU32, operand0: 11, operand1: 0, immediate0: U32_BUFFER_ID },
  { opcode: opcodes.storeU16, operand0: 4, operand1: 0, immediate0: U16_BUFFER_ID },
  { opcode: opcodes.storeU16, operand0: 10, operand1: 1, immediate0: U16_BUFFER_ID },
];

/** One descriptor that is valid under every mirrored engine rule. */
function fullDescriptor() {
  const capabilities = capabilitySet();
  return {
    capabilitySets: [capabilities],
    programs: [
      {
        techniqueId: PRIMARY_TECHNIQUE_ID,
        programId: PRIMARY_PROGRAM_ID,
        capabilitySet: capabilities,
        primitiveKind: textShaperAbi.engine.primitiveKinds.decoration,
        resourceKindMask: 0x13_57_9b_df,
        semanticViewMask: 3,
        storageKeyMask: batchFields.technique | batchFields.resource | batchFields.program,
        drawKeyMask: 255,
        paintCapabilities: 12,
        compositingCapabilities: 34,
        variant: 0xffff,
        allocationStrategy: policy.allocationStrategies.stableIndirect,
        f32InputCount: 2,
        u32InputCount: 2,
        inputs: [
          { scope: 'semantic', field: 200 },
          { scope: 'strike', field: 255 },
          { scope: 'glyph', field: 9 },
          { scope: 'resource', field: 10 },
        ],
        buffers: [
          {
            id: F32_BUFFER_ID,
            scalar: scalarTypes.f32,
            vectorWidth: 4,
            alignment: 16,
            stride: 64,
            usage: 7,
            capacityClass: 3,
          },
          { id: U16_BUFFER_ID, scalar: scalarTypes.u16, vectorWidth: 2 },
          { id: U32_BUFFER_ID, scalar: scalarTypes.u32, vectorWidth: 1 },
        ],
        operations: FULL_OPERATIONS.map((operation) => ({ ...operation })),
      },
      {
        techniqueId: SECONDARY_TECHNIQUE_ID,
        programId: SECONDARY_PROGRAM_ID,
        f32InputCount: 0,
        u32InputCount: 1,
        inputs: [{ scope: 'glyph', field: 200 }],
        storageKeyMask: batchFields.technique | batchFields.resource | batchFields.program,
        drawKeyMask: batchFields.technique | batchFields.resource | batchFields.program | batchFields.order,
        buffers: [{ id: SECONDARY_BUFFER_ID, scalar: scalarTypes.u32, vectorWidth: 1 }],
        operations: [
          { opcode: opcodes.loadU32, target: 0, operand0: 0 },
          { opcode: opcodes.storeU32, operand0: 0, operand1: 0, immediate0: SECONDARY_BUFFER_ID },
        ],
      },
    ],
  };
}

function compileDecoded(descriptor) {
  const bytes = compileRenderPolicy(descriptor);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

test('a fully specified policy retains every serialized value exactly', () => {
  const descriptor = fullDescriptor();
  const view = compileDecoded(descriptor);
  const request = layouts.policyRequest;
  const capability = layouts.policyCapabilitySet;

  assert.equal(view.getUint32(request.byteLength, true), view.byteLength);
  assert.equal(view.getUint32(request.capabilitySetCount, true), 1);
  assert.equal(view.getUint32(request.programCount, true), 2);
  assert.equal(view.getUint32(request.bufferCount, true), 4);
  assert.equal(view.getUint32(request.operationCount, true), FULL_OPERATIONS.length + 2);
  assert.equal(view.getUint32(request.inputCount, true), 5);

  const capabilitiesOffset = view.getUint32(request.capabilitySetsOffset, true);
  assert.equal(view.getUint32(capabilitiesOffset + capability.id, true), 1);
  assert.equal(
    view.getUint32(capabilitiesOffset + capability.flags, true),
    capabilityFlags.storageBuffers | capabilityFlags.orderedDirect | capabilityFlags.stableIndirect,
  );
  assert.equal(view.getUint32(capabilitiesOffset + capability.maxBufferBytes, true), 0xfe_dc_ba_98);
  assert.equal(view.getUint32(capabilitiesOffset + capability.updateAlignment, true), 256);
  assert.equal(view.getUint32(capabilitiesOffset + capability.coalesceGapBytes, true), 4096);
  assert.equal(view.getUint32(capabilitiesOffset + capability.rangeCallPenaltyBytes, true), 512);
  // u16 width boundaries survive verbatim.
  assert.equal(view.getUint16(capabilitiesOffset + capability.maxBuffersPerDraw, true), 16);
  assert.equal(view.getUint16(capabilitiesOffset + capability.maxResourcesPerDraw, true), 1234);
  assert.equal(view.getUint16(capabilitiesOffset + capability.maxIndirectDraws, true), 0);
  assert.equal(view.getUint16(capabilitiesOffset + capability.fragmentationBudget, true), 88);
  assert.equal(view.getUint16(capabilitiesOffset + capability.wholeBufferThresholdBasisPoints, true), 7500);

  const programLayout = layouts.policyProgram;
  const programsOffset = view.getUint32(request.programsOffset, true);
  const first = programsOffset;
  assert.equal(view.getUint32(first + programLayout.techniqueId, true), PRIMARY_TECHNIQUE_ID);
  assert.equal(view.getUint32(first + programLayout.programId, true), PRIMARY_PROGRAM_ID);
  assert.equal(view.getUint32(first + programLayout.capabilitySetId, true), 1);
  assert.equal(view.getUint32(first + programLayout.resourceKindMask, true), 0x13_57_9b_df);
  assert.equal(view.getUint32(first + programLayout.semanticViewMask, true), 3);
  assert.equal(
    view.getUint32(first + programLayout.storageKeyMask, true),
    batchFields.technique | batchFields.resource | batchFields.program,
  );
  assert.equal(view.getUint32(first + programLayout.drawKeyMask, true), 255);
  assert.equal(view.getUint32(first + programLayout.paintCapabilities, true), 12);
  assert.equal(view.getUint32(first + programLayout.compositingCapabilities, true), 34);
  assert.equal(view.getUint16(first + programLayout.variant, true), 0xffff);
  assert.equal(view.getUint16(first + programLayout.bufferCount, true), 3);
  assert.equal(view.getUint16(first + programLayout.operationCount, true), FULL_OPERATIONS.length);
  assert.equal(view.getUint16(first + programLayout.inputCount, true), 4);
  assert.equal(
    view.getUint16(first + programLayout.allocationStrategy, true),
    policy.allocationStrategies.stableIndirect,
  );
  assert.equal(
    view.getUint16(first + programLayout.primitiveKind, true),
    textShaperAbi.engine.primitiveKinds.decoration,
  );
  assert.equal(view.getUint8(first + programLayout.f32InputCount, true), 2);
  assert.equal(view.getUint8(first + programLayout.u32InputCount, true), 2);
  assert.equal(view.getUint32(first + programLayout.bufferStart, true), 0);
  assert.equal(view.getUint32(first + programLayout.operationStart, true), 0);
  assert.equal(view.getUint32(first + programLayout.inputStart, true), 0);

  const second = programsOffset + programLayout.size;
  assert.equal(view.getUint32(second + programLayout.techniqueId, true), SECONDARY_TECHNIQUE_ID);
  // Omitted optional fields keep their ABI defaults.
  assert.equal(view.getUint32(second + programLayout.capabilitySetId, true), 0);
  assert.equal(view.getUint32(second + programLayout.resourceKindMask, true), 1);
  assert.equal(view.getUint32(second + programLayout.semanticViewMask, true), 0);
  assert.equal(view.getUint16(second + programLayout.variant, true), 0);
  assert.equal(
    view.getUint16(second + programLayout.allocationStrategy, true),
    policy.allocationStrategies.orderedDirect,
  );
  assert.equal(view.getUint16(second + programLayout.primitiveKind, true), textShaperAbi.engine.primitiveKinds.glyph);
  assert.equal(view.getUint32(second + programLayout.bufferStart, true), 3);
  assert.equal(view.getUint32(second + programLayout.operationStart, true), FULL_OPERATIONS.length);
  assert.equal(view.getUint32(second + programLayout.inputStart, true), 4);

  const bufferLayout = layouts.policyBuffer;
  const buffersOffset = view.getUint32(request.buffersOffset, true);
  const explicitBuffer = buffersOffset;
  assert.equal(view.getUint16(explicitBuffer + bufferLayout.id, true), F32_BUFFER_ID);
  assert.equal(view.getUint8(explicitBuffer + bufferLayout.scalar, true), scalarTypes.f32);
  assert.equal(view.getUint8(explicitBuffer + bufferLayout.vectorWidth, true), 4);
  assert.equal(view.getUint16(explicitBuffer + bufferLayout.alignment, true), 16);
  assert.equal(view.getUint16(explicitBuffer + bufferLayout.stride, true), 64);
  assert.equal(view.getUint32(explicitBuffer + bufferLayout.usage, true), 7);
  assert.equal(view.getUint16(explicitBuffer + bufferLayout.capacityClass, true), 3);
  const defaultedBuffer = buffersOffset + bufferLayout.size;
  assert.equal(view.getUint16(defaultedBuffer + bufferLayout.id, true), U16_BUFFER_ID);
  assert.equal(view.getUint8(defaultedBuffer + bufferLayout.scalar, true), scalarTypes.u16);
  assert.equal(view.getUint8(defaultedBuffer + bufferLayout.vectorWidth, true), 2);
  assert.equal(view.getUint16(defaultedBuffer + bufferLayout.alignment, true), 2);
  assert.equal(view.getUint16(defaultedBuffer + bufferLayout.stride, true), 4);
  assert.equal(
    view.getUint32(defaultedBuffer + bufferLayout.usage, true),
    policy.bufferUsage.storage | policy.bufferUsage.copyDst,
  );
  assert.equal(view.getUint16(defaultedBuffer + bufferLayout.capacityClass, true), 1);

  const operationLayout = layouts.policyOperation;
  const operationsOffset = view.getUint32(request.operationsOffset, true);
  const firstOperation = operationsOffset;
  assert.equal(view.getUint8(firstOperation + operationLayout.opcode, true), opcodes.loadF32);
  assert.equal(view.getUint8(firstOperation + operationLayout.target, true), 0);
  assert.equal(view.getUint8(firstOperation + operationLayout.operand0, true), 0);
  // u32 width boundary survives verbatim in the constant pool.
  const maxConstant = operationsOffset + 11 * operationLayout.size;
  assert.equal(view.getUint32(maxConstant + operationLayout.immediate0, true), 0xffff_ffff);
  const selectOperation = operationsOffset + 6 * operationLayout.size;
  assert.equal(view.getUint8(selectOperation + operationLayout.opcode, true), opcodes.selectF32);
  assert.equal(view.getUint8(selectOperation + operationLayout.operand0, true), 5);
  assert.equal(view.getUint8(selectOperation + operationLayout.operand1, true), 3);
  assert.equal(view.getUint32(selectOperation + operationLayout.immediate0, true), 2);
  const lastStore = operationsOffset + (FULL_OPERATIONS.length - 1) * operationLayout.size;
  assert.equal(view.getUint8(lastStore + operationLayout.opcode, true), opcodes.storeU16);
  assert.equal(view.getUint8(lastStore + operationLayout.operand0, true), 10);
  assert.equal(view.getUint8(lastStore + operationLayout.operand1, true), 1);
  assert.equal(view.getUint32(lastStore + operationLayout.immediate0, true), U16_BUFFER_ID);

  const inputLayout = layouts.policyInput;
  const inputsOffset = view.getUint32(request.inputsOffset, true);
  const scopes = [
    ['semantic', 200],
    ['strike', 255],
    ['glyph', 9],
    ['resource', 10],
  ];
  for (const [index, [scope, field]] of scopes.entries()) {
    const offset = inputsOffset + index * inputLayout.size;
    assert.equal(view.getUint8(offset + inputLayout.scope, true), policy.inputScopes[scope]);
    assert.equal(view.getUint8(offset + inputLayout.field, true), field);
  }
});

test('a decoration program may accept zero resource kinds', () => {
  const descriptor = fullDescriptor();
  descriptor.programs[0].resourceKindMask = 0;
  assert.doesNotThrow(() => compileRenderPolicy(descriptor));
});

test('buffer ids collide only within one program', () => {
  const descriptor = fullDescriptor();
  descriptor.programs[1].buffers = [{ id: F32_BUFFER_ID, scalar: scalarTypes.u32, vectorWidth: 1 }];
  descriptor.programs[1].operations[1].immediate0 = F32_BUFFER_ID;
  assert.doesNotThrow(() => compileRenderPolicy(descriptor));

  const colliding = fullDescriptor();
  colliding.programs[0].buffers[1].id = F32_BUFFER_ID;
  assert.throws(
    () => compileRenderPolicy(colliding),
    new RegExp(`repeats buffer id ${F32_BUFFER_ID} within a program`),
  );
});

test('rejection happens before any output allocation or write', () => {
  const original = globalThis.Uint8Array;
  // Only sizable allocations can be the serialized output; small incidental
  // allocations from unrelated machinery must not fail the proof.
  let outputAllocations = 0;
  class CountingUint8Array extends original {
    constructor(...args) {
      if (Number(args[0]) >= 100) outputAllocations += 1;
      super(...args);
    }
  }
  globalThis.Uint8Array = CountingUint8Array;
  try {
    const descriptor = fullDescriptor();
    descriptor.programs[1].operations = [];
    assert.throws(() => compileRenderPolicy(descriptor), /declares no operations/);
    assert.equal(outputAllocations, 0);
  } finally {
    globalThis.Uint8Array = original;
  }
});

test('compiler rejects malformed descriptor shapes at its call boundary', () => {
  assert.throws(() => compileRenderPolicy(null), /descriptor needs an object/);
  assert.throws(() => compileRenderPolicy({ capabilitySets: {}, programs: [] }), /capabilitySets needs an array/);
  assert.throws(() => compileRenderPolicy({ capabilitySets: [], programs: {} }), /programs needs an array/);
  assert.throws(
    () => compileRenderPolicy({ capabilitySets: [null], programs: [] }),
    /capability set 0 needs an object/,
  );
  assert.throws(
    () => compileRenderPolicy({ capabilitySets: [capabilitySet()], programs: [null] }),
    /program 0 needs an object/,
  );
  for (const field of ['inputs', 'buffers', 'operations']) {
    const descriptor = fullDescriptor();
    descriptor.programs[0][field] = {};
    assert.throws(() => compileRenderPolicy(descriptor), new RegExp(`program 0 ${field} needs an array`));
  }
  const descriptor = fullDescriptor();
  descriptor.programs[0].operations[0] = null;
  assert.throws(() => compileRenderPolicy(descriptor), /program 0 operation 0 needs an object/);
});

/** Each case mutates a valid descriptor into one specific preflight rejection. */
const numericRejections = [
  ['a negative u8 input count', (d) => (d.programs[0].f32InputCount = -1), /f32 input count needs a u8/],
  ['an overflowing u8 input count', (d) => (d.programs[0].f32InputCount = 256), /f32 input count needs a u8/],
  ['a NaN u8 input count', (d) => (d.programs[0].u32InputCount = Number.NaN), /u32 input count needs a u8/],
  [
    'an infinite u8 input count',
    (d) => (d.programs[0].u32InputCount = Number.NEGATIVE_INFINITY),
    /u32 input count needs a u8/,
  ],
  ['a fractional opcode', (d) => (d.programs[0].operations[0].opcode = 0.5), /operation 0 opcode needs a u8/],
  ['an overflowing target', (d) => (d.programs[0].operations[0].target = 256), /operation 0 target needs a u8/],
  ['an overflowing input field', (d) => (d.programs[0].inputs[0].field = 256), /input 0 field needs a u8/],
  ['an overflowing buffer scalar', (d) => (d.programs[0].buffers[0].scalar = 300), /buffer 0 scalar needs a u8/],
  [
    'a negative buffer vectorWidth',
    (d) => (d.programs[0].buffers[0].vectorWidth = -1),
    /buffer 0 vectorWidth needs a u8/,
  ],
  ['an overflowing variant', (d) => (d.programs[0].variant = 65536), /variant needs a u16/],
  ['a negative variant', (d) => (d.programs[0].variant = -1), /variant needs a u16/],
  [
    'an overflowing draw capacity',
    (d) => (d.capabilitySets[0].maxBuffersPerDraw = 65536),
    /maxBuffersPerDraw needs a u16/,
  ],
  [
    'a fractional buffer id',
    (d) => (d.programs[0].buffers[0].id = 1.5),
    /buffer 0 id must come from id\('buffer', name\)/,
  ],
  [
    'an infinite stride',
    (d) => (d.programs[0].buffers[0].stride = Number.POSITIVE_INFINITY),
    /buffer 0 stride needs a u16/,
  ],
  [
    'a NaN capacityClass',
    (d) => (d.programs[0].buffers[1].capacityClass = Number.NaN),
    /buffer 1 capacityClass needs a u16/,
  ],
  [
    'an overflowing allocationStrategy',
    (d) => (d.programs[0].allocationStrategy = 65536),
    /allocationStrategy needs a u16/,
  ],
  ['a negative primitiveKind', (d) => (d.programs[0].primitiveKind = -5), /primitiveKind needs a u16/],
  [
    'an overflowing per-program input count',
    (d) => (d.programs[1].inputs = Array.from({ length: 65537 }, () => ({ scope: 'semantic', field: 0 }))),
    /input count needs a u16/,
  ],
  [
    'an overflowing maxBufferBytes',
    (d) => (d.capabilitySets[0].maxBufferBytes = 2 ** 32),
    /maxBufferBytes needs a u32/,
  ],
  ['a fractional updateAlignment', (d) => (d.capabilitySets[0].updateAlignment = 0.25), /updateAlignment needs a u32/],
  [
    'an infinite resourceKindMask',
    (d) => (d.programs[0].resourceKindMask = Number.POSITIVE_INFINITY),
    /resourceKindMask needs a u32/,
  ],
  ['a NaN drawKeyMask', (d) => (d.programs[0].drawKeyMask = Number.NaN), /drawKeyMask needs a u32/],
  ['negative paintCapabilities', (d) => (d.programs[0].paintCapabilities = -1), /paintCapabilities needs a u32/],
  [
    'an overflowing compositingCapabilities',
    (d) => (d.programs[0].compositingCapabilities = 2 ** 32),
    /compositingCapabilities needs a u32/,
  ],
  ['a negative buffer usage', (d) => (d.programs[0].buffers[0].usage = -1), /buffer 0 usage needs a u32/],
  [
    'an overflowing immediate0',
    (d) => (d.programs[0].operations[11].immediate0 = 2 ** 32),
    /operation 11 immediate0 needs a u32/,
  ],
  [
    'a fractional immediate1',
    (d) => (d.programs[0].operations[0].immediate1 = 1.5),
    /operation 0 immediate1 needs a u32/,
  ],
  [
    'a NaN immediate2',
    (d) => (d.programs[0].operations[0].immediate2 = Number.NaN),
    /operation 0 immediate2 needs a u32/,
  ],
];

for (const [name, mutate, pattern] of numericRejections) {
  test(`preflight rejects ${name}`, () => {
    const descriptor = fullDescriptor();
    mutate(descriptor);
    assert.throws(() => compileRenderPolicy(descriptor), pattern);
  });
}

test('preflight rejects unknown and inherited input scope keys before indexing the ABI', () => {
  for (const scope of ['bogus', 'toString', 'constructor', 99, undefined]) {
    const descriptor = fullDescriptor();
    descriptor.programs[0].inputs[0].scope = scope;
    assert.throws(
      () => compileRenderPolicy(descriptor),
      (error) => error instanceof TypeError && /input 0 scope .* is not a policy input scope/.test(error.message),
    );
  }
});

test('preflight rejects equivalent capability sets', () => {
  const descriptor = fullDescriptor();
  descriptor.capabilitySets.push({ ...descriptor.capabilitySets[0] });
  assert.throws(() => compileRenderPolicy(descriptor), /repeats an equivalent capability set/);
});

test('compiler snapshots each declared capability field once', () => {
  const descriptor = fullDescriptor();
  descriptor.programs[0].capabilitySet = undefined;
  let reads = 0;
  Object.defineProperty(descriptor.capabilitySets[0], 'flags', {
    enumerable: true,
    get() {
      reads += 1;
      return capabilityFlags.storageBuffers | capabilityFlags.orderedDirect | capabilityFlags.stableIndirect;
    },
  });

  compileRenderPolicy(descriptor);

  assert.equal(reads, 1);
});

test('preflight rejects a program referencing an undeclared capability set', () => {
  const descriptor = fullDescriptor();
  descriptor.programs[0].capabilitySet = capabilitySet({ maxBufferBytes: 0xfe_dc_ba_97 });
  assert.throws(() => compileRenderPolicy(descriptor), /references an undeclared capability set/);
});

test('preflight rejects a repeated technique, capability set, and variant', () => {
  const descriptor = fullDescriptor();
  Object.assign(descriptor.programs[1], {
    techniqueId: PRIMARY_TECHNIQUE_ID,
    capabilitySet: descriptor.capabilitySets[0],
    variant: 0xffff,
  });
  assert.throws(() => compileRenderPolicy(descriptor), /repeats a technique, capability set, and program variant/);
});

/** Each case mirrors one PolicyError from the shaper's Rust validators. */
const semanticRejections = [
  ['empty capability sets', (d) => (d.capabilitySets = []), /declares no capability sets/],
  [
    'more than eight capability sets',
    (d) =>
      (d.capabilitySets = Array.from({ length: 9 }, (_, index) => capabilitySet({ maxBufferBytes: 1024 + index }))),
    /more than 8 capability sets/,
  ],
  [
    'unknown capability flag bits',
    (d) => (d.capabilitySets[0].flags |= 1 << 6),
    /unknown bits or support no allocation strategy/,
  ],
  [
    'capability flags with no allocation support',
    (d) => (d.capabilitySets[0].flags = capabilityFlags.storageBuffers),
    /unknown bits or support no allocation strategy/,
  ],
  ['zero max buffer bytes', (d) => (d.capabilitySets[0].maxBufferBytes = 0), /limits need nonzero capacity/],
  [
    'buffers per draw beyond the program maximum',
    (d) => (d.capabilitySets[0].maxBuffersPerDraw = 17),
    /limits need nonzero capacity/,
  ],
  ['zero resources per draw', (d) => (d.capabilitySets[0].maxResourcesPerDraw = 0), /limits need nonzero capacity/],
  ['a zero fragmentation budget', (d) => (d.capabilitySets[0].fragmentationBudget = 0), /limits need nonzero capacity/],
  ['a non-power-of-two update alignment', (d) => (d.capabilitySets[0].updateAlignment = 3), /power of two up to 256/],
  ['an oversized update alignment', (d) => (d.capabilitySets[0].updateAlignment = 512), /power of two up to 256/],
  [
    'coalescing gaps beyond the buffer budget',
    (d) => (d.capabilitySets[0].coalesceGapBytes = d.capabilitySets[0].maxBufferBytes + 1),
    /upload cost model exceeds/,
  ],
  [
    'range call penalties beyond the buffer budget',
    (d) => (d.capabilitySets[0].rangeCallPenaltyBytes = d.capabilitySets[0].maxBufferBytes + 1),
    /upload cost model exceeds/,
  ],
  [
    'basis points above one hundred percent',
    (d) => (d.capabilitySets[0].wholeBufferThresholdBasisPoints = 10001),
    /upload cost model exceeds/,
  ],
  ['zero basis points', (d) => (d.capabilitySets[0].wholeBufferThresholdBasisPoints = 0), /upload cost model exceeds/],
  [
    'the indirect flag without an indirect limit',
    (d) => ((d.capabilitySets[0].flags |= capabilityFlags.indirectDraws), (d.capabilitySets[0].maxIndirectDraws = 0)),
    /pair the indirect-draw flag/,
  ],
  [
    'an indirect limit without the indirect flag',
    (d) => (d.capabilitySets[0].maxIndirectDraws = 5),
    /pair the indirect-draw flag/,
  ],
  ['an empty program list', (d) => (d.programs = []), /declares no programs/],
  [
    'more than thirty-two programs',
    (d) =>
      (d.programs = Array.from({ length: 33 }, (_, index) => ({
        ...d.programs[1],
        techniqueId: techniqueId(`test.policy-preflight/many/${index}`),
        programId: programId(`test.policy-preflight/many/${index}`, 'test'),
        buffers: [...d.programs[1].buffers],
        operations: [...d.programs[1].operations],
        inputs: [...d.programs[1].inputs],
      }))),
    /more than 32 programs/,
  ],
  [
    'glyph records without resource kinds',
    (d) => (
      (d.programs[0].resourceKindMask = 0), (d.programs[0].primitiveKind = textShaperAbi.engine.primitiveKinds.glyph)
    ),
    /accepts no resource kinds/,
  ],
  ['an unsupported primitive kind', (d) => (d.programs[0].primitiveKind = 3), /glyph or decoration records/],
  [
    'storage keys missing a required batch field',
    (d) => (d.programs[0].storageKeyMask = batchFields.technique | batchFields.program),
    /key masks miss a required batch field/,
  ],
  [
    'storage keys carrying the draw-order bit',
    (d) => (d.programs[0].storageKeyMask |= batchFields.order),
    /key masks miss a required batch field/,
  ],
  [
    'draw keys missing the order bit',
    (d) => (d.programs[0].drawKeyMask &= ~batchFields.order),
    /key masks miss a required batch field/,
  ],
  [
    'draw keys carrying an unknown batch bit',
    (d) => (d.programs[0].drawKeyMask |= 1 << 8),
    /key masks miss a required batch field/,
  ],
  ['an unknown allocation strategy', (d) => (d.programs[0].allocationStrategy = 3), /not a known strategy/],
  [
    'stable allocation without stable capability support',
    (d) => (d.capabilitySets[0].flags &= ~capabilityFlags.stableIndirect),
    /lacks the allocation support/,
  ],
  [
    'a declared capability set no program references',
    (d) => (
      d.capabilitySets.push(capabilitySet({ maxBufferBytes: 0xfe_dc_ba_97 })),
      d.programs.forEach((program) => (program.capabilitySet = d.capabilitySets[0]))
    ),
    /referenced by no program/,
  ],
  ['input counts beyond the register file', (d) => (d.programs[0].f32InputCount = 33), /register file/],
  [
    'an input table shorter than its declared counts',
    (d) => d.programs[0].inputs.pop(),
    /input table length must equal/,
  ],
  ['a program without buffers', (d) => (d.programs[1].buffers = []), /declares no buffers/],
  [
    'more than sixteen buffers',
    (d) =>
      (d.programs[1].buffers = Array.from({ length: 17 }, (_, index) => ({
        id: id('buffer', `test.policy-preflight/many/${index}`),
        scalar: scalarTypes.u32,
        vectorWidth: 1,
      }))),
    /more than 16 buffers/,
  ],
  ['a zero buffer id', (d) => (d.programs[1].buffers[0].id = 0), /buffer 0 id must come from id\('buffer', name\)/],
  ['a zero vector width', (d) => (d.programs[1].buffers[0].vectorWidth = 0), /vectorWidth needs 1\.\.4/],
  ['a five-lane vector width', (d) => (d.programs[0].buffers[0].vectorWidth = 5), /vectorWidth needs 1\.\.4/],
  [
    'a non-power-of-two buffer alignment',
    (d) => (d.programs[0].buffers[0].alignment = 3),
    /alignment needs a power of two/,
  ],
  [
    'an oversized buffer alignment',
    (d) => (d.programs[0].buffers[0].alignment = 512),
    /alignment needs a power of two/,
  ],
  ['a stride below the packed lanes', (d) => (d.programs[0].buffers[0].stride = 12), /stride fits every lane/],
  ['a stride unaligned to its alignment', (d) => (d.programs[0].buffers[0].stride = 63), /stride fits every lane/],
  ['zero buffer usage', (d) => (d.programs[0].buffers[0].usage = 0), /usage needs copyDst/],
  [
    'buffer usage without copy destination',
    (d) => (d.programs[0].buffers[0].usage = policy.bufferUsage.vertex),
    /usage needs copyDst/,
  ],
  ['unknown buffer usage bits', (d) => (d.programs[0].buffers[0].usage = 7 + 2 ** 31), /usage needs copyDst/],
  ['a zero capacity class', (d) => (d.programs[1].buffers[0].capacityClass = 0), /capacityClass needs a nonzero class/],
  ['an unknown scalar type', (d) => (d.programs[1].buffers[0].scalar = 9), /not a known scalar type/],
  ['a program without operations', (d) => (d.programs[1].operations = []), /declares no operations/],
  [
    'more than one hundred twenty-eight operations',
    (d) =>
      (d.programs[1].operations = Array.from({ length: 129 }, () => ({
        opcode: opcodes.constantU32,
        target: 0,
        immediate0: 1,
      }))),
    /more than 128 operations/,
  ],
  [
    'stores reading a register never written',
    (d) => (d.programs[0].operations[15].operand0 = 30),
    /before it is written/,
  ],
  ['arithmetic mixing register types', (d) => (d.programs[0].operations[9].operand1 = 4), /holds the other wire type/],
  ['targets beyond the register file', (d) => (d.programs[0].operations[4].target = 32), /beyond the register file/],
  [
    'f32 loads beyond the declared count',
    (d) => (d.programs[0].operations[1].operand0 = 2),
    /loads an f32 input beyond the declared count/,
  ],
  [
    'u32 loads beyond the declared count',
    (d) => (d.programs[1].operations[0].operand0 = 1),
    /loads a u32 input beyond the declared count/,
  ],
  ['a NaN f32 constant', (d) => (d.programs[0].operations[2].immediate0 = 0x7fc0_0000), /not a finite f32/],
  ['an infinite f32 constant', (d) => (d.programs[0].operations[2].immediate0 = 0x7f80_0000), /not a finite f32/],
  [
    'stores into an undeclared buffer',
    (d) => (d.programs[0].operations[12].immediate0 = UNKNOWN_BUFFER_ID),
    new RegExp(`undeclared buffer ${UNKNOWN_BUFFER_ID}`),
  ],
  [
    'u32 stores into an f32 buffer',
    (d) => (d.programs[0].operations[17].opcode = opcodes.storeU32),
    /stores .* lanes into a .* buffer/,
  ],
  [
    'store lanes beyond the buffer width',
    (d) => (d.programs[0].operations[12].operand1 = 4),
    /lane exceeds the buffer width/,
  ],
  [
    'two stores to one lane',
    (d) => (d.programs[0].operations[18].operand1 = 0),
    new RegExp(`writes buffer ${U16_BUFFER_ID} lane 0 twice`),
  ],
  [
    'a buffer with unwritten lanes',
    (d) => d.programs[0].operations.pop(),
    new RegExp(`leaves buffer ${U16_BUFFER_ID} lane.*unwritten|lanes unwritten`),
  ],
];

for (const [name, mutate, pattern] of semanticRejections) {
  test(`engine rules reject ${name}`, () => {
    const descriptor = fullDescriptor();
    mutate(descriptor);
    assert.throws(() => compileRenderPolicy(descriptor), pattern);
  });
}
