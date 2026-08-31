import { describe, expect, it } from 'vitest';

import { labelAnchor, SHOWCASE_OBJECTS } from './showcase-objects';

describe('object showcase fixtures', () => {
  it('defines six deterministic, uniquely keyed object types', () => {
    expect(SHOWCASE_OBJECTS).toHaveLength(6);
    expect(new Set(SHOWCASE_OBJECTS.map((object) => object.id)).size).toBe(6);
    expect(new Set(SHOWCASE_OBJECTS.map((object) => object.icon)).size).toBe(6);
  });

  it('keeps initial objects within the authored one-to-two-unit scale range', () => {
    for (const object of SHOWCASE_OBJECTS) {
      for (const size of object.size) expect(size).toBeGreaterThanOrEqual(1);
      for (const size of object.size) expect(size).toBeLessThanOrEqual(2);
    }
  });

  it('anchors every label over the horizontal center of its object', () => {
    for (const object of SHOWCASE_OBJECTS) {
      const [labelX, , labelZ] = labelAnchor(object);
      expect(labelX).toBe(object.position[0]);
      expect(labelZ).toBe(object.position[1]);
    }
  });
});
