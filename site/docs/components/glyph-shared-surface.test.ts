import { describe, expect, it } from 'vitest';

import { largestGlyphSurface } from './glyph-shared-surface';

describe('largestGlyphSurface', () => {
  it('allocates for the largest logical slot instead of summing pooled slots', () => {
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
