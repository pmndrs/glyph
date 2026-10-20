/* @workflow {
  "name": "benchmark:bitmap-native-replay-capture",
  "summary": "Authenticate one exact installed-package Bitmap initial/forward/reverse cycle against the native engine.",
  "requirements": "Explicit --artifact (approved 28fd archive) and --output under ignored evidence; pinned pnpm, Node and Rust toolchain.",
  "writes": "Ignored evidence blobs and reports; a temporary installed consumer is removed after capture."
} */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { installedPackageDependencies } from './support/package-labs-dependencies.mts';

const expectedArchive = '28fd04139e792aa37fd963bf6100c091a4acdbd24417e2435f1a71d898ab37bb';
const expectedWasm = '01001ff67186294925137a0fc2deadb94eea294d13182f72ca59e7c164f667cd';
const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!['--artifact', '--output', '--mode'].includes(key ?? '') || value === undefined || args.has(key!)) {
    throw new Error('Supply --artifact, --output, and optional --mode smoke|full as pairs');
  }
  args.set(key!, value);
}
const archive = resolve(args.get('--artifact') ?? '');
const output = resolve(args.get('--output') ?? '');
const mode = args.get('--mode') ?? 'full';
if (!args.has('--artifact') || !args.has('--output') || !['smoke', 'full'].includes(mode)) {
  throw new Error('Supply --artifact, --output, and optional --mode smoke|full');
}
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const archiveHash = sha256(await readFile(archive));
assert.equal(archiveHash, expectedArchive, 'unchanged shipping archive');
const pnpm = process.env.npm_execpath;
if (pnpm === undefined) throw new Error('Run through pinned pnpm workflow');
const tempRoot = await mkdtemp(resolve(tmpdir(), 'glyph-bitmap-replay-'));
const driver = fileURLToPath(new URL('../labs/package/bitmap-native-replay.capture.mts', import.meta.url));
const fixtures = [
  'inter-bitmap-16.font.glb',
  'dot-gothic-16-bitmap-16-32.font.glb',
  'fredoka-issue-216-bitmap-16.font.glb',
];
try {
  await mkdir(output);
  await writeFile(
    resolve(tempRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'glyph-bitmap-native-replay',
        private: true,
        type: 'module',
        dependencies: installedPackageDependencies(`file:${archive}`),
      },
      null,
      2,
    ) + '\n',
  );
  await run(pnpm, ['install', '--ignore-scripts', '--config.confirmModulesPurge=false'], tempRoot);
  const packageRoot = resolve(tempRoot, 'node_modules/@pmndrs/glyph');
  const installedJsBefore = await inventoryJs(resolve(packageRoot, 'dist'));
  assert.equal(sha256(await readFile(resolve(packageRoot, 'dist/text-shaper.wasm'))), expectedWasm);
  const inputFiles: Array<readonly [string, string]> = [
    ['archive', archive],
    ['installedWasm', resolve(packageRoot, 'dist/text-shaper.wasm')],
    ['installedAbi', resolve(packageRoot, 'dist/text-shaper-abi.js')],
    ['lockfile', resolve(tempRoot, 'pnpm-lock.yaml')],
    ['driver', driver],
    ['fixtureSource', fileURLToPath(new URL('../labs/package/fixture.ts', import.meta.url))],
    ...fixtures.map((name): readonly [string, string] => [
      name,
      fileURLToPath(new URL(`../fixtures/rendering/${name}`, import.meta.url)),
    ]),
  ];
  const inputHashes = Object.fromEntries(
    await Promise.all(inputFiles.map(async ([name, path]) => [name, sha256(await readFile(path))] as const)),
  );
  await run(process.execPath, [driver], fileURLToPath(new URL('..', import.meta.url)), {
    GLYPH_LABS_PACKAGE_ROOT: packageRoot,
    GLYPH_BITMAP_REPLAY_OUTPUT: output,
    GLYPH_BITMAP_REPLAY_MODE: mode,
  });
  assert.deepEqual(await inventoryJs(resolve(packageRoot, 'dist')), installedJsBefore, 'installed JS members changed');
  const manifestPath = resolve(output, 'capture-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    eventCount: number;
    blobs: Record<string, { length: number; sha256: string }>;
  };
  for (const [name, identity] of Object.entries(manifest.blobs)) {
    if (name.includes('/') || name.includes('..')) throw new Error(`Invalid captured blob name ${name}`);
    const bytes = await readFile(resolve(output, 'blobs', name));
    assert.equal(bytes.length, identity.length, `${name} length`);
    assert.equal(sha256(bytes), identity.sha256, `${name} SHA-256`);
  }
  const nativeSource = fileURLToPath(
    new URL('../../packages/glyph/rust/shaper/src/engine/transport/bitmap_replay_auth.rs', import.meta.url),
  );
  const transportSource = fileURLToPath(
    new URL('../../packages/glyph/rust/shaper/src/engine/transport.rs', import.meta.url),
  );
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        ...manifest,
        archiveSha256: archiveHash,
        inputHashes,
        installedJsMembers: installedJsBefore,
        tools: {
          node: process.version,
          pnpm: await version(pnpm),
          cargo: await version('cargo'),
          rustc: await version('rustc'),
        },
        observerSha256: sha256(await readFile(driver)),
        nativeHarnessSha256: sha256(await readFile(nativeSource)),
        transportSha256: sha256(await readFile(transportSource)),
        cargoTomlSha256: sha256(
          await readFile(fileURLToPath(new URL('../../packages/glyph/rust/shaper/Cargo.toml', import.meta.url))),
        ),
        workflowSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
      },
      null,
      2,
    ) + '\n',
  );
  if (mode === 'full') {
    const nativeTrace = resolve(output, 'events.jsonl');
    await run(
      'cargo',
      [
        'test',
        '--lib',
        'engine::transport::bitmap_replay_auth::authenticate',
        '--',
        '--ignored',
        '--exact',
        '--nocapture',
      ],
      fileURLToPath(new URL('../../packages/glyph/rust/shaper', import.meta.url)),
      { GLYPH_BITMAP_REPLAY_TRACE: nativeTrace },
    );
    await writeFile(
      resolve(output, 'replay-auth.json'),
      JSON.stringify(
        {
          result: 'exact-byte-pass',
          eventCount: manifest.eventCount,
          archiveSha256: archiveHash,
        },
        null,
        2,
      ) + '\n',
    );
  }
  process.stdout.write(`Bitmap ${mode} capture: ${output}\n`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

async function run(
  command: string,
  arguments_: readonly string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<void> {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(command, arguments_, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolveRun() : reject(new Error(`${basename(command)} exited with ${String(code)}`)),
    );
  });
}

async function inventoryJs(root: string): Promise<Record<string, string>> {
  const files = (await readdir(root, { recursive: true })).filter((name) => name.endsWith('.js')).sort();
  return Object.fromEntries(
    await Promise.all(files.map(async (name) => [name, sha256(await readFile(resolve(root, name)))] as const)),
  );
}

async function version(command: string): Promise<string> {
  return await new Promise<string>((resolveVersion, reject) => {
    const child = spawn(command, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let versionText = '';
    child.stdout.setEncoding('utf8').on('data', (part: string) => {
      versionText += part;
    });
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolveVersion(versionText.trim()) : reject(new Error(`${command} version failed`)),
    );
  });
}
