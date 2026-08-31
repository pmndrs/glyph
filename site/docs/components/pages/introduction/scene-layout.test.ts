import { describe, expect, it } from 'vitest';

import { paragraphOriginForInkCenter, paragraphTopFromCenter } from './scene-layout';

describe('paragraphTopFromCenter', () => {
  it('places a downward-flowing paragraph around the scene origin', () => {
    expect(paragraphTopFromCenter(2)).toBe(1);
    expect(paragraphTopFromCenter(2, 0.5)).toBe(1.5);
    expect(paragraphTopFromCenter(2, -0.5)).toBe(0.5);
  });
});

describe('paragraphOriginForInkCenter', () => {
  it('accounts for ink overhang instead of centering the paragraph advance box', () => {
    expect(paragraphOriginForInkCenter({ x: 2, y: 1, width: 6, height: 4 })).toEqual({ x: -5, y: 3 });
    expect(paragraphOriginForInkCenter({ x: 2, y: 1, width: 6, height: 4 }, 1, -1)).toEqual({ x: -4, y: 2 });
  });
});
