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
});
