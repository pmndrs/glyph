import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type { GlyphOutlineView } from '../glyph-outline.js';
import type { BorrowedGlyph, BorrowedGlyphLayout, GlyphLayoutColumns } from '../layout.js';
import type { BorrowedLayoutPublication, PlanTransport } from './handle-state.js';

/** Decodes one glyph's outline into views that the next decode replaces. */
export type OutlineDecoder = (fontHandle: number, glyphId: number, target?: GlyphOutlineView) => GlyphOutlineView;

export function createBorrowedGlyphLayout(
  transport: PlanTransport,
  publication: BorrowedLayoutPublication,
  assertActive: () => void,
  decodeOutline: OutlineDecoder,
  recordRead: () => void,
): BorrowedGlyphLayout {
  return Object.freeze(new BorrowedGlyphLayoutView(transport, publication, assertActive, decodeOutline, recordRead));
}

export function createInspectionBorrowedGlyphLayout(
  inspection: GlyphLayoutColumns,
  assertActive: () => void,
  decodeOutline: OutlineDecoder,
): BorrowedGlyphLayout {
  return Object.freeze(new InspectionBorrowedGlyphLayoutView(inspection, assertActive, decodeOutline));
}

/** The font handle of glyph `index`, which the layout stores once per font slot. */
export function fontHandleAt(layout: GlyphLayoutColumns, index: number): number {
  const fontHandle = layout.fontHandles[layout.glyphFontSlots[index]!];
  if (fontHandle === undefined) throw new RangeError('borrowed layout glyph references a missing font slot');
  return fontHandle;
}

function assertGlyphIndex(index: number, glyphCount: number): void {
  if (!Number.isSafeInteger(index) || index < 0 || index >= glyphCount) {
    throw new RangeError('borrowed layout glyph index is outside its range');
  }
}

/** Records fetched by the first sequential miss after a single-record read; each further one quadruples it. */
const SEQUENTIAL_WINDOW_RECORDS = 32;

class BorrowedGlyphLayoutView implements BorrowedGlyphLayout {
  readonly #transport: PlanTransport;
  readonly #publication: BorrowedLayoutPublication;
  readonly #assertActive: () => void;
  readonly #decodeOutline: OutlineDecoder;
  readonly #recordRead: () => void;
  /** The last fetched record range. No other paragraph can be borrowed during this one, so it stays as fetched. */
  #window: DataView | undefined;
  #windowStart = 0;
  #windowCount = 0;

  constructor(
    transport: PlanTransport,
    publication: BorrowedLayoutPublication,
    assertActive: () => void,
    decodeOutline: OutlineDecoder,
    recordRead: () => void,
  ) {
    this.#transport = transport;
    this.#publication = publication;
    this.#assertActive = assertActive;
    this.#decodeOutline = decodeOutline;
    this.#recordRead = recordRead;
  }

  get glyphCount(): number {
    this.#assertActive();
    return this.#publication.glyphCount;
  }

  outlineAt(index: number, target?: GlyphOutlineView): GlyphOutlineView {
    this.#assertActive();
    const base = this.#recordOffset(index);
    const view = this.#window!;
    const layout = textShaperAbi.layouts.borrowedGlyph;
    const outline = this.#decodeOutline(
      view.getUint32(base + layout.fontHandle, true),
      view.getUint16(base + layout.glyphId, true),
      target,
    );
    this.#recordRead();
    return outline;
  }

  glyphAt(index: number): BorrowedGlyph {
    this.#assertActive();
    const base = this.#recordOffset(index);
    const view = this.#window!;
    const layout = textShaperAbi.layouts.borrowedGlyph;
    const bidiLevel = view.getUint8(base + layout.bidiLevel);
    if (bidiLevel > 125) throw new RangeError('borrowed layout glyph has an invalid bidi level');
    const glyph = Object.freeze({
      stableId: view.getUint32(base + layout.stableId, true),
      fontHandle: view.getUint32(base + layout.fontHandle, true),
      glyphId: view.getUint16(base + layout.glyphId, true),
      cluster: view.getUint32(base + layout.cluster, true),
      bidiLevel,
      fontSize: view.getFloat32(base + layout.fontSize, true),
      x: view.getFloat32(base + layout.inlineOrigin, true),
      y: view.getFloat32(base + layout.blockOrigin, true),
      advance: view.getFloat32(base + layout.inlineAdvance, true),
      inkX: view.getFloat32(base + layout.inkInlineStart, true),
      inkY: view.getFloat32(base + layout.inkBlockStart, true),
      inkWidth: view.getFloat32(base + layout.inkInlineExtent, true),
      inkHeight: view.getFloat32(base + layout.inkBlockExtent, true),
      flags: view.getUint16(base + layout.flags, true),
    });
    this.#recordRead();
    return glyph;
  }

  /**
   * Returns record `index`'s byte offset in the fetched window. One isolated read crosses for one record; a read
   * that continues where the window ended fetches a growing range, so a full scan is a handful of crossings.
   */
  #recordOffset(index: number): number {
    const size = textShaperAbi.layouts.borrowedGlyph.size;
    const start = this.#windowStart;
    const end = start + this.#windowCount;
    if (this.#window !== undefined && index >= start && index < end) {
      // An outline decode inside this borrow may have grown engine memory, which moves the range but keeps it.
      if (this.#window.buffer.byteLength === 0) {
        this.#window = this.#transport.borrowParagraphGlyphs(this.#publication, start, this.#windowCount);
      } else {
        this.#transport.assertLayoutBorrowed(this.#publication);
      }
      return (index - start) * size;
    }
    let count = 1;
    if (this.#window !== undefined && index === end) {
      count = Math.min(
        this.#windowCount === 1 ? SEQUENTIAL_WINDOW_RECORDS : this.#windowCount * 4,
        textShaperAbi.engine.borrowedGlyphCapacity,
        this.#publication.glyphCount - index,
      );
    }
    this.#window = this.#transport.borrowParagraphGlyphs(this.#publication, index, count);
    this.#windowStart = index;
    this.#windowCount = count;
    return 0;
  }
}

class InspectionBorrowedGlyphLayoutView implements BorrowedGlyphLayout {
  readonly #inspection: GlyphLayoutColumns;
  readonly #assertActive: () => void;
  readonly #decodeOutline: OutlineDecoder;

  constructor(inspection: GlyphLayoutColumns, assertActive: () => void, decodeOutline: OutlineDecoder) {
    this.#inspection = inspection;
    this.#assertActive = assertActive;
    this.#decodeOutline = decodeOutline;
  }

  outlineAt(index: number, target?: GlyphOutlineView): GlyphOutlineView {
    this.#assertActive();
    const layout = this.#inspection;
    assertGlyphIndex(index, layout.glyphCount);
    return this.#decodeOutline(fontHandleAt(layout, index), layout.glyphIds[index]!, target);
  }

  get glyphCount(): number {
    this.#assertActive();
    return this.#inspection.glyphCount;
  }

  glyphAt(index: number): BorrowedGlyph {
    this.#assertActive();
    const layout = this.#inspection;
    assertGlyphIndex(index, layout.glyphCount);
    return Object.freeze({
      stableId: layout.glyphStableIds[index]!,
      fontHandle: fontHandleAt(layout, index),
      glyphId: layout.glyphIds[index]!,
      cluster: layout.clusters[index]!,
      bidiLevel: layout.glyphBidiLevels[index]!,
      fontSize: layout.glyphFontSizes[index]!,
      x: layout.x[index]!,
      y: layout.y[index]!,
      advance: layout.glyphAdvances[index]!,
      inkX: layout.glyphInkX[index]!,
      inkY: layout.glyphInkY[index]!,
      inkWidth: layout.glyphInkWidths[index]!,
      inkHeight: layout.glyphInkHeights[index]!,
      flags: layout.glyphFlags[index]!,
    });
  }
}
