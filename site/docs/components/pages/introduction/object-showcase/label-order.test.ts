import { describe, expect, it } from 'vitest';

import { farToNearLabelOrder } from './label-order';

describe('label draw order', () => {
  it('draws distant labels first and near labels last', () => {
    expect(farToNearLabelOrder([4, 25, 1, 9])).toEqual([1, 3, 0, 2]);
  });

  it('keeps source order stable when distances tie', () => {
    expect(farToNearLabelOrder([4, 4, 4])).toEqual([0, 1, 2]);
  });
});
