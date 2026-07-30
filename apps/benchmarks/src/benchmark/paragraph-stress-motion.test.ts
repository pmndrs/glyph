import { describe, expect, it } from 'vitest';

import { paragraphStressMotionFrame } from './paragraph-stress-motion';

describe('paragraph stress presentation motion', () => {
  it('shrinks width, then font size, then scrolls', () => {
    const start = paragraphStressMotionFrame(0, 50, 24);
    const widthBeat = paragraphStressMotionFrame(1_000, 50, 24);
    const fontBeat = paragraphStressMotionFrame(2_750, 50, 24);
    const scrollBeat = paragraphStressMotionFrame(5_500, 50, 24);

    expect(start).toEqual({ fontSize: 24, layoutWidthPercent: 82, scrollProgress: 0 });
    expect(widthBeat.layoutWidthPercent).toBeLessThan(82);
    expect(widthBeat.fontSize).toBe(24);
    expect(widthBeat.scrollProgress).toBe(0);
    expect(fontBeat.layoutWidthPercent).toBe(40);
    expect(fontBeat.fontSize).toBeLessThan(24);
    expect(fontBeat.scrollProgress).toBe(0);
    expect(scrollBeat.fontSize).toBe(8);
    expect(scrollBeat.scrollProgress).toBeGreaterThan(0);
  });

  it('rejects invalid timing inputs', () => {
    expect(() => paragraphStressMotionFrame(-1, 50, 24)).toThrow('elapsed time must be finite and nonnegative');
    expect(() => paragraphStressMotionFrame(0, 101, 24)).toThrow('animation speed must be in [0, 100]');
    expect(() => paragraphStressMotionFrame(0, 50, 7)).toThrow('start font size must be at least 8');
  });
});
