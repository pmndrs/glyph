import { afterEach, describe, expect, it, vi } from 'vitest';

const library = vi.hoisted(() => ({
  loadFont: vi.fn<(...args: readonly unknown[]) => Promise<{ readonly dispose: () => void }>>(),
}));

vi.mock('./library', () => ({ benchmarkFontLibrary: library }));

import { bitmap } from '@pmndrs/glyph/raster/bitmap';
import { disposeBakedFontPreloads, preloadBakedFont } from './runtime';

describe('baked benchmark font preloads', () => {
  afterEach(async () => {
    await disposeBakedFontPreloads();
    library.loadFont.mockReset();
  });

  it('retains one owner per artifact across repeated preloads', async () => {
    const dispose = vi.fn<() => void>();
    library.loadFont.mockResolvedValue({ dispose });

    await Promise.all([
      preloadBakedFont({ artifact: '/fixtures/inter.font.glb', raster: bitmap({ strikes: [16] }) }),
      preloadBakedFont({ artifact: '/fixtures/inter.font.glb', raster: bitmap({ strikes: [16] }) }),
    ]);

    expect(library.loadFont).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();

    await disposeBakedFontPreloads();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('evicts a rejected preload so the next request can retry', async () => {
    const failed = Promise.reject(new Error('fixture unavailable'));
    const dispose = vi.fn<() => void>();
    library.loadFont.mockReturnValueOnce(failed).mockResolvedValueOnce({ dispose });

    await expect(
      preloadBakedFont({ artifact: '/fixtures/retry.font.glb', raster: bitmap({ strikes: [16] }) }),
    ).rejects.toThrow('fixture unavailable');
    await preloadBakedFont({ artifact: '/fixtures/retry.font.glb', raster: bitmap({ strikes: [16] }) });

    expect(library.loadFont).toHaveBeenCalledTimes(2);
  });

  it('retains distinct raster requests from one multi-format artifact', async () => {
    library.loadFont.mockImplementation(() => Promise.resolve({ dispose: vi.fn<() => void>() }));

    await Promise.all([
      preloadBakedFont({ artifact: '/fixtures/inter.font.glb', raster: bitmap({ strikes: [16] }) }),
      preloadBakedFont({
        artifact: '/fixtures/inter.font.glb',
        raster: bitmap({ strikes: [8, 16] }),
      }),
    ]);

    expect(library.loadFont).toHaveBeenCalledTimes(2);
  });
});
