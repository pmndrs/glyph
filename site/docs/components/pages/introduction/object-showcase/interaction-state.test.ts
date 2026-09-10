import { describe, expect, it } from 'vitest';

import {
  canSelectShowcaseObject,
  closeShowcasePanel,
  finishShowcaseClose,
  finishShowcaseFocus,
  focusShowcaseObject,
  ORBITING,
  showcaseLabelOpacityTarget,
  selectedShowcaseIndex,
} from './interaction-state';

describe('object-showcase interaction state', () => {
  it('moves through the complete focus and close lifecycle without losing the selection', () => {
    const focusing = focusShowcaseObject(4);
    expect(focusing).toEqual({ phase: 'focusing', selectedIndex: 4 });
    expect(selectedShowcaseIndex(focusing)).toBe(4);

    const open = finishShowcaseFocus(focusing);
    expect(open).toEqual({ phase: 'open', selectedIndex: 4 });

    const closing = closeShowcasePanel(open);
    expect(closing).toEqual({ phase: 'closing', selectedIndex: 4 });
    expect(finishShowcaseClose(closing)).toBe(ORBITING);
    expect(selectedShowcaseIndex(ORBITING)).toBeUndefined();
  });

  it('ignores stale completion events that do not match the active phase', () => {
    const focusing = focusShowcaseObject(2);
    expect(finishShowcaseClose(focusing)).toBe(focusing);
    const open = finishShowcaseFocus(focusing);
    expect(finishShowcaseFocus(open)).toBe(open);
    expect(closeShowcasePanel(ORBITING)).toBe(ORBITING);
  });

  it('crossfades labels out while focusing and back in during the camera return', () => {
    const focusing = focusShowcaseObject(1);
    const open = finishShowcaseFocus(focusing);
    const closing = closeShowcasePanel(open);
    expect(showcaseLabelOpacityTarget(ORBITING)).toBe(1);
    expect(showcaseLabelOpacityTarget(focusing)).toBe(0);
    expect(showcaseLabelOpacityTarget(open)).toBe(0);
    expect(showcaseLabelOpacityTarget(closing)).toBe(1);
    expect(canSelectShowcaseObject(focusing)).toBe(false);
    expect(canSelectShowcaseObject(open)).toBe(false);
    expect(canSelectShowcaseObject(closing)).toBe(true);
    expect(canSelectShowcaseObject(ORBITING)).toBe(true);
  });
});
