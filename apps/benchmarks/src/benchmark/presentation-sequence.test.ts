import { describe, expect, it } from 'vitest';

import { adjacentPresentationWorkload, PRESENTATION_SCENES, presentationFrame } from './presentation-sequence';

describe('presentation sequence', () => {
  it('keeps the reviewed one-minute scene order and durations in one table', () => {
    expect(PRESENTATION_SCENES).toEqual([
      { durationMs: 7_000, workload: 'off-axis-3d' },
      { durationMs: 8_000, workload: 'icon-grid' },
      { durationMs: 7_000, workload: 'paint-effects' },
      { durationMs: 10_000, workload: 'advanced-shaping' },
      { durationMs: 7_000, workload: 'zoom-text' },
      { durationMs: 7_000, workload: 'text-ladder' },
      { durationMs: 7_000, workload: 'dynamic-layout' },
      { durationMs: 7_000, workload: 'paragraph-stress' },
    ]);
    expect(PRESENTATION_SCENES.reduce((total, scene) => total + scene.durationMs, 0)).toBe(60_000);
  });

  it('navigates linearly without wrapping past either end', () => {
    expect(adjacentPresentationWorkload('off-axis-3d', -1)).toBe('off-axis-3d');
    expect(adjacentPresentationWorkload('off-axis-3d', 1)).toBe('icon-grid');
    expect(adjacentPresentationWorkload('paragraph-stress', 1)).toBe('paragraph-stress');
    expect(adjacentPresentationWorkload('unknown', 1)).toBe('off-axis-3d');
    expect(adjacentPresentationWorkload('unknown', -1)).toBe('paragraph-stress');
  });

  it('plays from the selected scene through the end', () => {
    expect(presentationFrame('paint-effects', 0)).toEqual({
      complete: false,
      elapsedInSceneMs: 0,
      workload: 'paint-effects',
    });
    expect(presentationFrame('paint-effects', 7_000)).toEqual({
      complete: false,
      elapsedInSceneMs: 0,
      workload: 'advanced-shaping',
    });
    expect(presentationFrame('paragraph-stress', 7_000)).toEqual({
      complete: true,
      elapsedInSceneMs: 7_000,
      workload: 'paragraph-stress',
    });
  });
});
