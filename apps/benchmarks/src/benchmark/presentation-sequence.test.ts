import { describe, expect, it } from 'vitest';

import { ADVANCED_SHAPING_PRESENTATION_CYCLE_DURATION_MS } from '../workloads/advanced-shaping';
import {
  adjacentPresentationWorkload,
  PRESENTATION_SCENES,
  presentationFrame,
  TEXT_LADDER_PRESENTATION_DURATION_MS,
  ZOOM_TEXT_PRESENTATION_DURATION_MS,
} from './presentation-sequence';

describe('presentation sequence', () => {
  it('keeps the reviewed one-minute scene order and durations in one table', () => {
    expect(PRESENTATION_SCENES).toEqual([
      { durationMs: 2_000, workload: 'off-axis-3d' },
      { durationMs: 2_000, workload: 'icon-grid' },
      { durationMs: 4_000, workload: 'paint-effects' },
      { durationMs: ADVANCED_SHAPING_PRESENTATION_CYCLE_DURATION_MS, workload: 'advanced-shaping' },
      { durationMs: ZOOM_TEXT_PRESENTATION_DURATION_MS, workload: 'zoom-text' },
      { durationMs: TEXT_LADDER_PRESENTATION_DURATION_MS, workload: 'text-ladder' },
      { durationMs: 9_000, preset: 'icon-grid-return', workload: 'icon-grid' },
      { durationMs: 6_000, workload: 'dynamic-layout' },
      { durationMs: 6_000, workload: 'paragraph-stress' },
      { durationMs: 8_016, workload: 'off-axis-3d' },
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
    expect(presentationFrame('paint-effects', 4_000)).toEqual({
      complete: false,
      elapsedInSceneMs: 0,
      workload: 'advanced-shaping',
    });
    expect(presentationFrame('paragraph-stress', 6_000)).toEqual({
      complete: false,
      elapsedInSceneMs: 0,
      workload: 'off-axis-3d',
    });
    expect(presentationFrame('paragraph-stress', 14_016)).toEqual({
      complete: true,
      elapsedInSceneMs: 8_016,
      workload: 'off-axis-3d',
    });
  });

  it('returns to icons with an explicit alternate preset', () => {
    expect(presentationFrame('off-axis-3d', 30_984)).toEqual({
      complete: false,
      elapsedInSceneMs: 0,
      preset: 'icon-grid-return',
      workload: 'icon-grid',
    });
  });
});
