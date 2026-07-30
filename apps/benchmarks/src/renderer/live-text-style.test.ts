import { describe, expect, it } from 'vitest';

import { benchmarkContentWidth, liveTextPosition } from './live-text-style';

describe('benchmark content width', () => {
  it('holds the authored minimum below the reference viewport and grows inside larger viewports', () => {
    expect(benchmarkContentWidth(390, 0.8)).toBe(576);
    expect(benchmarkContentWidth(768, 0.8)).toBe(576);
    expect(benchmarkContentWidth(1_280, 0.8)).toBeCloseTo(985.6);
  });

  it('leaves the shared inset at the full-width setting', () => {
    expect(benchmarkContentWidth(1_280, 1)).toBe(1_232);
  });

  it('rejects invalid viewport and ratio inputs', () => {
    expect(() => benchmarkContentWidth(0, 0.8)).toThrow('viewport width');
    expect(() => benchmarkContentWidth(640, 0)).toThrow('layout width ratio');
    expect(() => benchmarkContentWidth(640, 1.1)).toThrow('layout width ratio');
  });
});

describe('live text position', () => {
  it('keeps a stable typewriter measure at a fixed top inset', () => {
    expect(liveTextPosition('top-start', 900, 640, 640, 20)).toEqual([130, -48]);
    expect(liveTextPosition('top-start', 900, 640, 640, 260)).toEqual([130, -48]);
  });

  it('centers a stable paragraph measure in both axes', () => {
    expect(liveTextPosition('measure-center', 900, 640, 640, 260)).toEqual([130, -190]);
  });

  it('centers ordinary live specimens from their committed layout bounds', () => {
    expect(liveTextPosition('center', 900, 640, 640, 260)).toEqual([130, -190]);
  });
});
