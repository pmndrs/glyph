import { Container3D, type Destroy3DOptions } from '@pixi/3d';
import type { GlyphCopy } from '@pmndrs/glyph';

/** Independent desired text snapshot in native Container3D space (+X right, +Y up).
 * The root copies its source local transform/origin; content retains the captured anchor. Same-parent attachment
 * replaces the source without another offset. Later source edits do not affect it; dispose it independently.
 */
export class Pixi3DTextSnapshot extends Container3D {
  #copies: GlyphCopy<void>[] = [];
  #disposed = false;
  /** @internal Copy destinations register their core-owned leases here. */
  retain(copy: GlyphCopy<void>): void {
    if (this.#disposed) throw new Error('Pixi3D text snapshot is disposed');
    this.#copies.push(copy);
  }
  get disposed(): boolean {
    return this.#disposed;
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const copy of this.#copies) copy.dispose();
    this.#copies = [];
    for (const child of this.removeChildren()) child.destroy({ children: true });
  }
  override destroy(options?: Destroy3DOptions): void {
    this.dispose();
    super.destroy(options);
  }
}
