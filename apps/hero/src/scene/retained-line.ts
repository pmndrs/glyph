import { type Glyphs, type Text } from '@pmndrs/glyph/three';
import { Matrix4 } from 'three/webgpu';

const hidden = new Matrix4().makeScale(0, 0, 0);

/** The hero's centred monospace lines, whose typing and finale reuse the same draw records every replay. */
export class RetainedLine {
  readonly glyphs: Glyphs;
  readonly #prefixOffsets: Float32Array;
  readonly #transform = new Matrix4();
  #count = -1;

  constructor(source: Pick<Text<never>, 'text' | 'glyphs' | 'breakApart' | 'parent' | 'visible'>) {
    const layout = source.glyphs();
    const full = source.text;
    this.#prefixOffsets = new Float32Array(full.length + 1);
    const [glyphs, decorations] = source.breakApart();
    decorations?.dispose();
    this.glyphs = glyphs;
    source.parent?.add(glyphs);
    source.visible = false;
    // Centre each prefix with Glyph's own spacing/trailing-space rules, once during preparation.
    // Summing advances loses the layout engine's line-end spacing and f32 rounding.
    try {
      for (let count = 1; count < full.length; count++) {
        source.text = full.slice(0, count);
        this.#prefixOffsets[count] = source.glyphs().x[0]! - layout.x[0]!;
      }
    } catch (error) {
      glyphs.dispose();
      throw error;
    } finally {
      source.text = full;
    }
  }

  /** Shows a centred prefix using matrices only, with no React update, shaping, or material allocation. */
  show(count: number): void {
    if (count === this.#count) return;
    this.#count = count;
    const shift = this.#prefixOffsets[count]!;
    for (const glyph of this.glyphs.measurements) {
      if (this.glyphs.glyphAt(glyph.index)!.cluster >= count) this.glyphs.setMatrixAt(glyph.index, hidden);
      else {
        this.#transform.copy(glyph.originalMatrix);
        this.#transform.elements[12]! += shift;
        this.glyphs.setMatrixAt(glyph.index, this.#transform);
      }
    }
  }

  /** Restore transforms after the finale, even if the visible prefix length did not change. */
  reset(count: number): void {
    this.#count = -1;
    this.glyphs.visible = true;
    this.show(count);
  }

  dispose(): void {
    this.glyphs.dispose();
  }
}
