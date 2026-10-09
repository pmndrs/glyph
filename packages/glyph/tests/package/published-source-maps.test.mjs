import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';
import { rewritePublishedSourceMaps } from '../../scripts/support/published-source-maps.mjs';

test('staged JS and declaration maps resolve from the published tree and preserve mappings', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'glyph-source-maps-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const staging = join(root, '.cache/build/staging/internal');
  const source = join(root, 'src/internal');
  await mkdir(staging, { recursive: true });
  await mkdir(source, { recursive: true });
  const original = {
    version: 3,
    sources: ['module.ts'],
    sourceRoot: relative(staging, source),
    names: ['value'],
    mappings: 'AAAA',
    sourcesContent: ['export const value = 1;'],
  };
  for (const suffix of ['js', 'd.ts']) await writeFile(join(staging, `module.${suffix}.map`), JSON.stringify(original));
  await rewritePublishedSourceMaps(join(root, '.cache/build/staging'), join(root, 'dist'), join(root, 'src'));
  for (const suffix of ['js', 'd.ts']) {
    const map = JSON.parse(await readFile(join(staging, `module.${suffix}.map`), 'utf8'));
    assert.equal(resolve(root, 'dist/internal', map.sources[0]), join(source, 'module.ts'));
    const { sourceRoot: _sourceRoot, ...unchanged } = original;
    assert.deepEqual(map, { ...unchanged, sources: ['../../src/internal/module.ts'] });
  }
});

test('source maps cannot escape the packaged source tree', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'glyph-source-map-escape-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'stage'));
  await writeFile(join(root, 'stage/module.js.map'), JSON.stringify({ version: 3, sources: ['../../outside.ts'] }));
  await assert.rejects(
    rewritePublishedSourceMaps(join(root, 'stage'), join(root, 'dist'), join(root, 'src')),
    /outside the published tree/,
  );
});
