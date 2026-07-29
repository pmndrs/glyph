import { describe, expect, it } from 'vitest';

import { exactBaseTextureArrayBytes } from './texture-memory';

describe('exact base texture-array accounting', () => {
  it('counts every layer in the padded base-level allocation', () => {
    expect(exactBaseTextureArrayBytes(1024, 1024, 10, 4)).toBe(41_943_040);
  });

  it('preserves non-power-of-two base dimensions', () => {
    expect(exactBaseTextureArrayBytes(1024, 1023, 24, 4)).toBe(100_564_992);
    expect(exactBaseTextureArrayBytes(1024, 1017, 44, 4)).toBe(183_287_808);
  });

  it('counts a single-texel allocation', () => {
    expect(exactBaseTextureArrayBytes(1, 1, 3, 4)).toBe(12);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid dimensions and unsafe arithmetic (%s)',
    (value) => {
      expect(() => exactBaseTextureArrayBytes(value, 1, 1, 4)).toThrow(RangeError);
    },
  );

  it('rejects an allocation whose byte length exceeds safe integer range', () => {
    expect(() => exactBaseTextureArrayBytes(Number.MAX_SAFE_INTEGER, 1, 2, 4)).toThrow(
      'texture-array byte length exceeds safe integer range',
    );
  });
});
