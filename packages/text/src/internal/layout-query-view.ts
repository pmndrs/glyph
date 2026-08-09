import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type { ParagraphMeasurement } from '../layout.js';
import type { TextEnginePublication } from './text-engine-host.js';

/** Reads an explicitly requested semantic sidecar. Rendering never calls this reader. */
export function readTextEngineMeasurements(
  publication: TextEnginePublication,
): ReadonlyMap<number, ParagraphMeasurement> {
  const view = new SemanticViewReader(publication);
  const table = view.table();
  const recordLayout = textShaperAbi.layouts.engineSemanticView;
  const kinds = textShaperAbi.engine.semanticKinds;
  const measurements = new Map<number, ParagraphMeasurement>();
  for (let index = 0; index < table.count; index += 1) {
    const record = view.record(table, index);
    if (view.u16(record + recordLayout.kind) !== kinds.paragraphMeasurement) continue;
    const paragraphId = view.u32(record + recordLayout.id);
    const lineStart = view.u32(record + recordLayout.itemStart);
    const lineCount = view.u32(record + recordLayout.itemCount);
    if (lineStart + lineCount > table.count)
      throw new RangeError('paragraph measurement line span is outside the query');
    let firstBaseline = 0;
    let lastBaseline = 0;
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
      const line = view.record(table, lineStart + lineIndex);
      if (view.u16(line + recordLayout.kind) !== kinds.line || view.u32(line + recordLayout.parentId) !== paragraphId) {
        throw new TypeError('paragraph measurement references a foreign semantic line');
      }
      const baseline = view.f32(line + recordLayout.blockStart);
      if (lineIndex === 0) firstBaseline = baseline;
      lastBaseline = baseline;
    }
    if (measurements.has(paragraphId)) throw new TypeError('text engine returned duplicate paragraph measurements');
    measurements.set(
      paragraphId,
      Object.freeze({
        width: view.f32(record + recordLayout.inlineStart),
        height: view.f32(record + recordLayout.blockStart),
        contentWidth: view.f32(record + recordLayout.inlineExtent),
        contentHeight: view.f32(record + recordLayout.blockExtent),
        firstBaseline,
        lastBaseline,
        overflowed: (view.u16(record + recordLayout.flags) & textShaperAbi.engine.measurementFlags.overflowed) !== 0,
      }),
    );
  }
  return measurements;
}

interface SemanticViewTable {
  readonly offset: number;
  readonly count: number;
  readonly stride: number;
}

class SemanticViewReader {
  readonly #publication: TextEnginePublication;
  readonly #view: DataView;

  constructor(publication: TextEnginePublication) {
    if (publication.bytes.buffer !== publication.memoryBuffer) {
      throw new TypeError('text-engine query bytes do not belong to the reported Wasm memory');
    }
    this.#publication = publication;
    this.#view = new DataView(publication.memoryBuffer);
  }

  table(): SemanticViewTable {
    const result = textShaperAbi.layouts.engineResult;
    const record = textShaperAbi.layouts.engineSemanticView;
    const offset = this.u32(result.semanticViewsOffset);
    const count = this.u32(result.semanticViewCount);
    if (count !== this.#publication.semanticViewCount) {
      throw new TypeError('text-engine query metadata disagrees with its publication');
    }
    if (count === 0) {
      if (offset !== 0) throw new RangeError('empty text-engine semantic view has a nonzero offset');
      return { offset: 0, count: 0, stride: record.size };
    }
    const byteLength = count * record.size;
    if (!Number.isSafeInteger(byteLength) || offset % record.alignment !== 0 || offset < result.size) {
      throw new RangeError('text-engine semantic view has an invalid span');
    }
    this.#assertRange(offset, byteLength);
    return { offset, count, stride: record.size };
  }

  record(table: SemanticViewTable, index: number): number {
    if (!Number.isSafeInteger(index) || index < 0 || index >= table.count) {
      throw new RangeError('text-engine semantic-view record index is outside its table');
    }
    return table.offset + index * table.stride;
  }

  u16(offset: number): number {
    this.#assertRange(offset, 2);
    return this.#view.getUint16(this.#publication.bytes.byteOffset + offset, true);
  }

  u32(offset: number): number {
    this.#assertRange(offset, 4);
    return this.#view.getUint32(this.#publication.bytes.byteOffset + offset, true);
  }

  f32(offset: number): number {
    this.#assertRange(offset, 4);
    return this.#view.getFloat32(this.#publication.bytes.byteOffset + offset, true);
  }

  #assertRange(offset: number, byteLength: number): void {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(byteLength) ||
      offset < 0 ||
      byteLength < 0 ||
      offset + byteLength > this.#publication.bytes.byteLength
    ) {
      throw new RangeError('text-engine semantic-view read is outside the publication');
    }
  }
}
