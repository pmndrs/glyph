/* @workflow { "name": "benchmark:retained-uploads", "summary": "Prove retained Three storage uploads and profile an ASCII-rich Text on WebGPU and WebGL2.", "requirements": "Built Glyph, project Chromium, authenticated Inter Bitmap fixture, WebGPU, WebGL2, and Darwin or Linux advisory-lock tooling. Pass --usage=dynamic only for a baseline revision.", "writes": "No repository files; JSON evidence to stdout, plus optional browser delivery proof at GLYPH_RETAINED_UPLOAD_DELIVERY_PROOF." } */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Request, Response } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';

import { launchProjectChromium } from './support/project-chromium.mts';

interface RetainedUploadResult {
  readonly backend: 'webgpu' | 'webgl2';
  readonly expectedUsage: 'dynamic' | 'stream';
  readonly idle: Readonly<{
    readonly uploads: Readonly<{ readonly attributeUpdateCalls: number }>;
  }>;
}

interface ServedResponse {
  readonly url: string;
  readonly status: number;
  readonly contentType: string;
  readonly resourceType: string;
  readonly kind: 'javascript' | 'wasm' | 'font';
  readonly bytes: number;
  readonly sha256?: string;
  readonly omittedHashReason?: string;
  readonly installedSource?: { readonly path: string; readonly sha256: string };
}

interface FailedRequest {
  readonly url: string;
  readonly resourceType: string;
  readonly failure: string;
}

interface BackendDeliveryProof {
  readonly backend: 'webgpu' | 'webgl2';
  readonly responses: ServedResponse[];
  readonly failedRequests: FailedRequest[];
  readonly errors: string[];
  shaperMatchesInstalled: boolean;
  readonly installedEntriesSeen: { index: boolean; three: boolean };
}

interface DeliveryProof {
  readonly schemaVersion: 1;
  status: 'running' | 'completed' | 'failed';
  readonly installedShaper: { readonly path: string; readonly bytes: number; readonly sha256: string };
  readonly installedEntries: {
    readonly index: { readonly path: string; readonly sha256: string };
    readonly three: { readonly path: string; readonly sha256: string };
  };
  readonly backends: BackendDeliveryProof[];
  readonly errors: string[];
  readonly limitations: readonly string[];
}

const performanceLockPath = '/private/tmp/glyph-perf-measurement.lock';
const scriptPath = fileURLToPath(import.meta.url);
const lockHeld = process.argv.includes('--performance-lock-held');
const usage = process.argv.includes('--usage=dynamic') ? 'dynamic' : 'stream';
const root = fileURLToPath(new URL('..', import.meta.url));
const glyphPackageRoot =
  process.env.GLYPH_RETAINED_UPLOAD_PACKAGE_ROOT === undefined
    ? undefined
    : realpathSync(resolvePath(process.env.GLYPH_RETAINED_UPLOAD_PACKAGE_ROOT));
const deliveryProofPath = process.env.GLYPH_RETAINED_UPLOAD_DELIVERY_PROOF;
const port = process.env.PORT === undefined ? 0 : Number(process.env.PORT);
if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error('PORT must be a valid TCP port');
if (deliveryProofPath !== undefined) {
  if (!isAbsolute(deliveryProofPath)) throw new Error('GLYPH_RETAINED_UPLOAD_DELIVERY_PROOF must be absolute');
  if (existsSync(deliveryProofPath))
    throw new Error(`Browser delivery proof path already exists: ${deliveryProofPath}`);
}

if (!lockHeld) {
  runWithPerformanceLock();
} else {
  await run();
}

function runWithPerformanceLock(): void {
  const command = process.platform === 'darwin' ? '/usr/bin/lockf' : process.platform === 'linux' ? 'flock' : undefined;
  if (command === undefined) throw new Error('retained upload timing requires lockf on Darwin or flock on Linux');
  const forwarded = process.argv.slice(2).filter((argument) => argument !== '--performance-lock-held');
  const commandArguments =
    process.platform === 'darwin'
      ? ['-t', '0', performanceLockPath, process.execPath, scriptPath, '--performance-lock-held', ...forwarded]
      : [
          '--nonblock',
          '--conflict-exit-code',
          '75',
          performanceLockPath,
          process.execPath,
          scriptPath,
          '--performance-lock-held',
          ...forwarded,
        ];
  const result = spawnSync(command, commandArguments, { cwd: root, env: process.env, stdio: 'inherit' });
  if (result.error !== undefined) failLockedRun(result.error);
  if (result.status === 75) failLockedRun(new Error(`retained upload timing could not acquire ${performanceLockPath}`));
  if (result.status !== 0) failLockedRun(new Error(`retained upload timing failed under ${performanceLockPath}`));
}

function failLockedRun(error: Error): never {
  if (deliveryProofPath !== undefined && !existsSync(deliveryProofPath)) {
    try {
      if (!isAbsolute(deliveryProofPath)) throw new Error('Delivery proof path must be absolute');
      mkdirSync(dirname(deliveryProofPath), { recursive: true });
      writeFileSync(
        deliveryProofPath,
        `${JSON.stringify({ schemaVersion: 1, status: 'failed', backends: [], errors: [error.message] }, null, 2)}\n`,
      );
    } catch (writeError) {
      process.stderr.write(`Could not persist browser delivery failure: ${String(writeError)}\n`);
    }
  }
  throw error;
}

async function run(): Promise<void> {
  let browser: Awaited<ReturnType<typeof launchProjectChromium>> | undefined;
  let server: ViteDevServer | undefined;
  let delivery: DeliveryProof | undefined;
  let failure: unknown;
  const collectors: { finish(mode?: 'normal' | 'failure'): Promise<boolean> }[] = [];
  try {
    if (deliveryProofPath !== undefined) {
      if (glyphPackageRoot === undefined)
        throw new Error('Browser delivery proof requires an installed Glyph package root');
      const shaperPath = resolvePath(glyphPackageRoot, 'dist/text-shaper.wasm');
      const indexPath = resolvePath(glyphPackageRoot, 'dist/index.js');
      const threePath = resolvePath(glyphPackageRoot, 'dist/three.js');
      const [bytes, indexBytes, threeBytes] = await Promise.all([
        readFile(shaperPath),
        readFile(indexPath),
        readFile(threePath),
      ]);
      delivery = {
        schemaVersion: 1,
        status: 'running',
        installedShaper: { path: shaperPath, bytes: bytes.byteLength, sha256: sha256(bytes) },
        installedEntries: {
          index: { path: indexPath, sha256: sha256(indexBytes) },
          three: { path: threePath, sha256: sha256(threeBytes) },
        },
        backends: [],
        errors: [],
        limitations: [
          'Response hashes identify bytes actually delivered to Chromium; Vite-transformed JS is not expected to equal installed archive JS byte-for-byte.',
          'Each backend must serve JS from the installed index.js and three.js source paths; Vite-transformed body hashes are recorded beside installed source hashes, not compared for byte equality.',
          'Response body hashing and temporary buffers contribute to the observed browser command-family physical footprint.',
          'The proof does not cover every transitive browser module or runtime process identity.',
        ],
      };
    }
    server = await createServer({
      root,
      logLevel: 'warn',
      optimizeDeps: {
        force: true,
        ...(delivery === undefined ? {} : { exclude: ['@pmndrs/glyph', '@pmndrs/glyph/three'] }),
      },
      resolve: {
        dedupe: ['three'],
        ...(glyphPackageRoot === undefined
          ? {}
          : {
              alias: [
                { find: /^@pmndrs\/glyph\/three$/u, replacement: `${glyphPackageRoot}/dist/three.js` },
                { find: /^@pmndrs\/glyph$/u, replacement: `${glyphPackageRoot}/dist/index.js` },
              ],
            }),
      },
      server: {
        host: process.env.HOST ?? '127.0.0.1',
        port,
        strictPort: port !== 0,
        ...(glyphPackageRoot === undefined ? {} : { fs: { allow: [root, glyphPackageRoot] } }),
      },
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (address === null || address === undefined || typeof address === 'string') {
      throw new Error('Vite did not publish its loopback TCP address');
    }
    const origin = process.env.PORTLESS_URL ?? `http://127.0.0.1:${String(address.port)}`;
    browser = await launchProjectChromium({
      headless: true,
      args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
    });
    const results: RetainedUploadResult[] = [];
    for (const backend of ['webgpu', 'webgl2'] as const) {
      const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
      const collector =
        delivery === undefined ? undefined : captureDelivery(page, backend, delivery, new URL(origin).origin);
      if (collector !== undefined) collectors.push(collector);
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${origin}/retained-upload.html?backend=${backend}&usage=${usage}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForFunction(
        () =>
          (window as typeof window & { retainedUploadReady?: Promise<RetainedUploadResult> }).retainedUploadReady !==
          undefined,
      );
      const result = await page.evaluate(
        () => (window as typeof window & { retainedUploadReady: Promise<RetainedUploadResult> }).retainedUploadReady,
      );
      if (errors.length !== 0) throw new Error(`${backend} browser errors: ${errors.join(' | ')}`);
      if (result.backend !== backend) throw new Error(`expected ${backend}, received ${result.backend}`);
      if (collector !== undefined && !(await collector.finish('normal')))
        throw new Error(`${backend} browser delivery proof failed`);
      results.push(result);
      await page.close();
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          schemaVersion: 1,
          environment: {
            browser: browser.version(),
            three: '0.185.1',
            glyph: glyphPackageRoot ?? 'workspace-source',
          },
          workload: {
            model: 'one retained Text inside one TextGroup',
            initialColorSpans: 240,
            initialGlyphs: 240 * 12,
            idleFrames: 30,
          },
          usage,
          results,
          limitations: [
            'Bytes are counted at Three common Attributes upload decisions and WebGL2 PBO texture updates; ordinary textures, uniforms, and swap-chain traffic are excluded.',
            'CPU render timings measure synchronous renderer submission in one browser task, not display presentation cadence or GPU execution.',
            'Headless project Chromium proves real backend execution and readback but is not labeled as a hardware-GPU timing result.',
          ],
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    failure = error;
  } finally {
    for (const collector of collectors) {
      try {
        if (!(await collector.finish(failure === undefined ? 'normal' : 'failure')) && failure === undefined) {
          failure = new Error('Browser delivery proof failed');
        }
      } catch (error) {
        if (failure === undefined) failure = error;
        else delivery?.errors.push(`delivery collector cleanup: ${String(error)}`);
      }
    }
    try {
      if (browser !== undefined && !(await settlesWithin(browser.close(), 2_000))) {
        if (failure === undefined) failure = new Error('Browser close exceeded two seconds');
        else delivery?.errors.push('Browser close exceeded two seconds');
      }
    } catch (error) {
      if (failure === undefined) failure = error;
      else delivery?.errors.push(`browser close: ${String(error)}`);
    }
    try {
      if (server !== undefined && !(await settlesWithin(server.close(), 2_000))) {
        if (failure === undefined) failure = new Error('Vite server close exceeded two seconds');
        else delivery?.errors.push('Vite server close exceeded two seconds');
      }
    } catch (error) {
      if (failure === undefined) failure = error;
      else delivery?.errors.push(`server close: ${String(error)}`);
    }
    if (deliveryProofPath !== undefined) {
      if (delivery === undefined) {
        // An early setup failure still gets a structured proof status.
        delivery = {
          schemaVersion: 1,
          status: 'failed',
          installedShaper: { path: glyphPackageRoot ?? 'unavailable', bytes: 0, sha256: 'unavailable' },
          installedEntries: {
            index: { path: 'unavailable', sha256: 'unavailable' },
            three: { path: 'unavailable', sha256: 'unavailable' },
          },
          backends: [],
          errors: [],
          limitations: [],
        };
      }
      if (failure !== undefined) delivery.errors.push(String(failure));
      delivery.status =
        failure === undefined &&
        delivery.backends.length === 2 &&
        delivery.backends.every(
          (backend) =>
            backend.shaperMatchesInstalled &&
            backend.installedEntriesSeen.index &&
            backend.installedEntriesSeen.three &&
            backend.errors.length === 0,
        )
          ? 'completed'
          : 'failed';
      try {
        await mkdir(dirname(deliveryProofPath), { recursive: true });
        await writeFile(deliveryProofPath, `${JSON.stringify(delivery, null, 2)}\n`);
      } catch (error) {
        if (failure === undefined) failure = error;
        else process.stderr.write(`Could not persist browser delivery proof: ${String(error)}\n`);
      }
    }
  }
  if (failure !== undefined) throw failure;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function settlesWithin(promise: Promise<unknown>, milliseconds: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), milliseconds);
  });
  try {
    return await Promise.race([promise.then(() => true), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function captureDelivery(
  page: Page,
  backend: 'webgpu' | 'webgl2',
  delivery: DeliveryProof,
  expectedOrigin: string,
): { finish(mode?: 'normal' | 'failure'): Promise<boolean> } {
  const proof: BackendDeliveryProof = {
    backend,
    responses: [],
    failedRequests: [],
    errors: [],
    shaperMatchesInstalled: false,
    installedEntriesSeen: { index: false, three: false },
  };
  delivery.backends.push(proof);
  const pending: { url: string; settled: boolean; task: Promise<void> }[] = [];
  let finalized = false;
  const installedEntry = (url: string): 'index' | 'three' | undefined => {
    const servedUrl = new URL(url);
    if (servedUrl.origin !== expectedOrigin) return undefined;
    const pathname = decodeURIComponent(servedUrl.pathname);
    const sourcePath = pathname.startsWith('/@fs/') ? pathname.slice('/@fs'.length) : pathname;
    if (sourcePath === delivery.installedEntries.index.path) return 'index';
    if (sourcePath === delivery.installedEntries.three.path) return 'three';
    return undefined;
  };
  const observe = (response: Response) => {
    const url = response.url();
    const servedUrl = new URL(url);
    const pathname = servedUrl.pathname;
    const contentType = response.headers()['content-type'] ?? '';
    const resourceType = response.request().resourceType();
    const shaper = pathname.endsWith('/text-shaper.wasm');
    const wasm = shaper || /(?:^|[\s;])application\/wasm(?:[\s;]|$)/iu.test(contentType);
    const font = pathname.endsWith('.font.glb');
    const javascript = resourceType === 'script' || /(?:javascript|ecmascript)/iu.test(contentType);
    if (!wasm && !font && !javascript) return;
    const kind = wasm ? 'wasm' : font ? 'font' : 'javascript';
    const entry = installedEntry(url);
    const item: { url: string; settled: boolean; task: Promise<void> } = {
      url,
      settled: false,
      task: Promise.resolve(),
    };
    item.task = response
      .body()
      .then((body) => {
        if (finalized) return;
        const hashFont = !font || body.byteLength <= 4 * 1024 * 1024;
        const digest = hashFont ? sha256(body) : undefined;
        const installedSource = entry === undefined ? undefined : delivery.installedEntries[entry];
        proof.responses.push({
          url,
          status: response.status(),
          contentType,
          resourceType,
          kind,
          bytes: body.byteLength,
          ...(digest === undefined ? { omittedHashReason: 'font body exceeds 4 MiB' } : { sha256: digest }),
          ...(installedSource === undefined ? {} : { installedSource }),
        });
        if (entry !== undefined) {
          if (kind !== 'javascript' || response.status() < 200 || response.status() >= 300) {
            proof.errors.push(`Installed ${entry} entry was not served as successful JavaScript: ${url}`);
          } else {
            proof.installedEntriesSeen[entry] = true;
          }
        }
        if (shaper && servedUrl.origin === expectedOrigin) {
          const binaryWasm =
            body.byteLength >= 8 && body[0] === 0 && body[1] === 97 && body[2] === 115 && body[3] === 109;
          if (
            !binaryWasm ||
            response.status() < 200 ||
            response.status() >= 300 ||
            digest !== delivery.installedShaper.sha256
          ) {
            proof.errors.push(`Served shaper body differs from installed binary: ${url}`);
          } else {
            proof.shaperMatchesInstalled = true;
          }
        } else if (shaper) {
          proof.errors.push(`Shaper response came from outside navigation origin ${expectedOrigin}: ${url}`);
        }
      })
      .catch((error: unknown) => {
        if (!finalized) proof.errors.push(`Could not read ${url}: ${String(error)}`);
      })
      .finally(() => {
        item.settled = true;
      });
    pending.push(item);
  };
  const observeFailure = (request: Request) => {
    if (finalized) return;
    const url = request.url();
    const pathname = new URL(url).pathname;
    const resourceType = request.resourceType();
    if (resourceType !== 'script' && !/\.(?:m?js|wasm|font\.glb)$/iu.test(pathname)) return;
    const failure = JSON.stringify(request.failure()) ?? 'unknown';
    proof.failedRequests.push({ url, resourceType, failure });
    proof.errors.push(`Failed ${resourceType} request before a complete response: ${url}: ${failure}`);
  };
  // Register before navigation so bootstrap scripts and the first shaper fetch cannot precede capture.
  page.on('response', observe);
  page.on('requestfailed', observeFailure);
  let finished: Promise<boolean> | undefined;
  return {
    finish(mode = 'normal') {
      finished ??= (async () => {
        page.off('response', observe);
        if (mode === 'normal') page.off('requestfailed', observeFailure);
        if (mode === 'failure') {
          try {
            if (!(await settlesWithin(page.close(), 1_000))) {
              proof.errors.push('Page close exceeded one second during failed verification');
            }
          } catch (error) {
            proof.errors.push(`Page close failed during failed verification: ${String(error)}`);
          }
          page.off('requestfailed', observeFailure);
        }
        const allBodies = Promise.all(pending.map((item) => item.task));
        if (!(await settlesWithin(allBodies, 5_000))) {
          proof.errors.push('Response body collection exceeded five seconds');
          if (mode === 'normal') {
            try {
              if (!(await settlesWithin(page.close(), 1_000))) {
                proof.errors.push('Page close exceeded one second after body collection timeout');
              }
            } catch (error) {
              proof.errors.push(`Page close failed after body collection timeout: ${String(error)}`);
            }
          }
        }
        for (const item of pending) {
          if (!item.settled) proof.errors.push(`Response body unresolved at finalization: ${item.url}`);
        }
        finalized = true;
        if (!proof.shaperMatchesInstalled) {
          proof.errors.push(
            `No successful text-shaper.wasm response matched installed SHA-256 ${delivery.installedShaper.sha256}`,
          );
        }
        if (!proof.installedEntriesSeen.index) proof.errors.push('Installed dist/index.js was not served successfully');
        if (!proof.installedEntriesSeen.three) proof.errors.push('Installed dist/three.js was not served successfully');
        proof.responses.sort((left, right) => left.url.localeCompare(right.url));
        proof.failedRequests.sort((left, right) => left.url.localeCompare(right.url));
        return proof.errors.length === 0;
      })();
      return finished;
    },
  };
}
