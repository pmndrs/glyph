import { describe, expect, it } from 'vitest';

import { assertSourceOutlineTransform } from './source-outline-reference';

describe('source-outline transform validation', () => {
  it('accepts a finite invertible affine transform', () => {
    expect(() => assertSourceOutlineTransform({ a: 2, b: 0.5, c: -0.25, d: 3, e: 12, f: -8 })).not.toThrow();
  });

  it('rejects non-finite and singular transforms', () => {
    expect(() => assertSourceOutlineTransform({ a: Number.NaN, b: 0, c: 0, d: 1, e: 0, f: 0 })).toThrow(
      'components must be finite',
    );
    expect(() => assertSourceOutlineTransform({ a: 2, b: 4, c: 1, d: 2, e: 0, f: 0 })).toThrow('must be invertible');
  });
});
