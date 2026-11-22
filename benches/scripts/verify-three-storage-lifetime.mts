/* @workflow { "name": "benchmark:three-storage-lifetime", "summary": "Probe Three storage retirement and sibling survival on a persistent renderer.", "requirements": "Built Glyph distribution, Playwright Chromium, baked Inter fixture, and npm access to the selected exact Three version. Pass --three-version=0.185.1 for the tested lower peer, --glyph-tgz=<packed package> --expect-leak for a final-owner negative control, or --scenario=sibling --expect-sibling-failure for a pre-fix sibling negative control.", "writes": "No repository files; temporary package extracts are removed." } */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

import { launchProjectChromium } from './support/project-chromium.mts';

interface StorageLifetimeResult {
  readonly backend: 'webgpu' | 'webgl2';
  readonly baseline: number;
  readonly firstDraw: number;
  readonly firstEmpty: number;
  readonly revivedDraw: number;
  readonly finalEmpty: number;
  readonly finalDisposed: number;
  readonly firstEmptyBytes: number;
  readonly firstGeometryAttributes: readonly string[];
  readonly retiredGeometryAttributes: readonly string[];
  readonly reusedTransformAttribute: boolean;
  readonly identicalRevivedPixels: boolean;
  readonly firstDrawPixels: number;
  readonly revivedDrawPixels: number;
  readonly firstEmptyPixels: number;
  readonly finalEmptyPixels: number;
  readonly secondaryDraw?: number;
  readonly secondaryDisposed?: number;
  readonly secondaryDisposedBeforeOwner?: boolean;
}

interface SiblingPreparation {
  readonly initial: {
    readonly backend: 'webgpu' | 'webgl2';
    readonly referencePixels: number;
    readonly bothPixels: number;
    readonly sharedAttributeName: string;
    readonly storageBefore: number;
  };
  trigger(): Promise<{
    readonly retiredDrawDisposed: boolean;
    readonly retiredHeldSharedAtDispose: boolean;
    readonly survivorRetainedDraw: boolean;
    readonly survivorRetainedStorage: boolean;
    readonly identicalSurvivorPixels: boolean;
    readonly survivorPixels: number | undefined;
    readonly storageAfter: number;
    readonly renderError: string | undefined;
  }>;
}

const exec = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const workspaceGlyph = resolve(root, '../packages/glyph');
const threeVersion = option('--three-version=') ?? '0.186.1';
if (threeVersion !== '0.185.1' && threeVersion !== '0.186.1') {
  throw new Error('three-version must be 0.185.1 or 0.186.1');
}
const glyphTgz = option('--glyph-tgz=');
const scenario = option('--scenario=') ?? 'single';
if (
  scenario !== 'single' &&
  scenario !== 'multi' &&
  scenario !== 'renderer-disposed-first' &&
  scenario !== 'compile' &&
  scenario !== 'sibling'
) {
  throw new Error('scenario must be single, multi, renderer-disposed-first, compile, or sibling');
}
const threeSourceArchive = option('--three-source-archive=');
const upstreamCommit = '9986ad524ae0c0ad0fd5193bd6ac235743d0b843';
const upstreamArchiveSha256 = '1116f218148d0a141cc7c7236e0326eb068b70b22abe26dbacff82a4cd74142b';
const expectLeak = process.argv.includes('--expect-leak');
if (expectLeak && glyphTgz === undefined) throw new Error('--expect-leak requires --glyph-tgz');
const expectSiblingFailure = process.argv.includes('--expect-sibling-failure');
if (expectSiblingFailure && (scenario !== 'sibling' || glyphTgz === undefined)) {
  throw new Error('--expect-sibling-failure requires --scenario=sibling and --glyph-tgz');
}
if (scenario === 'sibling' && expectLeak) throw new Error('--expect-leak applies only to final-owner scenarios');
const temporary = await mkdtemp(join(tmpdir(), 'glyph-three-storage-'));
const port = process.env.PORT === undefined ? 0 : Number(process.env.PORT);
if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error('PORT must be a valid TCP port');
const host = process.env.HOST ?? '127.0.0.1';
let browser: Awaited<ReturnType<typeof launchProjectChromium>> | undefined;
let server: ViteDevServer | undefined;
try {
  const threeExtract = join(temporary, 'three');
  await mkdir(threeExtract);
  let threeDir: string;
  let entryRoot: string;
  if (threeSourceArchive !== undefined) {
    const archive = resolve(threeSourceArchive);
    const archiveSha256 = createHash('sha256')
      .update(await readFile(archive))
      .digest('hex');
    if (archiveSha256 !== upstreamArchiveSha256)
      throw new Error(`unexpected upstream archive SHA-256 ${archiveSha256}`);
    await exec('tar', [
      '-xzf',
      archive,
      '-C',
      threeExtract,
      '--strip-components=1',
      `mrdoob-three.js-${upstreamCommit.slice(0, 7)}/src`,
    ]);
    threeDir = threeExtract;
    entryRoot = 'src';
    process.stdout.write(`Three unreleased source commit ${upstreamCommit}, archive SHA-256 ${archiveSha256}\n`);
  } else {
    const { stdout: tarName } = await exec('npm', [
      'pack',
      `three@${threeVersion}`,
      '--pack-destination',
      threeExtract,
      '--silent',
    ]);
    const threeTgz = join(threeExtract, tarName.trim());
    const threeSha256 = createHash('sha256')
      .update(await readFile(threeTgz))
      .digest('hex');
    await exec('tar', ['-xzf', threeTgz, '-C', threeExtract]);
    threeDir = join(threeExtract, 'package');
    entryRoot = 'build';
    process.stdout.write(`Three ${threeVersion} tarball SHA-256 ${threeSha256}\n`);
  }
  const aliases =
    threeSourceArchive === undefined
      ? [
          { find: 'three/webgpu', replacement: join(threeDir, entryRoot, 'three.webgpu.js') },
          { find: 'three/tsl', replacement: join(threeDir, entryRoot, 'three.tsl.js') },
          { find: /^three$/, replacement: join(threeDir, entryRoot, 'three.module.js') },
        ]
      : [
          { find: 'three/webgpu', replacement: join(threeDir, entryRoot, 'Three.WebGPU.js') },
          { find: 'three/tsl', replacement: join(threeDir, entryRoot, 'Three.TSL.js') },
          { find: /^three$/, replacement: join(threeDir, entryRoot, 'Three.js') },
        ];
  const allowed = [root, workspaceGlyph, await realpath(threeDir)];
  if (glyphTgz !== undefined) {
    const extracted = join(temporary, 'glyph');
    await mkdir(extracted);
    const archive = resolve(glyphTgz);
    const glyphSha256 = createHash('sha256')
      .update(await readFile(archive))
      .digest('hex');
    process.stdout.write(`Glyph tarball SHA-256 ${glyphSha256}\n`);
    await exec('tar', ['-xzf', archive, '-C', extracted]);
    const glyphDir = join(extracted, 'package');
    await symlink(join(workspaceGlyph, 'node_modules'), join(glyphDir, 'node_modules'), 'dir');
    aliases.unshift(
      { find: /^@pmndrs\/glyph\/three\/typegpu$/, replacement: join(glyphDir, 'dist/three/typegpu.js') },
      { find: /^@pmndrs\/glyph\/three$/, replacement: join(glyphDir, 'dist/three.js') },
      { find: /^@pmndrs\/glyph$/, replacement: join(glyphDir, 'dist/index.js') },
    );
    allowed.push(await realpath(glyphDir));
  }
  server = await createServer({
    root,
    logLevel: 'error',
    resolve: { alias: aliases },
    optimizeDeps: { entries: ['v1-storage-lifetime.html'], force: true },
    server: { host, port, strictPort: port !== 0, fs: { allow: allowed } },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === 'string') throw new Error('Vite has no port');
  const origin = process.env.PORTLESS_URL ?? `http://127.0.0.1:${String(address.port)}`;
  browser = await launchProjectChromium({
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
  });
  for (const backend of ['webgpu', 'webgl2'] as const) {
    const page = await browser.newPage({ viewport: { width: 256, height: 128 }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/v1-storage-lifetime.html?backend=${backend}&scenario=${scenario}`, {
      waitUntil: 'domcontentloaded',
    });
    if (scenario === 'sibling') {
      await page.waitForFunction(
        () =>
          (window as typeof window & { targetV1SiblingStorageReady?: Promise<SiblingPreparation> })
            .targetV1SiblingStorageReady !== undefined,
      );
      const initial = await page.evaluate(
        async () =>
          (
            await (window as typeof window & { targetV1SiblingStorageReady: Promise<SiblingPreparation> })
              .targetV1SiblingStorageReady
          ).initial,
      );
      if (errors.length !== 0) throw new Error(`${backend} failed before sibling removal: ${errors.join(' | ')}`);
      if (
        initial.backend !== backend ||
        initial.referencePixels < 16 ||
        initial.bothPixels <= initial.referencePixels
      ) {
        throw new Error(`${backend} did not prepare a valid sibling reference: ${JSON.stringify(initial)}`);
      }
      if (backend === 'webgpu' && initial.storageBefore <= 0) {
        throw new Error(
          `${backend} did not allocate shared storage before sibling removal: ${JSON.stringify(initial)}`,
        );
      }
      const result = await page.evaluate(async () =>
        (
          await (window as typeof window & { targetV1SiblingStorageReady: Promise<SiblingPreparation> })
            .targetV1SiblingStorageReady
        ).trigger(),
      );
      await page.close();
      const observation = { ...initial, ...result, browserErrors: errors };
      process.stdout.write(`${threeVersion} ${backend} sibling: ${JSON.stringify(observation)}\n`);
      if (!result.retiredDrawDisposed || !result.survivorRetainedDraw || !result.survivorRetainedStorage) {
        throw new Error(
          `${backend} did not retire one draw while retaining its shared sibling: ${JSON.stringify(observation)}`,
        );
      }
      if (result.retiredHeldSharedAtDispose !== expectSiblingFailure) {
        throw new Error(`${backend} retired geometry had unexpected shared storage: ${JSON.stringify(observation)}`);
      }
      if (expectSiblingFailure && backend === 'webgpu') {
        const destroyedStorageError = /destroyed.*(?:buffer|storage)|(?:buffer|storage).*destroyed/i;
        const observedErrors = [...errors, ...(result.renderError === undefined ? [] : [result.renderError])];
        if (observedErrors.some((message) => !destroyedStorageError.test(message))) {
          throw new Error(`${backend} saw an unrelated error after removal: ${JSON.stringify(observation)}`);
        }
        const validationFailure = observedErrors.length > 0;
        const wrongPixels = result.survivorPixels !== undefined && !result.identicalSurvivorPixels;
        if (!validationFailure && !wrongPixels) {
          throw new Error(`${backend} did not reproduce the sibling failure: ${JSON.stringify(observation)}`);
        }
      } else if (result.renderError !== undefined || errors.length !== 0 || !result.identicalSurvivorPixels) {
        throw new Error(`${backend} sibling changed or failed after removal: ${JSON.stringify(observation)}`);
      }
      continue;
    }
    await page.waitForFunction(
      () =>
        (window as typeof window & { targetV1StorageLifetimeReady?: Promise<StorageLifetimeResult> })
          .targetV1StorageLifetimeReady !== undefined,
    );
    const result = await page.evaluate(
      () =>
        (window as typeof window & { targetV1StorageLifetimeReady: Promise<StorageLifetimeResult> })
          .targetV1StorageLifetimeReady,
    );
    await page.close();
    if (errors.length !== 0) throw new Error(`${backend} browser errors: ${errors.join(' | ')}`);
    if (result.backend !== backend) throw new Error(`${backend} selected ${result.backend}`);
    if (backend === 'webgpu' && (result.firstDraw <= result.baseline || result.revivedDraw <= result.baseline)) {
      throw new Error(`${backend} did not allocate visible storage: ${JSON.stringify(result)}`);
    }
    if (
      result.firstDrawPixels < 16 ||
      result.revivedDrawPixels < 16 ||
      result.firstEmptyPixels !== 0 ||
      result.finalEmptyPixels !== 0 ||
      !result.reusedTransformAttribute ||
      !result.identicalRevivedPixels
    ) {
      throw new Error(
        `${backend} failed visible reactivation using the retained transform attribute: ${JSON.stringify(result)}`,
      );
    }
    if (backend === 'webgpu') {
      const leaked = result.finalDisposed > result.baseline;
      const released = result.finalDisposed === result.baseline;
      if (expectLeak ? !leaked : !released) {
        throw new Error(
          `${backend} ${expectLeak ? 'negative control did not leak' : 'storage did not retire'}: ${JSON.stringify(result)}`,
        );
      }
      if (
        (scenario === 'multi' || scenario === 'renderer-disposed-first') &&
        (result.secondaryDraw === undefined || result.secondaryDraw <= result.baseline)
      ) {
        throw new Error(`${backend} second renderer did not allocate shared storage: ${JSON.stringify(result)}`);
      }
      if (scenario === 'multi' && result.secondaryDisposed !== result.baseline) {
        throw new Error(`${backend} second renderer retained owned storage: ${JSON.stringify(result)}`);
      }
      if (scenario === 'renderer-disposed-first' && result.secondaryDisposedBeforeOwner !== true) {
        throw new Error(`${backend} disposed-renderer order did not complete: ${JSON.stringify(result)}`);
      }
    }
    process.stdout.write(
      `${threeSourceArchive === undefined ? threeVersion : upstreamCommit} ${backend}: ${JSON.stringify(result)}\n`,
    );
  }
} finally {
  await browser?.close();
  await server?.close();
  await rm(temporary, { recursive: true, force: true });
}

function option(prefix: string): string | undefined {
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}
