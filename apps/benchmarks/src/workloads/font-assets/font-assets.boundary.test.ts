import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const fontAssetsRoot = new URL('.', import.meta.url);

async function readAssetSource(name: string): Promise<string> {
  return readFile(new URL(name, fontAssetsRoot), 'utf8');
}

describe('benchmark font-asset boundaries', () => {
  it('selects one technique lazily instead of statically importing every renderer asset lane', async () => {
    const index = await readAssetSource('index.ts');

    expect(index).toContain("import('./bitmap')");
    expect(index).toContain("import('./mtsdf')");
    expect(index).toContain("import('./slug')");
    expect(index).not.toMatch(/\bfrom ['"]\.\/(?:bitmap|mtsdf|slug)['"]/);
  });

  it('keeps direct font-baker and Wasm reach-through outside the workload asset adapter', async () => {
    const files = ['index.ts', 'runtime.ts', 'bitmap.ts', 'mtsdf.ts', 'slug.ts'];
    const sources = await Promise.all(files.map(readAssetSource));

    for (const source of sources) {
      expect(source).not.toMatch(/@pmndrs\/text-font-baker|text-shaper\.wasm\?url|font-baker\.wasm\?url/);
    }
    expect(sources[1]).toContain("import('@pmndrs/text/runtime-bake')");
  });

  it('keeps renderer scenes on the asset adapter rather than the runtime-bake entrypoint', async () => {
    const renderers = await Promise.all(
      ['../../renderer/bitmap-text.ts', '../../renderer/mtsdf-text.ts', '../../renderer/slug-text.ts'].map((name) =>
        readFile(new URL(name, fontAssetsRoot), 'utf8'),
      ),
    );

    for (const renderer of renderers) {
      expect(renderer).not.toContain('@pmndrs/text/runtime-bake');
      expect(renderer).not.toContain('@pmndrs/text-font-baker');
    }
  });

  it('keeps loading and raster metadata ownership out of retained renderer exports', async () => {
    const renderers = await Promise.all(
      ['../../renderer/bitmap-text.ts', '../../renderer/mtsdf-text.ts', '../../renderer/slug-text.ts'].map((name) =>
        readFile(new URL(name, fontAssetsRoot), 'utf8'),
      ),
    );

    for (const renderer of renderers) {
      expect(renderer).not.toMatch(/export (?:async )?function (?:load|registered)/);
      expect(renderer).not.toMatch(/export \{ preload(?:Bitmap|Mtsdf|Slug)FontAssets \}/);
    }
  });
});
