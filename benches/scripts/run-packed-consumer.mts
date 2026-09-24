/* @workflow {
  "name": "benchmark:packed-consumer",
  "summary": "Prove default gzip shaper loading and runtime font baking from an isolated installed browser consumer.",
  "requirements": "Built Glyph package, pnpm offline cache, and Playwright Chromium.",
  "writes": "Ignored temporary files under benches/.cache, removed before exit."
} */
import { execFile as execFileCallback } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Browser } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';

import { launchProjectChromium } from './support/project-chromium.mts';
import { packedArchiveDependency } from './support/packed-archive.mts';

interface PackedResult {
  readonly hash?: string;
  readonly bytes?: number;
  readonly error?: string;
  readonly initialized?: boolean;
}

const execFile = promisify(execFileCallback);
const appDirectory = fileURLToPath(new URL('..', import.meta.url));
const workspaceDirectory = fileURLToPath(new URL('../..', import.meta.url));
const cacheDirectory = join(appDirectory, '.cache');
const port = process.env.PORT === undefined ? 0 : Number(process.env.PORT);
if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error('PORT must be a valid TCP port');
await mkdir(cacheDirectory, { recursive: true });
const consumerDirectory = await mkdtemp(join(cacheDirectory, 'packed-consumer-'));
const archiveDirectory = join(consumerDirectory, 'archives');
await mkdir(archiveDirectory, { recursive: true });

let server: ViteDevServer | undefined;
let browser: Browser | undefined;
let shaperEncoding: 'asset' | 'http' | 'corrupt' = 'asset';
let shaperRequests = 0;
try {
  const [glyphArchive] = await Promise.all([
    packPackage('packages/glyph'),
    copyFile(
      join(appDirectory, 'fixtures/fonts/inter-v4.1/Inter-Regular.ttf'),
      join(consumerDirectory, 'Inter-Regular.ttf'),
    ),
  ]);
  await Promise.all([
    writeFile(
      join(consumerDirectory, 'package.json'),
      `${JSON.stringify({ private: true, type: 'module', dependencies: { '@pmndrs/glyph': glyphArchive } }, undefined, 2)}\n`,
    ),
    writeFile(
      join(consumerDirectory, 'index.html'),
      '<!doctype html><link rel="icon" href="data:," /><script type="module" src="/entry.js"></script>\n',
    ),
    writeFile(
      join(consumerDirectory, 'entry.js'),
      `import { glyph } from '@pmndrs/glyph'
import { bakeFontInWorker } from '@pmndrs/glyph/runtime-bake'
try {
  await glyph.init()
  const source = new Uint8Array(await (await fetch('/Inter-Regular.ttf')).arrayBuffer())
  const artifact = await bakeFontInWorker({ source, sourceUrl: location.href })
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', artifact))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
  await globalThis.__reportPackedResult({ hash, bytes: artifact.byteLength, initialized: glyph.initialized })
} catch (error) {
  await globalThis.__reportPackedResult({ error: error instanceof Error ? error.stack : String(error), initialized: glyph.initialized })
}
`,
    ),
  ]);
  await execFile('pnpm', ['install', '--ignore-workspace', '--offline', '--config.node-linker=hoisted'], {
    cwd: consumerDirectory,
    env: { ...process.env, CI: 'true' },
  });
  const compressedShaper = await readFile(
    join(consumerDirectory, 'node_modules/@pmndrs/glyph/dist/text-shaper.wasm.gz'),
  );

  server = await createServer({
    root: consumerDirectory,
    logLevel: 'silent',
    optimizeDeps: { include: ['ajv', 'gltf-validator'] },
    resolve: { preserveSymlinks: true },
    plugins: [
      {
        name: 'shaper-transfer-encoding',
        configureServer(vite) {
          vite.middlewares.use((request, response, next) => {
            if (!request.url?.split('?')[0]?.endsWith('/text-shaper.wasm.gz')) return next();
            shaperRequests += 1;
            response.setHeader('Content-Type', shaperEncoding === 'http' ? 'application/wasm' : 'application/gzip');
            response.setHeader('Cache-Control', 'no-store');
            if (shaperEncoding === 'http') response.setHeader('Content-Encoding', 'gzip');
            response.end(shaperEncoding === 'corrupt' ? compressedShaper.subarray(0, 16) : compressedShaper);
          });
        },
      },
    ],
    server: { host: process.env.HOST ?? '127.0.0.1', port, strictPort: port !== 0 },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error('packed-consumer Vite server did not expose a TCP port');
  }

  browser = await launchProjectChromium({ headless: true });
  for (const encoding of ['asset', 'http', 'corrupt'] as const) {
    shaperEncoding = encoding;
    const page = await browser.newPage();
    const completion = Promise.withResolvers<PackedResult>();
    const errors: string[] = [];
    page.context().on('weberror', (webError) => {
      const error = webError.error();
      errors.push(error.stack ?? error.message);
    });
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const location = message.location();
      const source = location.url === '' ? '' : ` @ ${location.url}:${String(location.lineNumber)}`;
      errors.push(`${message.text()}${source}`);
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400) {
        errors.push(`HTTP ${String(response.status())} ${response.request().resourceType()} ${response.url()}`);
      }
    });
    await page.exposeFunction('__reportPackedResult', (value: PackedResult) => {
      completion.resolve(value);
    });
    const origin = process.env.PORTLESS_URL ?? `http://127.0.0.1:${address.port}`;
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    const result = await completion.promise;
    if (encoding === 'corrupt') {
      if (result.error === undefined || result.initialized !== false) {
        throw new Error('truncated gzip must reject initialization');
      }
      process.stdout.write(`${JSON.stringify({ encoding, rejected: true })}\n`);
      await page.close();
      continue;
    }
    if (result.error !== undefined) {
      throw new Error(`${result.error}${errors.length === 0 ? '' : `\nBrowser errors:\n${errors.join('\n')}`}`);
    }
    if (errors.length > 0) throw new Error(`packed consumer browser errors: ${errors.join(' | ')}`);
    if (result.initialized !== true) throw new Error('packed consumer did not initialize the default shaper');

    const manifest = JSON.parse(await readFile(join(appDirectory, 'fixtures/fonts/inter-v4.1/manifest.json'), 'utf8'));
    const expectedHash = manifest.bake.expectedCore.artifactSha256;
    const expectedBytes = manifest.bake.expectedCore.artifactBytes;
    if (result.hash !== expectedHash || result.bytes !== expectedBytes) {
      throw new Error(
        `packed module Worker returned ${result.hash}/${result.bytes}; expected ${expectedHash}/${expectedBytes}`,
      );
    }
    process.stdout.write(`${JSON.stringify({ encoding, ...result })}\n`);
    await page.close();
  }
  if (shaperRequests !== 3) throw new Error(`expected three gzip shaper requests, received ${shaperRequests}`);
} finally {
  if (browser !== undefined) await browser.close();
  if (server !== undefined) await server.close();
  await rm(consumerDirectory, { recursive: true, force: true, maxRetries: 3 });
}

async function packPackage(packagePath: string): Promise<string> {
  const packageDirectory = join(workspaceDirectory, packagePath);
  await execFile('pnpm', ['pack', '--pack-destination', archiveDirectory], {
    cwd: packageDirectory,
    env: { ...process.env, CI: 'true' },
  });
  return packedArchiveDependency(await readdir(archiveDirectory));
}
