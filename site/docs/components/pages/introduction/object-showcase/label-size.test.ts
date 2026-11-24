import { describe, expect, it } from 'vitest';

import { generatedLabelFontSize } from './label-size';

describe('dense showcase label sizing', () => {
  it('grows with box size while preserving a readable floor', () => {
    const small = generatedLabelFontSize([0.55, 0.62, 0.55]);
    const medium = generatedLabelFontSize([0.75, 0.95, 0.75]);
    const large = generatedLabelFontSize([0.98, 1.32, 0.98]);
    expect(small).toBe(0.5);
    expect(medium).toBeGreaterThan(small);
    expect(large).toBe(0.66);
  });

  it('clamps outlier sizes to the authored visual range', () => {
    expect(generatedLabelFontSize([0.1, 0.1, 0.1])).toBe(0.5);
    expect(generatedLabelFontSize([4, 4, 4])).toBe(0.66);
  });
});
