export function renderPolicyBytes(abi) {
  const request = abi.layouts.policyRequest;
  const program = abi.layouts.policyProgram;
  const buffer = abi.layouts.policyBuffer;
  const operation = abi.layouts.policyOperation;
  const programsOffset = align(request.size, program.alignment);
  const buffersOffset = align(programsOffset + program.size, buffer.alignment);
  const operationsOffset = align(buffersOffset + buffer.size, operation.alignment);
  const operationCount = 2;
  const bytes = new Uint8Array(operationsOffset + operation.size * operationCount);
  const view = new DataView(bytes.buffer);

  view.setUint32(request.byteLength, bytes.byteLength, true);
  view.setUint32(request.programsOffset, programsOffset, true);
  view.setUint32(request.programCount, 1, true);
  view.setUint32(request.buffersOffset, buffersOffset, true);
  view.setUint32(request.bufferCount, 1, true);
  view.setUint32(request.operationsOffset, operationsOffset, true);
  view.setUint32(request.operationCount, operationCount, true);

  view.setUint32(programsOffset + program.techniqueId, 1, true);
  view.setUint32(programsOffset + program.programId, 1, true);
  view.setUint8(programsOffset + program.f32InputCount, 1);
  view.setUint16(programsOffset + program.bufferCount, 1, true);
  view.setUint16(programsOffset + program.operationCount, operationCount, true);

  view.setUint16(buffersOffset + buffer.id, 1, true);
  view.setUint8(buffersOffset + buffer.scalar, abi.policy.scalarTypes.f32);
  view.setUint8(buffersOffset + buffer.vectorWidth, 1);

  view.setUint8(operationsOffset + operation.opcode, abi.policy.opcodes.loadF32);
  view.setUint8(operationsOffset + operation.target, 0);
  view.setUint8(operationsOffset + operation.operand0, 0);

  const storeOffset = operationsOffset + operation.size;
  view.setUint8(storeOffset + operation.opcode, abi.policy.opcodes.storeF32);
  view.setUint8(storeOffset + operation.operand0, 0);
  view.setUint32(storeOffset + operation.immediate0, 1, true);
  return bytes;
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
