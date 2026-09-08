import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'vite';

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
  for (const peer of ['typegpu', '@typegpu/gl', '@typegpu/three']) {
    assert.ok(manifest.peerDependencies[peer], `${peer} must be a declared peer`);
    assert.equal(manifest.peerDependenciesMeta[peer]?.optional, true, `${peer} must remain optional`);
  }
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
    '@pmndrs/glyph/three/material',
    '@pmndrs/glyph/react/bitmap',
    '@pmndrs/glyph/react/msdf',
    '@pmndrs/glyph/react/slug',
    '@pmndrs/glyph/config/glyph',
    '@pmndrs/glyph/config/raster-format',
    '@pmndrs/glyph/config/schema',
  ]) {
    const resolved = import.meta.resolve(specifier, consumerEntry);
    const imported = await import(resolved);
    assert.ok(Object.keys(imported).length > 0, `${specifier} must expose its public leaf`);
  }

  const typeGpuConsumer = join(temporaryDirectory, 'consumer', 'typegpu.mjs');
  await writeFile(
    typeGpuConsumer,
    [
      "export * from '@pmndrs/glyph/shaders/typegpu/bitmap';",
      "export { defineTypeGpuConfig } from '@pmndrs/glyph/typegpu';",
      "export { ThreeConfig } from '@pmndrs/glyph/three/typegpu';",
      '',
    ].join('\n'),
  );
  await assert.rejects(buildPackedConsumer(typeGpuConsumer, true), /requires optional TypeGPU peer/);
  assert.deepEqual(await buildPackedConsumer(typeGpuConsumer, false), ['@typegpu/three', 'typegpu']);

  await verifyIsolatedPackedConsumers(
    join(archiveDirectory, `pmndrs-glyph-${sourceManifest.version}.tgz`),
    sourceManifest.devDependencies,
    context,
  );

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
    '@pmndrs/glyph/tsl',
    '@pmndrs/glyph/tsl/bitmap',
    '@pmndrs/glyph/shaders',
    '@pmndrs/glyph/shaders/bitmap',
    '@pmndrs/glyph/three/font-loader',
    '@pmndrs/glyph/three/loader',
    '@pmndrs/glyph/three/command-buffer-renderer',
    '@pmndrs/glyph/three/handle',
    '@pmndrs/glyph/three/schema',
    '@pmndrs/glyph/three/internal/draw-realizer',
    '@pmndrs/glyph/three/typegpu/internal/bitmap-shader',
    '@pmndrs/glyph/three/decorations',
    '@pmndrs/glyph/three/frame-error',
    '@pmndrs/glyph/three/glyph-measurement',
    '@pmndrs/glyph/three/glyphs',
    '@pmndrs/glyph/three/renderer-resources',
    '@pmndrs/glyph/three/text',
    '@pmndrs/glyph/three/engine-plan-target',
    '@pmndrs/glyph/raster/internal/bitmap-decoder',
    '@pmndrs/glyph/shaders/tsl/slug-shaders/tsl-compat',
    '@pmndrs/glyph/shaders/tsl/slug/internal/three-compat',
    '@pmndrs/glyph/shaders/typegpu/slug/slug-render',
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

async function buildPackedConsumer(entry, forbidTypeGpuPeers) {
  const typeGpuPeers = new Set();
  await build({
    configFile: false,
    logLevel: 'silent',
    root: dirname(entry),
    build: {
      lib: { entry, formats: ['es'], fileName: 'entry' },
      write: false,
      rollupOptions: {
        external(id) {
          if (/^(?:typegpu(?:\/|$)|@typegpu\/)/.test(id)) {
            if (forbidTypeGpuPeers) throw new Error(`requires optional TypeGPU peer ${id}`);
            typeGpuPeers.add(
              id
                .split('/')
                .slice(0, id.startsWith('@') ? 2 : 1)
                .join('/'),
            );
            return true;
          }
          if (id === '@pmndrs/glyph' || id.startsWith('@pmndrs/glyph/')) return false;
          return !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0');
        },
      },
    },
  });
  return [...typeGpuPeers].sort();
}

async function verifyIsolatedPackedConsumers(archive, availableVersions, context) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-packed-consumers-'));
  context.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  const storeDirectory = execFileSync('pnpm', ['store', 'path'], {
    cwd: packageDirectory,
    encoding: 'utf8',
  }).trim();
  const cases = [
    {
      name: 'core',
      dependencies: [],
      absentPeers: ['three', 'typegpu', '@typegpu/gl', '@typegpu/three'],
      entry: ["import * as core from '@pmndrs/glyph';", 'export { core };'],
      missingPeerImports: [
        { specifier: '@pmndrs/glyph/three', peer: 'three' },
        { specifier: '@pmndrs/glyph/typegpu', peer: 'typegpu' },
      ],
    },
    {
      name: 'three',
      dependencies: ['three', '@types/three'],
      absentPeers: ['typegpu', '@typegpu/gl', '@typegpu/three'],
      entry: publicSurfaceEntry([
        '@pmndrs/glyph',
        '@pmndrs/glyph/three',
        '@pmndrs/glyph/shaders/tsl',
        '@pmndrs/glyph/shaders/tsl/bitmap',
        '@pmndrs/glyph/shaders/tsl/msdf',
        '@pmndrs/glyph/shaders/tsl/slug',
        '@pmndrs/glyph/shaders/tsl/decoration',
        '@pmndrs/glyph/shaders/tsl/packed-color',
      ]),
      missingPeerImports: [{ specifier: '@pmndrs/glyph/three/typegpu', peer: 'typegpu' }],
    },
    {
      name: 'typegpu',
      dependencies: ['typegpu', '@webgpu/types'],
      absentPeers: ['three', '@typegpu/gl', '@typegpu/three'],
      entry: publicSurfaceEntry([
        '@pmndrs/glyph',
        '@pmndrs/glyph/typegpu',
        '@pmndrs/glyph/shaders/typegpu',
        '@pmndrs/glyph/shaders/typegpu/bitmap',
        '@pmndrs/glyph/shaders/typegpu/bitmap-reference',
        '@pmndrs/glyph/shaders/typegpu/msdf',
        '@pmndrs/glyph/shaders/typegpu/slug',
        '@pmndrs/glyph/shaders/typegpu/decoration',
      ]),
      missingPeerImports: [{ specifier: '@pmndrs/glyph/three/typegpu', peer: 'three' }],
    },
    {
      name: 'three-typegpu',
      dependencies: ['three', '@types/three', 'typegpu', '@typegpu/gl', '@typegpu/three', '@webgpu/types'],
      absentPeers: [],
      entry: publicSurfaceEntry([
        '@pmndrs/glyph',
        '@pmndrs/glyph/three/typegpu',
        '@pmndrs/glyph/shaders/typegpu',
        '@pmndrs/glyph/shaders/typegpu/bitmap',
        '@pmndrs/glyph/shaders/typegpu/bitmap-reference',
        '@pmndrs/glyph/shaders/typegpu/msdf',
        '@pmndrs/glyph/shaders/typegpu/slug',
        '@pmndrs/glyph/shaders/typegpu/decoration',
      ]),
      missingPeerImports: [],
      runtimePeers: ['@typegpu/gl', '@typegpu/three'],
    },
  ];

  for (const consumer of cases) {
    const consumerDirectory = join(temporaryDirectory, consumer.name);
    await mkdir(consumerDirectory);
    await copyFile(archive, join(consumerDirectory, 'glyph.tgz'));
    const dependencies = { '@pmndrs/glyph': 'file:./glyph.tgz' };
    for (const name of consumer.dependencies) {
      assert.equal(typeof availableVersions[name], 'string', `${name} needs a fixture version`);
      dependencies[name] = availableVersions[name];
    }
    await writeFile(
      join(consumerDirectory, 'package.json'),
      `${JSON.stringify({ private: true, type: 'module', dependencies }, undefined, 2)}\n`,
    );
    await writeFile(join(consumerDirectory, 'entry.ts'), `${consumer.entry.join('\n')}\n`);
    await writeFile(
      join(consumerDirectory, 'tsconfig.json'),
      `${JSON.stringify(typescriptConfig('./entry.ts', consumer.dependencies.includes('@webgpu/types'), true), undefined, 2)}\n`,
    );
    execFileSync(
      'pnpm',
      [
        'install',
        '--ignore-workspace',
        '--prefer-offline',
        '--config.auto-install-peers=false',
        '--config.node-linker=hoisted',
        '--store-dir',
        storeDirectory,
      ],
      { cwd: consumerDirectory, encoding: 'utf8', env: { ...process.env, CI: 'true' } },
    );

    const entry = join(consumerDirectory, 'entry.ts');
    const resolveFromConsumer = createRequire(entry);
    for (const peer of consumer.absentPeers) {
      assert.throws(
        () => resolveFromConsumer.resolve(peer),
        { code: 'MODULE_NOT_FOUND' },
        `${consumer.name} must not install optional peer ${peer}`,
      );
    }
    execFileSync(process.execPath, [join(packageDirectory, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], {
      cwd: consumerDirectory,
      stdio: 'pipe',
    });
    await buildInstalledConsumer(entry);

    for (const peer of consumer.runtimePeers ?? []) {
      await assertRuntimeImportRequiresPeer(consumerDirectory, '@pmndrs/glyph/three/typegpu', peer);
    }

    for (const rejected of consumer.missingPeerImports) {
      assertRuntimeImportRejects(consumerDirectory, rejected.specifier, rejected.peer);
    }
  }
}

async function assertRuntimeImportRequiresPeer(consumerDirectory, specifier, peer) {
  const peerDirectory = join(consumerDirectory, 'node_modules', ...peer.split('/'));
  const hiddenDirectory = `${peerDirectory}.hidden`;
  await rename(peerDirectory, hiddenDirectory);
  try {
    assertRuntimeImportRejects(consumerDirectory, specifier, peer);
  } finally {
    await rename(hiddenDirectory, peerDirectory);
  }
}

function assertRuntimeImportRejects(consumerDirectory, specifier, peer) {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', `import(${JSON.stringify(specifier)})`],
    {
      cwd: consumerDirectory,
      encoding: 'utf8',
    },
  );
  assert.notEqual(result.status, 0, `${specifier} must reject a missing ${peer} peer`);
  assert.match(`${result.stdout}\n${result.stderr}`, /ERR_MODULE_NOT_FOUND/);
  assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(escapeRegExp(peer)));
}

function typescriptConfig(entry, includeWebGpuTypes, skipLibCheck) {
  return {
    compilerOptions: {
      lib: ['ES2025', 'DOM', 'DOM.Iterable'],
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      noEmit: true,
      skipLibCheck,
      strict: true,
      target: 'ES2022',
      types: includeWebGpuTypes ? ['@webgpu/types'] : [],
    },
    files: [entry],
  };
}

function publicSurfaceEntry(specifiers) {
  return [
    ...specifiers.map((specifier, index) => `import * as surface${String(index)} from '${specifier}';`),
    `export const publicSurface = [${specifiers.map((_specifier, index) => `surface${String(index)}`).join(', ')}];`,
  ];
}

async function buildInstalledConsumer(entry) {
  await build({
    configFile: false,
    logLevel: 'silent',
    mode: 'production',
    root: dirname(entry),
    build: {
      lib: { entry, formats: ['es'], fileName: 'entry' },
      minify: 'oxc',
      target: 'es2022',
      write: false,
    },
  });
}

function escapeRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
