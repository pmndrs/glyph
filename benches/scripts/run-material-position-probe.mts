/* @workflow { "name": "benchmark:material-position", "summary": "Verify Slug custom-material stage and paragraph coordinates on WebGPU and WebGL2.", "requirements": "Built Glyph runtime, authenticated Inter Slug fixture, project Chromium, and a Portless route (PORT and PORTLESS_URL).", "writes": "Ignored browser caches only." } */
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

import { launchProjectChromium } from './support/project-chromium.mts';

const port = Number(process.env.PORT);
if (!Number.isSafeInteger(port) || port < 1 || process.env.PORTLESS_URL === undefined) {
  throw new Error('Run benchmark:material-position through Portless so PORT and PORTLESS_URL are set');
}
const origin = `http://127.0.0.1:${String(port)}`;

const server = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)),
  server: { host: '127.0.0.1', port, strictPort: true },
});
let browser: Awaited<ReturnType<typeof launchProjectChromium>> | undefined;
try {
  await server.listen();
  browser = await launchProjectChromium({
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
  });
  for (const shaders of ['stable', 'typegpu'] as const) {
    for (const backend of ['webgpu', 'webgl2'] as const) {
      for (const displacement of [false, true]) {
        const results = [];
        for (const transformMode of ['direct', 'indexed'] as const) {
          const page = await browser.newPage({ ignoreHTTPSErrors: origin.startsWith('https:') });
          const errors: string[] = [];
          page.on('pageerror', (error) => errors.push(error.message));
          page.on('console', (message) => {
            if (message.type() === 'error') errors.push(message.text());
          });
          try {
            await page.goto(`${origin}/material-position-probe.html?shaders=${shaders}`, {
              waitUntil: 'domcontentloaded',
            });
            const result = await page.evaluate(
              async ({ selectedBackend, selectedMode, displace }) => {
                const probePath = '/src/benchmark/targets/conformance/material-position-probe.ts';
                const response = await fetch(probePath);
                if (!response.ok)
                  throw new Error(
                    `probe module HTTP ${String(response.status)}: ${(await response.text()).slice(0, 500)}`,
                  );
                const module = await import(/* @vite-ignore */ probePath);
                return module.probeMaterialPosition(selectedBackend, selectedMode, displace);
              },
              { selectedBackend: backend, selectedMode: transformMode, displace: displacement },
            );
            if (errors.length > 0) throw new Error(`${backend} browser errors: ${errors.join(' | ')}`);
            results.push(result);
            process.stdout.write(`${JSON.stringify({ shaders, ...result })}\n`);
          } finally {
            await page.close();
          }
        }
        if (Math.abs(results[0]!.inkPixels - results[1]!.inkPixels) > 20) {
          throw new Error(`${shaders}/${backend} direct and indexed ink areas diverged: ${JSON.stringify(results)}`);
        }
      }
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
