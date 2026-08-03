import { describe, expect, it } from 'vitest';

import { compactRgba8Readback } from './rgba-readback';

describe('RGBA8 readback normalization', () => {
  it('removes the row alignment returned by the WebGPU readback path', () => {
    const padded = new Uint8Array(256 * 3 + 16);
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        padded.set([255, 0, 0, 255], row * 256 + column * 4);
      }
    }
    expect(compactRgba8Readback(padded, 4, 4)).toEqual(
      Uint8Array.from({ length: 64 }, (_, index) => [255, 0, 0, 255][index % 4]!),
    );
  });

  it('normalizes the bottom-left row origin returned by WebGL readPixels', () => {
    const bottomFirst = Uint8Array.from([30, 31, 32, 33, 20, 21, 22, 23, 10, 11, 12, 13]);
    expect(compactRgba8Readback(bottomFirst, 1, 3, 'bottom-to-top')).toEqual(
      Uint8Array.from([10, 11, 12, 13, 20, 21, 22, 23, 30, 31, 32, 33]),
    );
  });
});
