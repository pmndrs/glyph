import { execFile as execFileCallback } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Browser } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';

import { launchProjectChromium } from './support/project-chromium.mts';

interface PackedResult {
  readonly hash?: string;
  readonly bytes?: number;
  readonly error?: string;
}

const execFile = promisify(execFileCallback);
const appDirectory = fileURLToPath(new URL('..', import.meta.url));
const workspaceDirectory = fileURLToPath(new URL('../../..', import.meta.url));
const cacheDirectory = join(appDirectory, '.cache');
await mkdir(cacheDirectory, { recursive: true });
const consumerDirectory = await mkdtemp(join(cacheDirectory, 'packed-consumer-'));
const archiveDirectory = join(consumerDirectory, 'archives');
await mkdir(archiveDirectory, { recursive: true });

let server: ViteDevServer | undefined;
let browser: Browser | undefined;
try {
  await Promise.all([
    packPackage('packages/glyph'),
    copyFile(
      join(appDirectory, 'fixtures/fonts/inter-v4.1/Inter-Regular.ttf'),
      join(consumerDirectory, 'Inter-Regular.ttf'),
    ),
  ]);
  await Promise.all([
    writeFile(
      join(consumerDirectory, 'package.json'),
      `${JSON.stringify({ private: true, type: 'module', dependencies: { '@pmndrs/glyph': 'file:archives/pmndrs-glyph-0.0.0.tgz' } }, undefined, 2)}\n`,
    ),
    writeFile(
      join(consumerDirectory, 'index.html'),
      '<!doctype html><link rel="icon" href="data:," /><script type="module" src="/entry.js"></script>\n',
    ),
    writeFile(
      join(consumerDirectory, 'entry.js'),
      `import { bakeFontInWorker } from '@pmndrs/glyph/runtime-bake'
try {
  const source = new Uint8Array(await (await fetch('/Inter-Regular.ttf')).arrayBuffer())
  const artifact = await bakeFontInWorker({ source, sourceUrl: location.href })
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', artifact))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
  await globalThis.__reportPackedResult({ hash, bytes: artifact.byteLength })
} catch (error) {
  await globalThis.__reportPackedResult({ error: error instanceof Error ? error.stack : String(error) })
}
`,
    ),
  ]);
  await execFile('pnpm', ['install', '--ignore-workspace', '--offline', '--config.node-linker=hoisted'], {
    cwd: consumerDirectory,
    env: { ...process.env, CI: 'true' },
  });

  server = await createServer({
    root: consumerDirectory,
    logLevel: 'silent',
    optimizeDeps: { include: ['ajv', 'gltf-validator'] },
    resolve: { preserveSymlinks: true },
    server: { host: '127.0.0.1', port: 5183, strictPort: true },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error('packed-consumer Vite server did not expose a TCP port');
  }

  browser = await launchProjectChromium({ headless: true });
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
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'domcontentloaded' });
  const result = await completion.promise;
  if (result.error !== undefined) {
    throw new Error(`${result.error}${errors.length === 0 ? '' : `\nBrowser errors:\n${errors.join('\n')}`}`);
  }
  if (errors.length > 0) throw new Error(`packed consumer browser errors: ${errors.join(' | ')}`);

  const manifest = JSON.parse(await readFile(join(appDirectory, 'fixtures/fonts/inter-v4.1/manifest.json'), 'utf8'));
  const expectedHash = manifest.bake.expectedCore.artifactSha256;
  const expectedBytes = manifest.bake.expectedCore.artifactBytes;
  if (result.hash !== expectedHash || result.bytes !== expectedBytes) {
    throw new Error(
      `packed module Worker returned ${result.hash}/${result.bytes}; expected ${expectedHash}/${expectedBytes}`,
    );
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  if (browser !== undefined) await browser.close();
  if (server !== undefined) await server.close();
  await rm(consumerDirectory, { recursive: true, force: true, maxRetries: 3 });
}

async function packPackage(packagePath: string): Promise<void> {
  const packageDirectory = join(workspaceDirectory, packagePath);
  await execFile('pnpm', ['pack', '--pack-destination', archiveDirectory], {
    cwd: packageDirectory,
    env: { ...process.env, CI: 'true' },
  });
}
