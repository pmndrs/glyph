import type { LayoutBox } from '@pmndrs/glyph';

export type MutablePoint2 = {
  set(x: number, y: number): unknown;
};

export type CaretLayoutQuery = Readonly<{
  caretAt(x: number, y: number): Readonly<{ rect: LayoutBox }> | undefined;
  selectionRects(start: number, end: number): readonly LayoutBox[] | undefined;
}>;

/** A collapsed UTF-16 selection at the logical end of editable text. */
export function selectionAtTextEnd(text: string): readonly [number, number] {
  return [text.length, text.length];
}

/** Center a left-to-right caret whose leading edge begins at a shaped cluster boundary. */
export function caretCenterAfterBoundary(boundary: number, width: number): number {
  return boundary + width / 2;
}

/** True when the renderer's committed layout describes the exact editable value being queried. */
export function isTextLayoutCommitted(
  renderedText: string,
  expectedText: string,
  status: 'unbound' | 'pending' | 'committed' | 'failed',
): boolean {
  return renderedText === expectedText && status === 'committed';
}

/** Resolve an LTR keyboard offset from shaped advance boxes rather than a synthetic point hit. */
export function caretRectAtTextOffset(text: CaretLayoutQuery, offset: number, length: number): LayoutBox | undefined {
  if (offset <= 0 || length <= 0) return text.caretAt(-1_000_000, 0)?.rect;
  const boundary = Math.min(offset, length);
  const rect = text.selectionRects(boundary - 1, boundary)?.at(-1);
  return rect === undefined ? undefined : { ...rect, x: rect.x + rect.width, width: 0 };
}

/** Map proxy-local CSS pixels to Three's normalized device coordinates without allocating. */
export function setProxyPointNdc(target: MutablePoint2, x: number, y: number, width: number, height: number): void {
  target.set((x / width) * 2 - 1, 1 - (y / height) * 2);
}
