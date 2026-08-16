import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type { ParagraphLayoutInspection, ParagraphLayoutSummary } from '../layout.js';
import type { TextEnginePublication } from './host.js';

/** Reads an explicitly requested semantic sidecar. Rendering never calls this reader. */
export function readTextEngineMeasurements(
  publication: TextEnginePublication,
): ReadonlyMap<number, ParagraphLayoutSummary> {
  const view = new SemanticViewReader(publication);
  const table = view.table();
  const recordLayout = textShaperAbi.layouts.engineSemanticView;
  const kinds = textShaperAbi.engine.semanticKinds;
  const measurements = new Map<number, ParagraphLayoutSummary>();
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
        glyphCount: view.u32(record + recordLayout.parentId),
        lineCount,
        missingGlyphCount: view.u32(record + recordLayout.textStart),
      }),
    );
  }
  return measurements;
}

/** Copies one explicitly requested retained layout out of borrowed Wasm publication memory. */
export function readTextEngineLayouts(
  publication: TextEnginePublication,
): ReadonlyMap<number, ParagraphLayoutInspection> {
  const view = new SemanticViewReader(publication);
  const table = view.table();
  const recordLayout = textShaperAbi.layouts.engineSemanticView;
  const kinds = textShaperAbi.engine.semanticKinds;
  const measurements = readTextEngineMeasurements(publication);
  const layouts = new Map<number, ParagraphLayoutInspection>();
  for (let index = 0; index < table.count; index += 1) {
    const summary = view.record(table, index);
    if (view.u16(summary + recordLayout.kind) !== kinds.paragraphMeasurement) continue;
    const paragraphId = view.u32(summary + recordLayout.id);
    const measurement = measurements.get(paragraphId);
    if (measurement === undefined) throw new TypeError('layout inspection has no paragraph measurement');
    const lineStart = view.u32(summary + recordLayout.itemStart);
    const lineCount = view.u32(summary + recordLayout.itemCount);
    const glyphStart = checkedAdd(lineStart, lineCount, 'layout inspection glyph start');
    const glyphCount = measurement.glyphCount;
    if (checkedAdd(glyphStart, glyphCount, 'layout inspection glyph end') > table.count) {
      throw new RangeError('layout inspection glyph span is outside the query');
    }

    const fontHandles: number[] = [];
    const fontSlots = new Map<number, number>();
    const glyphStableIds = new Uint32Array(glyphCount);
    const glyphFontSlots = new Uint16Array(glyphCount);
    const glyphIds = new Uint16Array(glyphCount);
    const clusters = new Uint32Array(glyphCount);
    const glyphFontSizes = new Float32Array(glyphCount);
    const x = new Float32Array(glyphCount);
    const y = new Float32Array(glyphCount);
    const glyphFlags = new Uint16Array(glyphCount);
    for (let glyphIndex = 0; glyphIndex < glyphCount; glyphIndex += 1) {
      const glyph = view.record(table, glyphStart + glyphIndex);
      if (
        view.u16(glyph + recordLayout.kind) !== kinds.glyph ||
        view.u32(glyph + recordLayout.parentId) !== paragraphId
      ) {
        throw new TypeError('layout inspection references a foreign semantic glyph');
      }
      const fontHandle = view.u32(glyph + recordLayout.textEnd);
      let fontSlot = fontSlots.get(fontHandle);
      if (fontSlot === undefined) {
        fontSlot = fontHandles.length;
        if (fontSlot > 0xffff) throw new RangeError('layout inspection exceeds the font-slot range');
        fontSlots.set(fontHandle, fontSlot);
        fontHandles.push(fontHandle);
      }
      glyphStableIds[glyphIndex] = view.u32(glyph + recordLayout.id);
      glyphFontSlots[glyphIndex] = fontSlot;
      glyphIds[glyphIndex] = view.u32(glyph + recordLayout.itemStart);
      clusters[glyphIndex] = view.u32(glyph + recordLayout.textStart);
      glyphFontSizes[glyphIndex] = view.f32(glyph + recordLayout.inlineExtent);
      x[glyphIndex] = view.f32(glyph + recordLayout.inlineStart);
      y[glyphIndex] = view.f32(glyph + recordLayout.blockStart);
      glyphFlags[glyphIndex] = view.u16(glyph + recordLayout.flags);
    }

    const lineTextStarts = new Uint32Array(lineCount);
    const lineTextEnds = new Uint32Array(lineCount);
    const lineGlyphStarts = new Uint32Array(lineCount);
    const lineGlyphCounts = new Uint32Array(lineCount);
    const lineBaselines = new Float32Array(lineCount);
    const lineAdvances = new Float32Array(lineCount);
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
      const line = view.record(table, lineStart + lineIndex);
      if (view.u16(line + recordLayout.kind) !== kinds.line || view.u32(line + recordLayout.parentId) !== paragraphId) {
        throw new TypeError('layout inspection references a foreign semantic line');
      }
      const absoluteGlyphStart = view.u32(line + recordLayout.itemStart);
      const count = view.u32(line + recordLayout.itemCount);
      if (
        absoluteGlyphStart < glyphStart ||
        checkedAdd(absoluteGlyphStart, count, 'line glyph end') > glyphStart + glyphCount
      ) {
        throw new RangeError('layout inspection line glyph span is outside its paragraph');
      }
      lineTextStarts[lineIndex] = view.u32(line + recordLayout.textStart);
      lineTextEnds[lineIndex] = view.u32(line + recordLayout.textEnd);
      lineGlyphStarts[lineIndex] = absoluteGlyphStart - glyphStart;
      lineGlyphCounts[lineIndex] = count;
      lineBaselines[lineIndex] = view.f32(line + recordLayout.blockStart);
      lineAdvances[lineIndex] = view.f32(line + recordLayout.inlineExtent);
    }

    layouts.set(
      paragraphId,
      Object.freeze({
        ...measurement,
        fontHandles: Uint32Array.from(fontHandles),
        glyphStableIds,
        glyphFontSlots,
        glyphIds,
        clusters,
        glyphFontSizes,
        x,
        y,
        glyphFlags,
        lineTextStarts,
        lineTextEnds,
        lineGlyphStarts,
        lineGlyphCounts,
        lineBaselines,
        lineAdvances,
      }),
    );
  }
  return layouts;
}

function checkedAdd(left: number, right: number, label: string): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} overflows`);
  return value;
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
