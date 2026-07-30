import { describe, expect, it } from 'vitest';

import { sparklineCanvasMetrics, sparklineSampleY, sparklineTimestampX } from './sparkline';

describe('sparklineCanvasMetrics', () => {
  it('maps a fractional CSS box exactly onto its physical backing store', () => {
    expect(sparklineCanvasMetrics(287.5, 42, 2)).toEqual({
      backingHeight: 84,
      backingWidth: 575,
      cssHeight: 42,
      cssWidth: 287.5,
      pixelRatio: 2,
      scaleX: 2,
      scaleY: 2,
    });
  });

  it('uses the effective rounded backing-store scale instead of stretching later', () => {
    const metrics = sparklineCanvasMetrics(287.25, 41.75, 2);

    expect(metrics.backingWidth).toBe(575);
    expect(metrics.backingHeight).toBe(84);
    expect(metrics.cssWidth * metrics.scaleX).toBe(575);
    expect(metrics.cssHeight * metrics.scaleY).toBe(84);
  });
});

describe('sparklineTimestampX', () => {
  it('places samples on a fixed timestamp window', () => {
    expect(sparklineTimestampX(1_000, 1_000, 300, 300)).toBe(300);
    expect(sparklineTimestampX(850, 1_000, 300, 300)).toBe(150);
    expect(sparklineTimestampX(700, 1_000, 300, 300)).toBe(0);
  });

  it('moves the same sample continuously as RAF time advances', () => {
    expect(sparklineTimestampX(1_000, 1_010, 300, 300)).toBe(290);
    expect(sparklineTimestampX(1_000, 1_020, 300, 300)).toBe(280);
  });
});

describe('sparklineSampleY', () => {
  it('uses a fixed domain and clips missed budgets to the chart ceiling', () => {
    expect(sparklineSampleY(0, 16, 42)).toBe(40);
    expect(sparklineSampleY(8, 16, 42)).toBe(21);
    expect(sparklineSampleY(32, 16, 42)).toBe(2);
  });
});
