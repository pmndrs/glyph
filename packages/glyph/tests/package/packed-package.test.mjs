import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

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
  assert.equal(packedFiles.includes('dist/mtsdf-baker-abi-v0.json'), false);
  assert.equal(packedFiles.includes('dist/mtsdf-baker-abi-v1.json'), true);
  assert.equal(packedFiles.includes('dist/slug-baker-abi-v1.json'), false);
  assert.equal(packedFiles.includes('dist/slug-baker-abi-v0.json'), true);
  assert.deepEqual([...new Set(packedFiles.map((path) => path.split('/')[0]))].sort(), [
    'LICENSE',
    'bin',
    'dist',
    'package.json',
  ]);
  assert.equal(
    await readFile(join(installedDirectory, 'LICENSE'), 'utf8'),
    await readFile(join(packageDirectory, '..', '..', 'LICENSE'), 'utf8'),
  );
  const consumerEntry = pathToFileURL(join(temporaryDirectory, 'consumer', 'entry.mjs')).href;
  const moduleSubpaths = Object.entries(manifest.exports)
    .filter(([, target]) => typeof target === 'object' && target !== null)
    .map(([subpath]) => (subpath === '.' ? '@pmndrs/glyph' : `@pmndrs/glyph${subpath.slice(1)}`));

  for (const specifier of moduleSubpaths) {
    const resolved = import.meta.resolve(specifier, consumerEntry);
    const imported = await import(resolved);
    assert.ok(Object.keys(imported).length > 0, `${specifier} must expose at least one ESM export`);
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
  ]) {
    assert.throws(
      () => import.meta.resolve(removed, consumerEntry),
      /ERR_PACKAGE_PATH_NOT_EXPORTED/,
      `${removed} was replaced by a typed subpath and must not resolve`,
    );
  }

  const runtimeHost = await readFile(join(installedDirectory, 'dist/runtime-bake.js'), 'utf8');
  const serialWorkerHost = await readFile(join(installedDirectory, 'dist/internal/serial-worker-host.js'), 'utf8');
  assert.match(runtimeHost, /workerUrl:\s*new URL\(["']\.\/runtime-bake-worker\.js["']/);
  assert.match(serialWorkerHost, /new Worker\(this\.#protocol\.workerUrl/);
  assert.match(serialWorkerHost, /type:\s*["']module["']/);

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
