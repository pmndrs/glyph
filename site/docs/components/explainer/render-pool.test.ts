import { describe, expect, it } from 'vitest';

import { GlyphRenderPool } from './render-pool';

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

  it('grows to its cap and recycles the lowest-priority visible lease', () => {
    const pool = new GlyphRenderPool<string>(4);
    const first = pool.reconcile(
      [
        { key: 'centre', priority: 5 },
        { key: 'near-a', priority: 4 },
        { key: 'near-b', priority: 3 },
        { key: 'far', priority: 2 },
        { key: 'farthest', priority: 1 },
      ],
      0,
    );

    expect(first.map((slot) => slot?.key)).toEqual(['centre', 'near-a', 'near-b', 'far']);
    expect(pool.slots).toHaveLength(4);

    const next = pool.reconcile(
      [
        { key: 'centre', priority: 5 },
        { key: 'near-a', priority: 4 },
        { key: 'near-b', priority: 3 },
        { key: 'new-near', priority: 2 },
        { key: 'far', priority: 1 },
      ],
      10,
    );

    expect(next.map((slot) => slot?.key)).toEqual(['centre', 'near-a', 'near-b', 'new-near']);
    expect(pool.slots).toHaveLength(4);
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

  it('hands a returning key the slot that is still warm for it', () => {
    const pool = new GlyphRenderPool<string>(3);
    const [first, second] = pool.reconcile(
      [
        { key: 'first', priority: 1 },
        { key: 'second', priority: 0.5 },
      ],
      0,
    );
    pool.reconcile([{ key: 'second', priority: 1 }], 10);

    expect(pool.slots.find((slot) => slot.index === first?.index)?.warm).toBe('first');

    const returned = pool.reconcile(
      [
        { key: 'third', priority: 1 },
        { key: 'first', priority: 0.5 },
      ],
      20,
    );

    expect(returned.find((slot) => slot?.key === 'first')?.index).toBe(first?.index);
    expect(returned.find((slot) => slot?.key === 'third')?.index).not.toBe(second?.index);
    expect(pool.slots).toHaveLength(3);
  });

  it('recycles the least recently used free slot once the pool is at its cap', () => {
    const pool = new GlyphRenderPool<string>(2);
    const [older, newer] = pool.reconcile(
      [
        { key: 'older', priority: 1 },
        { key: 'newer', priority: 0.5 },
      ],
      0,
    );
    pool.reconcile([{ key: 'newer', priority: 1 }], 10);
    pool.reconcile([], 20);

    const [third] = pool.reconcile([{ key: 'third', priority: 1 }], 30);

    expect(third?.index).toBe(older?.index);
    expect(pool.slots.find((slot) => slot.index === newer?.index)?.warm).toBe('newer');
  });

  it('forgets a key so no slot stays warm for a removed target', () => {
    const pool = new GlyphRenderPool<string>(2);
    pool.reconcile([{ key: 'first', priority: 1 }], 0);
    pool.reconcile([], 10);
    pool.forget('first');

    expect(pool.slots.every((slot) => slot.warm === undefined)).toBe(true);
  });
});
