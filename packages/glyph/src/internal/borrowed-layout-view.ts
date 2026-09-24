import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type { GlyphOutlineContour } from '../glyph-outline.js';
import type { BorrowedGlyph, BorrowedGlyphLayout, GlyphLayoutInspection } from '../layout.js';
import type { BorrowedLayoutPublication, PlanTransport } from './handle-state.js';

type OutlineDecoder = (glyph: BorrowedGlyph) => GlyphOutlineContour[];

export function createBorrowedGlyphLayout(
  transport: PlanTransport,
  publication: BorrowedLayoutPublication,
  assertOpen: () => void,
  assertCurrent: () => void,
  decodeOutline: OutlineDecoder,
): BorrowedGlyphLayout {
  return Object.freeze(new BorrowedGlyphLayoutView(transport, publication, assertOpen, assertCurrent, decodeOutline));
}

export function createInspectionBorrowedGlyphLayout(
  inspection: GlyphLayoutInspection,
  assertActive: () => void,
  decodeOutline: OutlineDecoder,
): BorrowedGlyphLayout {
  return Object.freeze(new InspectionBorrowedGlyphLayoutView(inspection, assertActive, decodeOutline));
}

function assertGlyphIndex(index: number, glyphCount: number): void {
  if (!Number.isSafeInteger(index) || index < 0 || index >= glyphCount) {
    throw new RangeError('borrowed layout glyph index is outside its range');
  }
}

class BorrowedGlyphLayoutView implements BorrowedGlyphLayout {
  readonly #transport: PlanTransport;
  readonly #publication: BorrowedLayoutPublication;
  readonly #assertOpen: () => void;
  readonly #assertCurrent: () => void;
  readonly #decodeOutline: OutlineDecoder;
  #snapshot: readonly BorrowedGlyph[] | undefined;

  constructor(
    transport: PlanTransport,
    publication: BorrowedLayoutPublication,
    assertOpen: () => void,
    assertCurrent: () => void,
    decodeOutline: OutlineDecoder,
  ) {
    this.#transport = transport;
    this.#publication = publication;
    this.#assertOpen = assertOpen;
    this.#assertCurrent = assertCurrent;
    this.#decodeOutline = decodeOutline;
  }

  get glyphCount(): number {
    this.#assertActive();
    return this.#publication.glyphCount;
  }

  glyphAt(index: number): BorrowedGlyph {
    this.#assertActive();
    if (this.#snapshot === undefined) return this.#readGlyph(index);
    assertGlyphIndex(index, this.#snapshot.length);
    return this.#snapshot[index]!;
  }

  outlineAt(index: number): GlyphOutlineContour[] {
    this.#assertActive();
    if (this.#snapshot === undefined) {
      const snapshot: BorrowedGlyph[] = [];
      for (let glyph = 0; glyph < this.#publication.glyphCount; glyph += 1) snapshot.push(this.#readGlyph(glyph));
      this.#snapshot = snapshot;
    }
    assertGlyphIndex(index, this.#snapshot.length);
    return this.#decodeOutline(this.#snapshot[index]!);
  }

  #assertActive(): void {
    this.#assertOpen();
    if (this.#snapshot === undefined) this.#assertCurrent();
  }

  #readGlyph(index: number): BorrowedGlyph {
    const pointer = this.#transport.borrowParagraphGlyph(this.#publication, index);
    const layout = textShaperAbi.layouts.borrowedGlyph;
    const view = new DataView(this.#publication.memoryBuffer, pointer, layout.size);
    const bidiLevel = view.getUint8(layout.bidiLevel);
    if (bidiLevel > 125) throw new RangeError('borrowed layout glyph has an invalid bidi level');
    return Object.freeze({
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
  }
}

class InspectionBorrowedGlyphLayoutView implements BorrowedGlyphLayout {
  readonly #inspection: GlyphLayoutInspection;
  readonly #assertActive: () => void;
  readonly #decodeOutline: OutlineDecoder;

  constructor(inspection: GlyphLayoutInspection, assertActive: () => void, decodeOutline: OutlineDecoder) {
    this.#inspection = inspection;
    this.#assertActive = assertActive;
    this.#decodeOutline = decodeOutline;
  }

  outlineAt(index: number): GlyphOutlineContour[] {
    return this.#decodeOutline(this.glyphAt(index));
  }

  get glyphCount(): number {
    this.#assertActive();
    return this.#inspection.glyphCount;
  }

  glyphAt(index: number): BorrowedGlyph {
    this.#assertActive();
    const layout = this.#inspection;
    assertGlyphIndex(index, layout.glyphCount);
    const fontSlot = layout.glyphFontSlots[index]!;
    const fontHandle = layout.fontHandles[fontSlot];
    if (fontHandle === undefined) throw new RangeError('borrowed layout glyph references a missing font slot');
    return Object.freeze({
      stableId: layout.glyphStableIds[index]!,
      fontHandle,
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
