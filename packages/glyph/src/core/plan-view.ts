import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type { PlanPublication } from './backend.js';
import type {
  MaterialHandle,
  PolicyBufferId,
  RenderProgramId,
  RenderTechniqueId,
  ResourceHandle,
} from './render-policy.js';

/** Byte span, record count, and fixed stride for one validated plan table. */
export interface RenderPlanTable {
  readonly offset: number;
  readonly count: number;
  readonly stride: number;
}

/** Minimal bounds-checked reader accepted by the semantic record decoders. */
export interface RenderPlanReader {
  record(table: RenderPlanTable, index: number): number;
  u8(offset: number): number;
  u16(offset: number): number;
  u32(offset: number): number;
  f32(offset: number): number;
  bytes(offset: number, byteLength: number): Uint8Array;
}

type TableName = 'resources' | 'buffers' | 'patches' | 'primitives' | 'draws' | 'retirements' | 'diagnostics';

const resultLayout = textShaperAbi.layouts.engineResult;
const tableLayouts = {
  resources: {
    offset: resultLayout.resourcesOffset,
    count: resultLayout.resourceCount,
    record: textShaperAbi.layouts.engineResource,
  },
  buffers: {
    offset: resultLayout.buffersOffset,
    count: resultLayout.bufferCount,
    record: textShaperAbi.layouts.engineBuffer,
  },
  patches: {
    offset: resultLayout.patchesOffset,
    count: resultLayout.patchCount,
    record: textShaperAbi.layouts.enginePatch,
  },
  primitives: {
    offset: resultLayout.primitivesOffset,
    count: resultLayout.primitiveCount,
    record: textShaperAbi.layouts.enginePrimitive,
  },
  draws: { offset: resultLayout.drawsOffset, count: resultLayout.drawCount, record: textShaperAbi.layouts.engineDraw },
  retirements: {
    offset: resultLayout.retirementsOffset,
    count: resultLayout.retirementCount,
    record: textShaperAbi.layouts.engineRetirement,
  },
  diagnostics: {
    offset: resultLayout.diagnosticsOffset,
    count: resultLayout.diagnosticCount,
    record: textShaperAbi.layouts.engineDiagnostic,
  },
} as const;

/** Reusable zero-copy reader over one validated Rust render-plan publication. */
export class TextEngineRenderPlanView {
  #memoryBuffer: ArrayBufferLike | undefined;
  #view: DataView | undefined;
  #baseOffset = 0;
  #byteLength = 0;

  /** @internal Raw Wasm publications are consumed only by the retained plan. */
  bind(publication: PlanPublication): this {
    const bytes = publication.bytes;
    if (bytes.buffer !== publication.memoryBuffer) {
      throw new TypeError('text-engine publication bytes do not belong to the reported Wasm memory');
    }
    return this.#bindValidated(bytes);
  }

  /** Binds copied plan bytes received across a realm boundary after validating their complete table framing. */
  bindBytes(bytes: Uint8Array<ArrayBuffer>): this {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('text-engine plan bytes must be a Uint8Array');
    if (bytes.byteOffset !== 0 || bytes.byteLength !== bytes.buffer.byteLength) {
      throw new TypeError('text-engine plan bytes must span their complete standalone ArrayBuffer');
    }
    return this.#bindValidated(bytes);
  }

  #bindValidated(bytes: Uint8Array<ArrayBufferLike>): this {
    const view = this.#memoryBuffer === bytes.buffer ? this.#view! : new DataView(bytes.buffer);
    validateResultBytes(bytes, view);
    if (this.#memoryBuffer !== bytes.buffer) {
      this.#memoryBuffer = bytes.buffer;
      this.#view = view;
    }
    this.#baseOffset = bytes.byteOffset;
    this.#byteLength = bytes.byteLength;
    return this;
  }

  /** Resolves one validated table descriptor by semantic name. */
  table(name: TableName): RenderPlanTable {
    const layout = tableLayouts[name];
    const offset = this.u32(layout.offset);
    const count = this.u32(layout.count);
    if (count === 0) {
      if (offset !== 0) throw new RangeError(`empty text-engine ${name} table has a nonzero offset`);
      return { offset: 0, count: 0, stride: layout.record.size };
    }
    if (offset % layout.record.alignment !== 0) throw new RangeError(`text-engine ${name} table is misaligned`);
    const byteLength = checkedProduct(count, layout.record.size, `${name} table`);
    if (offset < resultLayout.size || offset + byteLength > this.#byteLength) {
      throw new RangeError(`text-engine ${name} table is outside the publication`);
    }
    return { offset, count, stride: layout.record.size };
  }

  /** Resolves one bounds-checked record offset within a table. */
  record(table: RenderPlanTable, index: number): number {
    if (!Number.isSafeInteger(index) || index < 0 || index >= table.count) {
      throw new RangeError('text-engine render-plan record index is outside its table');
    }
    return table.offset + index * table.stride;
  }

  /** Reads one bounds-checked unsigned byte. */
  u8(offset: number): number {
    this.#assertRange(offset, 1);
    return this.#view!.getUint8(this.#baseOffset + offset);
  }

  /** Reads one bounds-checked little-endian unsigned 16-bit value. */
  u16(offset: number): number {
    this.#assertRange(offset, 2);
    return this.#view!.getUint16(this.#baseOffset + offset, true);
  }

  /** Reads one bounds-checked little-endian unsigned 32-bit value. */
  u32(offset: number): number {
    this.#assertRange(offset, 4);
    return this.#view!.getUint32(this.#baseOffset + offset, true);
  }

  /** Reads one bounds-checked little-endian 32-bit float. */
  f32(offset: number): number {
    this.#assertRange(offset, 4);
    return this.#view!.getFloat32(this.#baseOffset + offset, true);
  }

  /** Borrows one bounds-checked byte span from the bound publication. */
  bytes(offset: number, byteLength: number): Uint8Array {
    this.#assertRange(offset, byteLength);
    return new Uint8Array(this.#memoryBuffer!, this.#baseOffset + offset, byteLength);
  }

  #assertRange(offset: number, byteLength: number): void {
    if (
      this.#view === undefined ||
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(byteLength) ||
      offset < 0 ||
      byteLength < 0 ||
      offset + byteLength > this.#byteLength
    ) {
      throw new RangeError('text-engine render-plan read is outside the publication');
    }
  }
}

function checkedProduct(left: number, right: number, label: string): number {
  const value = left * right;
  if (!Number.isSafeInteger(value))
    throw new RangeError(`${label} byte length exceeds JavaScript's safe integer range`);
  return value;
}

interface ResultTableLayout {
  readonly offset: number;
  readonly count: number;
  readonly record: { readonly size: number; readonly alignment: number };
}

function validateResultBytes(bytes: Uint8Array<ArrayBufferLike>, view: DataView): void {
  if (bytes.byteLength < resultLayout.size) {
    throw new RangeError('text-engine publication header has an invalid byte length');
  }
  const u32 = (offset: number): number => view.getUint32(bytes.byteOffset + offset, true);
  if (u32(resultLayout.byteLength) !== bytes.byteLength) {
    throw new RangeError('text-engine publication header has an invalid byte length');
  }
  if (u32(resultLayout.abiVersion) !== textShaperAbi.version) {
    throw new RangeError('text-engine publication has an unsupported ABI version');
  }
  if (u32(resultLayout.status) !== textShaperAbi.status.ok) {
    throw new RangeError('text-engine publication does not contain a successful result');
  }
  for (const name of Object.keys(tableLayouts) as TableName[]) {
    validateResultTable(u32, bytes.byteLength, name, tableLayouts[name]);
  }
  validateResultTable(u32, bytes.byteLength, 'semantic views', {
    offset: resultLayout.semanticViewsOffset,
    count: resultLayout.semanticViewCount,
    record: textShaperAbi.layouts.engineSemanticView,
  });
}

function validateResultTable(
  u32: (offset: number) => number,
  resultByteLength: number,
  name: string,
  layout: ResultTableLayout,
): void {
  const offset = u32(layout.offset);
  const count = u32(layout.count);
  if (count === 0) {
    if (offset !== 0) throw new RangeError(`empty text-engine ${name} table has a nonzero offset`);
    return;
  }
  if (offset % layout.record.alignment !== 0) throw new RangeError(`text-engine ${name} table is misaligned`);
  const byteLength = checkedProduct(count, layout.record.size, `${name} table`);
  if (offset < resultLayout.size || offset + byteLength > resultByteLength) {
    throw new RangeError(`text-engine ${name} table is outside the publication`);
  }
}

declare const renderPlanIdentityBrand: unique symbol;

/** Engine-owned storage identity. Applications and policy authors never construct one. */
export type RenderPlanBufferId = number & { readonly [renderPlanIdentityBrand]: 'buffer' };
/** Engine-owned retained-resource identity. Applications and policy authors never construct one. */
export type RenderPlanResourceId = number & { readonly [renderPlanIdentityBrand]: 'resource' };
/** Engine-owned primitive identity. Applications and policy authors never construct one. */
export type RenderPlanPrimitiveId = number & { readonly [renderPlanIdentityBrand]: 'primitive' };
/** Engine-owned draw identity. Applications and policy authors never construct one. */
export type RenderPlanDrawId = number & { readonly [renderPlanIdentityBrand]: 'draw' };
/** Engine-owned clipping identity. Zero means no clip. */
export type RenderPlanClipId = number & { readonly [renderPlanIdentityBrand]: 'clip' };
/** Engine-owned semantic-record identity. Zero means the primitive spans multiple semantics. */
export type RenderPlanSemanticId = number & { readonly [renderPlanIdentityBrand]: 'semantic' };
/** Host-bound transform identity carried by a render plan. Zero selects indexed transforms. */
export type RenderPlanTransformId = number & { readonly [renderPlanIdentityBrand]: 'transform' };

/** Scalar storage type declared for one renderer buffer. */
export type TextEngineScalarType = 'f32' | 'u32' | 'u16';
/** Semantic role of one plan primitive. */
export type TextEnginePrimitiveKind = 'glyph' | 'decoration' | 'inline-object' | 'clip' | 'policy';
/** Lifecycle action for one portable resource record. */
export type TextEngineResourceAction = 'create' | 'update' | 'retain';
/** Storage class released by one retirement record. */
export type TextEngineRetirementKind = 'resource' | 'buffer' | 'slot-range' | 'output-bytes';

interface TextEnginePatchBase {
  readonly bufferId: RenderPlanBufferId;
  /** Storage is keyed by `(id, generation)`: a changed generation is new storage. */
  readonly bufferGeneration: number;
  readonly destinationOffset: number;
  readonly byteLength: number;
}

/** Ensures retained renderer storage has at least the declared generation and size. */
export interface TextEngineAllocatePatch extends TextEnginePatchBase {
  readonly kind: 'allocate-or-resize';
}

/** Writes publication bytes into retained renderer storage. */
export interface TextEngineWritePatch extends TextEnginePatchBase {
  readonly kind: 'write';
  /**
   * Borrowed view of the payload region for `write` patches. It expires with the
   * publication it came from — copy it, or retain the whole publication first.
   */
  readonly payload: Uint8Array;
}

/** Fills a retained renderer-storage byte range with one value. */
export interface TextEngineFillPatch extends TextEnginePatchBase {
  readonly kind: 'fill';
  readonly fillValue: number;
}

/** Copies bytes between retained renderer buffers. */
export interface TextEngineCopyPatch extends TextEnginePatchBase {
  readonly kind: 'copy';
  readonly sourceBufferId: RenderPlanBufferId;
  readonly sourceOffset: number;
}

/** Retires one retained renderer buffer generation. */
export interface TextEngineRetirePatch extends TextEnginePatchBase {
  readonly kind: 'retire';
}

/** One decoded dirty-range operation on retained renderer storage. */
export type TextEnginePatchRecord =
  | TextEngineAllocatePatch
  | TextEngineWritePatch
  | TextEngineFillPatch
  | TextEngineCopyPatch
  | TextEngineRetirePatch;

/** One decoded row of the plan's `resources` table: an atlas or texture the host realizes. */
export interface TextEngineResourceRecord {
  readonly id: RenderPlanResourceId;
  readonly generation: number;
  readonly techniqueId: RenderTechniqueId;
  readonly resourceKind: number;
  readonly referenceId: ResourceHandle | 0;
  readonly action: TextEngineResourceAction;
}

/** A policy-buffer slot or engine-owned ordering lane associated with renderer storage. */
export type TextEngineBufferBinding = Readonly<{ kind: 'policy'; id: PolicyBufferId }> | Readonly<{ kind: 'order' }>;

/** One decoded row of the plan's `buffers` table: engine-owned storage the policy publishes into. */
export interface TextEngineBufferRecord {
  readonly id: RenderPlanBufferId;
  readonly generation: number;
  readonly programId: RenderProgramId;
  readonly scalarType: TextEngineScalarType;
  readonly vectorWidth: number;
  readonly capacityRecords: number;
  readonly byteLength: number;
  readonly binding: TextEngineBufferBinding;
}

/** One decoded row of the plan's `primitives` table. */
export interface TextEnginePrimitiveRecord {
  readonly id: RenderPlanPrimitiveId;
  readonly techniqueId: RenderTechniqueId;
  readonly programId: RenderProgramId;
  readonly programVariant: number;
  readonly kind: TextEnginePrimitiveKind;
  readonly recordCount: number;
  readonly recordIndex: number;
  readonly resourceId: RenderPlanResourceId | 0;
  readonly resourceGeneration: number;
  readonly bufferId: RenderPlanBufferId | 0;
  readonly logicalOrder: number;
  readonly clipId: RenderPlanClipId | 0;
  readonly semanticId: RenderPlanSemanticId | 0;
  readonly inlineStart: number;
  readonly blockStart: number;
  readonly inlineExtent: number;
  readonly blockExtent: number;
}

/** One decoded row of the plan's `draws` table. */
export interface TextEngineDrawRecord {
  readonly id: RenderPlanDrawId;
  readonly programId: RenderProgramId;
  readonly programVariant: number;
  readonly flags: number;
  readonly materialId: MaterialHandle | 0;
  readonly clipId: RenderPlanClipId | 0;
  readonly depthKey: number;
  readonly transformId: RenderPlanTransformId | 0;
  readonly primitiveStart: number;
  readonly primitiveCount: number;
  readonly bufferStart: number;
  readonly bufferCount: number;
  readonly resourceStart: number;
  readonly resourceCount: number;
  readonly orderToken: number;
  readonly indirectBufferId: RenderPlanBufferId | 0;
  readonly indirectOffset: number;
}

/**
 * One decoded row of the plan's `retirements` table: the only signal to release
 * engine storage. The engine defers reclamation until the acknowledged publication
 * generation passes `afterPublicationGeneration`, so a host that acknowledges late
 * keeps retired GPU memory alive and one that never acknowledges leaks it.
 */
export interface TextEngineRetirementRecord {
  readonly kind: TextEngineRetirementKind;
  readonly id: RenderPlanResourceId | RenderPlanBufferId | number;
  readonly generation: number;
  readonly afterPublicationGeneration: number;
  readonly byteOffset: number;
  readonly byteLength: number;
}

const patchLayout = textShaperAbi.layouts.enginePatch;
const resourceLayout = textShaperAbi.layouts.engineResource;
const bufferLayout = textShaperAbi.layouts.engineBuffer;
const primitiveLayout = textShaperAbi.layouts.enginePrimitive;
const drawLayout = textShaperAbi.layouts.engineDraw;
const retirementLayout = textShaperAbi.layouts.engineRetirement;

/** Decodes and validates one dirty-range patch. */
export function readTextEnginePatch(
  view: RenderPlanReader,
  table: RenderPlanTable,
  index: number,
): TextEnginePatchRecord {
  const record = view.record(table, index);
  const byteLength = view.u32(record + patchLayout.byteLength);
  const opcode = view.u16(record + patchLayout.opcode);
  const base = {
    bufferId: planBufferId(view.u32(record + patchLayout.bufferId), 'patch buffer'),
    bufferGeneration: view.u32(record + patchLayout.bufferGeneration),
    destinationOffset: view.u32(record + patchLayout.destinationOffset),
    byteLength,
  };
  const opcodes = textShaperAbi.engine.patchOpcodes;
  if (opcode === opcodes.allocateOrResize) return { ...base, kind: 'allocate-or-resize' };
  if (opcode === opcodes.write) {
    return {
      ...base,
      kind: 'write',
      payload: view.bytes(view.u32(record + patchLayout.payloadOffset), byteLength),
    };
  }
  if (opcode === opcodes.fill) {
    return { ...base, kind: 'fill', fillValue: view.u32(record + patchLayout.fillValue) };
  }
  if (opcode === opcodes.copy) {
    return {
      ...base,
      kind: 'copy',
      sourceBufferId: planBufferId(view.u32(record + patchLayout.sourceBufferId), 'copy source buffer'),
      sourceOffset: view.u32(record + patchLayout.sourceOffset),
    };
  }
  if (opcode === opcodes.retire) return { ...base, kind: 'retire' };
  throw new RangeError(`text-engine patch has unsupported opcode ${opcode}`);
}

/** Decodes and validates one portable resource record. */
export function readTextEngineResource(
  view: RenderPlanReader,
  table: RenderPlanTable,
  index: number,
): TextEngineResourceRecord {
  const record = view.record(table, index);
  const action = enumName(textShaperAbi.engine.resourceActions, view.u16(record + resourceLayout.action));
  if (action === undefined) throw new RangeError('text-engine resource has an unsupported action');
  return {
    id: planResourceId(view.u32(record + resourceLayout.id), 'resource'),
    generation: view.u32(record + resourceLayout.generation),
    techniqueId: nonzero(view.u32(record + resourceLayout.techniqueId), 'resource technique') as RenderTechniqueId,
    resourceKind: view.u16(record + resourceLayout.resourceKind),
    referenceId: view.u32(record + resourceLayout.referenceId) as ResourceHandle | 0,
    action,
  };
}

/** Decodes and validates one renderer buffer declaration. */
export function readTextEngineBuffer(
  view: RenderPlanReader,
  table: RenderPlanTable,
  index: number,
): TextEngineBufferRecord {
  const record = view.record(table, index);
  const scalarType = enumName(textShaperAbi.policy.scalarTypes, view.u8(record + bufferLayout.scalarType));
  if (scalarType === undefined) throw new RangeError('text-engine buffer has an unsupported scalar type');
  const bindingId = view.u16(record + bufferLayout.policyBufferId);
  return {
    id: planBufferId(view.u32(record + bufferLayout.id), 'buffer'),
    generation: view.u32(record + bufferLayout.generation),
    programId: nonzero(view.u32(record + bufferLayout.programId), 'buffer program') as RenderProgramId,
    scalarType,
    vectorWidth: view.u8(record + bufferLayout.vectorWidth),
    capacityRecords: view.u32(record + bufferLayout.capacityRecords),
    byteLength: view.u32(record + bufferLayout.byteLength),
    binding:
      bindingId === textShaperAbi.engine.internalBufferBindings.order
        ? { kind: 'order' }
        : { kind: 'policy', id: nonzero(bindingId, 'policy buffer') as PolicyBufferId },
  };
}

/** Decodes and validates one primitive span. */
export function readTextEnginePrimitive(
  view: RenderPlanReader,
  table: RenderPlanTable,
  index: number,
): TextEnginePrimitiveRecord {
  const record = view.record(table, index);
  const kind = enumName(textShaperAbi.engine.primitiveKinds, view.u16(record + primitiveLayout.kind));
  if (kind === undefined) throw new RangeError('text-engine primitive has an unsupported kind');
  return {
    id: nonzero(view.u32(record + primitiveLayout.id), 'primitive') as RenderPlanPrimitiveId,
    techniqueId: nonzero(view.u32(record + primitiveLayout.techniqueId), 'primitive technique') as RenderTechniqueId,
    programId: nonzero(view.u32(record + primitiveLayout.programId), 'primitive program') as RenderProgramId,
    programVariant: view.u16(record + primitiveLayout.programVariant),
    kind: kind === 'inlineObject' ? 'inline-object' : kind,
    recordCount: view.u16(record + primitiveLayout.recordCount),
    recordIndex: view.u32(record + primitiveLayout.recordIndex),
    resourceId: view.u32(record + primitiveLayout.resourceId) as RenderPlanResourceId | 0,
    resourceGeneration: view.u32(record + primitiveLayout.resourceGeneration),
    bufferId: view.u32(record + primitiveLayout.bufferId) as RenderPlanBufferId | 0,
    logicalOrder: view.u32(record + primitiveLayout.logicalOrder),
    clipId: view.u32(record + primitiveLayout.clipId) as RenderPlanClipId | 0,
    semanticId: view.u32(record + primitiveLayout.semanticId) as RenderPlanSemanticId | 0,
    inlineStart: view.f32(record + primitiveLayout.inlineStart),
    blockStart: view.f32(record + primitiveLayout.blockStart),
    inlineExtent: view.f32(record + primitiveLayout.inlineExtent),
    blockExtent: view.f32(record + primitiveLayout.blockExtent),
  };
}

/** Decodes and validates one ordered draw record. */
export function readTextEngineDraw(
  view: RenderPlanReader,
  table: RenderPlanTable,
  index: number,
): TextEngineDrawRecord {
  const record = view.record(table, index);
  return {
    id: nonzero(view.u32(record + drawLayout.id), 'draw') as RenderPlanDrawId,
    programId: nonzero(view.u32(record + drawLayout.programId), 'draw program') as RenderProgramId,
    programVariant: view.u16(record + drawLayout.programVariant),
    flags: view.u16(record + drawLayout.flags),
    materialId: view.u32(record + drawLayout.materialId) as MaterialHandle | 0,
    clipId: view.u32(record + drawLayout.clipId) as RenderPlanClipId | 0,
    depthKey: view.u32(record + drawLayout.depthKey),
    transformId: view.u32(record + drawLayout.transformId) as RenderPlanTransformId | 0,
    primitiveStart: view.u32(record + drawLayout.primitiveStart),
    primitiveCount: view.u32(record + drawLayout.primitiveCount),
    bufferStart: view.u32(record + drawLayout.bufferStart),
    bufferCount: view.u32(record + drawLayout.bufferCount),
    resourceStart: view.u32(record + drawLayout.resourceStart),
    resourceCount: view.u32(record + drawLayout.resourceCount),
    orderToken: view.u32(record + drawLayout.orderToken),
    indirectBufferId: view.u32(record + drawLayout.indirectBufferId) as RenderPlanBufferId | 0,
    indirectOffset: view.u32(record + drawLayout.indirectOffset),
  };
}

/** Decodes and validates one exact-generation retirement record. */
export function readTextEngineRetirement(
  view: RenderPlanReader,
  table: RenderPlanTable,
  index: number,
): TextEngineRetirementRecord {
  const record = view.record(table, index);
  const kind = enumName(textShaperAbi.engine.retirementKinds, view.u16(record + retirementLayout.kind));
  if (kind === undefined) throw new RangeError('text-engine retirement has an unsupported kind');
  const id = view.u32(record + retirementLayout.id);
  return {
    kind: kind === 'slotRange' ? 'slot-range' : kind === 'outputBytes' ? 'output-bytes' : kind,
    id:
      kind === 'resource'
        ? planResourceId(id, 'retired resource')
        : kind === 'buffer'
          ? planBufferId(id, 'retired buffer')
          : id,
    generation: view.u32(record + retirementLayout.generation),
    afterPublicationGeneration: view.u32(record + retirementLayout.afterPublicationGeneration),
    byteOffset: view.u32(record + retirementLayout.byteOffset),
    byteLength: view.u32(record + retirementLayout.byteLength),
  };
}

function nonzero(value: number, label: string): number {
  if (value === 0) throw new RangeError(`text-engine ${label} identity is zero`);
  return value;
}

function planBufferId(value: number, label: string): RenderPlanBufferId {
  return nonzero(value, label) as RenderPlanBufferId;
}

function planResourceId(value: number, label: string): RenderPlanResourceId {
  return nonzero(value, label) as RenderPlanResourceId;
}

function enumName<const Values extends Readonly<Record<string, number>>>(
  values: Values,
  wire: number,
): keyof Values | undefined {
  for (const [name, value] of Object.entries(values)) if (value === wire) return name as keyof Values;
  return undefined;
}
