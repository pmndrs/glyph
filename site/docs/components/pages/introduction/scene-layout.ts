import type { LayoutBox } from '@pmndrs/glyph';

/** Three-space Y for a Glyph paragraph whose visual block should be centered around `centerY`. */
export function paragraphTopFromCenter(blockHeight: number, centerY = 0): number {
  return centerY + blockHeight / 2;
}

/** Three-space paragraph origin that places measured ink around a requested scene-space center. */
export function paragraphOriginForInkCenter(ink: LayoutBox, centerX = 0, centerY = 0) {
  return {
    x: centerX - ink.x - ink.width / 2,
    y: centerY + ink.y + ink.height / 2,
  } as const;
}
