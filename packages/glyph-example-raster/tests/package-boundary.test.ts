import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const sourceFiles = ['artifact.ts', 'baker.ts', 'contract.ts', 'index.ts', 'raster.ts', 'runtime-baker.ts', 'three.ts'];

describe('package boundary', () => {
  test('uses only published core entry points and its own renderer dependency', async () => {
    const sources = await Promise.all(
      sourceFiles.map((file) => readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')),
    );
    for (const source of sources) {
      expect(source).not.toMatch(/@pmndrs\/glyph\/internal|@pmndrs\/glyph\/raster\/(?:bitmap|mtsdf|slug)/);
      expect(source).not.toMatch(/@pmndrs\/glyph\/bakers\/(?:bitmap|msdf|slug)/);
    }
  });

  test('requires no registration edit or kind switch in core', async () => {
    const core = fileURLToPath(new URL('../../glyph/src/', import.meta.url));
    const entries = await readdir(core, { recursive: true });
    const sources = await Promise.all(
      entries.filter((entry) => entry.endsWith('.ts')).map((entry) => readFile(join(core, entry), 'utf8')),
    );
    expect(sources.join('\n')).not.toContain('glyphExample');
    expect(sources.join('\n')).not.toContain('PMNDRS_glyph_example');
  });
});
