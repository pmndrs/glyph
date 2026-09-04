import { describe, expect, it } from 'vitest';

import {
  createDenseShowcaseObjects,
  DENSE_ADDITION_COUNT,
  DENSE_FIELD_EXTENT,
  DENSE_REVEAL_PER_FRAME,
  DENSE_SHADE_STEPS,
  DENSE_SHOWCASE_CAPACITY,
  nextVisibleShowcaseCount,
} from './dense-showcase';
import { colorToOklch, SHOWCASE_OBJECTS } from './showcase-objects';

describe('dense object showcase', () => {
  it('builds the same themed population every time a category is launched', () => {
    for (const source of SHOWCASE_OBJECTS) {
      const first = createDenseShowcaseObjects(source);
      const second = createDenseShowcaseObjects(source);
      expect(first).toHaveLength(DENSE_ADDITION_COUNT);
      expect(first.map(serializableObject)).toEqual(second.map(serializableObject));
      expect(first.every((item) => item.category === source.category && item.role === 'generated')).toBe(true);
      expect(new Set(first.map((item) => item.label)).size).toBe(DENSE_ADDITION_COUNT);
    }
  });

  it('maps varied sizes onto a contrasting bounded OKLCH color scale', () => {
    const source = SHOWCASE_OBJECTS[1]!;
    const items = createDenseShowcaseObjects(source);
    expect(new Set(items.map((item) => item.color.getHexString())).size).toBeLessThanOrEqual(DENSE_SHADE_STEPS);
    expect(new Set(items.map((item) => item.color.getHexString())).size).toBeGreaterThan(5);
    expect(new Set(items.map((item) => item.size[0].toFixed(3))).size).toBeGreaterThan(10);
    const ordered = [...items].sort((left, right) => volume(left) - volume(right));
    const [smallLightness, smallChroma] = colorToOklch(ordered[0]!.color);
    const [largeLightness, largeChroma] = colorToOklch(ordered.at(-1)!.color);
    expect(smallLightness - largeLightness).toBeGreaterThan(0.15);
    expect(largeChroma - smallChroma).toBeGreaterThan(0.05);
  });

  it('keeps every generated footprint separated from originals and siblings', () => {
    const generated = createDenseShowcaseObjects(SHOWCASE_OBJECTS[0]!);
    const items = [...SHOWCASE_OBJECTS, ...generated];
    for (const [index, left] of items.entries()) {
      for (const right of items.slice(index + 1)) {
        const separatedX = Math.abs(left.position[0] - right.position[0]) > (left.size[0] + right.size[0]) / 2;
        const separatedZ = Math.abs(left.position[1] - right.position[1]) > (left.size[2] + right.size[2]) / 2;
        expect(separatedX || separatedZ).toBe(true);
      }
    }
  });

  it('uses both plane axes through a thin perimeter margin', () => {
    const items = createDenseShowcaseObjects(SHOWCASE_OBJECTS[3]!);
    const x = items.map((item) => item.position[0]);
    const z = items.map((item) => item.position[1]);
    expect(Math.min(...x)).toBeLessThan(-DENSE_FIELD_EXTENT[0] * 0.92);
    expect(Math.max(...x)).toBeGreaterThan(DENSE_FIELD_EXTENT[0] * 0.92);
    expect(Math.min(...z)).toBeLessThan(-DENSE_FIELD_EXTENT[1] * 0.92);
    expect(Math.max(...z)).toBeGreaterThan(DENSE_FIELD_EXTENT[1] * 0.92);
  });

  it('reveals exactly one child per frame until the population is visible', () => {
    expect(nextVisibleShowcaseCount(6, DENSE_SHOWCASE_CAPACITY)).toBe(6 + DENSE_REVEAL_PER_FRAME);
    expect(nextVisibleShowcaseCount(DENSE_SHOWCASE_CAPACITY - 1, DENSE_SHOWCASE_CAPACITY)).toBe(
      DENSE_SHOWCASE_CAPACITY,
    );
    expect(nextVisibleShowcaseCount(DENSE_SHOWCASE_CAPACITY, DENSE_SHOWCASE_CAPACITY)).toBe(DENSE_SHOWCASE_CAPACITY);
  });
});

function serializableObject(item: (typeof SHOWCASE_OBJECTS)[number]) {
  return {
    color: item.color.getHexString(),
    id: item.id,
    label: item.label,
    position: item.position,
    size: item.size,
  };
}

function volume(item: (typeof SHOWCASE_OBJECTS)[number]): number {
  return item.size[0] * item.size[1] * item.size[2];
}
