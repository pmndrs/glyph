import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));

async function packageSources(): Promise<readonly (readonly [string, string])[]> {
  const directories = ['src', 'tests', 'scripts'];
  const files: string[] = [];
  for (const directory of directories) {
    const entries = await readdir(join(packageRoot, directory), { recursive: true });
    files.push(...entries.filter((entry) => /\.(?:mjs|mts|ts)$/.test(entry)).map((entry) => join(directory, entry)));
  }
  return Promise.all(files.map(async (file) => [file, await readFile(join(packageRoot, file), 'utf8')] as const));
}

describe('package boundary', () => {
  test('keeps the portable source tree renderer-free', async () => {
    for (const [file, source] of await packageSources()) {
      if (!file.startsWith('src/')) continue;
      expect(source).not.toMatch(/@pmndrs\/glyph\/internal|@pmndrs\/glyph\/raster\/(?:bitmap|msdf|slug)/);
      expect(source).not.toMatch(/@pmndrs\/glyph\/bakers\/(?:bitmap|msdf|slug)/);
      if (file === 'src/tsl.ts' || file === 'src/typegpu.ts') continue;
      expect(source).not.toMatch(/from ['"]three(?:\/|['"])/);
      expect(source).not.toMatch(/from ['"]typegpu(?:\/|['"])/);
    }
  });

  test('imports nothing from the engine package by relative path either', async () => {
    for (const [file, source] of await packageSources()) {
      expect(source, file).not.toMatch(/from ['"]\.\.\/\.\.\/glyph\//);
      expect(source, file).not.toMatch(/from ['"]\.\.\/\.\.\/\.\.\/packages\/glyph\//);
    }
  });

  test('keeps shader variants explicit and registration-free', async () => {
    const sources = await packageSources();
    const tsl = sources.find(([file]) => file === 'src/tsl.ts')?.[1];
    expect(tsl).toBeDefined();
    expect(tsl).not.toContain('registerThreeRasterProgram');
    expect(tsl).not.toContain('@pmndrs/glyph/three');
    const typegpu = sources.find(([file]) => file === 'src/typegpu.ts')?.[1];
    expect(typegpu).toBeDefined();
    expect(typegpu).not.toMatch(/from ['"]three(?:\/|['"])/);
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
