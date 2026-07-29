import { describe, expect, it } from 'vitest';

import { assertBitmapTextPixels } from './bitmap-text';

describe('bitmap text readback oracle', () => {
  it('accepts visible coverage that stays inside the render target', () => {
    const pixels = new Uint8Array(16 * 16 * 4);
    for (let y = 4; y < 12; y += 1) {
      for (let x = 2; x < 15; x += 1) {
        pixels[(y * 16 + x) * 4] = 255;
      }
    }
    expect(assertBitmapTextPixels(pixels, 16, 16)).toEqual({
      litPixels: 104,
      minX: 2,
      minY: 4,
      maxX: 14,
      maxY: 11,
      inkPixels: 104,
      inkMinX: 2,
      inkMinY: 4,
      inkMaxX: 14,
      inkMaxY: 11,
      touchesBoundary: false,
      referenceMismatchBytes: 0,
    });
  });

  it('rejects clipped output as an intentional negative control', () => {
    const pixels = new Uint8Array(16 * 16 * 4);
    for (let pixel = 0; pixel < 101; pixel += 1) pixels[pixel * 4] = 255;
    expect(() => assertBitmapTextPixels(pixels, 16, 16)).toThrow('render boundary');
    expect(assertBitmapTextPixels(pixels, 16, 16, undefined, true).touchesBoundary).toBe(true);
  });

  it('rejects an empty or nearly empty shader result', () => {
    expect(() => assertBitmapTextPixels(new Uint8Array(16 * 16 * 4), 16, 16)).toThrow('enough visible coverage');
  });

  it('derives the reference mismatch count from the compared frame bytes', () => {
    const pixels = new Uint8Array(16 * 16 * 4);
    for (let y = 4; y < 12; y += 1) {
      for (let x = 2; x < 15; x += 1) pixels[(y * 16 + x) * 4] = 255;
    }
    const reference = pixels.slice();
    reference[(8 * 16 + 8) * 4] = 254;

    expect(() => assertBitmapTextPixels(pixels, 16, 16, reference)).toThrow(
      'differs from its CPU atlas reference in 1 bytes',
    );
  });
});
