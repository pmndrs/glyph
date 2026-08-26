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
  // Built from parts because this file's own source would otherwise contain the
  // literals it forbids.
  const threeImport = new RegExp(`from '${'three'}|from "${'three'}`);

  test('reaches the engine only through the /core entry point', async () => {
    for (const [file, source] of await packageSources()) {
      const glyphImports = [...source.matchAll(/from ['"](@pmndrs\/glyph(?=\/|['"])(?:\/[A-Za-z0-9_.-]+)?)/g)].map(
        ([, specifier]) => specifier!,
      );
      const allowed = new Set(['@pmndrs/glyph/core', '@pmndrs/glyph/text-shaper.wasm']);
      if (file === 'src/engine.ts') allowed.add('@pmndrs/glyph');
      if (file === 'tests/example-render.test.ts') {
        allowed.add('@pmndrs/glyph');
        allowed.add('@pmndrs/glyph/bake');
      }
      for (const specifier of glyphImports) expect(allowed, `${file}: ${specifier}`).toContain(specifier);
      // No scene-graph integration or Three dependency.
      expect(source, file).not.toMatch(threeImport);
    }
  });

  test('imports nothing from the engine package by relative path either', async () => {
    for (const [file, source] of await packageSources()) {
      // Reaching dist or src of packages/glyph by relative path is the same defect as
      // a private subpath import, just spelled differently.
      expect(source, file).not.toMatch(/from ['"]\.\.\/\.\.\/glyph\//);
      expect(source, file).not.toMatch(/from ['"]\.\.\/\.\.\/\.\.\/packages\/glyph\//);
    }
  });

  test('needs no registration edit inside the engine package', async () => {
    const core = fileURLToPath(new URL('../../glyph/src/', import.meta.url));
    const entries = await readdir(core, { recursive: true });
    const sources = await Promise.all(
      entries.filter((entry) => entry.endsWith('.ts')).map((entry) => readFile(join(core, entry), 'utf8')),
    );
    expect(sources.join('\n')).not.toContain('glyph-example-renderer');
  });
});
