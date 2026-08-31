import { describe, expect, it } from 'vitest';

import { pillControlVisual } from './pill-control-material';

describe('object-showcase pill control visual state', () => {
  it('uses an outlined near-white idle treatment', () => {
    expect(pillControlVisual('idle', '#22c55e', 0)).toEqual({
      fillColor: '#05070b',
      fillOpacity: 0,
      outlineColor: '#f8fafc',
      textColor: '#f8fafc',
    });
  });

  it('fills white with black text on hover', () => {
    expect(pillControlVisual('hovered', '#22c55e')).toEqual({
      fillColor: '#ffffff',
      fillOpacity: 1,
      outlineColor: '#ffffff',
      textColor: '#05070b',
    });
  });

  it('uses the selected object color only while pressed', () => {
    expect(pillControlVisual('pressed', '#22c55e')).toEqual({
      fillColor: '#05070b',
      fillOpacity: 0.95,
      outlineColor: '#f8fafc',
      textColor: '#22c55e',
    });
    expect(pillControlVisual('idle', '#22c55e').textColor).toBe('#f8fafc');
  });

  it('keeps the scene-level control on a translucent black rest fill', () => {
    expect(pillControlVisual('idle', '#22c55e').fillOpacity).toBe(0.95);
  });
});
