import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('live-text viewport renderer boundaries', () => {
  it.each([
    ['bitmap-text-viewport.tsx', '../../renderer/bitmap-text'],
    ['sdf-text-viewports.tsx', '../../renderer/mtsdf-text'],
    ['sdf-text-viewports.tsx', '../../renderer/slug-text'],
  ] as const)('keeps %s references to %s lazy or type-only', async (file, rendererModule) => {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    const staticImports = source
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.startsWith('import ') && statement.includes(`'${rendererModule}'`));

    expect(staticImports).not.toHaveLength(0);
    expect(staticImports.every((statement) => statement.startsWith('import type '))).toBe(true);
    expect(source).toContain(`import('${rendererModule}')`);
  });

  it('keeps live renderer modules on persistent-scene contracts', async () => {
    const renderers = await Promise.all(
      ['bitmap-text.ts', 'mtsdf-text.ts', 'slug-text.ts'].map(async (file) => ({
        file,
        source: await readFile(new URL(`../../renderer/${file}`, import.meta.url), 'utf8'),
      })),
    );

    for (const { source } of renderers) {
      expect(source).not.toContain('createBitmapTextPreview');
      expect(source).not.toContain('createMtsdfTextPreview');
      expect(source).not.toContain('createSlugTextPreview');
      expect(source).not.toContain('TextPreview');
    }

    expect(renderers.find(({ file }) => file === 'bitmap-text.ts')?.source).toContain(
      'createBitmapTextPersistentScene',
    );
    expect(renderers.find(({ file }) => file === 'mtsdf-text.ts')?.source).toContain('createMtsdfTextPersistentScene');
    expect(renderers.find(({ file }) => file === 'slug-text.ts')?.source).toContain('createSlugTextPersistentScene');
  });
});
