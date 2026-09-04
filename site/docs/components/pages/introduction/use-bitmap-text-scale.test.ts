import { describe, expect, it } from 'vitest';

import { bitmapTextScale } from './bitmap-text-scale';

describe('bitmapTextScale', () => {
  it('preserves the requested physical strike across Three world units', () => {
    const oneX = bitmapTextScale(16, 6, 300, 1);
    const twoX = bitmapTextScale(16, 6, 300, 2);

    expect(oneX.fontSize * oneX.rasterPixelRatio).toBe(16);
    expect(twoX.fontSize * twoX.rasterPixelRatio).toBe(32);
    expect(twoX.fontSize).toBe(oneX.fontSize);
  });
});
