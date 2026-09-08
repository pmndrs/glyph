import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type { BorrowedGlyph, BorrowedGlyphLayout } from '../layout.js';
import type { BorrowedLayoutPublication, PlanTransport } from './handle-state.js';

export function createBorrowedGlyphLayout(
  transport: PlanTransport,
  publication: BorrowedLayoutPublication,
  assertActive: () => void,
): BorrowedGlyphLayout {
  return Object.freeze(new BorrowedGlyphLayoutView(transport, publication, assertActive));
}

class BorrowedGlyphLayoutView implements BorrowedGlyphLayout {
  readonly #transport: PlanTransport;
  readonly #publication: BorrowedLayoutPublication;
  readonly #assertActive: () => void;

  constructor(transport: PlanTransport, publication: BorrowedLayoutPublication, assertActive: () => void) {
    this.#transport = transport;
    this.#publication = publication;
    this.#assertActive = assertActive;
  }

  get glyphCount(): number {
    this.#assertActive();
    return this.#publication.glyphCount;
  }

  glyphAt(index: number): BorrowedGlyph {
    this.#assertActive();
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
