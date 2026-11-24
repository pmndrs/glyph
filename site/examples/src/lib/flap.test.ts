import { describe, expect, it } from 'vitest';

import { cellAt } from './flap';

describe('cellAt', () => {
  it('maps a row-major cell to an uppercased, fixed-width board character', () => {
    const lines = ['ab', 'cdef'];

    expect(Array.from({ length: 8 }, (_, index) => cellAt(lines, index, 4)).join('')).toBe('AB  CDEF');
  });

  it('returns a blank cell when the requested row is absent', () => {
    expect(cellAt([], 17, 4)).toBe(' ');
  });
});
