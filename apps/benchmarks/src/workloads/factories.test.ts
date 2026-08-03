import { describe, expect, it } from 'vitest';

import { setDynamicLayoutBoundsVisibility } from './dynamic-layout';
import { iconGridEntryAssignment } from './icon-grid';

describe('comparison workload factory invariants', () => {
  it('keeps an unassigned Icon Grid pool slot hidden instead of assigning icon zero', () => {
    expect(iconGridEntryAssignment([42], 0)).toEqual({ iconIndex: 42, virtualIconIndex: 42 });
    expect(iconGridEntryAssignment([42], 1)).toEqual({ iconIndex: 0, virtualIconIndex: undefined });
  });

  it('applies Dynamic Layout bounds visibility at creation rather than relying on a later update', () => {
    const bounds = { visible: false };
    setDynamicLayoutBoundsVisibility(bounds, true);
    expect(bounds.visible).toBe(true);
  });
});
