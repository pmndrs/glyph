import { describe, expect, it } from 'vitest';

import { assertTslBaselinePixels } from './tsl-baseline';

describe('TSL renderer baseline oracle', () => {
  it('accepts the exact fixed red readback', () => {
    const pixels = new Uint8Array(4 * 4 * 4);
    for (let offset = 0; offset < pixels.byteLength; offset += 4) {
      pixels.set([255, 0, 0, 255], offset);
    }
    expect(() => assertTslBaselinePixels(pixels)).not.toThrow();
  });

  it('rejects an intentional wrong-pixel negative control', () => {
    const pixels = new Uint8Array(4 * 4 * 4);
    for (let offset = 0; offset < pixels.byteLength; offset += 4) {
      pixels.set([255, 0, 0, 255], offset);
    }
    pixels[17] = 1;
    expect(() => assertTslBaselinePixels(pixels)).toThrow('pixel 4 channel 1');
  });
});
