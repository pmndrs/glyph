import type { TextPosition } from '@pmndrs/glyph';

export type MutablePoint2 = {
  set(x: number, y: number): unknown;
};

/** A collapsed position at the logical end of editable text, in UTF-16 code units. */
export function positionAtTextEnd(text: string): TextPosition {
  return { offset: text.length, affinity: 'upstream' };
}

/** A selection's anchor and focus as the ordered `[start, end)` the range queries require. */
export function orderedRange(anchor: number, focus: number): readonly [start: number, end: number] {
  return anchor <= focus ? [anchor, focus] : [focus, anchor];
}

/** Center a caret bar so its leading edge sits on the caret rectangle's x. */
export function caretCenterAfterBoundary(boundary: number, width: number): number {
  return boundary + width / 2;
}

/** Map proxy-local CSS pixels to Three's normalized device coordinates without allocating. */
export function setProxyPointNdc(target: MutablePoint2, x: number, y: number, width: number, height: number): void {
  target.set((x / width) * 2 - 1, 1 - (y / height) * 2);
}
