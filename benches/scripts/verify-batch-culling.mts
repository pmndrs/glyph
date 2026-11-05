/* @workflow { "name": "benchmark:batch-culling", "summary": "Experiment with supplied batch bounds and Three's existing frustum culler; compare pixels and separate timing channels on both backends and transform modes.", "requirements": "Built Glyph, project Chromium with WebGPU and WebGL2, and the Inter Bitmap fixture. Optional --output=<path> saves raw samples; --software-gpu selects SwiftShader (compatibility evidence only).", "writes": "Optional external JSON report; no tracked artifacts." } */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

import type { BatchCullingReport } from '../src/batch-culling-proof.ts';

import { launchProjectChromium } from './support/project-chromium.mts';

const softwareGpu = process.argv.includes('--software-gpu');
const output = process.argv.find((argument) => argument.startsWith('--output='))?.slice('--output='.length);
let server: ViteDevServer | undefined;
let browser: Awaited<ReturnType<typeof launchProjectChromium>> | undefined;
try {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    server: {
      host: process.env.HOST ?? '127.0.0.1',
      port: process.env.PORT === undefined ? 0 : Number(process.env.PORT),
      strictPort: process.env.PORT !== undefined,
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (address === undefined || address === null || typeof address === 'string') throw new Error('missing Vite address');
  const origin = process.env.PORTLESS_URL ?? `http://127.0.0.1:${String(address.port)}`;
  process.stdout.write(`Batch culling experiment: ${origin}\n`);
  browser = await launchProjectChromium({
    headless: true,
    args: [
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-webgpu',
      ...(softwareGpu
        ? [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--use-webgpu-adapter=swiftshader',
          ]
        : []),
    ],
  });
  const results = [];
  for (const backend of ['webgpu', 'webgl2']) {
    for (const transforms of ['indexed', 'direct']) {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.goto(`${origin}/batch-culling.html?backend=${backend}&transforms=${transforms}`);
      await page.waitForFunction(() => window.batchCullingReady !== undefined);
      // Promise completion follows GPU readbacks; no frame-count/sleep success condition.
      const result: BatchCullingReport = await page.evaluate(() => window.batchCullingReady);
      if (result.backend !== backend || result.transformMode !== transforms) throw new Error('backend/mode mismatch');
      if (errors.length !== 0) throw new Error(errors.join(' | '));
      results.push(result);
      process.stdout.write(`${backend}/${transforms}: ${String(result.checks.length)} parity cases passed\n`);
      await page.close();
    }
  }
  const sources = await Promise.all(
    [
      'src/batch-culling-proof.ts',
      'src/benchmark/labs/batch-culling-bounds.ts',
      'scripts/verify-batch-culling.mts',
      'fixtures/rendering/inter-bitmap-16.font.glb',
    ].map(async (path) => ({
      path,
      sha256: createHash('sha256')
        .update(await readFile(new URL(`../${path}`, import.meta.url)))
        .digest('hex'),
    })),
  );
  const report = {
    capturedAt: new Date().toISOString(),
    chromium: browser.version(),
    softwareGpuRequested: softwareGpu,
    sources,
    results,
  };
  if (output !== undefined) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(output === undefined ? `${JSON.stringify(report)}\n` : `Raw samples: ${output}\n`);
} finally {
  await browser?.close();
  await server?.close();
}
