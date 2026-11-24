import { describe, expect, it } from 'vitest';

import { isShowcaseLabelVisible } from './label-visibility';

describe('object-showcase label visibility', () => {
  it('hides primary labels and reveals spawned child labels in dense mode', () => {
    expect(isShowcaseLabelVisible('primary', 2, 12, true, undefined, false)).toBe(false);
    expect(isShowcaseLabelVisible('generated', 8, 12, true, undefined, false)).toBe(true);
    expect(isShowcaseLabelVisible('generated', 12, 12, true, undefined, false)).toBe(false);
  });

  it('restores primary labels outside dense mode', () => {
    expect(isShowcaseLabelVisible('primary', 2, 6, false, undefined, false)).toBe(true);
  });

  it('shows only the selected primary label while its panel is open', () => {
    expect(isShowcaseLabelVisible('primary', 2, 6, false, 2, true)).toBe(true);
    expect(isShowcaseLabelVisible('primary', 3, 6, false, 2, true)).toBe(false);
  });
});
