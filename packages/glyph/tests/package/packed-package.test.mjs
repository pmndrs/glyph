import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import { readJavaScriptModuleClosure } from '../support/javascript-module-closure.mjs';

const packageDirectory = fileURLToPath(new URL('../..', import.meta.url));

test('the packed package exposes every ESM subpath and no CommonJS entry', async (context) => {
  const temporaryDirectory = await mkdtemp(join(packageDirectory, '.packed-package-'));
  context.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

  const sourceManifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
  const archiveDirectory = join(temporaryDirectory, 'archive');
  const installedDirectory = join(temporaryDirectory, 'consumer', 'node_modules', '@pmndrs', 'glyph');
  await mkdir(archiveDirectory, { recursive: true });
  await mkdir(installedDirectory, { recursive: true });
  execFileSync('pnpm', ['pack', '--pack-destination', archiveDirectory], {
    cwd: packageDirectory,
    stdio: 'ignore',
  });
  execFileSync(
    'tar',
    [
      '-xzf',
      join(archiveDirectory, `pmndrs-glyph-${sourceManifest.version}.tgz`),
      '--strip-components=1',
      '-C',
      installedDirectory,
    ],
    { stdio: 'ignore' },
  );

  const manifest = JSON.parse(await readFile(join(installedDirectory, 'package.json'), 'utf8'));
  const packedFiles = await readdir(installedDirectory, { recursive: true });
  assert.equal(packedFiles.includes('dist/.tsbuildinfo'), false);
  assert.equal(packedFiles.includes('dist/internal/raster-baker-profile.d.ts'), false);
  assert.equal(packedFiles.includes('dist/internal/raster-baker-profile.js'), false);
  // The ABI ships as the generated TypeScript module the package's own bakers import. No JSON copy is
  // published: nothing could import one, because `exports` has no wildcard and names no ABI JSON. The
  // modules are packed because the published baker subpaths reach them, not because a consumer can.
  assert.deepEqual(
    packedFiles.filter((path) => /-abi-v[0-9]\.json$/.test(path)),
    [],
  );
  assert.equal(packedFiles.includes('dist/mtsdf-baker-abi.js'), true);
  assert.equal(packedFiles.includes('dist/slug-baker-abi.js'), true);
  assert.deepEqual([...new Set(packedFiles.map((path) => path.split('/')[0]))].sort(), [
    'LICENSE',
    'bin',
    'dist',
    'package.json',
    'src',
  ]);
  assert.equal(
    await readFile(join(installedDirectory, 'LICENSE'), 'utf8'),
    await readFile(join(packageDirectory, '..', '..', 'LICENSE'), 'utf8'),
  );
  const consumerEntry = pathToFileURL(join(temporaryDirectory, 'consumer', 'entry.mjs')).href;
  const moduleSubpaths = Object.entries(manifest.exports)
    .filter(([subpath, target]) => typeof target === 'object' && target !== null && !subpath.includes('*'))
    .map(([subpath]) => (subpath === '.' ? '@pmndrs/glyph' : `@pmndrs/glyph${subpath.slice(1)}`));

  for (const target of Object.values(manifest.exports)) {
    if (typeof target !== 'object' || target === null) continue;
    if (target.source.includes('*')) continue;
    assert.ok(packedFiles.includes(target.source.slice(2)), `${target.source} must ship with its source condition`);
  }

  for (const specifier of moduleSubpaths) {
    const resolved = import.meta.resolve(specifier, consumerEntry);
    const imported = await import(resolved);
    assert.ok(Object.keys(imported).length > 0, `${specifier} must expose at least one ESM export`);
  }

  for (const specifier of [
    '@pmndrs/glyph/tsl/packed-color',
    '@pmndrs/glyph/tsl/slug-shaders/slug-render',
    '@pmndrs/glyph/typegpu/bitmap-reference',
    '@pmndrs/glyph/three/material',
    '@pmndrs/glyph/react/bitmap',
    '@pmndrs/glyph/react/msdf',
    '@pmndrs/glyph/react/slug',
    '@pmndrs/glyph/raster/bitmap',
    '@pmndrs/glyph/config/glyph',
    '@pmndrs/glyph/config/raster-format',
    '@pmndrs/glyph/config/schema',
  ]) {
    const resolved = import.meta.resolve(specifier, consumerEntry);
    const imported = await import(resolved);
    assert.ok(Object.keys(imported).length > 0, `${specifier} must expose its public leaf`);
  }

  for (const subpath of ['./text-shaper.wasm', './bitmap-baker.wasm', './mtsdf-baker.wasm', './slug-baker.wasm']) {
    const specifier = `@pmndrs/glyph${subpath.slice(1)}`;
    const resolved = import.meta.resolve(specifier, consumerEntry);
    assert.ok((await readFile(fileURLToPath(resolved))).byteLength > 0, `${specifier} must be packed`);
  }

  // The JSON ABI subpaths were replaced by typed module subpaths. Prove they are unreachable from a real
  // install rather than absent from the manifest, so a wildcard or alias cannot resurrect them unnoticed.
  for (const removed of [
    '@pmndrs/glyph/shaper-abi.json',
    '@pmndrs/glyph/bitmap-abi.json',
    '@pmndrs/glyph/mtsdf-abi.json',
    '@pmndrs/glyph/slug-abi.json',
    '@pmndrs/glyph/font-baker-abi.json',
    // Withdrawn entry points. Their modules are still packed, so absence from the manifest is not
    // enough: prove a real install cannot reach them by specifier either.
    '@pmndrs/glyph/text-shaper-abi',
    '@pmndrs/glyph/bitmap-baker-abi',
    '@pmndrs/glyph/mtsdf-baker-abi',
    '@pmndrs/glyph/slug-baker-abi',
    '@pmndrs/glyph/font-baker-abi',
    '@pmndrs/glyph/bakers/bitmap/validate',
    '@pmndrs/glyph/bakers/msdf/validate',
    '@pmndrs/glyph/bakers/slug/validate',
    '@pmndrs/glyph/internal/configured-handle',
    '@pmndrs/glyph/generated/text-shaper-abi',
    '@pmndrs/glyph/font-baker/validator',
    '@pmndrs/glyph/loader',
    '@pmndrs/glyph/config/font-library',
    '@pmndrs/glyph/three/font-loader',
    '@pmndrs/glyph/three/loader',
    '@pmndrs/glyph/three/command-buffer-renderer',
    '@pmndrs/glyph/three/internal/draw-realizer',
    '@pmndrs/glyph/three/decorations',
    '@pmndrs/glyph/three/frame-error',
    '@pmndrs/glyph/three/glyph-measurement',
    '@pmndrs/glyph/three/glyphs',
    '@pmndrs/glyph/three/renderer-resources',
    '@pmndrs/glyph/three/text',
    '@pmndrs/glyph/three/engine-plan-target',
    '@pmndrs/glyph/raster/internal/bitmap-decoder',
    '@pmndrs/glyph/tsl/slug-shaders/tsl-compat',
  ]) {
    assert.throws(
      () => import.meta.resolve(removed, consumerEntry),
      { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' },
      `${removed} is not a published entry point and must not resolve`,
    );
  }

  const runtimeGraph = await readJavaScriptModuleClosure([
    join(installedDirectory, 'dist/runtime-bake.js'),
    join(installedDirectory, 'dist/internal/serial-worker-host.js'),
  ]);
  assert.match(runtimeGraph.source, /workerUrl:\s*new URL\(["'`]\.\.\/dist\/runtime-bake-worker\.js["'`]/);
  assert.match(runtimeGraph.source, /new Worker\(/);
  assert.match(runtimeGraph.source, /type:\s*["'`]module["'`]/);

  const cli = join(installedDirectory, 'bin/glyph.js');
  assert.notEqual((await stat(cli)).mode & 0o111, 0, 'the packed CLI must be executable');
  const cliHelp = spawnSync(process.execPath, [cli, '--help'], {
    cwd: join(temporaryDirectory, 'consumer'),
    encoding: 'utf8',
  });
  assert.equal(cliHelp.status, 0, cliHelp.stderr);
  assert.match(cliHelp.stdout, /^Usage: glyph <command>/);

  const commonJs = spawnSync(process.execPath, ['-e', "require('@pmndrs/glyph')"], {
    cwd: dirname(installedDirectory),
    encoding: 'utf8',
  });
  assert.notEqual(commonJs.status, 0);
  assert.match(commonJs.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED|ERR_REQUIRE_ESM/);
});
