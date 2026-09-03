import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import * as glyph from '@pmndrs/glyph';

import { readJavaScriptModuleClosure } from '../support/javascript-module-closure.mjs';

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
    './src/raster/bitmap.ts',
    './src/raster/msdf.ts',
    './src/raster/slug.ts',
    './dist/raster/bitmap.js',
    './dist/raster/msdf.js',
    './dist/raster/slug.js',
    './dist/internal/bitmap-*.js',
    './dist/internal/msdf-*.js',
    './dist/internal/slug-*.js',
  ]);
  assert.equal(manifest.exports['./internal/*'], null);
  assert.deepEqual(manifest.pmndrs, {
    glyph: { bitmap: './bakers/bitmap', msdf: './bakers/msdf', slug: './bakers/slug' },
  });
  for (const subpath of [
    './baker',
    './tsl/bitmap',
    './tsl/msdf',
    './tsl/slug',
    './tsl/decoration',
    './typegpu/bitmap',
    './tsl/*',
    './typegpu/*',
    './three/*',
    './react/*',
    './raster/*',
    './config/*',
  ]) {
    assert.ok(subpath in manifest.exports, `${subpath} must remain a tree-shakeable package boundary`);
  }
  for (const blocked of [
    './internal/*',
    './generated/*',
    './font-baker/*',
    './three/internal/*',
    './three/decorations',
    './three/frame-error',
    './three/glyph-measurement',
    './three/glyphs',
    './three/renderer-resources',
    './three/text',
    './raster/internal/*',
    './tsl/internal/*',
    './typegpu/internal/*',
    './tsl/slug-shaders/tsl-compat',
  ]) {
    assert.equal(manifest.exports[blocked], null, `${blocked} must remain package-private`);
  }

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
  // accident to ship. Public `/config/*` leaves are the GlyphConfig integration surface a custom renderer builds on.
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
    if (target === null) continue;
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

    assert.deepEqual(Object.keys(target).sort(), ['import', 'source', 'types']);
    assert.match(target.source, /^\.\/src\/.*\.ts$/);
    assert.deepEqual(target.types, { source: target.source, default: target.import.replace(/\.js$/, '.d.ts') });
    assert.match(target.import, /^\.\/dist\/.*\.js$/);
    assert.equal('require' in target, false);
  }
});

test('the public FontFace graph hides loader and mutable registration machinery', async () => {
  assert.equal('loadFont' in glyph, false);
  assert.equal('createFontLibrary' in glyph, false);
  assert.equal('defineFont' in glyph, false);
  assert.equal('FontLoader' in glyph, false);
  assert.equal('FontRegistry' in glyph, false);
  const [entry, runtimeWorker] = await Promise.all([
    readFile(new URL('../../dist/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../../dist/runtime-bake-worker.js', import.meta.url), 'utf8'),
  ]);
  const initialGraph = await readJavaScriptModuleClosure([
    new URL('../../dist/index.js', import.meta.url),
    new URL('../../dist/loader.js', import.meta.url),
  ]);
  const runtimeGraph = await readJavaScriptModuleClosure([
    new URL('../../dist/runtime-bake.js', import.meta.url),
    new URL('../../dist/internal/serial-worker-host.js', import.meta.url),
  ]);
  const fontBakerWasmGraph = await readJavaScriptModuleClosure([
    new URL('../../dist/font-baker/wasm-url.js', import.meta.url),
  ]);
  assert.ok(
    [...initialGraph.dynamicImports].some((specifier) => specifier.endsWith('/runtime-bake.js')),
    'font loading must reach runtime baking through a dynamic import',
  );
  assert.ok(
    initialGraph.paths.every(
      (path) =>
        !path.endsWith('/runtime-bake.js') && !path.includes('/runtime-bakers/') && !path.endsWith('/font-baker.wasm'),
    ),
    'runtime baking must not be statically reachable from the root loader graph',
  );
  assert.ok(
    [...initialGraph.staticImports].every((specifier) => !specifier.startsWith('node:')),
    'the browser loader graph must not statically import Node built-ins',
  );
  assert.doesNotMatch(initialGraph.source, /new Worker/);
  assert.doesNotMatch(initialGraph.source, /(?:\.\/node\/|\.\/bakers\/)/);
  assert.doesNotMatch(initialGraph.source, /(?:PMNDRS_font_slug|\.\/raster\/slug|slug-shaders)/);
  assert.doesNotMatch(entry, /(?:three\/|three["'])/, 'core entry must not import Three');
  assert.match(runtimeGraph.source, /workerUrl:\s*new URL\(["'`]\.\.\/dist\/runtime-bake-worker\.js["'`]/);
  assert.match(runtimeGraph.source, /new Worker\(/);
  assert.match(runtimeGraph.source, /type:\s*["'`]module["'`]/);
  assert.match(runtimeWorker, /await fetch\(/, 'the runtime worker must fetch its baker Wasm');
  assert.match(
    fontBakerWasmGraph.source,
    /new URL\(["'`]\.\.\/\.\.\/dist\/font-baker\.wasm["'`],\s*import\.meta\.url\)/,
    'the runtime worker graph must address the package-owned baker Wasm',
  );
  assert.doesNotMatch(
    `${runtimeGraph.source}\n${runtimeWorker}`,
    /(?:node:|font-baker\/validate|compose-bake|compiler-adapter|discovery|gltf-validator|ktx-parse|ajv)/,
  );
  assert.ok((await readFile(new URL('../../dist/font-baker.wasm', import.meta.url))).byteLength > 0);
});

test('generic raster baker construction lives only on the dedicated baker subpath', async () => {
  assert.equal('defineRasterBaker' in glyph, false);
  assert.equal('rasterBake' in glyph, false);
  const baker = await import('@pmndrs/glyph/baker');
  assert.equal(typeof baker.defineRasterBaker, 'function');
  assert.equal(typeof baker.rasterBake, 'function');
});
