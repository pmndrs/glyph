import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { validateFontArtifact } from '@pmndrs/glyph/bake';

/**
 * Every baked font the landing page, the docs and the examples ship is validated against the artifact schema of
 * the package they are built with. A font baked by an older package fails here, in `check`, and not as a blank
 * page with `GlyphFontError: baked font asset is invalid` in a reader's console. The fix is a rebake:
 * `bake:wordmark`, `bake:chorus`, `bake:explainer-fonts`, or the section's `scripts/bake-<section>-fonts.mts`.
 */
const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHIPPED = [
  join(site, 'landing/assets'),
  join(site, 'docs/assets/fonts'),
  // The examples draw from the hello-world app's checked-in fonts; see examples/src/fonts.ts.
  join(site, '../apps/r3f-hello-world/assets'),
];

function fonts(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return fonts(path);
    return entry.name.endsWith('.font.glb') ? [path] : [];
  });
}

describe('shipped font artifacts', () => {
  const artifacts = SHIPPED.flatMap(fonts);

  it('finds the fonts of all three surfaces', () => {
    expect(artifacts.length).toBeGreaterThan(30);
  });

  it.each(artifacts.map((path) => [relative(site, path), path] as const))(
    '%s is valid for the current package',
    async (_name, path) => {
      const artifact = await validateFontArtifact(new Uint8Array(await readFile(path)));
      expect(artifact).toBeDefined();
    },
  );
});
