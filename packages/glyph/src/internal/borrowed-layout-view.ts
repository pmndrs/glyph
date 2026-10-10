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

class BorrowedGlyphLayoutView implements BorrowedGlyphLayout {
  readonly #transport: PlanTransport;
  readonly #publication: BorrowedLayoutPublication;
  readonly #assertActive: () => void;
  readonly #decodeOutline: OutlineDecoder;
  readonly #recordRead: () => void;

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
    const view = this.#transport.borrowParagraphGlyph(this.#publication, index);
    const layout = textShaperAbi.layouts.borrowedGlyph;
    const outline = this.#decodeOutline(
      view.getUint32(layout.fontHandle, true),
      view.getUint16(layout.glyphId, true),
      target,
    );
    this.#recordRead();
    return outline;
  }

  glyphAt(index: number): BorrowedGlyph {
    this.#assertActive();
    const view = this.#transport.borrowParagraphGlyph(this.#publication, index);
    const layout = textShaperAbi.layouts.borrowedGlyph;
    const bidiLevel = view.getUint8(layout.bidiLevel);
    if (bidiLevel > 125) throw new RangeError('borrowed layout glyph has an invalid bidi level');
    const glyph = Object.freeze({
      stableId: view.getUint32(layout.stableId, true),
      fontHandle: view.getUint32(layout.fontHandle, true),
      glyphId: view.getUint16(layout.glyphId, true),
      cluster: view.getUint32(layout.cluster, true),
      bidiLevel,
      fontSize: view.getFloat32(layout.fontSize, true),
      x: view.getFloat32(layout.inlineOrigin, true),
      y: view.getFloat32(layout.blockOrigin, true),
      advance: view.getFloat32(layout.inlineAdvance, true),
      inkX: view.getFloat32(layout.inkInlineStart, true),
      inkY: view.getFloat32(layout.inkBlockStart, true),
      inkWidth: view.getFloat32(layout.inkInlineExtent, true),
      inkHeight: view.getFloat32(layout.inkBlockExtent, true),
      flags: view.getUint16(layout.flags, true),
    });
    this.#recordRead();
    return glyph;
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
