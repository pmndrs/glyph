/* @workflow { "name": "benchmark:v1-bitmap", "summary": "Render the Rust command-buffer path for Three Bitmap/MTSDF/Slug and a custom material on WebGPU and WebGL2.", "requirements": "Playwright Chromium, WebGPU, WebGL2, and baked Inter fixtures. Pass --typegpu to exercise /three/typegpu.", "writes": "No repository files." } */
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

import { launchProjectChromium } from './support/project-chromium.mts';

interface RasterProofResult {
  readonly backend: 'webgpu' | 'webgl2';
  readonly decorationPixels: number;
  readonly decorationRecords: number;
  readonly drawCount: number;
  readonly glyphCount: number;
  readonly litPixels: number;
  readonly retainedDraw: boolean;
  readonly retainedStorage: boolean;
  readonly detachedFirstFrameMatches: boolean;
  readonly detachedSameFrameWriteMatches: boolean;
  readonly gpuBytes: number;
}

interface ComposeProofResult {
  readonly backend: 'webgpu' | 'webgl2';
  readonly drawCount: number;
  readonly glyphCount: number;
  readonly litPixels: number;
  readonly redPixels: number;
  readonly greenPixels: number;
  readonly canonicalLitPixels: number;
  readonly canonicalGreenPixels: number;
}

interface MsdfProofResult extends RasterProofResult {
  readonly distanceCoverageChangedChannels: number;
  readonly distanceSamples: number;
  readonly distanceCoverageMatches: boolean;
  readonly distanceCoverageMaxDelta: number;
  readonly glowPixelsOutsideCoverage: number;
}

const shaderQuery = process.argv.includes('--typegpu') ? '&shaders=typegpu' : '';
process.stdout.write(`Three shaders: ${shaderQuery === '' ? 'stable TSL' : 'experimental TypeGPU'}\n`);

const stageTimeoutMs = 3 * 60 * 1_000;

function reportStage(message: string): void {
  process.stdout.write(`[three-proof] ${message}\n`);
}

async function withinDeadline<T>(label: string, task: Promise<T>): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} exceeded ${stageTimeoutMs} ms`)), stageTimeoutMs);
  });
  try {
    return await Promise.race([task, deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

const root = fileURLToPath(new URL('..', import.meta.url));
const port = process.env.PORT === undefined ? 0 : Number(process.env.PORT);
if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error('PORT must be a valid TCP port');
const host = process.env.HOST ?? '127.0.0.1';
let browser: Awaited<ReturnType<typeof launchProjectChromium>> | undefined;
let server: ViteDevServer | undefined;
try {
  reportStage('starting Vite');
  server = await withinDeadline(
    'Vite creation',
    createServer({
      root,
      logLevel: 'info',
      optimizeDeps: { force: true },
      server: { host, port, strictPort: port !== 0 },
    }),
  );
  await withinDeadline('Vite readiness', server.listen());
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error('Vite did not publish its loopback TCP address');
  }
  const origin = process.env.PORTLESS_URL ?? `http://127.0.0.1:${String(address.port)}`;
  reportStage(`Vite ready at ${origin}`);
  reportStage('launching Chromium');
  browser = await withinDeadline(
    'Chromium launch',
    launchProjectChromium({
      headless: true,
      args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
    }),
  );
  for (const expected of ['webgpu', 'webgl2'] as const) {
    reportStage(`${expected} Bitmap`);
    const page = await browser.newPage({ viewport: { width: 256, height: 128 }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await withinDeadline(
      `${expected} Bitmap navigation`,
      page.goto(`${origin}/v1-bitmap.html?backend=${expected}${shaderQuery}`, {
        waitUntil: 'domcontentloaded',
      }),
    );
    await withinDeadline(
      `${expected} Bitmap publication`,
      page.waitForFunction(
        () =>
          (window as typeof window & { targetV1BitmapReady?: Promise<RasterProofResult> }).targetV1BitmapReady !==
          undefined,
      ),
    );
    const result = await withinDeadline(
      `${expected} Bitmap result`,
      page.evaluate(
        () => (window as typeof window & { targetV1BitmapReady: Promise<RasterProofResult> }).targetV1BitmapReady,
      ),
    );
    if (errors.length !== 0) throw new Error(`${expected} browser errors: ${errors.join(' | ')}`);
    if (result.backend !== expected) throw new Error(`expected ${expected}, received ${result.backend}`);
    if (
      result.drawCount < 3 ||
      result.decorationPixels < 1 ||
      result.decorationRecords !== 2 ||
      result.glyphCount !== 16 ||
      result.litPixels < 32 ||
      !result.retainedDraw ||
      !result.retainedStorage ||
      !result.detachedFirstFrameMatches ||
      !result.detachedSameFrameWriteMatches ||
      result.gpuBytes <= 0
    ) {
      throw new Error(`${expected} target-v1 Bitmap output is not visibly populated: ${JSON.stringify(result)}`);
    }
    process.stdout.write(`${expected}: ${JSON.stringify(result)}\n`);
    await page.close();
  }
  for (const expected of ['webgpu', 'webgl2'] as const) {
    reportStage(`${expected} MTSDF`);
    const page = await browser.newPage({ viewport: { width: 256, height: 128 }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await withinDeadline(
      `${expected} MTSDF navigation`,
      page.goto(`${origin}/v1-mtsdf.html?backend=${expected}${shaderQuery}`, {
        waitUntil: 'domcontentloaded',
      }),
    );
    await withinDeadline(
      `${expected} MTSDF publication`,
      page.waitForFunction(
        () =>
          (window as typeof window & { targetV1MtsdfReady?: Promise<MsdfProofResult> }).targetV1MtsdfReady !==
          undefined,
      ),
    );
    const result = await withinDeadline(
      `${expected} MTSDF result`,
      page.evaluate(
        () => (window as typeof window & { targetV1MtsdfReady: Promise<MsdfProofResult> }).targetV1MtsdfReady,
      ),
    );
    if (errors.length !== 0) throw new Error(`${expected} MTSDF browser errors: ${errors.join(' | ')}`);
    if (result.backend !== expected) throw new Error(`expected ${expected}, received ${result.backend}`);
    if (
      result.drawCount < 3 ||
      result.decorationPixels < 1 ||
      result.decorationRecords !== 2 ||
      result.glyphCount !== 15 ||
      result.distanceSamples !== 4 ||
      !result.distanceCoverageMatches ||
      result.glowPixelsOutsideCoverage === 0 ||
      result.litPixels < 32 ||
      !result.retainedDraw ||
      !result.retainedStorage ||
      !result.detachedFirstFrameMatches ||
      !result.detachedSameFrameWriteMatches ||
      result.gpuBytes <= 0
    )
      throw new Error(`${expected} target-v1 MTSDF output is not visibly populated: ${JSON.stringify(result)}`);
    process.stdout.write(`${expected} msdf: ${JSON.stringify(result)}\n`);
    await page.close();
  }
  for (const expected of ['webgpu', 'webgl2'] as const) {
    reportStage(`${expected} Slug`);
    const page = await browser.newPage({ viewport: { width: 256, height: 128 }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await withinDeadline(
      `${expected} Slug navigation`,
      page.goto(`${origin}/v1-slug.html?backend=${expected}${shaderQuery}`, {
        waitUntil: 'domcontentloaded',
      }),
    );
    await withinDeadline(
      `${expected} Slug publication`,
      page.waitForFunction(
        () =>
          (window as typeof window & { targetV1SlugReady?: Promise<RasterProofResult> }).targetV1SlugReady !==
          undefined,
      ),
    );
    const result = await withinDeadline(
      `${expected} Slug result`,
      page.evaluate(
        () => (window as typeof window & { targetV1SlugReady: Promise<RasterProofResult> }).targetV1SlugReady,
      ),
    );
    if (errors.length !== 0) throw new Error(`${expected} Slug browser errors: ${errors.join(' | ')}`);
    if (result.backend !== expected) throw new Error(`expected ${expected}, received ${result.backend}`);
    if (
      result.drawCount < 3 ||
      result.decorationPixels < 1 ||
      result.decorationRecords !== 2 ||
      result.glyphCount !== 14 ||
      result.litPixels < 32 ||
      !result.retainedDraw ||
      !result.retainedStorage ||
      !result.detachedFirstFrameMatches ||
      !result.detachedSameFrameWriteMatches ||
      result.gpuBytes <= 0
    )
      throw new Error(`${expected} target-v1 Slug output is not visibly populated: ${JSON.stringify(result)}`);
    process.stdout.write(`${expected} slug: ${JSON.stringify(result)}\n`);
    await page.close();
  }
  for (const expected of ['webgpu', 'webgl2'] as const) {
    reportStage(`${expected} composed material`);
    const page = await browser.newPage({ viewport: { width: 256, height: 128 }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await withinDeadline(
      `${expected} compose navigation`,
      page.goto(`${origin}/v1-compose.html?backend=${expected}${shaderQuery}`, {
        waitUntil: 'domcontentloaded',
      }),
    );
    await withinDeadline(
      `${expected} compose publication`,
      page.waitForFunction(
        () =>
          (window as typeof window & { targetV1ComposeReady?: Promise<ComposeProofResult> }).targetV1ComposeReady !==
          undefined,
      ),
    );
    const result = await withinDeadline(
      `${expected} compose result`,
      page.evaluate(
        () => (window as typeof window & { targetV1ComposeReady: Promise<ComposeProofResult> }).targetV1ComposeReady,
      ),
    );
    if (errors.length !== 0) throw new Error(`${expected} compose browser errors: ${errors.join(' | ')}`);
    if (result.backend !== expected) throw new Error(`expected ${expected}, received ${result.backend}`);
    if (result.drawCount < 1 || result.glyphCount !== 16 || result.canonicalGreenPixels !== result.canonicalLitPixels)
      throw new Error(`compose proof did not establish a canonical baseline: ${JSON.stringify(result)}`);
    // Composing over the exported shader may repaint the glyphs but must not move or reshape them: an identical lit set
    // proves the custom material inherited the canonical position and coverage rather than reimplementing them.
    if (result.litPixels !== result.canonicalLitPixels || result.redPixels !== result.canonicalLitPixels)
      throw new Error(`custom material did not reproduce the canonical coverage: ${JSON.stringify(result)}`);
    if (result.greenPixels !== 0)
      throw new Error(`custom material did not apply its own final output: ${JSON.stringify(result)}`);
    process.stdout.write(`${expected} compose: ${JSON.stringify(result)}\n`);
    await page.close();
  }
} finally {
  try {
    if (browser !== undefined) await withinDeadline('Chromium shutdown', browser.close());
  } finally {
    if (server !== undefined) await withinDeadline('Vite shutdown', server.close());
  }
}
