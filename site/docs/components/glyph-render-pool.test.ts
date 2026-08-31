import { describe, expect, it } from 'vitest';

import { GlyphRenderPool } from './glyph-render-pool';

describe('GlyphRenderPool', () => {
  it('allocates one slot per visible request and keeps assignments stable', () => {
    const pool = new GlyphRenderPool<string>(3);
    const first = pool.reconcile(
      [
        { key: 'first', priority: 0.9 },
        { key: 'second', priority: 0.8 },
      ],
      10,
    );

    expect(first.map((slot) => slot?.index)).toEqual([0, 1]);

    const second = pool.reconcile(
      [
        { key: 'second', priority: 0.9 },
        { key: 'first', priority: 0.8 },
      ],
      20,
    );

    expect(second.map((slot) => slot?.index)).toEqual([1, 0]);
  });

  it('recycles an inactive slot for a newly visible request', () => {
    const pool = new GlyphRenderPool<string>(2);
    const first = pool.reconcile(
      [
        { key: 'first', priority: 1 },
        { key: 'second', priority: 0.5 },
      ],
      0,
    );
    const recycled = pool.reconcile(
      [
        { key: 'second', priority: 1 },
        { key: 'third', priority: 0.5 },
      ],
      100,
    );

    expect(recycled.find((slot) => slot?.key === 'second')?.index).toBe(first[1]?.index);
    expect(recycled.find((slot) => slot?.key === 'third')?.index).toBe(first[0]?.index);
    expect(pool.slots).toHaveLength(2);
  });

  it('retires idle secondary roots while preserving the primary root', () => {
    const pool = new GlyphRenderPool<string>(3);
    pool.reconcile(
      [
        { key: 'first', priority: 1 },
        { key: 'second', priority: 0.5 },
      ],
      0,
    );
    pool.reconcile([{ key: 'first', priority: 1 }], 10);

    expect(pool.retireIdle(111, 100, [0]).map((slot) => slot.index)).toEqual([1]);
    expect(pool.slots.map((slot) => slot.index)).toEqual([0]);
  });

  it('reports the next idle-retirement deadline without including the protected primary', () => {
    const pool = new GlyphRenderPool<string>(3);
    pool.reconcile(
      [
        { key: 'first', priority: 1 },
        { key: 'second', priority: 0.5 },
      ],
      0,
    );
    pool.reconcile([], 40);

    expect(pool.nextRetirementDelay(70, 100, [0])).toBe(70);
    expect(pool.nextRetirementDelay(140, 100, [0])).toBe(0);
    expect(pool.nextRetirementDelay(70, 100, [0, 1])).toBeUndefined();
  });
});
