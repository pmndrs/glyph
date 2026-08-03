import { describe, expect, it } from 'vitest';

import { createMtsdfTextTarget } from './mtsdf-text';

describe('MTSDF product target', () => {
  it('owns the product identity and rejects a run before its finite scene is loaded', async () => {
    const target = createMtsdfTextTarget('webgpu');
    expect(target).toMatchObject({
      id: 'mtsdf-text-webgpu',
      label: 'MTSDF text · WebGPU',
      detail: 'Inter GLB · HarfRust layout · RGBA8 KTX2 · shared TSL graph',
      color: 'cyan',
    });
    expect(target.capabilities).toEqual(
      new Set(['deterministic', 'font-bytes', 'wasm', 'shaping', 'paragraph', 'raster']),
    );
    await expect(target.run({}, 0, { dpr: 1, samples: 1, warmup: 0 })).rejects.toThrow(
      'MTSDF text target was not loaded',
    );
  });
});
