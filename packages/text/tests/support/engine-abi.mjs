export function renderPolicyBytes(abi) {
  return renderPolicyBytesFromPrograms(abi, [
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
  return renderPolicyBytesFromPrograms(abi, [
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

export function engineUpdateBytes(
  abi,
  {
    sessionId,
    policyHandle,
    expectedEngineRevision,
    consumedPlanRevision,
    acknowledgedPublicationGeneration = 0,
    textMutations = [],
  },
) {
  const layout = abi.layouts.engineUpdateRequest;
  const mutationLayout = abi.layouts.engineTextMutation;
  const mutationsOffset = textMutations.length === 0 ? 0 : align(layout.size, mutationLayout.alignment);
  const recordsEnd =
    textMutations.length === 0 ? layout.size : mutationsOffset + textMutations.length * mutationLayout.size;
  const payloadOffset = align(recordsEnd, 2);
  const payloadLength = textMutations.reduce((total, mutation) => total + mutation.insert.length * 2, 0);
  const bytes = new Uint8Array(payloadOffset + payloadLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(layout.abiVersion, abi.version, true);
  view.setUint32(layout.byteLength, bytes.byteLength, true);
  view.setUint32(layout.sessionId, sessionId, true);
  view.setUint32(layout.expectedEngineRevision, expectedEngineRevision, true);
  view.setUint32(layout.consumedPlanRevision, consumedPlanRevision, true);
  view.setUint32(layout.acknowledgedPublicationGeneration, acknowledgedPublicationGeneration, true);
  view.setUint32(layout.policyHandle, policyHandle, true);
  view.setUint32(layout.capabilitySet, 1, true);
  for (const field of [
    'maxClusters',
    'maxLines',
    'maxRegions',
    'maxExclusions',
    'maxInlineObjects',
    'maxSlotsPerBand',
  ]) {
    view.setUint32(layout[field], field === 'maxClusters' ? Math.max(1, textMutations.length) : 1, true);
  }
  view.setUint32(layout.maxOutputBytes, abi.layouts.engineResult.size, true);
  view.setUint32(layout.textMutationsOffset, mutationsOffset, true);
  view.setUint32(layout.textMutationCount, textMutations.length, true);
  let insertOffset = payloadOffset;
  for (const [index, mutation] of textMutations.entries()) {
    const record = mutationsOffset + index * mutationLayout.size;
    view.setUint8(record + mutationLayout.opcode, abi.engine.textMutationOpcodes.replaceUtf16);
    view.setUint8(record + mutationLayout.encoding, abi.engine.textEncodings.utf16Le);
    view.setUint32(record + mutationLayout.paragraphId, mutation.paragraphId ?? 1, true);
    view.setUint32(record + mutationLayout.textStart, mutation.start, true);
    view.setUint32(record + mutationLayout.deleteCount, mutation.deleteCount, true);
    if (mutation.insert.length > 0) {
      view.setUint32(record + mutationLayout.insertOffset, insertOffset, true);
      view.setUint32(record + mutationLayout.insertCount, mutation.insert.length, true);
      for (const unit of mutation.insert) {
        view.setUint16(insertOffset, unit, true);
        insertOffset += 2;
      }
    }
  }
  return bytes;
}

export function engineFrameUpdateBytes(
  abi,
  {
    sessionId,
    policyHandle,
    fontStackHandle,
    expectedEngineRevision = 0,
    consumedPlanRevision = 0,
    acknowledgedPublicationGeneration = 0,
    textMutation,
    style,
    geometry,
    limits,
  },
) {
  const request = abi.layouts.engineUpdateRequest;
  const textRecord = abi.layouts.engineTextMutation;
  const styleRecord = abi.layouts.engineStyleMutation;
  const constraint = abi.layouts.engineConstraint;
  const region = abi.layouts.engineRegion;
  let cursor = request.size;
  const textRecordOffset = textMutation === undefined ? 0 : cursor;
  if (textMutation !== undefined) cursor += textRecord.size;
  const styleRecordOffset = style === undefined ? 0 : align(cursor, styleRecord.alignment);
  if (style !== undefined) cursor = styleRecordOffset + styleRecord.size;
  const constraintOffset = geometry === undefined ? 0 : align(cursor, constraint.alignment);
  if (geometry !== undefined) cursor = constraintOffset + constraint.size;
  const regionOffset = geometry === undefined ? 0 : align(cursor, region.alignment);
  if (geometry !== undefined) cursor = regionOffset + region.size;
  const textPayloadOffset = textMutation === undefined || textMutation.insert.length === 0 ? 0 : align(cursor, 2);
  const textPayloadLength = textMutation === undefined ? 0 : textMutation.insert.length * 2;
  const bytes = new Uint8Array(textPayloadOffset === 0 ? cursor : textPayloadOffset + textPayloadLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(request.abiVersion, abi.version, true);
  view.setUint32(request.byteLength, bytes.byteLength, true);
  view.setUint32(request.sessionId, sessionId, true);
  view.setUint32(request.expectedEngineRevision, expectedEngineRevision, true);
  view.setUint32(request.consumedPlanRevision, consumedPlanRevision, true);
  view.setUint32(request.acknowledgedPublicationGeneration, acknowledgedPublicationGeneration, true);
  view.setUint32(request.policyHandle, policyHandle, true);
  view.setUint32(request.capabilitySet, 1, true);
  view.setUint32(request.maxClusters, limits.maxClusters, true);
  view.setUint32(request.maxLines, limits.maxLines, true);
  view.setUint32(request.maxRegions, 1, true);
  view.setUint32(request.maxExclusions, 1, true);
  view.setUint32(request.maxInlineObjects, 1, true);
  view.setUint32(request.maxSlotsPerBand, 1, true);
  view.setUint32(request.maxOutputBytes, limits.maxOutputBytes, true);
  view.setUint32(request.textMutationsOffset, textRecordOffset, true);
  view.setUint32(request.textMutationCount, textMutation === undefined ? 0 : 1, true);
  view.setUint32(request.styleMutationsOffset, styleRecordOffset, true);
  view.setUint32(request.styleMutationCount, style === undefined ? 0 : 1, true);
  view.setUint32(request.constraintsOffset, constraintOffset, true);
  view.setUint32(request.constraintCount, geometry === undefined ? 0 : 1, true);
  view.setUint32(request.regionsOffset, regionOffset, true);
  view.setUint32(request.regionCount, geometry === undefined ? 0 : 1, true);

  if (textMutation !== undefined) {
    view.setUint8(textRecordOffset + textRecord.opcode, abi.engine.textMutationOpcodes.replaceUtf16);
    view.setUint8(textRecordOffset + textRecord.encoding, abi.engine.textEncodings.utf16Le);
    view.setUint32(textRecordOffset + textRecord.paragraphId, textMutation.paragraphId ?? 1, true);
    view.setUint32(textRecordOffset + textRecord.textStart, textMutation.start, true);
    view.setUint32(textRecordOffset + textRecord.deleteCount, textMutation.deleteCount, true);
    view.setUint32(textRecordOffset + textRecord.insertOffset, textPayloadOffset, true);
    view.setUint32(textRecordOffset + textRecord.insertCount, textMutation.insert.length, true);
    for (const [index, unit] of textMutation.insert.entries()) {
      view.setUint16(textPayloadOffset + index * 2, unit, true);
    }
  }

  if (style !== undefined) {
    view.setUint8(styleRecordOffset + styleRecord.opcode, abi.engine.styleMutationOpcodes.upsert);
    view.setUint8(styleRecordOffset + styleRecord.flags, abi.engine.styleFlags.root);
    view.setUint32(styleRecordOffset + styleRecord.paragraphId, style.paragraphId ?? 1, true);
    view.setUint32(styleRecordOffset + styleRecord.styleId, 1, true);
    view.setUint32(
      styleRecordOffset + styleRecord.fieldMask,
      abi.engine.styleFields.fontStack |
        abi.engine.styleFields.fontSize |
        abi.engine.styleFields.lineHeight |
        abi.engine.styleFields.rasterPixelRatio,
      true,
    );
    view.setUint32(styleRecordOffset + styleRecord.textEnd, style.textEnd, true);
    view.setUint32(styleRecordOffset + styleRecord.fontStackHandle, fontStackHandle, true);
    view.setFloat32(styleRecordOffset + styleRecord.fontSize, style.fontSize, true);
    view.setFloat32(styleRecordOffset + styleRecord.lineHeight, style.lineHeight, true);
    view.setFloat32(styleRecordOffset + styleRecord.rasterPixelRatio, style.rasterPixelRatio, true);
  }

  if (geometry !== undefined) {
    view.setUint32(constraintOffset + constraint.paragraphId, geometry.paragraphId ?? 1, true);
    view.setUint32(constraintOffset + constraint.flowThreadId, 1, true);
    view.setFloat32(constraintOffset + constraint.width, geometry.width, true);
    view.setFloat32(constraintOffset + constraint.height, geometry.height, true);
    view.setFloat32(constraintOffset + constraint.viewportBlockEnd, geometry.height, true);
    view.setUint32(constraintOffset + constraint.maxLines, geometry.maxLines, true);
    view.setUint16(constraintOffset + constraint.regionCount, 1, true);
    view.setUint8(constraintOffset + constraint.widthMode, abi.engine.axisModes.exact);
    view.setUint8(constraintOffset + constraint.heightMode, abi.engine.axisModes.exact);
    view.setUint8(constraintOffset + constraint.wrap, abi.engine.wrapModes.word);
    view.setUint8(constraintOffset + constraint.align, abi.engine.inlineAlignments.start);
    view.setUint8(constraintOffset + constraint.overflow, abi.engine.overflowModes.visible);
    view.setUint8(constraintOffset + constraint.blockAlign, abi.engine.blockAlignments.start);

    view.setUint32(regionOffset + region.id, 1, true);
    view.setUint32(regionOffset + region.geometryRevision, geometry.revision, true);
    view.setUint8(regionOffset + region.shape, abi.engine.flowShapeKinds.rectangle);
    view.setUint8(regionOffset + region.writingMode, abi.engine.writingModes.horizontalTb);
    view.setUint8(regionOffset + region.textOrientation, abi.engine.textOrientations.mixed);
    view.setFloat32(regionOffset + region.inlineEnd, geometry.width, true);
    view.setFloat32(regionOffset + region.blockEnd, geometry.height, true);
    view.setFloat32(regionOffset + region.clipInlineEnd, geometry.width, true);
    view.setFloat32(regionOffset + region.clipBlockEnd, geometry.height, true);
  }
  return bytes;
}

export function copyIntoAllocation(memory, allocate, bytes) {
  const pointer = allocate(bytes.byteLength);
  if (pointer === 0) throw new Error('Wasm request allocation failed');
  new Uint8Array(memory.buffer, pointer, bytes.byteLength).set(bytes);
  return pointer;
}

export function fontBindingBytes(
  abi,
  {
    techniqueId,
    programVariant = 0,
    glyphCount,
    strikes,
    resources,
    resourceIndices,
    glyphF32 = [],
    glyphU32 = [],
    strikeF32 = [],
    strikeU32 = [],
    resourceF32 = [],
    resourceU32 = [],
  },
) {
  const request = abi.layouts.fontBindingRequest;
  const strikeLayout = abi.layouts.fontBindingStrike;
  const resourceLayout = abi.layouts.fontBindingResource;
  const strikeRows = glyphCount * strikes.length;
  const fields = [
    ['glyphF32', glyphF32, glyphCount],
    ['glyphU32', glyphU32, glyphCount],
    ['strikeF32', strikeF32, strikeRows],
    ['strikeU32', strikeU32, strikeRows],
    ['resourceF32', resourceF32, resources.length],
    ['resourceU32', resourceU32, resources.length],
  ];
  for (const [name, lanes, rows] of fields) {
    if (lanes.some((lane) => lane.length !== rows)) throw new RangeError(`${name} rows do not match the binding`);
  }
  if (resourceIndices.length !== strikeRows) throw new RangeError('resource index rows do not match the binding');

  let length = request.size;
  const allocateTable = (count, stride, alignment) => {
    if (count === 0) return 0;
    const offset = align(length, alignment);
    length = offset + count * stride;
    return offset;
  };
  const strikesOffset = allocateTable(strikes.length, strikeLayout.size, strikeLayout.alignment);
  const resourcesOffset = allocateTable(resources.length, resourceLayout.size, resourceLayout.alignment);
  const resourceIndicesOffset = allocateTable(resourceIndices.length, 4, 4);
  const fieldOffsets = fields.map(([, lanes, rows]) => allocateTable(lanes.length * rows, 4, 4));
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  view.setUint32(request.abiVersion, abi.version, true);
  view.setUint32(request.byteLength, bytes.byteLength, true);
  view.setUint32(request.techniqueId, techniqueId, true);
  view.setUint16(request.programVariant, programVariant, true);
  view.setUint32(request.glyphCount, glyphCount, true);
  view.setUint32(request.strikeCount, strikes.length, true);
  view.setUint32(request.resourceCount, resources.length, true);
  for (const [index, [name, lanes]] of fields.entries()) {
    view.setUint8(request[`${name}FieldCount`], lanes.length);
    view.setUint32(request[`${name}Offset`], fieldOffsets[index], true);
  }
  view.setUint32(request.strikesOffset, strikesOffset, true);
  view.setUint32(request.resourcesOffset, resourcesOffset, true);
  view.setUint32(request.resourceIndicesOffset, resourceIndicesOffset, true);

  for (const [index, ppem] of strikes.entries()) {
    view.setUint32(strikesOffset + index * strikeLayout.size + strikeLayout.ppem, ppem, true);
  }
  for (const [index, resource] of resources.entries()) {
    const offset = resourcesOffset + index * resourceLayout.size;
    view.setUint32(offset + resourceLayout.id, resource.id, true);
    view.setUint32(offset + resourceLayout.generation, resource.generation, true);
    view.setUint16(offset + resourceLayout.kind, resource.kind, true);
    view.setUint32(offset + resourceLayout.reference, resource.reference, true);
  }
  for (const [index, value] of resourceIndices.entries()) {
    view.setUint32(resourceIndicesOffset + index * 4, value, true);
  }
  for (const [fieldIndex, [, lanes]] of fields.entries()) {
    let offset = fieldOffsets[fieldIndex];
    const f32 = fieldIndex === 0 || fieldIndex === 2 || fieldIndex === 4;
    for (const lane of lanes) {
      for (const value of lane) {
        if (f32) view.setFloat32(offset, value, true);
        else view.setUint32(offset, value, true);
        offset += 4;
      }
    }
  }
  return bytes;
}

function align(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

export function renderPolicyBytesFromPrograms(abi, programs) {
  const requestLayout = abi.layouts.policyRequest;
  const capabilityLayout = abi.layouts.policyCapabilitySet;
  const programLayout = abi.layouts.policyProgram;
  const bufferLayout = abi.layouts.policyBuffer;
  const operationLayout = abi.layouts.policyOperation;
  const inputLayout = abi.layouts.policyInput;
  const bufferCount = programs.reduce((total, program) => total + program.buffers.length, 0);
  const operationCount = programs.reduce((total, program) => total + program.operations.length, 0);
  const programInputs = programs.map(
    (program) =>
      program.inputs ?? [
        ...Array.from({ length: program.f32InputCount }, (_, field) => ({ scope: 'semantic', field })),
        ...Array.from({ length: program.u32InputCount }, (_, field) => ({ scope: 'semantic', field })),
      ],
  );
  const inputCount = programInputs.reduce((total, inputs) => total + inputs.length, 0);
  const capabilities = [
    {
      id: 1,
      flags:
        abi.policy.capabilityFlags.storageBuffers |
        abi.policy.capabilityFlags.orderedDirect |
        abi.policy.capabilityFlags.stableIndirect,
      maxBufferBytes: 64 * 1024 * 1024,
      updateAlignment: 4,
      coalesceGapBytes: 128,
      rangeCallPenaltyBytes: 256,
      maxBuffersPerDraw: 16,
      maxResourcesPerDraw: 16,
      maxIndirectDraws: 0,
      fragmentationBudget: 8,
      wholeBufferThresholdBasisPoints: 7_500,
    },
  ];
  const capabilitiesOffset = align(requestLayout.size, capabilityLayout.alignment);
  const programsOffset = align(
    capabilitiesOffset + capabilityLayout.size * capabilities.length,
    programLayout.alignment,
  );
  const buffersOffset = align(programsOffset + programLayout.size * programs.length, bufferLayout.alignment);
  const operationsOffset = align(buffersOffset + bufferLayout.size * bufferCount, operationLayout.alignment);
  const inputsOffset =
    inputCount === 0 ? 0 : align(operationsOffset + operationLayout.size * operationCount, inputLayout.alignment);
  const byteLength =
    inputCount === 0
      ? operationsOffset + operationLayout.size * operationCount
      : inputsOffset + inputLayout.size * inputCount;
  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(requestLayout.byteLength, bytes.byteLength, true);
  view.setUint32(requestLayout.capabilitySetsOffset, capabilitiesOffset, true);
  view.setUint32(requestLayout.capabilitySetCount, capabilities.length, true);
  view.setUint32(requestLayout.programsOffset, programsOffset, true);
  view.setUint32(requestLayout.programCount, programs.length, true);
  view.setUint32(requestLayout.buffersOffset, buffersOffset, true);
  view.setUint32(requestLayout.bufferCount, bufferCount, true);
  view.setUint32(requestLayout.operationsOffset, operationsOffset, true);
  view.setUint32(requestLayout.operationCount, operationCount, true);
  view.setUint32(requestLayout.inputsOffset, inputsOffset, true);
  view.setUint32(requestLayout.inputCount, inputCount, true);

  for (let index = 0; index < capabilities.length; index += 1) {
    const descriptor = capabilities[index];
    const offset = capabilitiesOffset + index * capabilityLayout.size;
    view.setUint32(offset + capabilityLayout.id, descriptor.id, true);
    view.setUint32(offset + capabilityLayout.flags, descriptor.flags, true);
    view.setUint32(offset + capabilityLayout.maxBufferBytes, descriptor.maxBufferBytes, true);
    view.setUint32(offset + capabilityLayout.updateAlignment, descriptor.updateAlignment, true);
    view.setUint32(offset + capabilityLayout.coalesceGapBytes, descriptor.coalesceGapBytes, true);
    view.setUint32(offset + capabilityLayout.rangeCallPenaltyBytes, descriptor.rangeCallPenaltyBytes, true);
    view.setUint16(offset + capabilityLayout.maxBuffersPerDraw, descriptor.maxBuffersPerDraw, true);
    view.setUint16(offset + capabilityLayout.maxResourcesPerDraw, descriptor.maxResourcesPerDraw, true);
    view.setUint16(offset + capabilityLayout.maxIndirectDraws, descriptor.maxIndirectDraws, true);
    view.setUint16(offset + capabilityLayout.fragmentationBudget, descriptor.fragmentationBudget, true);
    view.setUint16(
      offset + capabilityLayout.wholeBufferThresholdBasisPoints,
      descriptor.wholeBufferThresholdBasisPoints,
      true,
    );
  }

  let bufferStart = 0;
  let operationStart = 0;
  let inputStart = 0;
  for (let index = 0; index < programs.length; index += 1) {
    const descriptor = programs[index];
    const offset = programsOffset + index * programLayout.size;
    view.setUint32(offset + programLayout.techniqueId, descriptor.techniqueId, true);
    view.setUint32(offset + programLayout.programId, descriptor.programId, true);
    view.setUint32(offset + programLayout.capabilitySetId, descriptor.capabilitySetId ?? 0, true);
    view.setUint32(offset + programLayout.resourceKindMask, descriptor.resourceKindMask ?? 1, true);
    view.setUint32(offset + programLayout.semanticViewMask, descriptor.semanticViewMask ?? 0, true);
    view.setUint32(
      offset + programLayout.storageKeyMask,
      descriptor.storageKeyMask ??
        abi.policy.batchFields.technique | abi.policy.batchFields.program | abi.policy.batchFields.resource,
      true,
    );
    view.setUint32(
      offset + programLayout.drawKeyMask,
      descriptor.drawKeyMask ??
        abi.policy.batchFields.technique |
          abi.policy.batchFields.program |
          abi.policy.batchFields.resource |
          abi.policy.batchFields.order,
      true,
    );
    view.setUint16(offset + programLayout.variant, descriptor.variant ?? 0, true);
    view.setUint8(offset + programLayout.f32InputCount, descriptor.f32InputCount);
    view.setUint8(offset + programLayout.u32InputCount, descriptor.u32InputCount);
    view.setUint32(offset + programLayout.paintCapabilities, descriptor.paintCapabilities ?? 0, true);
    view.setUint32(offset + programLayout.compositingCapabilities, descriptor.compositingCapabilities ?? 0, true);
    view.setUint32(offset + programLayout.bufferStart, bufferStart, true);
    view.setUint16(offset + programLayout.bufferCount, descriptor.buffers.length, true);
    view.setUint32(offset + programLayout.operationStart, operationStart, true);
    view.setUint16(offset + programLayout.operationCount, descriptor.operations.length, true);
    view.setUint16(
      offset + programLayout.allocationStrategy,
      descriptor.allocationStrategy ?? abi.policy.allocationStrategies.orderedDirect,
      true,
    );
    view.setUint32(offset + programLayout.inputStart, inputStart, true);
    view.setUint16(offset + programLayout.inputCount, programInputs[index].length, true);
    bufferStart += descriptor.buffers.length;
    operationStart += descriptor.operations.length;
    inputStart += programInputs[index].length;
  }
  let bufferIndex = 0;
  let operationIndex = 0;
  let inputIndex = 0;
  for (const [programIndex, descriptor] of programs.entries()) {
    for (const buffer of descriptor.buffers) {
      const offset = buffersOffset + bufferIndex * bufferLayout.size;
      view.setUint16(offset + bufferLayout.id, buffer.id, true);
      view.setUint8(offset + bufferLayout.scalar, buffer.scalar);
      view.setUint8(offset + bufferLayout.vectorWidth, buffer.vectorWidth);
      const scalarBytes = buffer.scalar === abi.policy.scalarTypes.u16 ? 2 : 4;
      view.setUint16(offset + bufferLayout.alignment, buffer.alignment ?? scalarBytes, true);
      view.setUint16(offset + bufferLayout.stride, buffer.stride ?? scalarBytes * buffer.vectorWidth, true);
      view.setUint32(
        offset + bufferLayout.usage,
        buffer.usage ?? abi.policy.bufferUsage.storage | abi.policy.bufferUsage.copyDst,
        true,
      );
      view.setUint16(offset + bufferLayout.capacityClass, buffer.capacityClass ?? 1, true);
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
    for (const input of programInputs[programIndex]) {
      const offset = inputsOffset + inputIndex * inputLayout.size;
      view.setUint8(offset + inputLayout.scope, abi.policy.inputScopes[input.scope]);
      view.setUint8(offset + inputLayout.field, input.field);
      inputIndex += 1;
    }
  }
  return bytes;
}
