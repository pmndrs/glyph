import { describe, expect, it } from 'vitest';

import { closeShowcasePanel, finishShowcaseFocus, focusShowcaseObject, ORBITING } from './interaction-state';
import { advanceSelectionScale, SHOWCASE_REST_SCALE, SHOWCASE_SELECTED_SCALE } from './selection-motion';

describe('object-showcase selection motion', () => {
  it('damps directly toward the selected and rest targets', () => {
    const focusing = focusShowcaseObject(2);
    const growing = advanceSelectionScale(SHOWCASE_REST_SCALE, focusing, 1 / 60);
    expect(growing).toBeGreaterThan(SHOWCASE_REST_SCALE);
    expect(growing).toBeLessThan(SHOWCASE_SELECTED_SCALE);
    const closing = closeShowcasePanel(finishShowcaseFocus(focusing));
    const shrinking = advanceSelectionScale(SHOWCASE_SELECTED_SCALE, closing, 1 / 60);
    expect(shrinking).toBeGreaterThan(SHOWCASE_REST_SCALE);
    expect(shrinking).toBeLessThan(SHOWCASE_SELECTED_SCALE);
    expect(advanceSelectionScale(SHOWCASE_REST_SCALE, ORBITING, 1 / 60)).toBe(SHOWCASE_REST_SCALE);
  });

  it('reverses an in-flight scale continuously by changing only its target', () => {
    const focusing = focusShowcaseObject(1);
    const open = finishShowcaseFocus(focusing);
    const beforeReverse = advanceSelectionScale(SHOWCASE_REST_SCALE, focusing, 0.08);
    const returning = advanceSelectionScale(beforeReverse, closeShowcasePanel(open), 1 / 60);
    const resumed = advanceSelectionScale(returning, focusing, 1 / 60);
    expect(returning).toBeLessThan(beforeReverse);
    expect(resumed).toBeGreaterThan(returning);
  });
});
