import { textShaperAbi } from '../generated/text-shaper-abi.js';

const MAX_U32 = 0xffff_ffff;

const encoder = new TextEncoder();

export type PolicyInputScope = keyof typeof textShaperAbi.policy.inputScopes;

export interface PolicyInput {
  readonly scope: PolicyInputScope;
  readonly field: number;
}

export interface PolicyBuffer {
  readonly id: number;
  readonly scalar: number;
  readonly vectorWidth: number;
  readonly alignment?: number;
  readonly stride?: number;
  readonly usage?: number;
  readonly capacityClass?: number;
}

export interface PolicyOperation {
  readonly opcode: number;
  readonly target?: number;
  readonly operand0?: number;
  readonly operand1?: number;
  readonly immediate0?: number;
  readonly immediate1?: number;
  readonly immediate2?: number;
}

export interface PolicyProgram {
  readonly techniqueId: number;
  readonly programId: number;
  /** Plan primitive kind this program's records publish as; glyph when omitted. */
  readonly primitiveKind?: number;
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

export interface PolicyCapabilitySet {
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

export interface PolicyDescriptor {
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
  readonly decoration: number;
}

export const firstPartyTechniqueWireIds: FirstPartyTechniqueWireIds = Object.freeze({
  bitmap: renderWireId('pmndrs.bitmap'),
  msdf: renderWireId('pmndrs.msdf'),
  slug: renderWireId('pmndrs.slug'),
  decoration: renderWireId('pmndrs.decoration'),
});

export type PolicyTransformMode = 'direct' | 'indexed';
export type PolicyAllocationMode = 'ordered' | 'stable';

export interface ProgramContext {
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

export function programContext(
  bindingScope: PolicyInputScope,
  bindingF32Count: number,
  bindingU32Count: number,
  inverseFontSize = false,
): ProgramContext {
  const operations: PolicyOperation[] = [];
  const semantic = textShaperAbi.engine.semanticF32Fields;
  const semanticU32 = textShaperAbi.engine.semanticU32Fields;
  const inputs: PolicyInput[] = [
    { scope: 'semantic', field: semantic.inlineOrigin },
    { scope: 'semantic', field: semantic.blockOrigin },
    { scope: 'semantic', field: semantic.fontSize },
    { scope: 'semantic', field: semantic.foregroundRed },
    { scope: 'semantic', field: semantic.foregroundGreen },
    { scope: 'semantic', field: semantic.foregroundBlue },
    { scope: 'semantic', field: semantic.foregroundAlpha },
    ...(inverseFontSize ? [{ scope: 'semantic' as const, field: semantic.inverseFontSize }] : []),
    ...Array.from({ length: bindingF32Count }, (_, field) => ({ scope: bindingScope, field })),
    { scope: 'semantic', field: semanticU32.transformIndex },
    { scope: 'semantic', field: semanticU32.stableGlyphId },
    ...Array.from({ length: bindingU32Count }, (_, field) => ({ scope: bindingScope, field })),
  ];
  return {
    inputs,
    operations,
    f32InputCount: 7 + (inverseFontSize ? 1 : 0) + bindingF32Count,
    u32InputCount: bindingU32Count + 2,
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

export function createProgram(
  techniqueId: number,
  programId: number,
  context: ProgramContext,
  buffers: readonly PolicyBuffer[],
  transformMode: PolicyTransformMode,
  allocationMode: PolicyAllocationMode,
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
    allocationStrategy:
      allocationMode === 'stable'
        ? textShaperAbi.policy.allocationStrategies.stableIndirect
        : textShaperAbi.policy.allocationStrategies.orderedDirect,
    storageKeyMask: batch.technique | batch.program | batch.resource,
    drawKeyMask:
      batch.technique |
      batch.program |
      batch.resource |
      batch.material |
      batch.clip |
      batch.depth |
      batch.order |
      (transformMode === 'direct' ? batch.transform : 0),
  };
}

export function stores(
  write: (buffer: number, lane: number, register: number) => void,
  groups: readonly (readonly [number, readonly number[]])[],
): void {
  for (const [buffer, registers] of groups) {
    for (const [lane, register] of registers.entries()) write(buffer, lane, register);
  }
}

export function floatBuffers(widths: readonly number[]): PolicyBuffer[] {
  return widths.map((vectorWidth, index) => ({
    id: index + 1,
    scalar: textShaperAbi.policy.scalarTypes.f32,
    vectorWidth,
  }));
}

export function u32Buffers(widths: readonly number[], firstId: number): PolicyBuffer[] {
  return widths.map((vectorWidth, index) => ({
    id: firstId + index,
    scalar: textShaperAbi.policy.scalarTypes.u32,
    vectorWidth,
  }));
}

export function compileRenderPolicy(descriptor: PolicyDescriptor): Uint8Array {
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
    view.setUint16(
      offset + programLayout.primitiveKind,
      value.primitiveKind ?? textShaperAbi.engine.primitiveKinds.glyph,
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
