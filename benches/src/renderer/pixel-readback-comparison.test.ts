import { describe, expect, test } from 'vitest';

import { comparePixelReadbacks } from './pixel-readback-comparison.ts';

describe('comparePixelReadbacks', () => {
  test('accepts one-byte render-target quantization while reporting it', () => {
    expect(comparePixelReadbacks([0, 64, 128, 255], [1, 63, 128, 254], 1)).toEqual({
      changedChannels: 3,
      matches: true,
      maxChannelDelta: 1,
    });
  });

  test('rejects a material coverage difference beyond quantization', () => {
    expect(comparePixelReadbacks([0, 64, 128, 255], [0, 62, 128, 255], 1)).toEqual({
      changedChannels: 1,
      matches: false,
      maxChannelDelta: 2,
    });
  });

  test('accepts a bounded number of sparse raster-edge differences', () => {
    expect(comparePixelReadbacks([0, 64, 128, 255], [0, 64, 0, 255], 1, 1)).toEqual({
      changedChannels: 1,
      matches: true,
      maxChannelDelta: 128,
    });
    expect(comparePixelReadbacks([0, 64, 128, 255], [1, 63, 0, 255], 1, 2)).toEqual({
      changedChannels: 3,
      matches: false,
      maxChannelDelta: 128,
    });
  });

  test('rejects mismatched readback dimensions', () => {
    expect(() => comparePixelReadbacks([0], [0, 1], 1)).toThrow(/length/);
  });
});
