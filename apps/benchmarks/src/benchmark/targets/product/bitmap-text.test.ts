import { describe, expect, it } from 'vitest';

import { createBitmapTextTarget } from './bitmap-text';

describe('Bitmap product target', () => {
  it('owns the product identity and rejects a run before its finite scene is loaded', async () => {
    const target = createBitmapTextTarget('webgpu');
    expect(target).toMatchObject({
      id: 'bitmap-text-webgpu',
      label: 'Bitmap text · WebGPU',
      detail: 'Selected font GLB · HarfRust layout · R8 KTX2 · instanced TSL',
      color: 'cyan',
    });
    expect(target.capabilities).toEqual(
      new Set(['deterministic', 'font-bytes', 'wasm', 'shaping', 'paragraph', 'raster']),
    );
    await expect(target.run({}, 0, { dpr: 1, samples: 1, warmup: 0 })).rejects.toThrow(
      'bitmap text target was not loaded',
    );
  });
});
