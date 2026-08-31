import { describe, expect, it } from 'vitest';

import { advanceDenseExitScale } from './dense-exit-motion';

describe('dense showcase exit motion', () => {
  it('collapses monotonically and reaches an exact hidden state', () => {
    let scale = 1;
    for (let frame = 0; frame < 120; frame += 1) {
      const next = advanceDenseExitScale(scale, 1 / 60);
      expect(next).toBeLessThanOrEqual(scale);
      scale = next;
    }
    expect(scale).toBe(0);
  });

  it('does not advance when no frame time elapsed', () => {
    expect(advanceDenseExitScale(1, 0)).toBe(1);
  });
});
