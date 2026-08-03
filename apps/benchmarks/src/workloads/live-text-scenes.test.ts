import { describe, expect, it } from 'vitest';

import { advancedShapingFrame, initialAdvancedShapingState } from './advanced-shaping/scene';
import { liveTextSceneForWorkload } from './live-text-scenes';

describe('live Text scene registry', () => {
  const showcaseFrame = advancedShapingFrame(initialAdvancedShapingState());

  it('routes only single-paragraph workloads to their authored scene definitions', () => {
    expect(
      liveTextSceneForWorkload('benchmark-ipsum', {
        fontFixture: 'inter',
        layoutWidthRatio: 0.82,
        showcaseFrame,
      })?.presentation,
    ).toBe('static');
    expect(
      liveTextSceneForWorkload('advanced-shaping', {
        fontFixture: 'noto-sans-cjk-showcase',
        layoutWidthRatio: 0.82,
        showcaseFrame,
      })?.presentation,
    ).toBe('timeline');
    expect(
      liveTextSceneForWorkload('icon-grid', {
        fontFixture: 'inter',
        layoutWidthRatio: 0.82,
        showcaseFrame,
      }),
    ).toBeUndefined();
  });
});
