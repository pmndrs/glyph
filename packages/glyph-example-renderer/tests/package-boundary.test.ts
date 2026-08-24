import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));

async function packageSources(): Promise<readonly (readonly [string, string])[]> {
  const directories = ['src', 'tests'];
  const files: string[] = [];
  for (const directory of directories) {
    const entries = await readdir(join(packageRoot, directory), { recursive: true });
    files.push(...entries.filter((entry) => entry.endsWith('.ts')).map((entry) => join(directory, entry)));
  }
  return Promise.all(files.map(async (file) => [file, await readFile(join(packageRoot, file), 'utf8')] as const));
}

describe('package boundary', () => {
  // Built from parts because this file's own source would otherwise contain the
  // literals it forbids.
  const threeImport = new RegExp(`from '${'three'}|from "${'three'}`);

  test('reaches the engine only through the /core entry point', async () => {
    for (const [file, source] of await packageSources()) {
      // The node-only bake import is confined to the acceptance test's temporary-font fixture.
      if (file !== 'tests/example-render.test.ts') {
        expect(source, file).not.toMatch(/@pmndrs\/glyph\/(?!core\b|text-shaper\.wasm)/);
      }
      // No scene-graph integration and no renderer dependency.
      expect(source, file).not.toMatch(threeImport);
    }
  });

  test('imports nothing from the engine package by relative path either', async () => {
    for (const [file, source] of await packageSources()) {
      // Reaching dist or src of packages/glyph by relative path is the same defect as
      // a private subpath import, just spelled differently.
      expect(source, file).not.toMatch(/from '\.\.\/\.\.\/glyph\//);
      expect(source, file).not.toMatch(/from '\.\.\/\.\.\/\.\.\/packages\/glyph\//);
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
