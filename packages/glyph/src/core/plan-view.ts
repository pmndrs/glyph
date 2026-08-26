import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type { TextEnginePublication } from './host.js';

export interface RenderPlanTable {
  readonly offset: number;
  readonly count: number;
  readonly stride: number;
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

  bind(publication: TextEnginePublication): this {
    const bytes = publication.bytes;
    if (bytes.buffer !== publication.memoryBuffer) {
      throw new TypeError('text-engine publication bytes do not belong to the reported Wasm memory');
    }
    return this.bindBytes(bytes);
  }

  /** Binds copied plan bytes received across a realm boundary after validating their complete table framing. */
  bindBytes(bytes: Uint8Array): this {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('text-engine plan bytes must be a Uint8Array');
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

  record(table: RenderPlanTable, index: number): number {
    if (!Number.isSafeInteger(index) || index < 0 || index >= table.count) {
      throw new RangeError('text-engine render-plan record index is outside its table');
    }
    return table.offset + index * table.stride;
  }

  u8(offset: number): number {
    this.#assertRange(offset, 1);
    return this.#view!.getUint8(this.#baseOffset + offset);
  }

  u16(offset: number): number {
    this.#assertRange(offset, 2);
    return this.#view!.getUint16(this.#baseOffset + offset, true);
  }

  u32(offset: number): number {
    this.#assertRange(offset, 4);
    return this.#view!.getUint32(this.#baseOffset + offset, true);
  }

  f32(offset: number): number {
    this.#assertRange(offset, 4);
    return this.#view!.getFloat32(this.#baseOffset + offset, true);
  }

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

function validateResultBytes(bytes: Uint8Array, view: DataView): void {
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

/** One decoded row of the plan's `patches` table: a dirty range on one retained buffer. */
export interface TextEnginePatchRecord {
  readonly opcode: number;
  readonly bufferId: number;
  /** Storage is keyed by `(id, generation)`: a changed generation is new storage. */
  readonly bufferGeneration: number;
  readonly destinationOffset: number;
  readonly byteLength: number;
  /**
   * Borrowed view of the payload region for `write` patches. It expires with the
   * publication it came from — copy it, or retain the whole publication first.
   */
  readonly payload: Uint8Array | undefined;
  readonly fillValue: number;
  readonly sourceBufferId: number;
  readonly sourceOffset: number;
}

/** One decoded row of the plan's `resources` table: an atlas or texture the host realizes. */
export interface TextEngineResourceRecord {
  readonly id: number;
  readonly generation: number;
  readonly techniqueId: number;
  readonly resourceKind: number;
  readonly referenceId: number;
  readonly action: number;
}

/** One decoded row of the plan's `buffers` table: engine-owned storage the policy publishes into. */
export interface TextEngineBufferRecord {
  readonly id: number;
  readonly generation: number;
  readonly programId: number;
  readonly scalarType: number;
  readonly vectorWidth: number;
  readonly capacityRecords: number;
  readonly byteLength: number;
  readonly policyBufferId: number;
}

/**
 * One decoded row of the plan's `retirements` table: the only signal to release
 * engine storage. The engine defers reclamation until the acknowledged publication
 * generation passes `afterPublicationGeneration`, so a host that acknowledges late
 * keeps retired GPU memory alive and one that never acknowledges leaks it.
 */
export interface TextEngineRetirementRecord {
  readonly kind: number;
  readonly id: number;
  readonly generation: number;
  readonly afterPublicationGeneration: number;
  readonly byteOffset: number;
  readonly byteLength: number;
}

const patchLayout = textShaperAbi.layouts.enginePatch;
const resourceLayout = textShaperAbi.layouts.engineResource;
const bufferLayout = textShaperAbi.layouts.engineBuffer;
const retirementLayout = textShaperAbi.layouts.engineRetirement;

export function readTextEnginePatch(
  view: TextEngineRenderPlanView,
  table: RenderPlanTable,
  index: number,
): TextEnginePatchRecord {
  const record = view.record(table, index);
  const byteLength = view.u32(record + patchLayout.byteLength);
  const opcode = view.u16(record + patchLayout.opcode);
  return {
    opcode,
    bufferId: view.u32(record + patchLayout.bufferId),
    bufferGeneration: view.u32(record + patchLayout.bufferGeneration),
    destinationOffset: view.u32(record + patchLayout.destinationOffset),
    byteLength,
    payload:
      opcode === textShaperAbi.engine.patchOpcodes.write && byteLength !== 0
        ? view.bytes(view.u32(record + patchLayout.payloadOffset), byteLength)
        : undefined,
    fillValue: view.u32(record + patchLayout.fillValue),
    sourceBufferId: view.u32(record + patchLayout.sourceBufferId),
    sourceOffset: view.u32(record + patchLayout.sourceOffset),
  };
}

export function readTextEngineResource(
  view: TextEngineRenderPlanView,
  table: RenderPlanTable,
  index: number,
): TextEngineResourceRecord {
  const record = view.record(table, index);
  return {
    id: view.u32(record + resourceLayout.id),
    generation: view.u32(record + resourceLayout.generation),
    techniqueId: view.u32(record + resourceLayout.techniqueId),
    resourceKind: view.u16(record + resourceLayout.resourceKind),
    referenceId: view.u32(record + resourceLayout.referenceId),
    action: view.u16(record + resourceLayout.action),
  };
}

export function readTextEngineBuffer(
  view: TextEngineRenderPlanView,
  table: RenderPlanTable,
  index: number,
): TextEngineBufferRecord {
  const record = view.record(table, index);
  return {
    id: view.u32(record + bufferLayout.id),
    generation: view.u32(record + bufferLayout.generation),
    programId: view.u32(record + bufferLayout.programId),
    scalarType: view.u8(record + bufferLayout.scalarType),
    vectorWidth: view.u8(record + bufferLayout.vectorWidth),
    capacityRecords: view.u32(record + bufferLayout.capacityRecords),
    byteLength: view.u32(record + bufferLayout.byteLength),
    policyBufferId: view.u16(record + bufferLayout.policyBufferId),
  };
}

export function readTextEngineRetirement(
  view: TextEngineRenderPlanView,
  table: RenderPlanTable,
  index: number,
): TextEngineRetirementRecord {
  const record = view.record(table, index);
  return {
    kind: view.u16(record + retirementLayout.kind),
    id: view.u32(record + retirementLayout.id),
    generation: view.u32(record + retirementLayout.generation),
    afterPublicationGeneration: view.u32(record + retirementLayout.afterPublicationGeneration),
    byteOffset: view.u32(record + retirementLayout.byteOffset),
    byteLength: view.u32(record + retirementLayout.byteLength),
  };
}
