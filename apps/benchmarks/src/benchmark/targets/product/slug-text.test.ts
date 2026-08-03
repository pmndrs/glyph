import { describe, expect, it } from 'vitest';
import { createSlugTextTarget } from './slug-text';

describe('Slug product target', () => {
  it('owns its public metadata and rejects runs before its finite scene is loaded', async () => {
    const target = createSlugTextTarget('webgpu');

    expect(target).toMatchObject({
      id: 'slug-text-webgpu',
      label: 'Slug text · WebGPU',
      detail: 'Inter GLB · HarfRust layout · analytic curves · shared TSL graph',
      color: 'green',
    });
    expect(target.capabilities).toEqual(
      new Set(['deterministic', 'font-bytes', 'wasm', 'shaping', 'paragraph', 'raster']),
    );
    await expect(target.run({}, 0, { dpr: 1, samples: 1, warmup: 0 })).rejects.toThrow(
      'Slug text target was not loaded',
    );
  });
});
