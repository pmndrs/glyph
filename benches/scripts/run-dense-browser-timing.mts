/* @workflow {
  "name": "benchmark:dense-browser-timing",
  "summary": "Measure matched 512/1024 flat TextGroup edits in installed Glyph on Chromium WebGPU and WebGL2.",
  "requirements": "Frozen Glyph archive, full SHA-256, offline pnpm cache, project Chromium, authenticated Inter Bitmap 16 fixture, and Portless PORT/PORTLESS_URL when provided. Pass --artifact ABS --expected-sha256 HEX --output ABS.",
  "writes": "One immutable JSON receipt at --output and two post-timing canvas PNGs beside it; removes its isolated benches/.cache consumer and closes its browser/server."
} */
import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Browser, Page, Response } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';

import {
  assertArchiveSha256,
  assertDeliveredEntries,
  assertInstalledDist,
  assertProofServerNonce,
  distInventory,
  installedDistResponseSource,
  sha256,
} from './support/archive-dist-proof.mts';
import { inspectDenseCanvasPng } from './support/dense-canvas-png.mts';
import { installedPackageDependencies } from './support/package-labs-dependencies.mts';
import { launchProjectChromium } from './support/project-chromium.mts';

type Backend = 'webgpu' | 'webgl2';
type Count = 512 | 1024;
interface Sample {
  readonly count: Count;
  readonly block: number;
  readonly phase: 'alpha' | 'bravo';
  readonly setterMs: number;
  readonly publicationMs: number;
  readonly renderSubmitMs: number;
  readonly rendererTotalMs: number;
  readonly completeCpuMs: number;
  readonly rafTimestamp: number;
  readonly rafIntervalMs: number | null;
  readonly rafIntervalPreviousCount: Count | null;
  readonly rafIntervalTransition: boolean;
}
interface BrowserResult {
  readonly requestedBackend: Backend;
  readonly actualBackend: Backend;
  readonly backendInfo: unknown;
  readonly fixture: Readonly<{
    readonly grid: readonly [number, number];
    readonly viewport: readonly [number, number];
    readonly dpr: number;
    readonly font: string;
    readonly text: string;
  }>;
  readonly warmupsPerCount: number;
  readonly blocksPerCount: number;
  readonly samplesPerBlock: number;
  readonly blockOrder: readonly (readonly Count[])[];
  readonly samples: Readonly<Record<Count, readonly Sample[]>>;
  readonly longTasks: readonly { readonly startTime: number; readonly duration: number }[];
  readonly oracles: unknown;
}
interface DeliveryResponse {
  readonly url: string;
  readonly source: string;
  readonly status: number;
  readonly resourceType: string;
  readonly sha256?: string;
  readonly bytes?: number;
}

const execFile = promisify(execFileCallback);
const appRoot = fileURLToPath(new URL('..', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
const scriptPath = fileURLToPath(import.meta.url);
const entryPath = fileURLToPath(new URL('./support/dense-browser-entry.js', import.meta.url));
const fixturePath = join(appRoot, 'fixtures/rendering/inter-bitmap-16.font.glb');
const fixtureSha256 = 'acdca408ed169c7aa1c2791dbbc2982afa1939c56fbc59ef43cc38f7ff366c14';
const options = parseOptions(process.argv.slice(2));
const port = process.env.PORT === undefined ? 0 : Number(process.env.PORT);
if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error('PORT must be a valid TCP port');
const nonce = randomUUID();
const receipt: Record<string, unknown> = {
  schemaVersion: 1,
  status: 'running',
  archive: { path: options.artifact, expectedSha256: options.expectedSha256 },
  model:
    'paired flat TextGroup 512/1024 browser CPU callback timing; publication is one existing Three scene traversal inside renderer.render; RAF interval is frame pacing, not GPU completion',
  limitations: [
    'Synchronous renderer.render duration is CPU submission, not GPU execution or display presentation.',
    'The fixture is matched between counts but differs from the maintained seven-family Node timing matrix.',
    'Headless Chromium device identity may be unavailable or software-backed; no hardware claim is inferred.',
    'No process or OS memory claim is made.',
  ],
  errors: [],
};
let consumer: string | undefined;
let server: ViteDevServer | undefined;
let browser: Browser | undefined;
let failure: unknown;
const teardownErrors: string[] = [];
try {
  const archiveBytes = await readFile(options.artifact);
  assertArchiveSha256(archiveBytes, options.expectedSha256);
  const [scriptBytes, entryBytes, fixtureBytes] = await Promise.all([
    readFile(scriptPath),
    readFile(entryPath),
    readFile(fixturePath),
  ]);
  if (sha256(fixtureBytes) !== fixtureSha256) throw new Error('Inter Bitmap 16 fixture differs from pinned bytes');
  receipt.sources = {
    timingScriptSha256: sha256(scriptBytes),
    browserEntrySha256: sha256(entryBytes),
    fixtureSha256: sha256(fixtureBytes),
  };
  await mkdir(join(appRoot, '.cache'), { recursive: true });
  consumer = await mkdtemp(join(appRoot, '.cache/dense-browser-'));
  const consumerRoot = consumer;
  await Promise.all([
    copyFile(fixturePath, join(consumerRoot, 'Inter.font.glb')),
    copyFile(entryPath, join(consumerRoot, 'entry.js')),
    writeFile(
      join(consumerRoot, 'index.html'),
      '<!doctype html><body style="margin:0;background:black"><canvas id="canvas" width="1536" height="1536"></canvas><script type="module" src="/entry.js"></script></body>\n',
    ),
    writeFile(
      join(consumerRoot, 'package.json'),
      `${JSON.stringify({ private: true, type: 'module', dependencies: installedPackageDependencies(`file:${options.artifact}`) }, null, 2)}\n`,
    ),
  ]);
  await execFile(
    'pnpm',
    ['install', '--ignore-workspace', '--offline', '--config.node-linker=hoisted', '--config.auto-install-peers=false'],
    { cwd: consumerRoot, env: { ...process.env, CI: 'true' } },
  );
  const installedRoot = await realpath(join(consumerRoot, 'node_modules/@pmndrs/glyph'));
  const archiveRoot = join(consumerRoot, 'archive');
  await mkdir(archiveRoot, { recursive: true });
  await execFile('tar', ['-xzf', options.artifact, '-C', archiveRoot]);
  const archiveInventory = await distInventory(join(archiveRoot, 'package/dist'));
  const installedInventory = await distInventory(join(installedRoot, 'dist'));
  assertInstalledDist(archiveInventory, installedInventory);
  for (const required of ['index.js', 'three.js', 'text-shaper.wasm']) {
    if (installedInventory[required] === undefined) throw new Error(`Archive lacks required ${required}`);
  }
  receipt.installed = { root: installedRoot, distSha256ByPath: installedInventory };
  receipt.dependencies = installedPackageDependencies(`file:${options.artifact}`);
  server = await createServer({
    root: consumerRoot,
    logLevel: 'silent',
    plugins: [
      {
        name: 'dense-browser-proof-origin',
        configureServer(viteServer) {
          viteServer.middlewares.use((_request, response, next) => {
            response.setHeader('x-glyph-proof-nonce', nonce);
            next();
          });
        },
      },
    ],
    optimizeDeps: { include: ['ajv', 'gltf-validator'], exclude: ['@pmndrs/glyph', '@pmndrs/glyph/three'] },
    resolve: {
      preserveSymlinks: true,
      dedupe: ['three'],
      alias: [
        { find: /^@pmndrs\/glyph\/three$/u, replacement: join(installedRoot, 'dist/three.js') },
        { find: /^@pmndrs\/glyph$/u, replacement: join(installedRoot, 'dist/index.js') },
      ],
    },
    server: {
      host: process.env.HOST ?? '127.0.0.1',
      port,
      strictPort: port !== 0,
      fs: { allow: [consumerRoot, installedRoot] },
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error('Dense browser Vite server did not expose a TCP port');
  }
  const origin = process.env.PORTLESS_URL ?? `http://127.0.0.1:${String(address.port)}`;
  const expectedOrigin = new URL(origin).origin;
  browser = await launchProjectChromium({
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
  });
  receipt.browser = { version: browser.version(), origin, portless: process.env.PORTLESS_URL !== undefined };
  const backendResults: Record<string, unknown> = {};
  receipt.backends = backendResults;
  for (const backend of ['webgpu', 'webgl2'] as const) {
    const page = await browser.newPage({
      viewport: { width: 1536, height: 1536 },
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: process.env.PORTLESS_URL !== undefined,
    });
    const backendReceipt: Record<string, unknown> = {};
    backendResults[backend] = backendReceipt;
    try {
      await captureBackend({
        page,
        backend,
        backendReceipt,
        origin,
        expectedOrigin,
        nonce,
        consumerRoot,
        installedRoot,
        installedInventory,
        output: options.output,
      });
    } finally {
      try {
        await page.close();
      } catch (error) {
        teardownErrors.push(`${backend} page: ${String(error)}`);
      }
    }
  }
  receipt.status = 'completed';
} catch (error) {
  failure = error;
  receipt.status = 'failed';
  (receipt.errors as string[]).push(String(error));
} finally {
  try {
    await browser?.close();
  } catch (error) {
    teardownErrors.push(`browser: ${String(error)}`);
  }
  try {
    await server?.close();
  } catch (error) {
    teardownErrors.push(`Vite server: ${String(error)}`);
  }
  if (consumer !== undefined) {
    try {
      await rm(consumer, { recursive: true, force: true, maxRetries: 3 });
    } catch (error) {
      teardownErrors.push(`consumer: ${String(error)}`);
    }
  }
  receipt.teardown = { errors: teardownErrors };
  if (teardownErrors.length > 0) {
    receipt.status = 'failed';
    (receipt.errors as string[]).push(...teardownErrors);
  }
  try {
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    if (failure === undefined) failure = error;
    else process.stderr.write(`Could not preserve dense-browser failure receipt: ${String(error)}\n`);
  }
}
if (failure !== undefined) throw failure;
if (teardownErrors.length > 0) throw new Error(`Dense-browser teardown failed: ${teardownErrors.join(' | ')}`);

function parseOptions(args: readonly string[]): {
  readonly artifact: string;
  readonly expectedSha256: string;
  readonly output: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (
      !['--artifact', '--expected-sha256', '--output'].includes(key ?? '') ||
      value === undefined ||
      values.has(key!)
    ) {
      throw new Error('Use --artifact ABS --expected-sha256 HEX --output ABS');
    }
    values.set(key!, value);
  }
  const artifact = values.get('--artifact');
  const output = values.get('--output');
  const expectedSha256 = values.get('--expected-sha256');
  if (
    values.size !== 3 ||
    artifact === undefined ||
    output === undefined ||
    !isAbsolute(artifact) ||
    !isAbsolute(output) ||
    !/^[a-f0-9]{64}$/u.test(expectedSha256 ?? '')
  ) {
    throw new Error('Use --artifact ABS --expected-sha256 HEX --output ABS');
  }
  if (resolve(output) === resolve(artifact)) throw new Error('Output must differ from archive');
  return { artifact: resolve(artifact), expectedSha256: expectedSha256!, output: resolve(output) };
}

async function captureBackend(input: {
  readonly page: Page;
  readonly backend: Backend;
  readonly backendReceipt: Record<string, unknown>;
  readonly origin: string;
  readonly expectedOrigin: string;
  readonly nonce: string;
  readonly consumerRoot: string;
  readonly installedRoot: string;
  readonly installedInventory: Record<string, string>;
  readonly output: string;
}): Promise<void> {
  const {
    page,
    backend,
    backendReceipt,
    origin,
    expectedOrigin,
    nonce: expectedNonce,
    consumerRoot,
    installedRoot,
    installedInventory,
    output,
  } = input;
  const responses: DeliveryResponse[] = [];
  const deliveryErrors: string[] = [];
  const browserErrors: string[] = [];
  const pending: Promise<void>[] = [];
  let canvasPng: Buffer | undefined;
  Object.assign(backendReceipt, { responses, deliveryErrors, browserErrors });
  await page.exposeFunction('captureDenseCanvas', async () => {
    canvasPng = await page.locator('#canvas').screenshot();
  });
  const installedDistRoot = join(installedRoot, 'dist');
  const originProbe = await page.request.get(`${origin}/__glyph-proof-origin__`);
  assertProofServerNonce(originProbe.headers(), expectedNonce);
  let fixtureDelivered = false;
  await page.context().route('**/Inter.font.glb', async (route) => {
    const url = route.request().url();
    try {
      if (new URL(url).origin !== expectedOrigin || new URL(url).pathname !== '/Inter.font.glb') {
        throw new Error(`Unexpected font fixture URL: ${url}`);
      }
      const response = await route.fetch();
      const body = await response.body();
      assertProofServerNonce(response.headers(), expectedNonce);
      if (response.status() !== 200 || sha256(body) !== fixtureSha256) {
        throw new Error('Delivered Inter Bitmap 16 fixture differs from pinned bytes');
      }
      fixtureDelivered = true;
      backendReceipt.fixtureDelivery = { url, status: response.status(), bytes: body.length, sha256: sha256(body) };
      await route.fulfill({ response, body });
    } catch (error) {
      deliveryErrors.push(`Could not authenticate delivered Inter fixture: ${String(error)}`);
      try {
        await route.abort('failed');
      } catch (abortError) {
        deliveryErrors.push(`Could not abort failed font request: ${String(abortError)}`);
      }
    }
  });
  await page.context().route('**/text-shaper.wasm*', async (route) => {
    const url = route.request().url();
    const source = installedDistResponseSource(url, expectedOrigin, consumerRoot, installedDistRoot);
    if (source !== 'text-shaper.wasm' || route.request().resourceType() !== 'fetch') {
      await route.continue();
      return;
    }
    try {
      const response = await route.fetch();
      const body = await response.body();
      const digest = sha256(body);
      responses.push({
        url,
        source,
        status: response.status(),
        resourceType: 'fetch',
        sha256: digest,
        bytes: body.length,
      });
      assertProofServerNonce(response.headers(), expectedNonce);
      if (
        response.status() < 200 ||
        response.status() >= 300 ||
        body.length < 8 ||
        body[0] !== 0 ||
        body[1] !== 97 ||
        body[2] !== 115 ||
        body[3] !== 109 ||
        digest !== installedInventory[source]
      ) {
        deliveryErrors.push(`Delivered text-shaper.wasm differs from frozen installed archive: ${url}`);
      }
      await route.fulfill({ response, body });
    } catch (error) {
      deliveryErrors.push(`Could not authenticate delivered text-shaper.wasm ${url}: ${String(error)}`);
      try {
        await route.abort('failed');
      } catch (abortError) {
        deliveryErrors.push(`Could not abort failed shaper request: ${String(abortError)}`);
      }
    }
  });
  page.context().on('response', (response: Response) => {
    const url = response.url();
    if (new URL(url).origin !== expectedOrigin) return;
    const source = installedDistResponseSource(url, expectedOrigin, consumerRoot, installedDistRoot);
    if (source === undefined) {
      const workspaceSource = installedDistResponseSource(
        url,
        expectedOrigin,
        consumerRoot,
        join(workspaceRoot, 'packages/glyph'),
      );
      if (
        workspaceSource !== undefined ||
        /@pmndrs[/_]glyph|text-shaper\.wasm/u.test(decodeURIComponent(new URL(url).pathname))
      ) {
        deliveryErrors.push(`Glyph source did not come from installed dist: ${url}`);
      }
      return;
    }
    if (!/\.(?:js|wasm)$/u.test(source) || installedInventory[source] === undefined) {
      deliveryErrors.push(`Installed response not in authenticated dist inventory: ${url}`);
      return;
    }
    try {
      assertProofServerNonce(response.headers(), expectedNonce);
      if (response.status() < 200 || response.status() >= 300) {
        deliveryErrors.push(`Installed ${source} response failed: ${String(response.status())}`);
      }
    } catch (error) {
      deliveryErrors.push(`Installed ${source} has invalid origin nonce: ${String(error)}`);
    }
    if (source === 'text-shaper.wasm' && response.request().resourceType() === 'fetch') return;
    if (source !== 'index.js' && source !== 'three.js') {
      responses.push({ url, source, status: response.status(), resourceType: response.request().resourceType() });
      return;
    }
    pending.push(
      response
        .body()
        .then((body) => {
          responses.push({
            url,
            source,
            status: response.status(),
            resourceType: response.request().resourceType(),
            sha256: sha256(body),
            bytes: body.length,
          });
        })
        .catch((error: unknown) => {
          deliveryErrors.push(`Could not read installed ${source}: ${String(error)}`);
        }),
    );
  });
  page.context().on('requestfailed', (request) => {
    if (/\.(?:js|wasm)(?:\?|$)/u.test(request.url())) deliveryErrors.push(`Failed package request: ${request.url()}`);
  });
  page.context().on('weberror', (error) => browserErrors.push(error.error().stack ?? error.error().message));
  page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  try {
    await page.goto(`${origin}/?backend=${backend}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => (window as typeof window & { denseBrowserReady?: Promise<BrowserResult> }).denseBrowserReady !== undefined,
    );
    const browserResult = await withDeadline(
      page.evaluate(() => (window as typeof window & { denseBrowserReady: Promise<BrowserResult> }).denseBrowserReady),
      10 * 60_000,
      `${backend} dense timing exceeded ten minutes`,
    );
    backendReceipt.browserResult = browserResult;
    backendReceipt.summary = summarize(browserResult);
    if (canvasPng === undefined) throw new Error(`${backend} timed canvas was not captured`);
    const pixels = await inspectDenseCanvasPng(page, canvasPng);
    const pngPath = `${output}.${backend}.png`;
    await mkdir(dirname(pngPath), { recursive: true });
    await writeFile(pngPath, canvasPng, { flag: 'wx' });
    backendReceipt.canvas = { path: pngPath, ...pixels };
  } finally {
    await Promise.all(pending);
  }
  assertDeliveredEntries(responses, ['index.js', 'three.js', 'text-shaper.wasm']);
  if (!fixtureDelivered) throw new Error('Inter Bitmap 16 fixture was not delivered');
  if (
    !responses.some(
      (response) =>
        response.source === 'text-shaper.wasm' &&
        response.resourceType === 'fetch' &&
        response.sha256 === installedInventory['text-shaper.wasm'],
    )
  ) {
    throw new Error('Actual fetched text-shaper.wasm bytes were not authenticated');
  }
  if (browserErrors.length > 0 || deliveryErrors.length > 0) {
    throw new Error(`${backend} browser/archive proof failed: ${[...browserErrors, ...deliveryErrors].join(' | ')}`);
  }
}

function summarize(result: BrowserResult): Record<Count, unknown> {
  if (
    result.actualBackend !== result.requestedBackend ||
    result.warmupsPerCount !== 20 ||
    result.blocksPerCount !== 8 ||
    result.samplesPerBlock !== 16 ||
    result.fixture.grid[0] !== 32 ||
    result.fixture.grid[1] !== 32 ||
    result.fixture.viewport[0] !== 1536 ||
    result.fixture.viewport[1] !== 1536 ||
    result.fixture.dpr !== 1 ||
    result.fixture.font !== 'Inter Bitmap 16' ||
    result.fixture.text !== 'alpha/bravo, one space, then zero-padded four-digit index'
  ) {
    throw new Error('Browser timing protocol/backend mismatch');
  }
  for (let block = 0; block < 8; block += 1) {
    const expected = block % 2 === 0 ? [512, 1024] : [1024, 512];
    if (result.blockOrder[block]?.join(',') !== expected.join(',')) throw new Error(`Block ${block} order mismatch`);
  }
  const summary = {} as Record<Count, unknown>;
  for (const count of [512, 1024] as const) {
    const samples = result.samples[count];
    if (samples.length !== 128) throw new Error(`Expected 128 ${count}-label samples`);
    if (samples.some((sample) => sample.count !== count)) throw new Error(`Mislabeled ${count}-label sample`);
    for (let block = 0; block < 8; block += 1) {
      if (samples.filter((sample) => sample.block === block).length !== 16) {
        throw new Error(`Missing ${count}-label block ${block}`);
      }
    }
    const metrics = [
      'setterMs',
      'publicationMs',
      'renderSubmitMs',
      'rendererTotalMs',
      'completeCpuMs',
      'rafIntervalMs',
    ] as const;
    const percentiles = Object.fromEntries(
      metrics.map((metric) => {
        // A preceding rAF interval after a count switch includes the other count's frame. Keep
        // every raw interval, but exclude those transitions from count-specific pacing quantiles.
        const eligible =
          metric === 'rafIntervalMs' ? samples.filter((sample) => !sample.rafIntervalTransition) : samples;
        const values = eligible.map((sample) => sample[metric]).filter((value): value is number => value !== null);
        if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error(`Invalid ${metric} sample`);
        return [metric, { p50: nearestRank(values, 0.5), p95: nearestRank(values, 0.95) }];
      }),
    );
    const blocks = Array.from({ length: 8 }, (_, block) => {
      const values = samples.filter((sample) => sample.block === block).map((sample) => sample.completeCpuMs);
      return { block, completeCpuP50Ms: nearestRank(values, 0.5), completeCpuP95Ms: nearestRank(values, 0.95) };
    });
    summary[count] = {
      percentiles,
      blocks,
      pacingIntervalsExcludingTransitions: samples.filter(
        (sample) => !sample.rafIntervalTransition && sample.rafIntervalMs !== null,
      ).length,
      pacingTransitionIntervalsInRawSamples: samples.filter((sample) => sample.rafIntervalTransition).length,
    };
  }
  return summary;
}

function nearestRank(values: readonly number[], quantile: number): number {
  if (values.length === 0) throw new Error('No timing samples');
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(quantile * sorted.length) - 1]!;
}

async function withDeadline<Value>(work: Promise<Value>, milliseconds: number, message: string): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
