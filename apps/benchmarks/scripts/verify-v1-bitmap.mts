import { spawn } from 'node:child_process';
/* @workflow { "name": "benchmark:v1-bitmap", "summary": "Render the Rust command-buffer path for Three Bitmap/MTSDF/Slug and a custom material on WebGPU and WebGL2.", "requirements": "Playwright Chromium, WebGPU, WebGL2, and baked Inter fixtures.", "writes": "No repository files." } */
import { fileURLToPath } from 'node:url';

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

const root = fileURLToPath(new URL('..', import.meta.url));
const vite = fileURLToPath(new URL('../node_modules/.bin/vite', import.meta.url));
const server = spawn(vite, ['--host', '127.0.0.1', '--port', '5177', '--strictPort'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.once('exit', (code) => reject(new Error(`Vite exited before readiness (${String(code)})\n${output.trim()}`)));
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('Local:')) resolve();
    });
  }
});

const browser = await launchProjectChromium({
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
});
try {
  for (const expected of ['webgpu', 'webgl2'] as const) {
    const page = await browser.newPage({ viewport: { width: 256, height: 128 }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:5177/v1-bitmap.html?backend=${expected}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () =>
        (window as typeof window & { targetV1BitmapReady?: Promise<RasterProofResult> }).targetV1BitmapReady !==
        undefined,
    );
    const result = await page.evaluate(
      () => (window as typeof window & { targetV1BitmapReady: Promise<RasterProofResult> }).targetV1BitmapReady,
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
    const page = await browser.newPage({ viewport: { width: 256, height: 128 }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:5177/v1-mtsdf.html?backend=${expected}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(
      () =>
        (window as typeof window & { targetV1MtsdfReady?: Promise<RasterProofResult> }).targetV1MtsdfReady !==
        undefined,
    );
    const result = await page.evaluate(
      () => (window as typeof window & { targetV1MtsdfReady: Promise<RasterProofResult> }).targetV1MtsdfReady,
    );
    if (errors.length !== 0) throw new Error(`${expected} MTSDF browser errors: ${errors.join(' | ')}`);
    if (result.backend !== expected) throw new Error(`expected ${expected}, received ${result.backend}`);
    if (
      result.drawCount < 3 ||
      result.decorationPixels < 1 ||
      result.decorationRecords !== 2 ||
      result.glyphCount !== 15 ||
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
    const page = await browser.newPage({ viewport: { width: 256, height: 128 }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:5177/v1-slug.html?backend=${expected}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(
      () =>
        (window as typeof window & { targetV1SlugReady?: Promise<RasterProofResult> }).targetV1SlugReady !== undefined,
    );
    const result = await page.evaluate(
      () => (window as typeof window & { targetV1SlugReady: Promise<RasterProofResult> }).targetV1SlugReady,
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
    const page = await browser.newPage({ viewport: { width: 256, height: 128 }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:5177/v1-compose.html?backend=${expected}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () =>
        (window as typeof window & { targetV1ComposeReady?: Promise<ComposeProofResult> }).targetV1ComposeReady !==
        undefined,
    );
    const result = await page.evaluate(
      () => (window as typeof window & { targetV1ComposeReady: Promise<ComposeProofResult> }).targetV1ComposeReady,
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
  await browser.close();
  server.kill('SIGTERM');
}
