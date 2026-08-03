import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('live-text viewport technique boundaries', () => {
  it.each([
    ['bitmap-text-viewport.tsx', '../../techniques/bitmap/persistent-scene'],
    ['sdf-text-viewports.tsx', '../../techniques/mtsdf/persistent-scene'],
    ['sdf-text-viewports.tsx', '../../techniques/slug/persistent-scene'],
  ] as const)('keeps %s references to %s lazy or type-only', async (file, techniqueModule) => {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    const staticImports = source
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.startsWith('import ') && statement.includes(`'${techniqueModule}'`));

    expect(staticImports).not.toHaveLength(0);
    expect(staticImports.every((statement) => statement.startsWith('import type '))).toBe(true);
    expect(source).toContain(`import('${techniqueModule}')`);
  });

  it('keeps live technique modules on persistent-scene contracts', async () => {
    const renderers = await Promise.all(
      [
        ['bitmap', 'persistent-scene.ts'],
        ['mtsdf', 'persistent-scene.ts'],
        ['slug', 'persistent-scene.ts'],
      ].map(async ([technique, file]) => ({
        file,
        technique,
        source: await readFile(new URL(`../../techniques/${technique}/${file}`, import.meta.url), 'utf8'),
      })),
    );

    for (const { source } of renderers) {
      expect(source).not.toContain('createBitmapTextPreview');
      expect(source).not.toContain('createMtsdfTextPreview');
      expect(source).not.toContain('createSlugTextPreview');
      expect(source).not.toContain('TextPreview');
    }

    expect(renderers.find(({ technique }) => technique === 'bitmap')?.source).toContain(
      'createBitmapTextPersistentScene',
    );
    expect(renderers.find(({ technique }) => technique === 'mtsdf')?.source).toContain(
      'createMtsdfTextPersistentScene',
    );
    expect(renderers.find(({ technique }) => technique === 'slug')?.source).toContain('createSlugTextPersistentScene');
  });

  it('keeps the harness separate from benchmark surface implementations', async () => {
    const [appSource, surfaceSource, comparisonSource, preloadSource] = await Promise.all([
      readFile(new URL('../../app.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./benchmark-surface.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./comparison-workload-viewport.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./scene-preload.ts', import.meta.url), 'utf8'),
    ]);

    expect(appSource).toContain("import { BenchmarkSurface } from './surfaces/benchmark/benchmark-surface';");
    expect(appSource).not.toContain('function BenchmarkSurface(');
    expect(appSource).not.toContain('function ComparisonWorkloadViewport(');
    expect(surfaceSource).toContain("import { ComparisonWorkloadViewport } from './comparison-workload-viewport';");
    expect(comparisonSource).toContain("import { preloadComparisonWorkload } from './scene-preload';");
    expect(preloadSource).toContain('let comparisonWorkloadModule');
    expect(preloadSource).toContain('const liveSceneAssetResources = new Map<string, Promise<void>>()');
  });
});
