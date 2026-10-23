/* @workflow {
  "name": "benchmark:packed-consumer",
  "summary": "Pack Glyph or install a frozen archive and prove runtime font baking from an isolated browser consumer.",
  "requirements": "Built Glyph package, pnpm offline cache, and Playwright Chromium. For a frozen archive pass --artifact, --expected-sha256, and --output together.",
  "writes": "Ignored temporary files under benches/.cache, removed before exit; optional JSON receipt at --output."
} */
import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Browser, Response } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';

import { launchProjectChromium } from './support/project-chromium.mts';
import {
  assertArchiveSha256,
  assertDeliveredEntries,
  assertInstalledDist,
  assertProofServerNonce,
  distInventory,
  installedDistResponseSource,
  sha256,
} from './support/archive-dist-proof.mts';
import { packedArchiveDependency } from './support/packed-archive.mts';
import { installedCoreDependencies } from './support/package-labs-dependencies.mts';

interface PackedResult {
  readonly hash?: string;
  readonly bytes?: number;
  readonly error?: string;
}

const execFile = promisify(execFileCallback);
const appDirectory = fileURLToPath(new URL('..', import.meta.url));
const workspaceDirectory = fileURLToPath(new URL('../..', import.meta.url));
const cacheDirectory = join(appDirectory, '.cache');
const options = parseOptions(process.argv.slice(2));
const serverNonce = randomUUID();
const port = process.env.PORT === undefined ? 0 : Number(process.env.PORT);
if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error('PORT must be a valid TCP port');
await mkdir(cacheDirectory, { recursive: true });
const consumerDirectory = await mkdtemp(join(cacheDirectory, 'packed-consumer-'));
const archiveDirectory = join(consumerDirectory, 'archives');
await mkdir(archiveDirectory, { recursive: true });

let server: ViteDevServer | undefined;
let browser: Browser | undefined;
let primaryFailure: unknown;
let failed = false;
const teardown: string[] = [];
let receiptFailure: unknown;
let completedResult: PackedResult | undefined;
const receipt: Record<string, unknown> = {
  schemaVersion: 1,
  status: 'running',
  mode: options.artifact === undefined ? 'pack' : 'artifact',
  coverage: 'runtime font baking with font-baker.wasm; text shaping and text-shaper.wasm are not exercised',
  ...(options.artifact === undefined
    ? {}
    : { archive: { path: options.artifact, expectedSha256: options.expectedSha256 } }),
  errors: [],
};
try {
  const [glyphArchive] = await Promise.all([
    options.artifact === undefined
      ? packPackage('packages/glyph')
      : authenticateArchive(options.artifact, options.expectedSha256!),
    copyFile(
      join(appDirectory, 'fixtures/fonts/inter-v4.1/Inter-Regular.ttf'),
      join(consumerDirectory, 'Inter-Regular.ttf'),
    ),
    copyFile(
      join(appDirectory, 'fixtures/rendering/inter-bitmap-16.font.glb'),
      join(consumerDirectory, 'Inter.font.glb'),
    ),
  ]);
  await Promise.all([
    writeFile(
      join(consumerDirectory, 'package.json'),
      `${JSON.stringify({ private: true, type: 'module', dependencies: installedCoreDependencies(glyphArchive) }, undefined, 2)}\n`,
    ),
    writeFile(
      join(consumerDirectory, 'index.html'),
      '<!doctype html><link rel="icon" href="data:," /><script type="module" src="/entry.js"></script>\n',
    ),
    writeFile(
      join(consumerDirectory, 'entry.js'),
      `import { bakeFontInWorker } from '@pmndrs/glyph/runtime-bake'
import { glyph, bitmap } from '@pmndrs/glyph'
try {
  const source = new Uint8Array(await (await fetch('/Inter-Regular.ttf')).arrayBuffer())
  const artifact = await bakeFontInWorker({ source, sourceUrl: location.href })
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', artifact))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
  const font = glyph.fontFace('/Inter.font.glb', { format: bitmap({ strikes: [16] }) })
  await font.load()
  font.dispose()
  await globalThis.__reportPackedResult({ hash, bytes: artifact.byteLength })
} catch (error) {
  await globalThis.__reportPackedResult({ error: error instanceof Error ? error.stack : String(error) })
}
`,
    ),
  ]);
  await execFile(
    'pnpm',
    ['install', '--ignore-workspace', '--offline', '--config.node-linker=hoisted', '--config.auto-install-peers=false'],
    {
      cwd: consumerDirectory,
      env: { ...process.env, CI: 'true' },
    },
  );

  const installedRoot = await realpath(join(consumerDirectory, 'node_modules/@pmndrs/glyph'));
  const installedEntries = ['index.js', 'runtime-bake.js', 'font-baker.wasm'] as const;
  const installedSources = Object.fromEntries(
    await Promise.all(
      installedEntries.map(
        async (entry) =>
          [
            entry,
            {
              path: join(installedRoot, 'dist', entry),
              sha256: sha256(await readFile(join(installedRoot, 'dist', entry))),
            },
          ] as const,
      ),
    ),
  ) as Record<(typeof installedEntries)[number], { path: string; sha256: string }>;
  let installedDistSha256ByPath: Record<string, string> | undefined;
  if (options.artifact !== undefined) {
    const unpacked = join(consumerDirectory, 'archive');
    await mkdir(unpacked, { recursive: true });
    await execFile('tar', ['-xzf', options.artifact, '-C', unpacked]);
    const archiveDist = await distInventory(join(unpacked, 'package/dist'));
    const installedDist = await distInventory(join(installedRoot, 'dist'));
    assertInstalledDist(archiveDist, installedDist);
    installedDistSha256ByPath = installedDist;
    receipt.archive = { path: options.artifact, sha256: options.expectedSha256 };
    receipt.installed = { root: installedRoot, distSha256ByPath: installedDist };
  }
  receipt.installedEntries = installedSources;

  server = await createServer({
    root: consumerDirectory,
    plugins: [
      {
        name: 'glyph-packed-proof-origin',
        configureServer(viteServer) {
          viteServer.middlewares.use((_request, response, next) => {
            response.setHeader('x-glyph-proof-nonce', serverNonce);
            next();
          });
        },
      },
    ],
    logLevel: 'silent',
    optimizeDeps: {
      include: ['ajv', 'gltf-validator'],
      ...(options.artifact === undefined ? {} : { exclude: ['@pmndrs/glyph', '@pmndrs/glyph/runtime-bake'] }),
    },
    resolve: {
      preserveSymlinks: true,
      ...(options.artifact === undefined
        ? {}
        : {
            alias: [
              { find: /^@pmndrs\/glyph\/runtime-bake$/u, replacement: installedSources['runtime-bake.js']!.path },
              { find: /^@pmndrs\/glyph$/u, replacement: installedSources['index.js']!.path },
            ],
          }),
    },
    server: { host: process.env.HOST ?? '127.0.0.1', port, strictPort: port !== 0 },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error('packed-consumer Vite server did not expose a TCP port');
  }

  browser = await launchProjectChromium({ headless: true });
  const page = await browser.newPage({ ignoreHTTPSErrors: process.env.PORTLESS_URL !== undefined });
  const responses: {
    url: string;
    source: string;
    status: number;
    resourceType: string;
    contentType: string;
    sha256: string;
    bytes: number;
  }[] = [];
  const responseTasks: Promise<void>[] = [];
  const deliveryErrors: string[] = [];
  const unmatchedGlyphResponses: string[] = [];
  const origin = process.env.PORTLESS_URL ?? `http://127.0.0.1:${address.port}`;
  const expectedOrigin = new URL(origin).origin;
  const errors: string[] = [];
  const blockedRequests: string[] = [];
  const completion = Promise.withResolvers<PackedResult>();
  receipt.browser = { responses, errors, blockedRequests, deliveryErrors, unmatchedGlyphResponses };
  const originProbe = await page.request.get(`${origin}/__glyph-proof-origin__`);
  assertProofServerNonce(originProbe.headers(), serverNonce);
  await page.context().route('**/font-baker.wasm*', async (route) => {
    const url = route.request().url();
    const source = installedDistResponseSource(url, expectedOrigin, consumerDirectory, join(installedRoot, 'dist'));
    if (source !== 'font-baker.wasm' || route.request().resourceType() !== 'fetch') {
      await route.continue();
      return;
    }
    try {
      // The runtime baker may retire its Worker before Playwright can read a passive response body. Hold this
      // request until its actual server bytes have been read and authenticated, then forward those same bytes.
      const response = await route.fetch();
      const body = await response.body();
      const digest = sha256(body);
      responses.push({
        url,
        source,
        status: response.status(),
        resourceType: route.request().resourceType(),
        contentType: response.headers()['content-type'] ?? '',
        sha256: digest,
        bytes: body.byteLength,
      });
      assertProofServerNonce(response.headers(), serverNonce);
      if (
        response.status() < 200 ||
        response.status() >= 300 ||
        body.byteLength < 8 ||
        body[0] !== 0 ||
        body[1] !== 97 ||
        body[2] !== 115 ||
        body[3] !== 109 ||
        digest !== installedSources['font-baker.wasm'].sha256
      ) {
        deliveryErrors.push(`Delivered font-baker.wasm differs from installed archive: ${url}`);
      }
      await route.fulfill({ response, body });
    } catch (error) {
      deliveryErrors.push(`Could not authenticate delivered font-baker.wasm ${url}: ${String(error)}`);
      try {
        await route.abort('failed');
      } catch (abortError) {
        deliveryErrors.push(`Could not abort failed font-baker.wasm request ${url}: ${String(abortError)}`);
      }
    }
  });
  const observeResponse = (response: Response) => {
    const url = response.url();
    const source = installedDistResponseSource(url, expectedOrigin, consumerDirectory, join(installedRoot, 'dist'));
    if (source !== undefined && installedDistSha256ByPath?.[source] !== undefined && /\.(?:js|wasm)$/u.test(source)) {
      try {
        assertProofServerNonce(response.headers(), serverNonce);
      } catch (error) {
        deliveryErrors.push(`Invalid proof origin for installed ${source}: ${String(error)} ${url}`);
      }
      if (response.status() < 200 || response.status() >= 300) {
        deliveryErrors.push(`Invalid installed ${source} response: ${url} (${String(response.status())})`);
      }
    }
    const entry = installedEntries.find((candidate) => candidate === source);
    if (entry === undefined) {
      if (source !== undefined) {
        if (
          installedDistSha256ByPath !== undefined &&
          /\.(?:js|wasm)$/u.test(source) &&
          installedDistSha256ByPath[source] === undefined
        ) {
          deliveryErrors.push(`Installed dist response is absent from authenticated archive inventory: ${source}`);
        }
      } else if (
        options.artifact !== undefined &&
        (installedDistResponseSource(
          url,
          expectedOrigin,
          consumerDirectory,
          join(workspaceDirectory, 'packages/glyph'),
        ) !== undefined ||
          /@pmndrs[/_]glyph|font-baker\.wasm/u.test(decodeURIComponent(new URL(url).pathname)))
      ) {
        unmatchedGlyphResponses.push(url);
        deliveryErrors.push(`Glyph package response did not come from installed dist: ${url}`);
      }
      return;
    }
    if (entry === 'font-baker.wasm' && response.request().resourceType() === 'fetch') return;
    responseTasks.push(
      response
        .body()
        .then((body) => {
          const binaryFetch = entry === 'font-baker.wasm' && response.request().resourceType() === 'fetch';
          const responseSource = entry === 'font-baker.wasm' && !binaryFetch ? 'font-baker.wasm:url-module' : entry;
          responses.push({
            url,
            source: responseSource,
            status: response.status(),
            resourceType: response.request().resourceType(),
            contentType: response.headers()['content-type'] ?? '',
            sha256: sha256(body),
            bytes: body.byteLength,
          });
          try {
            assertProofServerNonce(response.headers(), serverNonce);
          } catch (error) {
            deliveryErrors.push(`Invalid proof origin for installed ${entry}: ${String(error)} ${url}`);
          }
          if (response.status() < 200 || response.status() >= 300) {
            deliveryErrors.push(`Invalid ${entry} response: ${url} (${String(response.status())})`);
          }
          if (
            binaryFetch &&
            (body.byteLength < 8 ||
              body[0] !== 0 ||
              body[1] !== 97 ||
              body[2] !== 115 ||
              body[3] !== 109 ||
              sha256(body) !== installedSources[entry].sha256)
          ) {
            deliveryErrors.push(`Delivered font-baker.wasm differs from installed archive: ${url}`);
          }
        })
        .catch((error: unknown) => {
          deliveryErrors.push(`Could not read ${url}: ${String(error)}`);
        }),
    );
  };
  page.context().on('response', observeResponse);
  page.context().on('requestfailed', (request) => {
    if (request.url().endsWith('/fingerprint-negative-control.js')) return;
    if (/\.(?:js|wasm)(?:\?|$)/u.test(request.url())) {
      const message = `Failed browser request: ${request.url()}`;
      deliveryErrors.push(message);
      completion.resolve({ error: message });
    }
  });
  await page.context().route(/fingerprint/i, async (route) => {
    blockedRequests.push(route.request().url());
    await route.abort('blockedbyclient');
  });
  page.context().on('weberror', (webError) => {
    const error = webError.error();
    errors.push(error.stack ?? error.message);
    completion.resolve({ error: error.message });
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const location = message.location();
    const source = location.url === '' ? '' : ` @ ${location.url}:${String(location.lineNumber)}`;
    errors.push(`${message.text()}${source}`);
    console.error(`${message.text()}${source}`);
  });
  page.on('pageerror', (error) => {
    errors.push(error.message);
    completion.resolve({ error: error.message });
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      const message = `HTTP ${String(response.status())} ${response.request().resourceType()} ${response.url()}`;
      errors.push(message);
      completion.resolve({ error: message });
    }
  });
  await page.exposeFunction('__reportPackedResult', (value: PackedResult) => {
    completion.resolve(value);
  });
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
  const result = await completion.promise;
  receipt.browser = {
    version: browser.version(),
    responses,
    errors,
    blockedRequests,
    deliveryErrors,
    unmatchedGlyphResponses,
    result,
  };
  await Promise.all(responseTasks);
  if (result.error !== undefined) {
    throw new Error(`${result.error}${errors.length === 0 ? '' : `\nBrowser errors:\n${errors.join('\n')}`}`);
  }
  if (errors.length > 0) throw new Error(`packed consumer browser errors: ${errors.join(' | ')}`);
  if (options.artifact !== undefined) {
    try {
      assertDeliveredEntries(responses, installedEntries);
    } catch (error) {
      deliveryErrors.push(`${String(error)}; unmatched Glyph URLs: ${unmatchedGlyphResponses.join(' | ') || 'none'}`);
    }
    if (deliveryErrors.length > 0) throw new Error(`Archive browser delivery failed: ${deliveryErrors.join(' | ')}`);
  }

  const blocked = await page.evaluate(async () => {
    try {
      await fetch('/fingerprint-negative-control.js');
      return false;
    } catch {
      return true;
    }
  });
  if (!blocked || blockedRequests.length !== 1 || !blockedRequests[0]!.endsWith('/fingerprint-negative-control.js')) {
    throw new Error(`Blocked module URLs during installed-package loading: ${blockedRequests.join(', ')}`);
  }

  const manifest = JSON.parse(await readFile(join(appDirectory, 'fixtures/fonts/inter-v4.1/manifest.json'), 'utf8'));
  const expectedHash = manifest.bake.expectedCore.artifactSha256;
  const expectedBytes = manifest.bake.expectedCore.artifactBytes;
  receipt.golden = {
    sha256: expectedHash,
    bytes: expectedBytes,
    manifestSha256: sha256(await readFile(join(appDirectory, 'fixtures/fonts/inter-v4.1/manifest.json'))),
    sourceSha256: sha256(await readFile(join(consumerDirectory, 'Inter-Regular.ttf'))),
  };
  if (result.hash !== expectedHash || result.bytes !== expectedBytes) {
    throw new Error(
      `packed module Worker returned ${result.hash}/${result.bytes}; expected ${expectedHash}/${expectedBytes}`,
    );
  }
  receipt.status = 'completed';
  completedResult = result;
} catch (error) {
  failed = true;
  primaryFailure = error;
  receipt.status = 'failed';
  receipt.errors = [String(error)];
} finally {
  if (browser !== undefined) {
    try {
      await browser.close();
    } catch (error) {
      teardown.push(`browser: ${String(error)}`);
    }
  }
  if (server !== undefined) {
    try {
      await server.close();
    } catch (error) {
      teardown.push(`server: ${String(error)}`);
    }
  }
  try {
    await rm(consumerDirectory, { recursive: true, force: true, maxRetries: 3 });
  } catch (error) {
    teardown.push(`temporary consumer: ${String(error)}`);
  }
  receipt.teardown = { errors: teardown };
  if (teardown.length > 0) receipt.status = 'failed';
  if (options.output !== undefined) {
    try {
      await mkdir(dirname(options.output), { recursive: true });
      await writeFile(options.output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    } catch (error) {
      receiptFailure = error;
    }
  }
  if (failed && receiptFailure !== undefined) {
    process.stderr.write(`Could not persist packed-consumer failure receipt: ${String(receiptFailure)}\n`);
  }
}
if (failed) throw primaryFailure;
if (receiptFailure !== undefined) throw receiptFailure;
if (teardown.length > 0) throw new Error(`Packed consumer teardown failed: ${teardown.join(' | ')}`);
if (completedResult !== undefined) process.stdout.write(`${JSON.stringify(completedResult)}\n`);

function parseOptions(args: string[]): { artifact?: string; expectedSha256?: string; output?: string } {
  if (args.length === 0) return {};
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (
      !['--artifact', '--expected-sha256', '--output'].includes(key ?? '') ||
      value === undefined ||
      values.has(key!)
    ) {
      throw new Error('Use --artifact PATH --expected-sha256 HEX --output PATH');
    }
    values.set(key!, value);
  }
  if (values.size !== 3 || !/^[a-f0-9]{64}$/u.test(values.get('--expected-sha256') ?? '')) {
    throw new Error('Use --artifact PATH --expected-sha256 HEX --output PATH');
  }
  return {
    artifact: resolve(values.get('--artifact')!),
    expectedSha256: values.get('--expected-sha256')!,
    output: resolve(values.get('--output')!),
  };
}

async function authenticateArchive(path: string, expectedSha256: string): Promise<string> {
  try {
    assertArchiveSha256(await readFile(path), expectedSha256);
  } catch (error) {
    throw new Error(`Archive SHA-256 mismatch for ${basename(path)}: ${String(error)}`, { cause: error });
  }
  return `file:${path}`;
}

async function packPackage(packagePath: string): Promise<string> {
  const packageDirectory = join(workspaceDirectory, packagePath);
  await execFile('pnpm', ['pack', '--pack-destination', archiveDirectory], {
    cwd: packageDirectory,
    env: { ...process.env, CI: 'true' },
  });
  return packedArchiveDependency(await readdir(archiveDirectory));
}
