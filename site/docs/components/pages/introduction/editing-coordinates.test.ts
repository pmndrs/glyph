import { describe, expect, it } from 'vitest';

import { caretCenterAfterBoundary, orderedRange, positionAtTextEnd, setProxyPointNdc } from './editing-coordinates';

describe('editing caret coordinates', () => {
  it('starts with a collapsed UTF-16 position at the text end', () => {
    expect(positionAtTextEnd('A😀')).toEqual({ offset: 3, affinity: 'upstream' });
  });

  it('orders a backwards drag, because the range queries reject a reversed range', () => {
    expect(orderedRange(7, 2)).toEqual([2, 7]);
    expect(orderedRange(2, 7)).toEqual([2, 7]);
  });

  it('places the visible caret after rather than across its boundary', () => {
    expect(caretCenterAfterBoundary(10, 2)).toBe(11);
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
