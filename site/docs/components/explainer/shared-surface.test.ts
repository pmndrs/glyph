import { describe, expect, it } from 'vitest';

import { largestGlyphSurface, proxyPointToVirtualFrame } from './shared-surface';

describe('largestGlyphSurface', () => {
  it('allocates for the largest registered proxy instead of summing proxy sizes', () => {
    expect(
      largestGlyphSurface([
        { dpr: 2, height: 240, width: 640 },
        { dpr: 2, height: 480, width: 420 },
      ]),
    ).toEqual({ dpr: 2, height: 480, width: 640 });
  });

  it('keeps a valid one-pixel host when no slot is active', () => {
    expect(largestGlyphSurface([])).toEqual({ dpr: 1, height: 1, width: 1 });
  });
});

describe('proxyPointToVirtualFrame', () => {
  it('adds the centered crop offset on both axes', () => {
    expect(
      proxyPointToVirtualFrame({ height: 480, width: 640 }, { height: 240, width: 400 }, { x: 30, y: 20 }),
    ).toEqual({ x: 150, y: 140 });
  });

  it('keeps coordinates unchanged for a full-size proxy', () => {
    expect(
      proxyPointToVirtualFrame({ height: 480, width: 640 }, { height: 480, width: 640 }, { x: 30, y: 20 }),
    ).toEqual({ x: 30, y: 20 });
  });
});
