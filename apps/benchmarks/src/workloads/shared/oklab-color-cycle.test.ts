import { describe, expect, it } from 'vitest';

import { createOklabColorCycle } from './oklab-color-cycle';

describe('OKLab palette cycle', () => {
  it('preserves every authored starting color and its offset', () => {
    const palette = [0xa855f7, 0x22d3ee, 0x34d399, 0xf59e0b, 0xfb7185, 0xff4dc4];
    const color = createOklabColorCycle(palette);
    expect(palette.map((_, offset) => color(offset, 0))).toEqual(palette);
    expect(color(0, 1 / palette.length)).toBe(palette[1]);
  });

  it('wraps one full phase without changing the result', () => {
    const color = createOklabColorCycle([0xff0000, 0x0000ff]);
    expect(color(0, 0.25)).toBe(color(0, 1.25));
  });

  it('retains deterministic scalar interpolation across repeated frame samples', () => {
    const color = createOklabColorCycle([0xff0000, 0x0000ff]);
    const expected = color(1, 0.375);

    for (let index = 0; index < 120; index += 1) {
      expect(color(1, 0.375)).toBe(expected);
    }
  });

  it('rejects an unusable palette', () => {
    expect(() => createOklabColorCycle([0xffffff])).toThrow('at least two colors');
  });
});
