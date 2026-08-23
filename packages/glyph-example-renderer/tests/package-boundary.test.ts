import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const sourceFiles = ['device.ts', 'draw-list.ts', 'index.ts', 'plan-reader.ts'];

describe('package boundary', () => {
  test('reaches the engine only through published entry points', async () => {
    const sources = await Promise.all(
      sourceFiles.map((file) => readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')),
    );
    for (const source of sources) {
      // Internals and generated modules are off limits: a second renderer that needs them
      // proves the published surface is insufficient, which is the whole point of this package.
      expect(source).not.toMatch(/@pmndrs\/glyph\/(?:internal|generated)/);
      // No scene-graph integration. This package must not depend on `/three` to reach the engine.
      expect(source).not.toMatch(/@pmndrs\/glyph\/three/);
      expect(source).not.toMatch(/from 'three/);
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
