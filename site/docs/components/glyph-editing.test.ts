import { describe, expect, it } from 'vitest';

import { setProxyPointNdc } from './glyph-editing';

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
