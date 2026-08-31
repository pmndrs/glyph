import { describe, expect, it, vi } from 'vitest';

import { advancePooledRoots, type GlyphFrameStore } from './glyph-frame-scheduler';

describe('advancePooledRoots', () => {
  it('steps the global R3F scheduler exactly once for multiple active roots', () => {
    const first = vi.fn();
    const second = vi.fn();
    const stores: GlyphFrameStore[] = [
      { getState: () => ({ advance: first }) },
      { getState: () => ({ advance: second }) },
    ];

    advancePooledRoots(stores, 42);

    expect(first).toHaveBeenCalledExactlyOnceWith(42);
    expect(second).not.toHaveBeenCalled();
  });
});
