import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type { LayoutBox, GlyphLayoutInspection, ParagraphLayoutSummary, ParagraphLineMetrics } from '../layout.js';
import type { PlanPublication } from './backend.js';

/**
 * Reads the ink box off one semantic record, or reports its absence.
 *
 * Absence is carried by a flag bit on the paragraph record rather than by a sentinel extent,
 * because a zero-extent ink box is a legitimate answer — a paragraph of spaces has one.
 */
function inkBoundsOf(view: SemanticViewReader, record: number, measured: boolean): LayoutBox | undefined {
  if (!measured) return undefined;
  const layout = textShaperAbi.layouts.engineSemanticView;
  return Object.freeze({
    x: view.f32(record + layout.inkInlineStart),
    y: view.f32(record + layout.inkBlockStart),
    width: view.f32(record + layout.inkInlineExtent),
    height: view.f32(record + layout.inkBlockExtent),
  });
}

/** Reads an explicitly requested semantic sidecar. Rendering never calls this reader. */
export function readPlannerMeasurements(publication: PlanPublication): ReadonlyMap<number, ParagraphLayoutSummary> {
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
    const flags = view.u16(record + recordLayout.flags);
    const inkMeasured = (flags & textShaperAbi.engine.measurementFlags.inkBounds) !== 0;
    const glyphStart = lineStart + lineCount;
    let firstBaseline = 0;
    let lastBaseline = 0;
    const lines: ParagraphLineMetrics[] = [];
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
      const line = view.record(table, lineStart + lineIndex);
      if (view.u16(line + recordLayout.kind) !== kinds.line || view.u32(line + recordLayout.parentId) !== paragraphId) {
        throw new TypeError('paragraph measurement references a foreign semantic line');
      }
      const baseline = view.f32(line + recordLayout.blockStart);
      if (lineIndex === 0) firstBaseline = baseline;
      lastBaseline = baseline;
      const lineHeight = view.f32(line + recordLayout.blockExtent);
      // The engine reports the line box's ascent; its descent is the remainder of the box, so the
      // two are derived from one number instead of two that could disagree.
      const ascent = view.f32(line + recordLayout.ascent);
      // A measurement-only query leaves the line's glyph span zeroed; it is only meaningful
      // alongside the per-glyph columns, which the measure reader validates before publishing.
      const lineGlyphStart = view.u32(line + recordLayout.itemStart);
      lines.push(
        Object.freeze({
          index: lineIndex,
          textStart: view.u32(line + recordLayout.textStart),
          textEnd: view.u32(line + recordLayout.textEnd),
          glyphStart: lineGlyphStart === 0 ? 0 : lineGlyphStart - glyphStart,
          glyphCount: view.u32(line + recordLayout.itemCount),
          baseline,
          advance: view.f32(line + recordLayout.inlineExtent),
          ascent,
          descent: lineHeight - ascent,
          lineHeight,
          inkBounds: inkBoundsOf(view, line, inkMeasured),
        }),
      );
    }
    if (measurements.has(paragraphId)) throw new TypeError('text engine returned duplicate paragraph measurements');
    const contentHeight = view.f32(record + recordLayout.blockExtent);
    const ascent = view.f32(record + recordLayout.ascent);
    measurements.set(
      paragraphId,
      Object.freeze({
        width: view.f32(record + recordLayout.inlineStart),
        height: view.f32(record + recordLayout.blockStart),
        contentWidth: view.f32(record + recordLayout.inlineExtent),
        contentHeight,
        firstBaseline,
        lastBaseline,
        // Whole-paragraph BaselineMetrics use the first baseline as their one reference.
        ascent,
        descent: contentHeight - ascent,
        lineHeight: contentHeight,
        inkBounds: inkBoundsOf(view, record, inkMeasured),
        overflowed: (flags & textShaperAbi.engine.measurementFlags.overflowed) !== 0,
        minContentWidth: view.f32(record + recordLayout.minContentWidth),
        maxContentWidth: view.f32(record + recordLayout.maxContentWidth),
        glyphCount: view.u32(record + recordLayout.parentId),
        lineCount,
        missingGlyphCount: view.u32(record + recordLayout.textStart),
        lines: Object.freeze(lines),
      }),
    );
  }
  return measurements;
}

/** Copies one explicitly requested retained layout out of borrowed Wasm publication memory. */
export function readPlannerLayouts(publication: PlanPublication): ReadonlyMap<number, GlyphLayoutInspection> {
  const view = new SemanticViewReader(publication);
  const table = view.table();
  const recordLayout = textShaperAbi.layouts.engineSemanticView;
  const kinds = textShaperAbi.engine.semanticKinds;
  const measurements = readPlannerMeasurements(publication);
  const layouts = new Map<number, GlyphLayoutInspection>();
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
    const glyphBidiLevels = new Uint8Array(glyphCount);
    const glyphFontSizes = new Float32Array(glyphCount);
    const x = new Float32Array(glyphCount);
    const y = new Float32Array(glyphCount);
    const glyphAdvances = new Float32Array(glyphCount);
    const glyphInkX = new Float32Array(glyphCount);
    const glyphInkY = new Float32Array(glyphCount);
    const glyphInkWidths = new Float32Array(glyphCount);
    const glyphInkHeights = new Float32Array(glyphCount);
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
      const bidiLevel = view.u32(glyph + recordLayout.itemCount);
      if (bidiLevel > 125) throw new RangeError('layout inspection glyph has an invalid bidi level');
      glyphBidiLevels[glyphIndex] = bidiLevel;
      glyphFontSizes[glyphIndex] = view.f32(glyph + recordLayout.inlineExtent);
      x[glyphIndex] = view.f32(glyph + recordLayout.inlineStart);
      y[glyphIndex] = view.f32(glyph + recordLayout.blockStart);
      glyphAdvances[glyphIndex] = view.f32(glyph + recordLayout.inlineAdvance);
      glyphInkX[glyphIndex] = view.f32(glyph + recordLayout.inkInlineStart);
      glyphInkY[glyphIndex] = view.f32(glyph + recordLayout.inkBlockStart);
      glyphInkWidths[glyphIndex] = view.f32(glyph + recordLayout.inkInlineExtent);
      glyphInkHeights[glyphIndex] = view.f32(glyph + recordLayout.inkBlockExtent);
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

    // `glyphCount` and `lineCount` are the published authorities for indexing these columns
    // (`GlyphLayout`). This reader is their only producer, so the guarantee is checked here
    // once rather than re-asserted by every consumer — which is exactly what the one real consumer
    // of the previous shape had to hand-write over six of these arrays.
    assertColumnLengths(glyphCount, [
      glyphStableIds,
      glyphFontSlots,
      glyphIds,
      clusters,
      glyphBidiLevels,
      glyphFontSizes,
      x,
      y,
      glyphAdvances,
      glyphInkX,
      glyphInkY,
      glyphInkWidths,
      glyphInkHeights,
      glyphFlags,
    ]);
    assertColumnLengths(lineCount, [
      lineTextStarts,
      lineTextEnds,
      lineGlyphStarts,
      lineGlyphCounts,
      lineBaselines,
      lineAdvances,
    ]);
    if (measurement.lines.length !== lineCount) {
      throw new RangeError('layout inspection line metrics disagree with its line count');
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
        glyphBidiLevels,
        glyphFontSizes,
        x,
        y,
        glyphAdvances,
        glyphInkX,
        glyphInkY,
        glyphInkWidths,
        glyphInkHeights,
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

function assertColumnLengths(count: number, columns: readonly ArrayLike<number>[]): void {
  for (const column of columns) {
    if (column.length !== count) throw new RangeError('layout inspection published a ragged column');
  }
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
  readonly #publication: PlanPublication;
  readonly #view: DataView;

  constructor(publication: PlanPublication) {
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
