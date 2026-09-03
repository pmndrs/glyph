import { describe, expect, it } from 'vitest';

import { rankViewportTargets } from './viewport-ranking';

describe('rankViewportTargets', () => {
  it('keeps visible targets nearest the viewport centre and excludes offscreen targets', () => {
    const ranked = rankViewportTargets(
      [
        { key: 'above', top: -300, bottom: -100, height: 200 },
        { key: 'top', top: -20, bottom: 280, height: 300 },
        { key: 'centre', top: 350, bottom: 650, height: 300 },
        { key: 'bottom', top: 760, bottom: 1_060, height: 300 },
      ],
      1_000,
    );

    expect(ranked.map(({ key }) => key)).toEqual(['centre', 'top', 'bottom']);
    expect(ranked.find(({ key }) => key === 'top')?.ratio).toBeCloseTo(280 / 300);
  });

  it('uses visible area to break equal centre-distance ties', () => {
    const ranked = rankViewportTargets(
      [
        { key: 'partial', top: -100, bottom: 600, height: 700 },
        { key: 'full', top: 650, bottom: 850, height: 200 },
      ],
      1_000,
    );

    expect(ranked.map(({ key }) => key)).toEqual(['full', 'partial']);
  });
});
