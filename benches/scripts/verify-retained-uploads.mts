/* @workflow { "name": "benchmark:retained-uploads", "summary": "Prove retained Three storage uploads and profile an ASCII-rich Text on WebGPU and WebGL2.", "requirements": "Built Glyph, project Chromium, authenticated Inter Bitmap fixture, Portless, WebGPU, WebGL2, and Darwin or Linux advisory-lock tooling. Pass --usage=dynamic only for a baseline revision.", "writes": "No repository files; JSON evidence to stdout." } */
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

import { launchProjectChromium } from './support/project-chromium.mts';

interface RetainedUploadResult {
  readonly backend: 'webgpu' | 'webgl2';
  readonly expectedUsage: 'dynamic' | 'stream';
  readonly idle: Readonly<{
    readonly uploads: Readonly<{ readonly attributeUpdateCalls: number }>;
  }>;
}

const performanceLockPath = '/private/tmp/glyph-perf-measurement.lock';
const scriptPath = fileURLToPath(import.meta.url);
const lockHeld = process.argv.includes('--performance-lock-held');
const usage = process.argv.includes('--usage=dynamic') ? 'dynamic' : 'stream';
const root = fileURLToPath(new URL('..', import.meta.url));
const origin = process.env.PORTLESS_URL;
if (origin === undefined) throw new Error('Run benchmark:retained-uploads through Portless; PORTLESS_URL is required.');
const glyphPackageRoot =
  process.env.GLYPH_RETAINED_UPLOAD_PACKAGE_ROOT === undefined
    ? undefined
    : realpathSync(resolvePath(process.env.GLYPH_RETAINED_UPLOAD_PACKAGE_ROOT));
const port = process.env.PORT === undefined ? 0 : Number(process.env.PORT);
if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error('PORT must be a valid TCP port');

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
  if (result.error !== undefined) throw result.error;
  if (result.status === 75) throw new Error(`retained upload timing could not acquire ${performanceLockPath}`);
  if (result.status !== 0) throw new Error(`retained upload timing failed under ${performanceLockPath}`);
}

async function run(): Promise<void> {
  let browser: Awaited<ReturnType<typeof launchProjectChromium>> | undefined;
  let server: ViteDevServer | undefined;
  try {
    server = await createServer({
      root,
      logLevel: 'warn',
      optimizeDeps: { force: true },
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
    browser = await launchProjectChromium({
      headless: true,
      args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
    });
    const results: RetainedUploadResult[] = [];
    for (const backend of ['webgpu', 'webgl2'] as const) {
      const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
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
  } finally {
    try {
      await browser?.close();
    } finally {
      await server?.close();
    }
  }
}
