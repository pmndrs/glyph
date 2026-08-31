import { describe, expect, it, vi } from 'vitest';

import {
  caretCenterAfterBoundary,
  caretRectAtTextOffset,
  isTextLayoutCommitted,
  selectionAtTextEnd,
  setProxyPointNdc,
} from './editing-coordinates';

describe('editing caret coordinates', () => {
  it('starts with a collapsed UTF-16 selection at the text end', () => {
    expect(selectionAtTextEnd('A😀')).toEqual([3, 3]);
  });

  it('places the visible caret after rather than across its shaped boundary', () => {
    expect(caretCenterAfterBoundary(10, 2)).toBe(11);
  });

  it('does not read a stale layout while an edited value is still pending', () => {
    expect(isTextLayoutCommitted('edit glyphs', 'edit glyph', 'committed')).toBe(false);
    expect(isTextLayoutCommitted('edit glyph', 'edit glyph', 'pending')).toBe(false);
    expect(isTextLayoutCommitted('edit glyph', 'edit glyph', 'committed')).toBe(true);
  });

  it('resolves the text end from the last shaped advance instead of a far-right point hit', () => {
    const caretAt = vi.fn();
    const selectionRects = vi.fn(() => [{ x: 10, y: 2, width: 7, height: 12 }]);

    expect(caretRectAtTextOffset({ caretAt, selectionRects }, 3, 3)).toEqual({
      x: 17,
      y: 2,
      width: 0,
      height: 12,
    });
    expect(selectionRects).toHaveBeenCalledWith(2, 3);
    expect(caretAt).not.toHaveBeenCalled();
  });
});

describe('setProxyPointNdc', () => {
  it.each([
    [0, 0, -1, 1],
    [400, 200, 0, 0],
    [800, 400, 1, -1],
  ])('maps proxy pixel (%s, %s) to NDC (%s, %s)', (x, y, expectedX, expectedY) => {
    const point = {
      x: 0,
      y: 0,
      set(nextX: number, nextY: number) {
        this.x = nextX;
        this.y = nextY;
      },
    };

    setProxyPointNdc(point, x, y, 800, 400);

    expect(point).toMatchObject({ x: expectedX, y: expectedY });
  });
});
