import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type { PlanPublication } from './handle-state.js';

/** Byte span, record count, and fixed stride for one Rust-authored plan table. */
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

/** Reusable zero-copy reader over one trusted Rust render-plan publication. */
export class RenderPlanView {
  #memoryBuffer: ArrayBufferLike | undefined;
  #view: DataView | undefined;
  #baseOffset = 0;
  #tables: Readonly<Record<TableName, RenderPlanTable>> | undefined;

  /** @internal Raw Wasm publications are consumed only by the render planner. */
  bind(publication: PlanPublication): this {
    const bytes = publication.bytes;
    const view = this.#memoryBuffer === bytes.buffer ? this.#view! : new DataView(bytes.buffer);
    if (this.#memoryBuffer !== bytes.buffer) {
      this.#memoryBuffer = bytes.buffer;
      this.#view = view;
    }
    this.#baseOffset = bytes.byteOffset;
    this.#tables = readTables(view, bytes.byteOffset);
    return this;
  }

  /** Resolves one Rust-authored table descriptor by semantic name. */
  table(name: TableName): RenderPlanTable {
    return this.#tables![name];
  }

  /** Resolves one record offset within a Rust-authored table. */
  record(table: RenderPlanTable, index: number): number {
    return table.offset + index * table.stride;
  }

  /** Reads one unsigned byte. */
  u8(offset: number): number {
    return this.#view!.getUint8(this.#baseOffset + offset);
  }

  /** Reads one little-endian unsigned 16-bit value. */
  u16(offset: number): number {
    return this.#view!.getUint16(this.#baseOffset + offset, true);
  }

  /** Reads one little-endian unsigned 32-bit value. */
  u32(offset: number): number {
    return this.#view!.getUint32(this.#baseOffset + offset, true);
  }

  /** Reads one little-endian 32-bit float. */
  f32(offset: number): number {
    return this.#view!.getFloat32(this.#baseOffset + offset, true);
  }

  /** Borrows one byte span from the bound publication. */
  bytes(offset: number, byteLength: number): Uint8Array {
    return new Uint8Array(this.#memoryBuffer!, this.#baseOffset + offset, byteLength);
  }
}

function readTables(view: DataView, baseOffset: number): Readonly<Record<TableName, RenderPlanTable>> {
  const table = (name: TableName): RenderPlanTable => {
    const layout = tableLayouts[name];
    return {
      offset: view.getUint32(baseOffset + layout.offset, true),
      count: view.getUint32(baseOffset + layout.count, true),
      stride: layout.record.size,
    };
  };
  return {
    resources: table('resources'),
    buffers: table('buffers'),
    patches: table('patches'),
    primitives: table('primitives'),
    draws: table('draws'),
    retirements: table('retirements'),
    diagnostics: table('diagnostics'),
  };
}
