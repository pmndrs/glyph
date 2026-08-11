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

/** Reusable zero-copy reader over one borrowed Rust render-plan publication. */
export class TextEngineRenderPlanView {
  #memoryBuffer: ArrayBuffer | undefined;
  #view: DataView | undefined;
  #baseOffset = 0;
  #byteLength = 0;

  bind(publication: TextEnginePublication): this {
    const bytes = publication.bytes;
    if (bytes.buffer !== publication.memoryBuffer) {
      throw new TypeError('text-engine publication bytes do not belong to the reported Wasm memory');
    }
    if (this.#memoryBuffer !== publication.memoryBuffer) {
      this.#memoryBuffer = publication.memoryBuffer;
      this.#view = new DataView(publication.memoryBuffer);
    }
    this.#baseOffset = bytes.byteOffset;
    this.#byteLength = bytes.byteLength;
    if (this.#byteLength < resultLayout.size || this.u32(resultLayout.byteLength) !== this.#byteLength) {
      throw new RangeError('text-engine publication header has an invalid byte length');
    }
    for (const name of Object.keys(tableLayouts) as TableName[]) this.table(name);
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
