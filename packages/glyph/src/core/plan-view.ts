import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type { PlanPublication } from '../internal/handle-state.js';
import type { ResourceHandle } from '../config/codec.js';

/** Byte span, record count, and fixed stride for one validated plan table. */
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
export class RenderPlanView {
  #memoryBuffer: ArrayBufferLike | undefined;
  #view: DataView | undefined;
  #baseOffset = 0;
  #byteLength = 0;
  #tables: Readonly<Record<TableName, RenderPlanTable>> | undefined;

  /** @internal Raw Wasm publications are consumed only by the render planner. */
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
    const tables = validateResultBytes(bytes, view);
    if (this.#memoryBuffer !== bytes.buffer) {
      this.#memoryBuffer = bytes.buffer;
      this.#view = view;
    }
    this.#baseOffset = bytes.byteOffset;
    this.#byteLength = bytes.byteLength;
    this.#tables = tables;
    return this;
  }

  /** Resolves one validated table descriptor by semantic name. */
  table(name: TableName): RenderPlanTable {
    const table = this.#tables?.[name];
    if (table === undefined) throw new RangeError('text-engine render-plan view is not bound');
    return table;
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

function validateResultBytes(
  bytes: Uint8Array<ArrayBufferLike>,
  view: DataView,
): Readonly<Record<TableName, RenderPlanTable>> {
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
  const tables = {} as Record<TableName, RenderPlanTable>;
  for (const name of Object.keys(tableLayouts) as TableName[])
    tables[name] = validateResultTable(u32, bytes.byteLength, name, tableLayouts[name]);
  validateResultTable(u32, bytes.byteLength, 'semantic views', {
    offset: resultLayout.semanticViewsOffset,
    count: resultLayout.semanticViewCount,
    record: textShaperAbi.layouts.engineSemanticView,
  });
  return Object.freeze(tables);
}

function validateResultTable(
  u32: (offset: number) => number,
  resultByteLength: number,
  name: string,
  layout: ResultTableLayout,
): RenderPlanTable {
  const offset = u32(layout.offset);
  const count = u32(layout.count);
  if (count === 0) {
    if (offset !== 0) throw new RangeError(`empty text-engine ${name} table has a nonzero offset`);
    return Object.freeze({ offset: 0, count: 0, stride: layout.record.size });
  }
  if (offset % layout.record.alignment !== 0) throw new RangeError(`text-engine ${name} table is misaligned`);
  const byteLength = checkedProduct(count, layout.record.size, `${name} table`);
  if (offset < resultLayout.size || offset + byteLength > resultByteLength) {
    throw new RangeError(`text-engine ${name} table is outside the publication`);
  }
  return Object.freeze({ offset, count, stride: layout.record.size });
}

/** @internal Reads one field from an admitted Rust resource row without semantic revalidation. */
export function readTrustedRenderPlanResourceReferenceId(
  plan: RenderPlanView,
  table: RenderPlanTable,
  index: number,
): ResourceHandle {
  const base = plan.record(table, index);
  return plan.u32(base + textShaperAbi.layouts.engineResource.referenceId) as ResourceHandle;
}
