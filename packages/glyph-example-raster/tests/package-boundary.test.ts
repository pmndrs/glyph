import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));

async function sourceFiles(): Promise<readonly (readonly [string, string])[]> {
  const entries = await readdir(join(packageRoot, 'src'), { recursive: true });
  return Promise.all(
    entries
      .filter((entry) => entry.endsWith('.ts'))
      .map(async (entry) => [entry, await readFile(join(packageRoot, 'src', entry), 'utf8')] as const),
  );
}

describe('package boundary', () => {
  test('keeps the portable source tree renderer-free', async () => {
    for (const [file, source] of await sourceFiles()) {
      if (file === 'tsl.ts' || file === 'typegpu.ts') continue;
      expect(source).not.toMatch(/@pmndrs\/glyph\/internal|@pmndrs\/glyph\/raster\/(?:bitmap|mtsdf|slug)/);
      expect(source).not.toMatch(/@pmndrs\/glyph\/bakers\/(?:bitmap|msdf|slug)/);
      expect(source).not.toMatch(/from ['"]three(?:\/|['"])/);
      expect(source).not.toMatch(/from ['"]typegpu(?:\/|['"])/);
    }
  });

  test('keeps shader variants explicit and registration-free', async () => {
    const sources = await sourceFiles();
    const tsl = sources.find(([file]) => file === 'tsl.ts')?.[1];
    expect(tsl).toBeDefined();
    expect(tsl).not.toContain('registerThreeRasterPlanProgram');
    expect(tsl).not.toContain('@pmndrs/glyph/three');
    const typegpu = sources.find(([file]) => file === 'typegpu.ts')?.[1];
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
