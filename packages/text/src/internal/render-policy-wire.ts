import { textShaperAbi } from '../generated/text-shaper-abi.js';

const MAX_U32 = 0xffff_ffff;
const encoder = new TextEncoder();
export const FIRST_PARTY_TRANSFORM_BUFFER_ID = 15;

type PolicyInputScope = keyof typeof textShaperAbi.policy.inputScopes;

interface PolicyInput {
  readonly scope: PolicyInputScope;
  readonly field: number;
}

interface PolicyBuffer {
  readonly id: number;
  readonly scalar: number;
  readonly vectorWidth: number;
  readonly alignment?: number;
  readonly stride?: number;
  readonly usage?: number;
  readonly capacityClass?: number;
}

interface PolicyOperation {
  readonly opcode: number;
  readonly target?: number;
  readonly operand0?: number;
  readonly operand1?: number;
  readonly immediate0?: number;
  readonly immediate1?: number;
  readonly immediate2?: number;
}

interface PolicyProgram {
  readonly techniqueId: number;
  readonly programId: number;
  readonly capabilitySetId?: number;
  readonly resourceKindMask?: number;
  readonly semanticViewMask?: number;
  readonly storageKeyMask?: number;
  readonly drawKeyMask?: number;
  readonly variant?: number;
  readonly f32InputCount: number;
  readonly u32InputCount: number;
  readonly paintCapabilities?: number;
  readonly compositingCapabilities?: number;
  readonly allocationStrategy?: number;
  readonly inputs: readonly PolicyInput[];
  readonly buffers: readonly PolicyBuffer[];
  readonly operations: readonly PolicyOperation[];
}

interface PolicyCapabilitySet {
  readonly id: number;
  readonly flags: number;
  readonly maxBufferBytes: number;
  readonly updateAlignment: number;
  readonly coalesceGapBytes: number;
  readonly rangeCallPenaltyBytes: number;
  readonly maxBuffersPerDraw: number;
  readonly maxResourcesPerDraw: number;
  readonly maxIndirectDraws: number;
  readonly fragmentationBudget: number;
  readonly wholeBufferThresholdBasisPoints: number;
}

interface PolicyDescriptor {
  readonly capabilitySets: readonly PolicyCapabilitySet[];
  readonly programs: readonly PolicyProgram[];
}

/** Deterministic UTF-8 FNV-1a mapping used by both policy and font-binding compilers. */
export function renderWireId(id: string): number {
  if (typeof id !== 'string' || id.length === 0) throw new TypeError('render identity must be a nonempty string');
  let hash = 0x811c_9dc5;
  for (const byte of encoder.encode(id)) hash = Math.imul(hash ^ byte, 0x0100_0193) >>> 0;
  if (hash === 0) throw new RangeError('raster technique ID hashes to the reserved zero wire identity');
  return hash;
}

/** Runtime-scoped collision proof for every string identity lowered into the shared u32 wire namespace. */
export class RenderWireIdentityRegistry {
  readonly #strings = new Map<number, string>();

  resolve(id: string): number {
    const wireId = renderWireId(id);
    const collision = this.#strings.get(wireId);
    if (collision !== undefined && collision !== id) {
      throw new TypeError(`render wire identity collision between "${collision}" and "${id}"`);
    }
    this.#strings.set(wireId, id);
    return wireId;
  }
}

export interface FirstPartyTechniqueWireIds {
  readonly bitmap: number;
  readonly msdf: number;
  readonly slug: number;
}

export const firstPartyTechniqueWireIds: FirstPartyTechniqueWireIds = Object.freeze({
  bitmap: renderWireId('pmndrs.bitmap'),
  msdf: renderWireId('pmndrs.msdf'),
  slug: renderWireId('pmndrs.slug'),
});

/** Compiler-mapped Three policy covering every first-party raster technique in one registration. */
export function firstPartyThreeRenderPolicyBytes(
  identities: RenderWireIdentityRegistry = new RenderWireIdentityRegistry(),
): Uint8Array {
  const bitmap = identities.resolve('pmndrs.bitmap');
  const msdf = identities.resolve('pmndrs.msdf');
  const slug = identities.resolve('pmndrs.slug');
  const programs = [bitmapProgram(bitmap, 1), msdfProgram(msdf, 2), slugProgram(slug, 3)];
  if (new Set(programs.map((program) => program.techniqueId)).size !== programs.length) {
    throw new TypeError('first-party raster technique wire identities collide');
  }
  return compilePolicy({ capabilitySets: [threeCapabilitySet()], programs });
}

function threeCapabilitySet(): PolicyCapabilitySet {
  const flags = textShaperAbi.policy.capabilityFlags;
  return {
    id: 1,
    flags: flags.storageBuffers | flags.aliasVec2 | flags.aliasVec4 | flags.orderedDirect | flags.stableIndirect,
    maxBufferBytes: 64 * 1024 * 1024,
    updateAlignment: 4,
    coalesceGapBytes: 128,
    rangeCallPenaltyBytes: 256,
    maxBuffersPerDraw: 16,
    maxResourcesPerDraw: 16,
    maxIndirectDraws: 0,
    fragmentationBudget: 8,
    wholeBufferThresholdBasisPoints: 7_500,
  };
}

function bitmapProgram(techniqueId: number, programId: number): PolicyProgram {
  const context = programContext('strike', 8, 0);
  const { loadF32, loadU32, binary, storeF32, storeU32 } = context;
  loadF32(15);
  loadU32(31, 0);
  binary('multiplyF32', 15, 7, 2);
  binary('addF32', 16, 0, 15);
  binary('multiplyF32', 17, 8, 2);
  binary('subtractF32', 18, 1, 17);
  binary('multiplyF32', 19, 9, 2);
  binary('multiplyF32', 20, 10, 2);
  stores(storeF32, [
    [1, [16, 18]],
    [2, [19, 20]],
    [3, [11, 12]],
    [4, [13, 14]],
    [5, [3, 4, 5, 6]],
  ]);
  storeU32(FIRST_PARTY_TRANSFORM_BUFFER_ID, 0, 31);
  return createProgram(techniqueId, programId, context, [...floatBuffers([2, 2, 2, 2, 4]), transformIndexBuffer()]);
}

function msdfProgram(techniqueId: number, programId: number): PolicyProgram {
  const context = programContext('glyph', 10, 1);
  const { operations, loadF32, loadU32, binary, constantF32, storeF32, storeU32 } = context;
  loadF32(17);
  loadU32(17, 1);
  loadU32(31, 0);
  binary('multiplyF32', 18, 7, 2);
  binary('addF32', 19, 0, 18);
  binary('multiplyF32', 20, 8, 2);
  binary('subtractF32', 21, 1, 20);
  binary('multiplyF32', 22, 9, 2);
  binary('multiplyF32', 23, 10, 2);
  operations.push({ opcode: textShaperAbi.policy.opcodes.convertU32ToF32, target: 24, operand0: 17 });
  constantF32(25, 0);
  stores(storeF32, [
    [1, [19, 21, 22, 23]],
    [2, [11, 12, 13, 14]],
    [3, [11, 12, 15, 16]],
    [4, [3, 4, 5, 6]],
    [5, [25, 25, 25, 25]],
    [6, [25, 25, 25, 25]],
    [7, [25, 25, 25, 24]],
  ]);
  storeU32(FIRST_PARTY_TRANSFORM_BUFFER_ID, 0, 31);
  return createProgram(techniqueId, programId, context, [
    ...floatBuffers([4, 4, 4, 4, 4, 4, 4]),
    transformIndexBuffer(),
  ]);
}

function slugProgram(techniqueId: number, programId: number): PolicyProgram {
  const context = programContext('glyph', 8, 6, true);
  const { loadF32, loadU32, binary, constantF32, constantU32, storeF32, storeU32 } = context;
  loadF32(16);
  loadU32(31, 0);
  for (let field = 0; field < 6; field += 1) loadU32(21 + field, field + 1);
  binary('multiplyF32', 16, 8, 2);
  binary('addF32', 17, 0, 16);
  binary('multiplyF32', 18, 9, 2);
  binary('subtractF32', 19, 1, 18);
  binary('multiplyF32', 20, 10, 2);
  binary('multiplyF32', 27, 11, 2);
  constantF32(28, 0);
  constantU32(29, 0);
  stores(storeF32, [
    [1, [17, 19, 20, 27]],
    [2, [8, 9, 10, 11]],
    [3, [12, 13, 14, 15]],
    [4, [3, 4, 5, 6]],
    [5, [7, 28, 28, 28]],
  ]);
  stores(storeU32, [
    [6, [21, 22, 23, 24]],
    [7, [25, 26, 29, 29]],
  ]);
  storeU32(FIRST_PARTY_TRANSFORM_BUFFER_ID, 0, 31);
  return createProgram(techniqueId, programId, context, [
    ...floatBuffers([4, 4, 4, 4, 4]),
    ...u32Buffers([4, 4], 6),
    transformIndexBuffer(),
  ]);
}

interface ProgramContext {
  readonly inputs: PolicyInput[];
  readonly operations: PolicyOperation[];
  readonly f32InputCount: number;
  readonly u32InputCount: number;
  readonly loadF32: (count: number) => void;
  readonly loadU32: (target: number, field: number) => void;
  readonly binary: (
    name: 'addF32' | 'subtractF32' | 'multiplyF32',
    target: number,
    left: number,
    right: number,
  ) => void;
  readonly constantF32: (target: number, value: number) => void;
  readonly constantU32: (target: number, value: number) => void;
  readonly storeF32: (buffer: number, lane: number, register: number) => void;
  readonly storeU32: (buffer: number, lane: number, register: number) => void;
}

function programContext(
  bindingScope: PolicyInputScope,
  bindingF32Count: number,
  bindingU32Count: number,
  inverseFontSize = false,
): ProgramContext {
  const operations: PolicyOperation[] = [];
  const semantic = textShaperAbi.engine.semanticF32Fields;
  const semanticU32 = textShaperAbi.engine.semanticU32Fields;
  const inputs: PolicyInput[] = [
    { scope: 'semantic', field: semantic.inlineStart },
    { scope: 'semantic', field: semantic.blockStart },
    { scope: 'semantic', field: semantic.fontSize },
    { scope: 'semantic', field: semantic.foregroundRed },
    { scope: 'semantic', field: semantic.foregroundGreen },
    { scope: 'semantic', field: semantic.foregroundBlue },
    { scope: 'semantic', field: semantic.foregroundAlpha },
    ...(inverseFontSize ? [{ scope: 'semantic' as const, field: semantic.inverseFontSize }] : []),
    ...Array.from({ length: bindingF32Count }, (_, field) => ({ scope: bindingScope, field })),
    { scope: 'semantic', field: semanticU32.transformIndex },
    ...Array.from({ length: bindingU32Count }, (_, field) => ({ scope: bindingScope, field })),
  ];
  return {
    inputs,
    operations,
    f32InputCount: 7 + (inverseFontSize ? 1 : 0) + bindingF32Count,
    u32InputCount: bindingU32Count + 1,
    loadF32(count) {
      for (let field = 0; field < count; field += 1) {
        operations.push({ opcode: textShaperAbi.policy.opcodes.loadF32, target: field, operand0: field });
      }
    },
    loadU32(target, field) {
      operations.push({ opcode: textShaperAbi.policy.opcodes.loadU32, target, operand0: field });
    },
    binary(name, target, left, right) {
      operations.push({ opcode: textShaperAbi.policy.opcodes[name], target, operand0: left, operand1: right });
    },
    constantF32(target, value) {
      operations.push({ opcode: textShaperAbi.policy.opcodes.constantF32, target, immediate0: f32Bits(value) });
    },
    constantU32(target, value) {
      operations.push({ opcode: textShaperAbi.policy.opcodes.constantU32, target, immediate0: value });
    },
    storeF32(buffer, lane, register) {
      operations.push({
        opcode: textShaperAbi.policy.opcodes.storeF32,
        operand0: register,
        operand1: lane,
        immediate0: buffer,
      });
    },
    storeU32(buffer, lane, register) {
      operations.push({
        opcode: textShaperAbi.policy.opcodes.storeU32,
        operand0: register,
        operand1: lane,
        immediate0: buffer,
      });
    },
  };
}

function createProgram(
  techniqueId: number,
  programId: number,
  context: ProgramContext,
  buffers: readonly PolicyBuffer[],
): PolicyProgram {
  const batch = textShaperAbi.policy.batchFields;
  return {
    techniqueId,
    programId,
    f32InputCount: context.f32InputCount,
    u32InputCount: context.u32InputCount,
    inputs: context.inputs,
    buffers,
    operations: context.operations,
    storageKeyMask: batch.technique | batch.program | batch.resource,
    drawKeyMask:
      batch.technique | batch.program | batch.resource | batch.material | batch.clip | batch.depth | batch.order,
  };
}

function stores(
  write: (buffer: number, lane: number, register: number) => void,
  groups: readonly (readonly [number, readonly number[]])[],
): void {
  for (const [buffer, registers] of groups) {
    for (const [lane, register] of registers.entries()) write(buffer, lane, register);
  }
}

function floatBuffers(widths: readonly number[]): PolicyBuffer[] {
  return widths.map((vectorWidth, index) => ({
    id: index + 1,
    scalar: textShaperAbi.policy.scalarTypes.f32,
    vectorWidth,
  }));
}

function u32Buffers(widths: readonly number[], firstId: number): PolicyBuffer[] {
  return widths.map((vectorWidth, index) => ({
    id: firstId + index,
    scalar: textShaperAbi.policy.scalarTypes.u32,
    vectorWidth,
  }));
}

function transformIndexBuffer(): PolicyBuffer {
  return {
    id: FIRST_PARTY_TRANSFORM_BUFFER_ID,
    scalar: textShaperAbi.policy.scalarTypes.u32,
    vectorWidth: 1,
  };
}

function compilePolicy(descriptor: PolicyDescriptor): Uint8Array {
  const request = textShaperAbi.layouts.policyRequest;
  const capability = textShaperAbi.layouts.policyCapabilitySet;
  const programLayout = textShaperAbi.layouts.policyProgram;
  const bufferLayout = textShaperAbi.layouts.policyBuffer;
  const operationLayout = textShaperAbi.layouts.policyOperation;
  const inputLayout = textShaperAbi.layouts.policyInput;
  const programs = descriptor.programs;
  const bufferCount = sum(programs, (program) => program.buffers.length);
  const operationCount = sum(programs, (program) => program.operations.length);
  const inputCount = sum(programs, (program) => program.inputs.length);
  const capabilitiesOffset = align(request.size, capability.alignment);
  const programsOffset = align(
    checkedAdd(
      capabilitiesOffset,
      checkedProduct(capability.size, descriptor.capabilitySets.length, 'policy capabilities'),
      'policy programs',
    ),
    programLayout.alignment,
  );
  const buffersOffset = align(
    checkedAdd(
      programsOffset,
      checkedProduct(programLayout.size, programs.length, 'policy programs'),
      'policy buffers',
    ),
    bufferLayout.alignment,
  );
  const operationsOffset = align(
    checkedAdd(buffersOffset, checkedProduct(bufferLayout.size, bufferCount, 'policy buffers'), 'policy operations'),
    operationLayout.alignment,
  );
  const inputsOffset = align(
    checkedAdd(
      operationsOffset,
      checkedProduct(operationLayout.size, operationCount, 'policy operations'),
      'policy inputs',
    ),
    inputLayout.alignment,
  );
  const byteLength = checkedAdd(
    inputsOffset,
    checkedProduct(inputLayout.size, inputCount, 'policy inputs'),
    'policy bytes',
  );
  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(request.byteLength, bytes.byteLength, true);
  view.setUint32(request.capabilitySetsOffset, capabilitiesOffset, true);
  view.setUint32(request.capabilitySetCount, descriptor.capabilitySets.length, true);
  view.setUint32(request.programsOffset, programsOffset, true);
  view.setUint32(request.programCount, programs.length, true);
  view.setUint32(request.buffersOffset, buffersOffset, true);
  view.setUint32(request.bufferCount, bufferCount, true);
  view.setUint32(request.operationsOffset, operationsOffset, true);
  view.setUint32(request.operationCount, operationCount, true);
  view.setUint32(request.inputsOffset, inputsOffset, true);
  view.setUint32(request.inputCount, inputCount, true);

  for (const [index, value] of descriptor.capabilitySets.entries()) {
    const offset = capabilitiesOffset + index * capability.size;
    view.setUint32(offset + capability.id, value.id, true);
    view.setUint32(offset + capability.flags, value.flags, true);
    view.setUint32(offset + capability.maxBufferBytes, value.maxBufferBytes, true);
    view.setUint32(offset + capability.updateAlignment, value.updateAlignment, true);
    view.setUint32(offset + capability.coalesceGapBytes, value.coalesceGapBytes, true);
    view.setUint32(offset + capability.rangeCallPenaltyBytes, value.rangeCallPenaltyBytes, true);
    view.setUint16(offset + capability.maxBuffersPerDraw, value.maxBuffersPerDraw, true);
    view.setUint16(offset + capability.maxResourcesPerDraw, value.maxResourcesPerDraw, true);
    view.setUint16(offset + capability.maxIndirectDraws, value.maxIndirectDraws, true);
    view.setUint16(offset + capability.fragmentationBudget, value.fragmentationBudget, true);
    view.setUint16(offset + capability.wholeBufferThresholdBasisPoints, value.wholeBufferThresholdBasisPoints, true);
  }

  let bufferStart = 0;
  let operationStart = 0;
  let inputStart = 0;
  for (const [index, value] of programs.entries()) {
    const offset = programsOffset + index * programLayout.size;
    view.setUint32(offset + programLayout.techniqueId, value.techniqueId, true);
    view.setUint32(offset + programLayout.programId, value.programId, true);
    view.setUint32(offset + programLayout.capabilitySetId, value.capabilitySetId ?? 0, true);
    view.setUint32(offset + programLayout.resourceKindMask, value.resourceKindMask ?? 1, true);
    view.setUint32(offset + programLayout.semanticViewMask, value.semanticViewMask ?? 0, true);
    view.setUint32(offset + programLayout.storageKeyMask, value.storageKeyMask ?? 0, true);
    view.setUint32(offset + programLayout.drawKeyMask, value.drawKeyMask ?? 0, true);
    view.setUint32(offset + programLayout.paintCapabilities, value.paintCapabilities ?? 0, true);
    view.setUint32(offset + programLayout.compositingCapabilities, value.compositingCapabilities ?? 0, true);
    view.setUint32(offset + programLayout.bufferStart, bufferStart, true);
    view.setUint32(offset + programLayout.operationStart, operationStart, true);
    view.setUint16(offset + programLayout.variant, value.variant ?? 0, true);
    view.setUint16(offset + programLayout.bufferCount, value.buffers.length, true);
    view.setUint16(offset + programLayout.operationCount, value.operations.length, true);
    view.setUint16(
      offset + programLayout.allocationStrategy,
      value.allocationStrategy ?? textShaperAbi.policy.allocationStrategies.orderedDirect,
      true,
    );
    view.setUint8(offset + programLayout.f32InputCount, value.f32InputCount);
    view.setUint8(offset + programLayout.u32InputCount, value.u32InputCount);
    view.setUint32(offset + programLayout.inputStart, inputStart, true);
    view.setUint16(offset + programLayout.inputCount, value.inputs.length, true);
    bufferStart += value.buffers.length;
    operationStart += value.operations.length;
    inputStart += value.inputs.length;
  }

  let bufferIndex = 0;
  let operationIndex = 0;
  let inputIndex = 0;
  for (const value of programs) {
    for (const buffer of value.buffers) {
      const offset = buffersOffset + bufferIndex * bufferLayout.size;
      const scalarBytes = buffer.scalar === textShaperAbi.policy.scalarTypes.u16 ? 2 : 4;
      view.setUint16(offset + bufferLayout.id, buffer.id, true);
      view.setUint8(offset + bufferLayout.scalar, buffer.scalar);
      view.setUint8(offset + bufferLayout.vectorWidth, buffer.vectorWidth);
      view.setUint16(offset + bufferLayout.alignment, buffer.alignment ?? scalarBytes, true);
      view.setUint16(offset + bufferLayout.stride, buffer.stride ?? scalarBytes * buffer.vectorWidth, true);
      view.setUint32(
        offset + bufferLayout.usage,
        buffer.usage ?? textShaperAbi.policy.bufferUsage.storage | textShaperAbi.policy.bufferUsage.copyDst,
        true,
      );
      view.setUint16(offset + bufferLayout.capacityClass, buffer.capacityClass ?? 1, true);
      bufferIndex += 1;
    }
    for (const operation of value.operations) {
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
    for (const input of value.inputs) {
      const offset = inputsOffset + inputIndex * inputLayout.size;
      view.setUint8(offset + inputLayout.scope, textShaperAbi.policy.inputScopes[input.scope]);
      view.setUint8(offset + inputLayout.field, input.field);
      inputIndex += 1;
    }
  }
  return bytes;
}

function sum<T>(values: readonly T[], measure: (value: T) => number): number {
  return values.reduce((total, value) => checkedAdd(total, measure(value), 'policy record count'), 0);
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function checkedAdd(left: number, right: number, label: string): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value > MAX_U32) throw new RangeError(`${label} exceeds u32`);
  return value;
}

function checkedProduct(left: number, right: number, label: string): number {
  const value = left * right;
  if (!Number.isSafeInteger(value) || value > MAX_U32) throw new RangeError(`${label} exceeds u32`);
  return value;
}

function f32Bits(value: number): number {
  const bytes = new ArrayBuffer(4);
  const view = new DataView(bytes);
  view.setFloat32(0, value, true);
  return view.getUint32(0, true);
}
