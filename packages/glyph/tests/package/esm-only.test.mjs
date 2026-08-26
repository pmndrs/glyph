import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { FontLoader, FontRegistry } from '@pmndrs/glyph';

const manifestUrl = new URL('../../package.json', import.meta.url);

test('the published contract is ESM-only', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));

  assert.equal(manifest.type, 'module');
  assert.equal(manifest.main, undefined);
  assert.equal(manifest.module, undefined);
  assert.equal(manifest.private, undefined);
  assert.deepEqual(manifest.repository, {
    type: 'git',
    url: 'git+https://github.com/pmndrs/glyph.git',
    directory: 'packages/glyph',
  });
  assert.deepEqual(manifest.publishConfig, {
    access: 'public',
    registry: 'https://registry.npmjs.org/',
  });
  assert.deepEqual(manifest.bin, { glyph: './bin/glyph.js' });
  assert.deepEqual(manifest.sideEffects, [
    './dist/raster/bitmap-technique.js',
    './dist/raster/msdf.js',
    './dist/raster/slug-technique.js',
    './dist/three/bitmap.js',
    './dist/three/msdf.js',
    './dist/three/slug.js',
  ]);
  assert.equal(manifest.exports['./internal/raster-baker-profile'], undefined);
  assert.deepEqual(manifest.pmndrs, {
    glyph: { bitmap: './bakers/bitmap', msdf: './bakers/msdf', slug: './bakers/slug' },
  });

  // The JSON ABI subpaths were replaced by typed module subpaths. Assert the removed names are gone
  // whatever target shape they might reappear with, since the resource allow-list below only sees strings.
  for (const removed of [
    './shaper-abi.json',
    './bitmap-abi.json',
    './mtsdf-abi.json',
    './slug-abi.json',
    './font-baker-abi.json',
  ]) {
    assert.ok(!(removed in manifest.exports), `${removed} was replaced by a typed subpath and must stay removed`);
  }

  // The typed ABI subpaths published struct offsets for pointer arithmetic and the validator subpaths
  // published bake-time artifact checks; neither had a consumer outside this package. The modules are still built
  // and packed — only the entry points are withdrawn, so a re-added name is a decision to make, not an
  // accident to ship. `/core` and `/tsl` stay published: they are the engine-integration surface a custom
  // renderer builds on, and `@pmndrs/glyph/three` is itself one of their consumers.
  for (const removed of [
    './text-shaper-abi',
    './bitmap-baker-abi',
    './mtsdf-baker-abi',
    './slug-baker-abi',
    './font-baker-abi',
    './bakers/bitmap/validate',
    './bakers/msdf/validate',
    './bakers/slug/validate',
  ]) {
    assert.ok(!(removed in manifest.exports), `${removed} is deliberately unpublished and must stay unpublished`);
  }

  for (const [subpath, target] of Object.entries(manifest.exports)) {
    if (typeof target === 'string') {
      assert.ok(
        [
          './package.json',
          './bitmap-baker.wasm',
          './mtsdf-baker.wasm',
          './slug-baker.wasm',
          './font-baker.wasm',
          './text-shaper.wasm',
        ].includes(subpath),
        `unexpected non-JavaScript resource export ${subpath}`,
      );
      assert.match(target, /^\.\/dist\/.*\.wasm$|^\.\/package\.json$/);
      continue;
    }

    assert.deepEqual(Object.keys(target).sort(), ['import', 'types']);
    assert.match(target.import, /^\.\/dist\/.*\.js$/);
    assert.match(target.types, /^\.\/dist\/.*\.d\.ts$/);
    assert.equal('require' in target, false);
  }
});

test('the public loader graph exposes registration without eager baker or Node host edges', async () => {
  assert.equal(typeof FontLoader, 'function');
  assert.equal(typeof FontRegistry, 'function');
  const [entry, loader, runtimeHost, runtimeWorker, serialWorkerHost] = await Promise.all([
    readFile(new URL('../../dist/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../../dist/loader.js', import.meta.url), 'utf8'),
    readFile(new URL('../../dist/runtime-bake.js', import.meta.url), 'utf8'),
    readFile(new URL('../../dist/runtime-bake-worker.js', import.meta.url), 'utf8'),
    readFile(new URL('../../dist/internal/serial-worker-host.js', import.meta.url), 'utf8'),
  ]);
  const initialGraph = `${entry}\n${loader}`;
  assert.match(loader, /import\(["']\.\/runtime-bake\.js["']\)/);
  assert.doesNotMatch(initialGraph, /(?:from\s+["']\.\/runtime-bake|new Worker|font-baker\.wasm|node:)/);
  assert.doesNotMatch(initialGraph, /(?:\.\/node\/|\.\/bakers\/)/);
  assert.doesNotMatch(initialGraph, /(?:PMNDRS_font_slug|\.\/raster\/slug|slug-shaders)/);
  assert.doesNotMatch(entry, /(?:three\/|three["'])/, 'core entry must not import Three');
  assert.match(runtimeHost, /workerUrl:\s*new URL\(["']\.\/runtime-bake-worker\.js["']/);
  assert.match(serialWorkerHost, /new Worker\(this\.#protocol\.workerUrl/);
  assert.match(serialWorkerHost, /type:\s*["']module["']/);
  assert.match(runtimeWorker, /from ["']\.\/font-baker\/wasm-url\.js["']/);
  assert.doesNotMatch(
    `${runtimeHost}\n${runtimeWorker}`,
    /(?:node:|font-baker\/validate|compose-bake|compiler-adapter|discovery|gltf-validator|ktx-parse|ajv)/,
  );
  for (const helper of ['core-bake-policy.js', 'owned-array-buffer.js', 'successful-promise-cache.js']) {
    const source = await readFile(new URL(`../../dist/internal/${helper}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /(?:^|\n)\s*(?:import|export\s+\{.*\}\s+from)\s/m);
  }
  assert.ok((await readFile(new URL('../../dist/font-baker.wasm', import.meta.url))).byteLength > 0);
});
