import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type { AnyRasterTechnique, RasterResourceId } from '../raster-technique.js';

const MAX_U32 = 0xffff_ffff;

// Engine-side policy limits mirrored from rust/shaper/src/engine/policy.rs.
const MAX_POLICY_CAPABILITY_SETS = 8;
const MAX_POLICY_PROGRAMS = 32;
const MAX_BUFFERS_PER_POLICY_PROGRAM = 16;
const MAX_OPERATIONS_PER_POLICY_PROGRAM = 128;
const MAX_POLICY_REGISTERS = 32;
const MAX_POLICY_VECTOR_WIDTH = 4;
const MAX_POLICY_ALIGNMENT = 256;
const MAX_WHOLE_BUFFER_THRESHOLD_BASIS_POINTS = 10_000;
// Wire register types from the shaper's straight-line operation validator.
const REGISTER_UNINITIALIZED = 0;
const REGISTER_F32 = 1;
const REGISTER_U32 = 2;

const encoder = new TextEncoder();

// Reused bit-level scratch for finite-constant checks; module scope avoids per-op allocation.
const f32Scratch = new DataView(new ArrayBuffer(4));

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
  readonly techniqueId: RenderTechniqueId;
  readonly programId: RenderProgramId;
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

declare const techniqueWireIdBrand: unique symbol;
declare const programWireIdBrand: unique symbol;
declare const resourceWireIdBrand: unique symbol;

export type RenderTechniqueId = number & { readonly [techniqueWireIdBrand]: true };
export type RenderProgramId = number & { readonly [programWireIdBrand]: true };
export type RenderResourceId = number & { readonly [resourceWireIdBrand]: true };

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

  idFor(id: string): number {
    const wireId = renderWireId(id);
    const collision = this.#strings.get(wireId);
    if (collision !== undefined && collision !== id) {
      throw new TypeError(`render wire identity collision between "${collision}" and "${id}"`);
    }
    this.#strings.set(wireId, id);
    return wireId;
  }

  techniqueId(technique: AnyRasterTechnique | string): RenderTechniqueId {
    return this.idFor(rasterTechniqueIdentity(technique)) as RenderTechniqueId;
  }

  programId(technique: AnyRasterTechnique | string, namespace: string, variant = 'default'): RenderProgramId {
    return this.idFor(programWireKey(technique, namespace, variant)) as RenderProgramId;
  }

  resourceId(resource: RasterResourceId): RenderResourceId {
    return this.idFor(resource) as RenderResourceId;
  }
}

/** Derive one pure technique ID from its portable identity. */
export function techniqueId(technique: AnyRasterTechnique | string): RenderTechniqueId {
  return renderWireId(rasterTechniqueIdentity(technique)) as RenderTechniqueId;
}

/** Derive one pure resource ID from its stable authored key. */
export function resourceId(resource: RasterResourceId): RenderResourceId {
  return renderWireId(resource) as RenderResourceId;
}

/** Derive one pure program ID without exposing its canonical wire key. */
export function programId(
  technique: AnyRasterTechnique | string,
  namespace: string,
  variant = 'default',
): RenderProgramId {
  return renderWireId(programWireKey(technique, namespace, variant)) as RenderProgramId;
}

function programWireKey(technique: AnyRasterTechnique | string, namespace: string, variant: string): string {
  if (typeof namespace !== 'string' || namespace.length === 0) {
    throw new TypeError('render program namespace must be a nonempty string');
  }
  if (typeof variant !== 'string' || variant.length === 0) {
    throw new TypeError('render program variant must be a nonempty string');
  }
  return JSON.stringify(['glyph-program-v1', rasterTechniqueIdentity(technique), namespace, variant]);
}

function rasterTechniqueIdentity(technique: AnyRasterTechnique | string): string {
  const id = typeof technique === 'string' ? technique : technique?.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('render technique identity must be a nonempty string');
  }
  return id;
}

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

export interface ProgramBody {
  readonly inputs: PolicyInput[];
  readonly operations: PolicyOperation[];
  readonly f32InputCount: number;
  readonly u32InputCount: number;
}

export function createProgram(
  wireTechniqueId: RenderTechniqueId,
  wireProgramId: RenderProgramId,
  context: ProgramBody,
  buffers: readonly PolicyBuffer[],
  transformMode: PolicyTransformMode,
  allocationMode: PolicyAllocationMode,
): PolicyProgram {
  nonzeroU32(wireTechniqueId, 'policy technique id');
  nonzeroU32(wireProgramId, 'policy program id');
  if (!isNonArrayObject(context)) throw new TypeError('policy program body needs an object');
  if (!Array.isArray(context.inputs) || !Array.isArray(context.operations)) {
    throw new TypeError('policy program body needs input and operation arrays');
  }
  if (!Array.isArray(buffers)) throw new TypeError('policy program buffers need an array');
  if (transformMode !== 'direct' && transformMode !== 'indexed') {
    throw new TypeError('policy transform mode must be "direct" or "indexed"');
  }
  if (allocationMode !== 'ordered' && allocationMode !== 'stable') {
    throw new TypeError('policy allocation mode must be "ordered" or "stable"');
  }
  const inputs = Object.freeze(
    context.inputs.map((input, index) => {
      if (!isNonArrayObject(input)) throw new TypeError(`policy program input ${index} needs an object`);
      return Object.freeze({ scope: input.scope, field: input.field });
    }),
  );
  const operations = Object.freeze(
    context.operations.map((operation, index) => {
      if (!isNonArrayObject(operation)) throw new TypeError(`policy program operation ${index} needs an object`);
      return Object.freeze({
        opcode: operation.opcode,
        ...(operation.target === undefined ? {} : { target: operation.target }),
        ...(operation.operand0 === undefined ? {} : { operand0: operation.operand0 }),
        ...(operation.operand1 === undefined ? {} : { operand1: operation.operand1 }),
        ...(operation.immediate0 === undefined ? {} : { immediate0: operation.immediate0 }),
        ...(operation.immediate1 === undefined ? {} : { immediate1: operation.immediate1 }),
        ...(operation.immediate2 === undefined ? {} : { immediate2: operation.immediate2 }),
      });
    }),
  );
  const bufferSnapshots = Object.freeze(
    buffers.map((buffer, index) => {
      if (!isNonArrayObject(buffer)) throw new TypeError(`policy program buffer ${index} needs an object`);
      const source = buffer as unknown as PolicyBuffer;
      return Object.freeze({
        id: source.id,
        scalar: source.scalar,
        vectorWidth: source.vectorWidth,
        ...(source.alignment === undefined ? {} : { alignment: source.alignment }),
        ...(source.stride === undefined ? {} : { stride: source.stride }),
        ...(source.usage === undefined ? {} : { usage: source.usage }),
        ...(source.capacityClass === undefined ? {} : { capacityClass: source.capacityClass }),
      });
    }),
  );
  const batch = textShaperAbi.policy.batchFields;
  return Object.freeze({
    techniqueId: wireTechniqueId,
    programId: wireProgramId,
    f32InputCount: context.f32InputCount,
    u32InputCount: context.u32InputCount,
    inputs,
    buffers: bufferSnapshots,
    operations,
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
  });
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
  assertPolicyDescriptorShape(descriptor);
  const request = textShaperAbi.layouts.policyRequest;
  const capability = textShaperAbi.layouts.policyCapabilitySet;
  const programLayout = textShaperAbi.layouts.policyProgram;
  const bufferLayout = textShaperAbi.layouts.policyBuffer;
  const operationLayout = textShaperAbi.layouts.policyOperation;
  const inputLayout = textShaperAbi.layouts.policyInput;
  const programs = descriptor.programs;

  // Call-boundary preflight mirroring the shaper's validate_policy: every serialized
  // value and engine semantic rule is proven before the output allocation exists.
  if (descriptor.capabilitySets.length === 0) {
    throw new RangeError('policy declares no capability sets');
  }
  if (descriptor.capabilitySets.length > MAX_POLICY_CAPABILITY_SETS) {
    throw new RangeError(`policy declares more than ${MAX_POLICY_CAPABILITY_SETS} capability sets`);
  }
  const capabilityIds = new Set<number>();
  for (const [index, set] of descriptor.capabilitySets.entries()) {
    preflightCapabilitySet(set, `policy capability set ${index}`);
    if (capabilityIds.has(set.id)) throw new TypeError(`policy repeats capability set id ${set.id}`);
    capabilityIds.add(set.id);
  }

  if (programs.length === 0) throw new RangeError('policy declares no programs');
  if (programs.length > MAX_POLICY_PROGRAMS) {
    throw new RangeError(`policy declares more than ${MAX_POLICY_PROGRAMS} programs`);
  }
  const programIds = new Set<number>();
  const variants = new Set<string>();
  for (const program of programs) {
    nonzeroU32(program.techniqueId, 'policy technique id');
    nonzeroU32(program.programId, 'policy program id');
    const programLabel = `policy program ${program.programId}`;
    // Numeric domains first so the semantic rules below never judge unproven values.
    if (program.capabilitySetId !== undefined) {
      u32(program.capabilitySetId, `${programLabel} capability set id`);
    }
    if (program.resourceKindMask !== undefined) u32(program.resourceKindMask, `${programLabel} resourceKindMask`);
    if (program.semanticViewMask !== undefined) u32(program.semanticViewMask, `${programLabel} semanticViewMask`);
    if (program.storageKeyMask !== undefined) u32(program.storageKeyMask, `${programLabel} storageKeyMask`);
    if (program.drawKeyMask !== undefined) u32(program.drawKeyMask, `${programLabel} drawKeyMask`);
    if (program.paintCapabilities !== undefined) {
      u32(program.paintCapabilities, `${programLabel} paintCapabilities`);
    }
    if (program.compositingCapabilities !== undefined) {
      u32(program.compositingCapabilities, `${programLabel} compositingCapabilities`);
    }
    if (program.allocationStrategy !== undefined) {
      u16(program.allocationStrategy, `${programLabel} allocationStrategy`);
    }
    if (program.primitiveKind !== undefined) u16(program.primitiveKind, `${programLabel} primitiveKind`);
    const variant = u16(program.variant ?? 0, 'policy program variant');
    u8(program.f32InputCount, `${programLabel} f32 input count`);
    u8(program.u32InputCount, `${programLabel} u32 input count`);

    u16(program.buffers.length, `${programLabel} buffer count`);
    const bufferIds = new Set<number>();
    for (const [index, buffer] of program.buffers.entries()) {
      const bufferLabel = `policy program ${program.programId} buffer ${index}`;
      const id = u16(buffer.id, `${bufferLabel} id`);
      if (bufferIds.has(id)) throw new TypeError(`policy repeats buffer id ${id} within a program`);
      bufferIds.add(id);
      u8(buffer.scalar, `${bufferLabel} scalar`);
      u8(buffer.vectorWidth, `${bufferLabel} vectorWidth`);
      if (buffer.alignment !== undefined) u16(buffer.alignment, `${bufferLabel} alignment`);
      if (buffer.stride !== undefined) u16(buffer.stride, `${bufferLabel} stride`);
      if (buffer.usage !== undefined) u32(buffer.usage, `${bufferLabel} usage`);
      if (buffer.capacityClass !== undefined) u16(buffer.capacityClass, `${bufferLabel} capacityClass`);
    }

    u16(program.operations.length, `${programLabel} operation count`);
    for (const [index, operation] of program.operations.entries()) {
      const operationLabel = `policy program ${program.programId} operation ${index}`;
      u8(operation.opcode, `${operationLabel} opcode`);
      if (operation.target !== undefined) u8(operation.target, `${operationLabel} target`);
      if (operation.operand0 !== undefined) u8(operation.operand0, `${operationLabel} operand0`);
      if (operation.operand1 !== undefined) u8(operation.operand1, `${operationLabel} operand1`);
      if (operation.immediate0 !== undefined) u32(operation.immediate0, `${operationLabel} immediate0`);
      if (operation.immediate1 !== undefined) u32(operation.immediate1, `${operationLabel} immediate1`);
      if (operation.immediate2 !== undefined) u32(operation.immediate2, `${operationLabel} immediate2`);
    }

    u16(program.inputs.length, `${programLabel} input count`);
    for (const [index, input] of program.inputs.entries()) {
      const inputLabel = `policy program ${program.programId} input ${index}`;
      // Object.hasOwn keeps inherited keys like "toString" out of the ABI table lookup.
      if (!(typeof input.scope === 'string' && Object.hasOwn(textShaperAbi.policy.inputScopes, input.scope))) {
        throw new TypeError(`${inputLabel} scope ${JSON.stringify(input.scope)} is not a policy input scope`);
      }
      u8(input.field, `${inputLabel} field`);
    }

    // Semantic rules, judged only after every numeric domain above held.
    const effectiveCapabilitySetId = program.capabilitySetId ?? 0;
    if (effectiveCapabilitySetId !== 0 && !capabilityIds.has(effectiveCapabilitySetId)) {
      throw new TypeError(`${programLabel} references undeclared capability set ${effectiveCapabilitySetId}`);
    }
    preflightProgramSemantics(program, descriptor.capabilitySets);
    if (programIds.has(program.programId)) throw new TypeError(`policy repeats program id ${program.programId}`);
    programIds.add(program.programId);
    const key = `${effectiveCapabilitySetId}:${program.techniqueId}:${variant}`;
    if (variants.has(key)) throw new TypeError('policy repeats a technique, capability set, and program variant');
    variants.add(key);
  }

  // Every declared capability set must be reachable by some program; a wildcard
  // (unset) program reference covers all of them.
  for (const set of descriptor.capabilitySets) {
    const referenced = programs.some((program) => {
      const id = program.capabilitySetId ?? 0;
      return id === 0 || id === set.id;
    });
    if (!referenced) {
      throw new TypeError(`policy capability set ${set.id} is declared but referenced by no program`);
    }
  }

  const bufferCount = sum(programs, (program) => program.buffers.length);
  const operationCount = sum(programs, (program) => program.operations.length);
  const inputCount = sum(programs, (program) => program.inputs.length);
  const capabilitiesOffset = align(request.size, capability.alignment, 'policy capability sets');
  const programsOffset = align(
    checkedAdd(
      capabilitiesOffset,
      checkedProduct(capability.size, descriptor.capabilitySets.length, 'policy capabilities'),
      'policy programs',
    ),
    programLayout.alignment,
    'policy programs',
  );
  const buffersOffset = align(
    checkedAdd(
      programsOffset,
      checkedProduct(programLayout.size, programs.length, 'policy programs'),
      'policy buffers',
    ),
    bufferLayout.alignment,
    'policy buffers',
  );
  const operationsOffset = align(
    checkedAdd(buffersOffset, checkedProduct(bufferLayout.size, bufferCount, 'policy buffers'), 'policy operations'),
    operationLayout.alignment,
    'policy operations',
  );
  const inputsOffset = align(
    checkedAdd(
      operationsOffset,
      checkedProduct(operationLayout.size, operationCount, 'policy operations'),
      'policy inputs',
    ),
    inputLayout.alignment,
    'policy inputs',
  );
  const byteLength = checkedAdd(
    inputsOffset,
    checkedProduct(inputLayout.size, inputCount, 'policy inputs'),
    'policy bytes',
  );

  interface PlannedProgram {
    readonly value: PolicyProgram;
    readonly bufferStart: number;
    readonly operationStart: number;
    readonly inputStart: number;
  }

  // Per-program record starts accumulate across programs; each step is proven to
  // stay inside the u32 domain even though its total was already bounded above.
  let bufferStart = 0;
  let operationStart = 0;
  let inputStart = 0;
  const plans: PlannedProgram[] = programs.map((value) => {
    const plan = { value, bufferStart, operationStart, inputStart };
    bufferStart = checkedAdd(bufferStart, value.buffers.length, 'policy buffer start');
    operationStart = checkedAdd(operationStart, value.operations.length, 'policy operation start');
    inputStart = checkedAdd(inputStart, value.inputs.length, 'policy input start');
    return plan;
  });

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

  for (const [index, planned] of plans.entries()) {
    const value = planned.value;
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
    view.setUint32(offset + programLayout.bufferStart, planned.bufferStart, true);
    view.setUint32(offset + programLayout.operationStart, planned.operationStart, true);
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
    view.setUint32(offset + programLayout.inputStart, planned.inputStart, true);
    view.setUint16(offset + programLayout.inputCount, value.inputs.length, true);
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

function assertPolicyDescriptorShape(value: unknown): asserts value is PolicyDescriptor {
  if (!isNonArrayObject(value)) throw new TypeError('policy descriptor needs an object');
  if (!Array.isArray(value.capabilitySets)) throw new TypeError('policy descriptor capabilitySets needs an array');
  if (!Array.isArray(value.programs)) throw new TypeError('policy descriptor programs needs an array');
  for (const [index, set] of value.capabilitySets.entries()) {
    if (!isNonArrayObject(set)) throw new TypeError(`policy capability set ${index} needs an object`);
  }
  for (const [programIndex, program] of value.programs.entries()) {
    if (!isNonArrayObject(program)) throw new TypeError(`policy program ${programIndex} needs an object`);
    const inputs = program.inputs;
    const buffers = program.buffers;
    const operations = program.operations;
    if (!Array.isArray(inputs)) throw new TypeError(`policy program ${programIndex} inputs needs an array`);
    if (!Array.isArray(buffers)) throw new TypeError(`policy program ${programIndex} buffers needs an array`);
    if (!Array.isArray(operations)) throw new TypeError(`policy program ${programIndex} operations needs an array`);
    for (const [index, input] of inputs.entries()) {
      if (!isNonArrayObject(input))
        throw new TypeError(`policy program ${programIndex} input ${index} needs an object`);
    }
    for (const [index, buffer] of buffers.entries()) {
      if (!isNonArrayObject(buffer)) {
        throw new TypeError(`policy program ${programIndex} buffer ${index} needs an object`);
      }
    }
    for (const [index, operation] of operations.entries()) {
      if (!isNonArrayObject(operation)) {
        throw new TypeError(`policy program ${programIndex} operation ${index} needs an object`);
      }
    }
  }
}

function nonzeroU32(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 0xffff_ffff)
    throw new RangeError(`${label} needs a nonzero u32`);
  return value;
}

/** @internal Validate and snapshot one host capability set before invoking technique code. */
export function normalizePolicyCapabilitySet(value: unknown, label = 'policy capability set'): PolicyCapabilitySet {
  if (!isNonArrayObject(value)) throw new TypeError(`${label} needs an object`);
  const snapshot: PolicyCapabilitySet = Object.freeze({
    id: value.id,
    flags: value.flags,
    maxBufferBytes: value.maxBufferBytes,
    updateAlignment: value.updateAlignment,
    coalesceGapBytes: value.coalesceGapBytes,
    rangeCallPenaltyBytes: value.rangeCallPenaltyBytes,
    maxBuffersPerDraw: value.maxBuffersPerDraw,
    maxResourcesPerDraw: value.maxResourcesPerDraw,
    maxIndirectDraws: value.maxIndirectDraws,
    fragmentationBudget: value.fragmentationBudget,
    wholeBufferThresholdBasisPoints: value.wholeBufferThresholdBasisPoints,
  }) as PolicyCapabilitySet;
  preflightCapabilitySet(snapshot, label);
  return snapshot;
}

/** Capability-set contract mirrored from validate_capability_sets. */
function preflightCapabilitySet(set: PolicyCapabilitySet, label: string): void {
  nonzeroU32(set.id, `${label} id`);
  u32(set.flags, `${label} flags`);
  u32(set.maxBufferBytes, `${label} maxBufferBytes`);
  u32(set.updateAlignment, `${label} updateAlignment`);
  u32(set.coalesceGapBytes, `${label} coalesceGapBytes`);
  u32(set.rangeCallPenaltyBytes, `${label} rangeCallPenaltyBytes`);
  u16(set.maxBuffersPerDraw, `${label} maxBuffersPerDraw`);
  u16(set.maxResourcesPerDraw, `${label} maxResourcesPerDraw`);
  u16(set.maxIndirectDraws, `${label} maxIndirectDraws`);
  u16(set.fragmentationBudget, `${label} fragmentationBudget`);
  u16(set.wholeBufferThresholdBasisPoints, `${label} wholeBufferThresholdBasisPoints`);

  const { capabilityFlags } = textShaperAbi.policy;
  const knownFlags =
    capabilityFlags.storageBuffers |
    capabilityFlags.indirectDraws |
    capabilityFlags.aliasVec2 |
    capabilityFlags.aliasVec4 |
    capabilityFlags.orderedDirect |
    capabilityFlags.stableIndirect;
  const allocationSupport = capabilityFlags.orderedDirect | capabilityFlags.stableIndirect;
  if ((set.flags & ~knownFlags) !== 0 || (set.flags & allocationSupport) === 0) {
    throw new RangeError(`${label} flags use unknown bits or support no allocation strategy`);
  }
  if (
    set.maxBufferBytes === 0 ||
    set.maxBuffersPerDraw === 0 ||
    set.maxBuffersPerDraw > MAX_BUFFERS_PER_POLICY_PROGRAM ||
    set.maxResourcesPerDraw === 0 ||
    set.fragmentationBudget === 0
  ) {
    throw new RangeError(
      `${label} limits need nonzero capacity within ${MAX_BUFFERS_PER_POLICY_PROGRAM} buffers per draw`,
    );
  }
  if (!isPowerOfTwo(set.updateAlignment) || set.updateAlignment > MAX_POLICY_ALIGNMENT) {
    throw new RangeError(`${label} updateAlignment needs a power of two up to ${MAX_POLICY_ALIGNMENT}`);
  }
  if (
    set.coalesceGapBytes > set.maxBufferBytes ||
    set.rangeCallPenaltyBytes > set.maxBufferBytes ||
    set.wholeBufferThresholdBasisPoints < 1 ||
    set.wholeBufferThresholdBasisPoints > MAX_WHOLE_BUFFER_THRESHOLD_BASIS_POINTS
  ) {
    throw new RangeError(`${label} upload cost model exceeds its own buffer budget`);
  }
  if (((set.flags & capabilityFlags.indirectDraws) === 0) !== (set.maxIndirectDraws === 0)) {
    throw new RangeError(`${label} must pair the indirect-draw flag with its indirect draw limit`);
  }
}

/** Program-level contract mirrored from validate_policy's per-program checks. */
function preflightProgramSemantics(program: PolicyProgram, capabilitySets: readonly PolicyCapabilitySet[]): void {
  const label = `policy program ${program.programId}`;
  const { batchFields, capabilityFlags, allocationStrategies } = textShaperAbi.policy;
  const { primitiveKinds } = textShaperAbi.engine;
  const primitiveKind = program.primitiveKind ?? primitiveKinds.glyph;
  if (primitiveKind !== primitiveKinds.glyph && primitiveKind !== primitiveKinds.decoration) {
    throw new RangeError(`${label} primitiveKind must publish glyph or decoration records`);
  }
  // Decoration programs draw without raster resources; every other kind must accept some.
  if ((program.resourceKindMask ?? 1) === 0 && primitiveKind !== primitiveKinds.decoration) {
    throw new RangeError(`${label} accepts no resource kinds but does not publish decoration records`);
  }

  const allBatchFields =
    batchFields.technique |
    batchFields.resource |
    batchFields.program |
    batchFields.material |
    batchFields.clip |
    batchFields.depth |
    batchFields.order |
    batchFields.transform;
  const storageKeyFields = allBatchFields & ~(batchFields.order | batchFields.transform);
  const requiredStorageKeys = batchFields.technique | batchFields.resource | batchFields.program;
  const requiredDrawKeys = requiredStorageKeys | batchFields.order;
  const storageKeyMask = program.storageKeyMask ?? 0;
  const drawKeyMask = program.drawKeyMask ?? 0;
  if (
    (storageKeyMask & ~storageKeyFields) !== 0 ||
    (storageKeyMask & requiredStorageKeys) !== requiredStorageKeys ||
    (drawKeyMask & ~allBatchFields) !== 0 ||
    (drawKeyMask & requiredDrawKeys) !== requiredDrawKeys
  ) {
    throw new RangeError(`${label} storage/draw key masks miss a required batch field or use an unknown one`);
  }

  const strategy = program.allocationStrategy ?? allocationStrategies.orderedDirect;
  if (strategy !== allocationStrategies.orderedDirect && strategy !== allocationStrategies.stableIndirect) {
    throw new RangeError(`${label} allocationStrategy is not a known strategy`);
  }
  const requiredCapability =
    strategy === allocationStrategies.orderedDirect ? capabilityFlags.orderedDirect : capabilityFlags.stableIndirect;

  preflightProgramBody(program);

  // A wildcard program (capability set id zero) draws against every declared set.
  const effectiveCapabilitySetId = program.capabilitySetId ?? 0;
  for (const [index, set] of capabilitySets.entries()) {
    if (
      (effectiveCapabilitySetId === 0 || effectiveCapabilitySetId === set.id) &&
      (set.flags & requiredCapability) === 0
    ) {
      throw new RangeError(`policy capability set ${index} lacks the allocation support ${label} needs`);
    }
  }
}

/** Buffer schemas, exact input counts, and the straight-line operation graph from validate_program. */
function preflightProgramBody(program: PolicyProgram): void {
  const label = `policy program ${program.programId}`;
  if (program.f32InputCount > MAX_POLICY_REGISTERS || program.u32InputCount > MAX_POLICY_REGISTERS) {
    throw new RangeError(`${label} input counts exceed the ${MAX_POLICY_REGISTERS}-slot register file`);
  }
  if (program.inputs.length !== program.f32InputCount + program.u32InputCount) {
    throw new TypeError(`${label} input table length must equal its declared f32 and u32 input counts`);
  }

  if (program.buffers.length === 0) throw new RangeError(`${label} declares no buffers`);
  if (program.buffers.length > MAX_BUFFERS_PER_POLICY_PROGRAM) {
    throw new RangeError(`${label} declares more than ${MAX_BUFFERS_PER_POLICY_PROGRAM} buffers`);
  }
  const { scalarTypes, bufferUsage } = textShaperAbi.policy;
  const knownUsages = bufferUsage.vertex | bufferUsage.storage | bufferUsage.copyDst;
  const byteWidths: ReadonlyMap<number, number> = new Map([
    [scalarTypes.f32, 4],
    [scalarTypes.u32, 4],
    [scalarTypes.u16, 2],
  ]);
  for (const [index, buffer] of program.buffers.entries()) {
    const bufferLabel = `${label} buffer ${index}`;
    const byteWidth = byteWidths.get(buffer.scalar);
    if (byteWidth === undefined) throw new RangeError(`${bufferLabel} scalar is not a known scalar type`);
    if (buffer.id === 0) throw new TypeError(`${bufferLabel} uses the reserved zero id`);
    if (buffer.vectorWidth < 1 || buffer.vectorWidth > MAX_POLICY_VECTOR_WIDTH) {
      throw new RangeError(`${bufferLabel} vectorWidth needs 1..${MAX_POLICY_VECTOR_WIDTH}`);
    }
    const alignment = buffer.alignment ?? byteWidth;
    if (!isPowerOfTwo(alignment) || alignment > MAX_POLICY_ALIGNMENT) {
      throw new RangeError(`${bufferLabel} alignment needs a power of two up to ${MAX_POLICY_ALIGNMENT}`);
    }
    const stride = buffer.stride ?? byteWidth * buffer.vectorWidth;
    if (stride < byteWidth * buffer.vectorWidth || stride % alignment !== 0) {
      throw new RangeError(`${bufferLabel} stride fits every lane and is a multiple of its alignment`);
    }
    const usage = buffer.usage ?? bufferUsage.storage | bufferUsage.copyDst;
    if (usage === 0 || (usage & ~knownUsages) !== 0 || (usage & bufferUsage.copyDst) === 0) {
      throw new RangeError(`${bufferLabel} usage needs copyDst and only known usage bits`);
    }
    if ((buffer.capacityClass ?? 1) === 0) throw new RangeError(`${bufferLabel} capacityClass needs a nonzero class`);
  }

  if (program.operations.length === 0) throw new RangeError(`${label} declares no operations`);
  if (program.operations.length > MAX_OPERATIONS_PER_POLICY_PROGRAM) {
    throw new RangeError(`${label} declares more than ${MAX_OPERATIONS_PER_POLICY_PROGRAM} operations`);
  }

  const registers = new Uint8Array(MAX_POLICY_REGISTERS);
  const storedLanes = new Map<number, number>();
  for (const [index, operation] of program.operations.entries()) {
    preflightOperation(operation, index, program, registers, storedLanes);
  }
  for (const buffer of program.buffers) {
    if ((storedLanes.get(buffer.id) ?? 0) !== (1 << buffer.vectorWidth) - 1) {
      throw new TypeError(`${label} leaves buffer ${buffer.id} lanes unwritten`);
    }
  }
}

function preflightOperation(
  operation: PolicyOperation,
  index: number,
  program: PolicyProgram,
  registers: Uint8Array,
  storedLanes: Map<number, number>,
): void {
  const label = `policy program ${program.programId} operation ${index}`;
  const { opcodes } = textShaperAbi.policy;
  switch (operation.opcode) {
    case opcodes.loadF32:
      if ((operation.operand0 ?? 0) >= program.f32InputCount) {
        throw new RangeError(`${label} loads an f32 input beyond the declared count`);
      }
      initializeRegister(registers, operation.target ?? 0, REGISTER_F32, label);
      return;
    case opcodes.loadU32:
      if ((operation.operand0 ?? 0) >= program.u32InputCount) {
        throw new RangeError(`${label} loads a u32 input beyond the declared count`);
      }
      initializeRegister(registers, operation.target ?? 0, REGISTER_U32, label);
      return;
    case opcodes.constantF32: {
      f32Scratch.setUint32(0, operation.immediate0 ?? 0, true);
      if (!Number.isFinite(f32Scratch.getFloat32(0, true))) {
        throw new RangeError(`${label} constant is not a finite f32`);
      }
      initializeRegister(registers, operation.target ?? 0, REGISTER_F32, label);
      return;
    }
    case opcodes.constantU32:
      initializeRegister(registers, operation.target ?? 0, REGISTER_U32, label);
      return;
    case opcodes.addF32:
    case opcodes.subtractF32:
    case opcodes.multiplyF32:
      requireRegister(registers, operation.operand0 ?? 0, REGISTER_F32, label);
      requireRegister(registers, operation.operand1 ?? 0, REGISTER_F32, label);
      initializeRegister(registers, operation.target ?? 0, REGISTER_F32, label);
      return;
    case opcodes.lessThanF32:
      requireRegister(registers, operation.operand0 ?? 0, REGISTER_F32, label);
      requireRegister(registers, operation.operand1 ?? 0, REGISTER_F32, label);
      initializeRegister(registers, operation.target ?? 0, REGISTER_U32, label);
      return;
    case opcodes.selectF32:
      requireRegister(registers, operation.operand0 ?? 0, REGISTER_U32, label);
      requireRegister(registers, operation.operand1 ?? 0, REGISTER_F32, label);
      requireRegister(registers, operation.immediate0 ?? 0, REGISTER_F32, label);
      initializeRegister(registers, operation.target ?? 0, REGISTER_F32, label);
      return;
    case opcodes.convertU32ToF32:
      requireRegister(registers, operation.operand0 ?? 0, REGISTER_U32, label);
      initializeRegister(registers, operation.target ?? 0, REGISTER_F32, label);
      return;
    case opcodes.storeF32:
    case opcodes.storeU32:
    case opcodes.storeU16: {
      const sourceType = operation.opcode === opcodes.storeF32 ? REGISTER_F32 : REGISTER_U32;
      requireRegister(registers, operation.operand0 ?? 0, sourceType, label);
      validateStore(operation, index, program, storedLanes);
      return;
    }
    default:
      throw new RangeError(`${label} opcode ${operation.opcode} is not a known policy opcode`);
  }
}

function validateStore(
  operation: PolicyOperation,
  index: number,
  program: PolicyProgram,
  storedLanes: Map<number, number>,
): void {
  const label = `policy program ${program.programId} operation ${index}`;
  const { opcodes, scalarTypes } = textShaperAbi.policy;
  const bufferId = operation.immediate0 ?? 0;
  const schema = program.buffers.find((candidate) => candidate.id === bufferId);
  if (schema === undefined) throw new TypeError(`${label} stores into undeclared buffer ${bufferId}`);
  const expectedScalar =
    operation.opcode === opcodes.storeF32
      ? scalarTypes.f32
      : operation.opcode === opcodes.storeU32
        ? scalarTypes.u32
        : scalarTypes.u16;
  if (schema.scalar !== expectedScalar) {
    throw new TypeError(`${label} stores ${expectedScalar} lanes into a ${schema.scalar} buffer`);
  }
  const lane = operation.operand1 ?? 0;
  if (lane >= schema.vectorWidth) throw new RangeError(`${label} lane exceeds the buffer width`);
  const mask = 1 << lane;
  if (((storedLanes.get(bufferId) ?? 0) & mask) !== 0) {
    throw new TypeError(`${label} writes buffer ${bufferId} lane ${lane} twice`);
  }
  storedLanes.set(bufferId, (storedLanes.get(bufferId) ?? 0) | mask);
}

function initializeRegister(registers: Uint8Array, target: number, type: number, label: string): void {
  if (target >= MAX_POLICY_REGISTERS) throw new RangeError(`${label} targets a register beyond the register file`);
  registers[target] = type;
}

function requireRegister(registers: Uint8Array, source: number, type: number, label: string): void {
  if (source >= MAX_POLICY_REGISTERS) throw new RangeError(`${label} reads a register beyond the register file`);
  const actual = registers[source];
  if (actual === REGISTER_UNINITIALIZED) throw new TypeError(`${label} reads register ${source} before it is written`);
  if (actual !== type) throw new TypeError(`${label} register ${source} holds the other wire type`);
}

function isPowerOfTwo(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

function u32(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_U32) throw new RangeError(`${label} needs a u32`);
  return value;
}

function u16(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) throw new RangeError(`${label} needs a u16`);
  return value;
}

function u8(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xff) throw new RangeError(`${label} needs a u8`);
  return value;
}

function sum<T>(values: readonly T[], measure: (value: T) => number): number {
  return values.reduce((total, value) => checkedAdd(total, measure(value), 'policy record count'), 0);
}

function align(value: number, alignment: number, label: string): number {
  if (!Number.isSafeInteger(alignment) || alignment < 1)
    throw new RangeError(`${label} needs a positive integer alignment`);
  const aligned = Math.ceil(value / alignment) * alignment;
  if (!Number.isSafeInteger(aligned) || aligned > MAX_U32) throw new RangeError(`${label} offset exceeds u32`);
  return aligned;
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

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
