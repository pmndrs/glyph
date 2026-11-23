import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type {
  LayoutBox,
  GlyphLayoutColumns,
  ParagraphLayoutSummary,
  ParagraphLineMetrics,
  LineFontMetrics,
} from '../layout.js';
import {
  DeferredGlyphFacts,
  GlyphFacts,
  SummaryLines,
  deferredSummary,
  type LineGlyphFacts,
  type MeasuredLineFields,
  type MeasuredSummaryFields,
} from './deferred-glyph-facts.js';
import type { BorrowedLayoutPublication, PlanPublication, PlanTransport } from './handle-state.js';

const zeroFontMetrics: LineFontMetrics = Object.freeze({
  ascent: 0,
  descent: 0,
  leading: 0,
  capHeight: 0,
  xHeight: 0,
  capHeightSource: 'fallback',
  xHeightSource: 'fallback',
});
const zeroAnchorOffset = Object.freeze({ x: 0, y: 0 });
const recordLayout = textShaperAbi.layouts.engineSemanticView;
const semanticKinds = textShaperAbi.engine.semanticKinds;
const measurementFlags = textShaperAbi.engine.measurementFlags;

/** Reads the ink box off one semantic record, or reports its absence via a flag bit — not a sentinel extent, since a zero-extent ink box (a paragraph of spaces) is a legitimate answer. */
function inkBoundsOf(view: DataView, record: number, measured: boolean): LayoutBox | undefined {
  if (!measured) return undefined;
  return Object.freeze({
    x: view.getFloat32(record + recordLayout.inkInlineStart, true),
    y: view.getFloat32(record + recordLayout.inkBlockStart, true),
    width: view.getFloat32(record + recordLayout.inkInlineExtent, true),
    height: view.getFloat32(record + recordLayout.inkBlockExtent, true),
  });
}

/**
 * Decodes the metrics of one line record. Adjacent lines commonly share one authored strut: `previous` is the font
 * metrics of the line before, kept as the same immutable value when equal rather than allocated again per line.
 */
function lineFieldsOf(
  view: DataView,
  line: number,
  index: number,
  previous: LineFontMetrics | undefined,
): MeasuredLineFields {
  const baseline = view.getFloat32(line + recordLayout.blockStart, true);
  const lineHeight = view.getFloat32(line + recordLayout.blockExtent, true);
  // The engine reports the line box's ascent; its descent is the remainder of the box, so the
  // two are derived from one number instead of two that could disagree.
  const ascent = view.getFloat32(line + recordLayout.ascent, true);
  const fontAscent = view.getFloat32(line + recordLayout.fontAscent, true);
  const fontDescent = view.getFloat32(line + recordLayout.fontDescent, true);
  const heightFallbacks = view.getUint16(line + recordLayout.flags, true);
  const leading = lineHeight - fontAscent - fontDescent;
  const capHeight = view.getFloat32(line + recordLayout.capHeight, true);
  const xHeight = view.getFloat32(line + recordLayout.xHeight, true);
  const capHeightSource = (heightFallbacks & 1) === 0 ? 'font' : 'fallback';
  const xHeightSource = (heightFallbacks & 2) === 0 ? 'font' : 'fallback';
  const fontMetrics: LineFontMetrics =
    previous !== undefined &&
    previous.ascent === fontAscent &&
    previous.descent === fontDescent &&
    previous.leading === leading &&
    previous.capHeight === capHeight &&
    previous.xHeight === xHeight &&
    previous.capHeightSource === capHeightSource &&
    previous.xHeightSource === xHeightSource
      ? previous
      : Object.freeze({
          ascent: fontAscent,
          descent: fontDescent,
          leading,
          capHeight,
          xHeight,
          capHeightSource,
          xHeightSource,
        });
  return {
    index,
    textStart: view.getUint32(line + recordLayout.textStart, true),
    textEnd: view.getUint32(line + recordLayout.textEnd, true),
    baseline,
    alphabeticBaseline: baseline,
    ideographicBaseline: baseline - ascent + lineHeight,
    capHeightTop: view.getFloat32(line + recordLayout.capHeightTop, true),
    xHeightTop: view.getFloat32(line + recordLayout.xHeightTop, true),
    fontMetrics,
    advance: view.getFloat32(line + recordLayout.inlineExtent, true),
    ascent,
    descent: lineHeight - ascent,
    lineHeight,
  };
}

/**
 * Every measurement with glyph facts carries line glyph spans based at the index where glyph records would begin,
 * whether or not the view serialized them; owned glyph demand combines these spans with the borrowed arena.
 */
function lineGlyphFactsOf(view: DataView, line: number, glyphStart: number, inkMeasured: boolean): LineGlyphFacts {
  return {
    glyphStart: view.getUint32(line + recordLayout.itemStart, true) - glyphStart,
    glyphCount: view.getUint32(line + recordLayout.itemCount, true),
    inkBounds: inkBoundsOf(view, line, inkMeasured),
  };
}

/**
 * Line records past this count are copied out of Wasm memory and decoded on first demand; fewer are decoded with the
 * record, which costs less than the copy.
 */
const EAGER_LINE_RECORDS = 16;

/** One measurement's line records: `count` records from `base` in `view`. */
interface LineBlock {
  readonly view: DataView;
  readonly base: number;
  readonly count: number;
  /** Record index at which this measurement's glyph records would begin. */
  readonly glyphStart: number;
  readonly inkMeasured: boolean;
}

/**
 * The line block of one measurement, and whether it must be decoded before the Wasm call returns: a long block is
 * copied, so its lines can be decoded later.
 */
function lineBlockOf(
  reader: SemanticViewReader,
  table: SemanticViewTable,
  lineStart: number,
  lineCount: number,
  flags: number,
): { readonly block: LineBlock; readonly borrowed: boolean } {
  const base = table.offset + lineStart * table.stride;
  const borrowed = lineCount <= EAGER_LINE_RECORDS;
  return {
    block: {
      view: borrowed ? reader.view : reader.copy(base, lineCount * table.stride),
      base: borrowed ? base : 0,
      count: lineCount,
      glyphStart: lineStart + lineCount,
      inkMeasured: (flags & measurementFlags.inkBounds) !== 0,
    },
    borrowed,
  };
}

function lineFieldsOfBlock(block: LineBlock, first: LineFontMetrics | undefined): readonly MeasuredLineFields[] {
  const lines: MeasuredLineFields[] = [];
  let previous = first;
  for (let index = 0; index < block.count; index += 1) {
    const line = lineFieldsOf(block.view, block.base + index * recordLayout.size, index, previous);
    previous = line.fontMetrics;
    lines.push(line);
  }
  return lines;
}

function lineGlyphFactsOfBlock(block: LineBlock): readonly LineGlyphFacts[] {
  const lines: LineGlyphFacts[] = [];
  for (let index = 0; index < block.count; index += 1) {
    lines.push(
      lineGlyphFactsOf(block.view, block.base + index * recordLayout.size, block.glyphStart, block.inkMeasured),
    );
  }
  return lines;
}

/** The glyph facts one measurement record carries; a copied block's per-line facts are decoded on first demand. */
function glyphFactsOfRecord(
  view: DataView,
  record: number,
  { block, borrowed }: ReturnType<typeof lineBlockOf>,
): GlyphFacts {
  return new GlyphFacts(
    view.getUint32(record + recordLayout.parentId, true),
    view.getUint32(record + recordLayout.textStart, true),
    inkBoundsOf(view, record, block.inkMeasured),
    borrowed ? lineGlyphFactsOfBlock(block) : () => lineGlyphFactsOfBlock(block),
  );
}

function assertMeasurementLine(view: SemanticViewReader, line: number, paragraphId: number): void {
  if (
    view.u16(line + recordLayout.kind) !== semanticKinds.line ||
    view.u32(line + recordLayout.parentId) !== paragraphId
  ) {
    throw new TypeError('paragraph measurement references a foreign semantic line');
  }
}

/**
 * Reads an explicitly requested semantic sidecar. Rendering never calls this reader.
 *
 * `observed`: the summaries are a caller's measurement read. They decode their lines on first read and record reads of
 * their glyph facts (`DeferredGlyphFacts.read`), whether the engine carried those facts or deferred them. Otherwise a
 * summary that carries its facts is plain data.
 */
export function readPlannerMeasurements(
  publication: PlanPublication,
  observed = false,
): ReadonlyMap<number, ParagraphLayoutSummary> {
  const view = new SemanticViewReader(publication);
  const table = view.table();
  const measurements = new Map<number, ParagraphLayoutSummary>();
  for (let index = 0; index < table.count; index += 1) {
    const record = view.record(table, index);
    if (view.u16(record + recordLayout.kind) !== semanticKinds.paragraphMeasurement) continue;
    const flags = view.u16(record + recordLayout.flags);
    if ((flags & measurementFlags.priorGlyphFacts) !== 0) continue;
    const paragraphId = view.u32(record + recordLayout.id);
    if (measurements.has(paragraphId)) throw new TypeError('text engine returned duplicate paragraph measurements');
    const lineStart = view.u32(record + recordLayout.itemStart);
    const lineCount = view.u32(record + recordLayout.itemCount);
    if (lineStart + lineCount > table.count)
      throw new RangeError('paragraph measurement line span is outside the query');
    // A summary-only read answered from flow: its glyph facts are computed on first read (`DeferredGlyphFacts`).
    const glyphsDeferred = (flags & measurementFlags.glyphsDeferred) !== 0;
    const lazy = glyphsDeferred || observed;
    const firstLine =
      lineCount === 0 ? undefined : lineFieldsOf(view.view, view.record(table, lineStart), 0, undefined);
    const lastBaseline =
      lineCount === 0 ? 0 : view.f32(view.record(table, lineStart + lineCount - 1) + recordLayout.blockStart);
    const contentHeight = view.f32(record + recordLayout.blockExtent);
    const ascent = view.f32(record + recordLayout.ascent);
    const fields: MeasuredSummaryFields = {
      width: view.f32(record + recordLayout.inlineStart),
      height: view.f32(record + recordLayout.blockStart),
      contentWidth: view.f32(record + recordLayout.inlineExtent),
      contentHeight,
      firstBaseline: firstLine?.baseline ?? 0,
      lastBaseline,
      alphabeticBaseline: firstLine?.alphabeticBaseline ?? 0,
      ideographicBaseline: firstLine?.ideographicBaseline ?? 0,
      capHeightTop: firstLine?.capHeightTop ?? 0,
      xHeightTop: firstLine?.xHeightTop ?? 0,
      fontMetrics: firstLine?.fontMetrics ?? zeroFontMetrics,
      anchorOffset: zeroAnchorOffset,
      // Whole-paragraph BaselineMetrics use the first baseline as their one reference.
      ascent,
      descent: contentHeight - ascent,
      lineHeight: contentHeight,
      overflowed: (flags & measurementFlags.overflowed) !== 0,
      minContentWidth: view.f32(record + recordLayout.minContentWidth),
      maxContentWidth: view.f32(record + recordLayout.maxContentWidth),
      lineCount,
    };
    if (lazy) {
      for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
        assertMeasurementLine(view, view.record(table, lineStart + lineIndex), paragraphId);
      }
      const located = lineBlockOf(view, table, lineStart, lineCount, flags);
      const facts = glyphsDeferred
        ? new DeferredGlyphFacts()
        : DeferredGlyphFacts.answered(glyphFactsOfRecord(view.view, record, located));
      const lines = new SummaryLines(
        located.borrowed
          ? lineFieldsOfBlock(located.block, firstLine?.fontMetrics)
          : () => lineFieldsOfBlock(located.block, firstLine?.fontMetrics),
      );
      measurements.set(paragraphId, deferredSummary(fields, lines, facts));
      continue;
    }
    const inkMeasured = (flags & measurementFlags.inkBounds) !== 0;
    const glyphStart = lineStart + lineCount;
    const lines: ParagraphLineMetrics[] = [];
    let previous = firstLine?.fontMetrics;
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
      const line = view.record(table, lineStart + lineIndex);
      assertMeasurementLine(view, line, paragraphId);
      const metrics = lineIndex === 0 ? firstLine! : lineFieldsOf(view.view, line, lineIndex, previous);
      previous = metrics.fontMetrics;
      lines.push(
        Object.freeze({
          ...metrics,
          glyphStart: view.u32(line + recordLayout.itemStart) - glyphStart,
          glyphCount: view.u32(line + recordLayout.itemCount),
          inkBounds: inkBoundsOf(view.view, line, inkMeasured),
        }),
      );
    }
    measurements.set(
      paragraphId,
      Object.freeze({
        ...fields,
        inkBounds: inkBoundsOf(view.view, record, inkMeasured),
        glyphCount: view.u32(record + recordLayout.parentId),
        missingGlyphCount: view.u32(record + recordLayout.textStart),
        lines: Object.freeze(lines),
      }),
    );
  }
  return measurements;
}

/**
 * Reads the glyph facts of the measurements a request returned: with `prior`, the facts it returned for paragraphs
 * as they were before its input, which the deferred summaries of those earlier preparations answer with; otherwise
 * the facts of the measurements it made.
 */
export function readPlannerGlyphFacts(publication: PlanPublication, prior: boolean): ReadonlyMap<number, GlyphFacts> {
  const view = new SemanticViewReader(publication);
  const table = view.table();
  const facts = new Map<number, GlyphFacts>();
  for (let index = 0; index < table.count; index += 1) {
    const record = view.record(table, index);
    if (view.u16(record + recordLayout.kind) !== semanticKinds.paragraphMeasurement) continue;
    const flags = view.u16(record + recordLayout.flags);
    if (((flags & measurementFlags.priorGlyphFacts) !== 0) !== prior) continue;
    if ((flags & measurementFlags.glyphsDeferred) !== 0) continue;
    const lineStart = view.u32(record + recordLayout.itemStart);
    const lineCount = view.u32(record + recordLayout.itemCount);
    if (lineStart + lineCount > table.count)
      throw new RangeError('paragraph measurement line span is outside the query');
    const located = lineBlockOf(view, table, lineStart, lineCount, flags);
    facts.set(view.u32(record + recordLayout.id), glyphFactsOfRecord(view.view, record, located));
  }
  return facts;
}

/** Keeps the private per-glyph columns of a canonical inspection out of the public measurement cache. */
export function measurementFromLayoutInspection(layout: GlyphLayoutColumns): ParagraphLayoutSummary {
  return Object.freeze({
    width: layout.width,
    height: layout.height,
    contentWidth: layout.contentWidth,
    contentHeight: layout.contentHeight,
    firstBaseline: layout.firstBaseline,
    lastBaseline: layout.lastBaseline,
    alphabeticBaseline: layout.alphabeticBaseline,
    ideographicBaseline: layout.ideographicBaseline,
    capHeightTop: layout.capHeightTop,
    xHeightTop: layout.xHeightTop,
    fontMetrics: layout.fontMetrics,
    anchorOffset: layout.anchorOffset,
    ascent: layout.ascent,
    descent: layout.descent,
    lineHeight: layout.lineHeight,
    inkBounds: layout.inkBounds,
    overflowed: layout.overflowed,
    minContentWidth: layout.minContentWidth,
    maxContentWidth: layout.maxContentWidth,
    glyphCount: layout.glyphCount,
    lineCount: layout.lineCount,
    missingGlyphCount: layout.missingGlyphCount,
    lines: layout.lines,
  });
}

/** Copies owned inspection columns from the current prepared borrowed layout without replaying text preparation. */
export function copyPreparedLayoutInspection(
  measurement: ParagraphLayoutSummary,
  transport: PlanTransport,
  borrowed: BorrowedLayoutPublication,
): GlyphLayoutColumns {
  const glyphCount = borrowed.glyphCount;
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
  // Records are `repr(C)` with naturally aligned fields, so the scratch range is read as typed lanes.
  const record = textShaperAbi.layouts.borrowedGlyph;
  const words = record.size >> 2;
  const halves = record.size >> 1;
  for (let start = 0; start < glyphCount; start += textShaperAbi.engine.borrowedGlyphCapacity) {
    const count = Math.min(textShaperAbi.engine.borrowedGlyphCapacity, glyphCount - start);
    const view = transport.borrowParagraphGlyphs(borrowed, start, count);
    const u32 = new Uint32Array(view.buffer, view.byteOffset, count * words);
    const f32 = new Float32Array(view.buffer, view.byteOffset, count * words);
    const u16 = new Uint16Array(view.buffer, view.byteOffset, count * halves);
    const u8 = new Uint8Array(view.buffer, view.byteOffset, count * record.size);
    let previousFontHandle = 0;
    let previousFontSlot = -1;
    for (let offset = 0; offset < count; offset += 1) {
      const index = start + offset;
      const word = offset * words;
      const half = offset * halves;
      const fontHandle = u32[word + (record.fontHandle >> 2)]!;
      let fontSlot = previousFontSlot;
      if (fontHandle !== previousFontHandle || fontSlot === -1) {
        const known = fontSlots.get(fontHandle);
        if (known === undefined) {
          fontSlot = fontHandles.length;
          if (fontSlot > 0xffff) throw new RangeError('prepared layout exceeds the font-slot range');
          fontSlots.set(fontHandle, fontSlot);
          fontHandles.push(fontHandle);
        } else {
          fontSlot = known;
        }
        previousFontHandle = fontHandle;
        previousFontSlot = fontSlot;
      }
      glyphStableIds[index] = u32[word + (record.stableId >> 2)]!;
      glyphFontSlots[index] = fontSlot;
      glyphIds[index] = u16[half + (record.glyphId >> 1)]!;
      clusters[index] = u32[word + (record.cluster >> 2)]!;
      glyphBidiLevels[index] = u8[offset * record.size + record.bidiLevel]!;
      glyphFontSizes[index] = f32[word + (record.fontSize >> 2)]!;
      x[index] = f32[word + (record.inlineOrigin >> 2)]!;
      y[index] = f32[word + (record.blockOrigin >> 2)]!;
      glyphAdvances[index] = f32[word + (record.inlineAdvance >> 2)]!;
      glyphInkX[index] = f32[word + (record.inkInlineStart >> 2)]!;
      glyphInkY[index] = f32[word + (record.inkBlockStart >> 2)]!;
      glyphInkWidths[index] = f32[word + (record.inkInlineExtent >> 2)]!;
      glyphInkHeights[index] = f32[word + (record.inkBlockExtent >> 2)]!;
      glyphFlags[index] = u16[half + (record.flags >> 1)]!;
    }
  }
  const lineTextStarts = new Uint32Array(measurement.lineCount);
  const lineTextEnds = new Uint32Array(measurement.lineCount);
  const lineGlyphStarts = new Uint32Array(measurement.lineCount);
  const lineGlyphCounts = new Uint32Array(measurement.lineCount);
  const lineBaselines = new Float32Array(measurement.lineCount);
  const lineAdvances = new Float32Array(measurement.lineCount);
  for (const [index, line] of measurement.lines.entries()) {
    lineTextStarts[index] = line.textStart;
    lineTextEnds[index] = line.textEnd;
    lineGlyphStarts[index] = line.glyphStart;
    lineGlyphCounts[index] = line.glyphCount;
    lineBaselines[index] = line.baseline;
    lineAdvances[index] = line.advance;
  }
  const lines = measurement.lines.map((line) =>
    Object.freeze({
      ...line,
      // A line with no glyph has no glyph ink to union; the measurement already knows its box.
      inkBounds:
        glyphInkBounds(glyphInkX, glyphInkY, glyphInkWidths, glyphInkHeights, line.glyphStart, line.glyphCount) ??
        line.inkBounds,
    }),
  );
  return Object.freeze({
    ...measurement,
    inkBounds:
      glyphInkBounds(glyphInkX, glyphInkY, glyphInkWidths, glyphInkHeights, 0, glyphCount) ?? measurement.inkBounds,
    lines: Object.freeze(lines),
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
  });
}

/** Copied borrowed glyph records carry positioned ink; aggregate it only for an owned inspection. */
function glyphInkBounds(
  x: Float32Array,
  y: Float32Array,
  widths: Float32Array,
  heights: Float32Array,
  start: number,
  count: number,
): LayoutBox | undefined {
  if (count === 0) return undefined;
  let minX = x[start]!;
  let minY = y[start]!;
  let maxX = minX + widths[start]!;
  let maxY = minY + heights[start]!;
  for (let index = start + 1; index < start + count; index += 1) {
    minX = Math.min(minX, x[index]!);
    minY = Math.min(minY, y[index]!);
    maxX = Math.max(maxX, x[index]! + widths[index]!);
    maxY = Math.max(maxY, y[index]! + heights[index]!);
  }
  return Object.freeze({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
}

/** Copies one explicitly requested retained layout out of borrowed Wasm publication memory. */
export function readPlannerLayouts(publication: PlanPublication): ReadonlyMap<number, GlyphLayoutColumns> {
  const view = new SemanticViewReader(publication);
  const table = view.table();
  const kinds = textShaperAbi.engine.semanticKinds;
  const measurements = readPlannerMeasurements(publication);
  const layouts = new Map<number, GlyphLayoutColumns>();
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
    // Bound the native view to this publication once. Each scalar load then gets DataView's
    // bounds protection without rechecking package-owned record arithmetic in JavaScript.
    this.#view = new DataView(publication.memoryBuffer, publication.bytes.byteOffset, publication.bytes.byteLength);
  }

  /** The publication's bytes; record offsets index this view. */
  get view(): DataView {
    return this.#view;
  }

  /** An owned copy of `byteLength` bytes at `offset`, readable after the Wasm call that wrote them returns. */
  copy(offset: number, byteLength: number): DataView {
    this.#assertRange(offset, byteLength);
    const start = this.#publication.bytes.byteOffset + offset;
    return new DataView(this.#publication.memoryBuffer.slice(start, start + byteLength));
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
    return this.#view.getUint16(offset, true);
  }

  u32(offset: number): number {
    return this.#view.getUint32(offset, true);
  }

  f32(offset: number): number {
    return this.#view.getFloat32(offset, true);
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
