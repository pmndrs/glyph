export function renderPolicyBytes(abi) {
  return policyBytes(abi, [
    {
      techniqueId: 1,
      programId: 1,
      f32InputCount: 1,
      u32InputCount: 0,
      buffers: [{ id: 1, scalar: abi.policy.scalarTypes.f32, vectorWidth: 1 }],
      operations: [
        { opcode: abi.policy.opcodes.loadF32, target: 0, operand0: 0 },
        { opcode: abi.policy.opcodes.storeF32, operand0: 0, immediate0: 1 },
      ],
    },
  ]);
}

export function kernelPolicyBytes(abi) {
  const opcodes = abi.policy.opcodes;
  return policyBytes(abi, [
    {
      techniqueId: 1,
      programId: 1,
      f32InputCount: 4,
      u32InputCount: 1,
      buffers: [
        { id: 1, scalar: abi.policy.scalarTypes.f32, vectorWidth: 4 },
        { id: 2, scalar: abi.policy.scalarTypes.u32, vectorWidth: 1 },
        { id: 3, scalar: abi.policy.scalarTypes.u16, vectorWidth: 1 },
      ],
      operations: [
        { opcode: opcodes.loadF32, target: 0, operand0: 0 },
        { opcode: opcodes.loadF32, target: 1, operand0: 1 },
        { opcode: opcodes.addF32, target: 2, operand0: 0, operand1: 1 },
        { opcode: opcodes.loadF32, target: 3, operand0: 2 },
        { opcode: opcodes.multiplyF32, target: 4, operand0: 2, operand1: 3 },
        { opcode: opcodes.loadF32, target: 5, operand0: 3 },
        { opcode: opcodes.lessThanF32, target: 6, operand0: 5, operand1: 0 },
        { opcode: opcodes.selectF32, target: 7, operand0: 6, operand1: 4, immediate0: 2 },
        { opcode: opcodes.loadU32, target: 8, operand0: 0 },
        { opcode: opcodes.convertU32ToF32, target: 9, operand0: 8 },
        { opcode: opcodes.addF32, target: 10, operand0: 7, operand1: 9 },
        { opcode: opcodes.storeF32, operand0: 0, operand1: 0, immediate0: 1 },
        { opcode: opcodes.storeF32, operand0: 2, operand1: 1, immediate0: 1 },
        { opcode: opcodes.storeF32, operand0: 7, operand1: 2, immediate0: 1 },
        { opcode: opcodes.storeF32, operand0: 10, operand1: 3, immediate0: 1 },
        { opcode: opcodes.storeU32, operand0: 8, operand1: 0, immediate0: 2 },
        { opcode: opcodes.storeU16, operand0: 8, operand1: 0, immediate0: 3 },
      ],
    },
  ]);
}

export function engineUpdateBytes(abi, { sessionId, policyHandle, expectedEngineRevision, consumedPlanRevision }) {
  const layout = abi.layouts.engineUpdateRequest;
  const bytes = new Uint8Array(layout.size);
  const view = new DataView(bytes.buffer);
  view.setUint32(layout.abiVersion, abi.version, true);
  view.setUint32(layout.byteLength, bytes.byteLength, true);
  view.setUint32(layout.sessionId, sessionId, true);
  view.setUint32(layout.expectedEngineRevision, expectedEngineRevision, true);
  view.setUint32(layout.consumedPlanRevision, consumedPlanRevision, true);
  view.setUint32(layout.policyHandle, policyHandle, true);
  for (const field of [
    'maxClusters',
    'maxLines',
    'maxRegions',
    'maxExclusions',
    'maxInlineObjects',
    'maxSlotsPerBand',
  ]) {
    view.setUint32(layout[field], 1, true);
  }
  view.setUint32(layout.maxOutputBytes, abi.layouts.engineResult.size, true);
  return bytes;
}

export function copyIntoAllocation(memory, allocate, bytes) {
  const pointer = allocate(bytes.byteLength);
  if (pointer === 0) throw new Error('Wasm request allocation failed');
  new Uint8Array(memory.buffer, pointer, bytes.byteLength).set(bytes);
  return pointer;
}

function align(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

function policyBytes(abi, programs) {
  const requestLayout = abi.layouts.policyRequest;
  const programLayout = abi.layouts.policyProgram;
  const bufferLayout = abi.layouts.policyBuffer;
  const operationLayout = abi.layouts.policyOperation;
  const bufferCount = programs.reduce((total, program) => total + program.buffers.length, 0);
  const operationCount = programs.reduce((total, program) => total + program.operations.length, 0);
  const programsOffset = align(requestLayout.size, programLayout.alignment);
  const buffersOffset = align(programsOffset + programLayout.size * programs.length, bufferLayout.alignment);
  const operationsOffset = align(buffersOffset + bufferLayout.size * bufferCount, operationLayout.alignment);
  const bytes = new Uint8Array(operationsOffset + operationLayout.size * operationCount);
  const view = new DataView(bytes.buffer);
  view.setUint32(requestLayout.byteLength, bytes.byteLength, true);
  view.setUint32(requestLayout.programsOffset, programsOffset, true);
  view.setUint32(requestLayout.programCount, programs.length, true);
  view.setUint32(requestLayout.buffersOffset, buffersOffset, true);
  view.setUint32(requestLayout.bufferCount, bufferCount, true);
  view.setUint32(requestLayout.operationsOffset, operationsOffset, true);
  view.setUint32(requestLayout.operationCount, operationCount, true);

  let bufferStart = 0;
  let operationStart = 0;
  for (let index = 0; index < programs.length; index += 1) {
    const descriptor = programs[index];
    const offset = programsOffset + index * programLayout.size;
    view.setUint32(offset + programLayout.techniqueId, descriptor.techniqueId, true);
    view.setUint32(offset + programLayout.programId, descriptor.programId, true);
    view.setUint16(offset + programLayout.variant, descriptor.variant ?? 0, true);
    view.setUint8(offset + programLayout.f32InputCount, descriptor.f32InputCount);
    view.setUint8(offset + programLayout.u32InputCount, descriptor.u32InputCount);
    view.setUint32(offset + programLayout.paintCapabilities, descriptor.paintCapabilities ?? 0, true);
    view.setUint32(offset + programLayout.compositingCapabilities, descriptor.compositingCapabilities ?? 0, true);
    view.setUint32(offset + programLayout.bufferStart, bufferStart, true);
    view.setUint16(offset + programLayout.bufferCount, descriptor.buffers.length, true);
    view.setUint32(offset + programLayout.operationStart, operationStart, true);
    view.setUint16(offset + programLayout.operationCount, descriptor.operations.length, true);
    bufferStart += descriptor.buffers.length;
    operationStart += descriptor.operations.length;
  }
  let bufferIndex = 0;
  let operationIndex = 0;
  for (const descriptor of programs) {
    for (const buffer of descriptor.buffers) {
      const offset = buffersOffset + bufferIndex * bufferLayout.size;
      view.setUint16(offset + bufferLayout.id, buffer.id, true);
      view.setUint8(offset + bufferLayout.scalar, buffer.scalar);
      view.setUint8(offset + bufferLayout.vectorWidth, buffer.vectorWidth);
      bufferIndex += 1;
    }
    for (const operation of descriptor.operations) {
      const offset = operationsOffset + operationIndex * operationLayout.size;
      view.setUint8(offset + operationLayout.opcode, operation.opcode);
      view.setUint8(offset + operationLayout.target, operation.target ?? 0);
      view.setUint8(offset + operationLayout.operand0, operation.operand0 ?? 0);
      view.setUint8(offset + operationLayout.operand1, operation.operand1 ?? 0);
      view.setUint32(offset + operationLayout.immediate0, operation.immediate0 ?? 0, true);
      view.setUint32(offset + operationLayout.immediate1, operation.immediate1 ?? 0, true);
      view.setUint32(offset + operationLayout.immediate2, operation.immediate2 ?? 0, true);
      operationIndex += 1;
    }
  }
  return bytes;
}
