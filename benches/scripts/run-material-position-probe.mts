/* @workflow { "name": "benchmark:material-position", "summary": "Verify custom Three material position stage safety and paragraph coordinates on real Slug draws, on WebGPU and WebGL2.", "requirements": "Built Glyph runtime, the baked Inter Slug fixture, and project Chromium with WebGPU and WebGL2. PORT and PORTLESS_URL are honoured when set.", "writes": "No repository files." } */
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

import type {
  MaterialPositionCase,
  MaterialPositionResult,
} from '../src/benchmark/targets/conformance/material-position-probe.ts';
import { launchProjectChromium } from './support/project-chromium.mts';

const port = process.env.PORT === undefined ? 0 : Number(process.env.PORT);
if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error('PORT must be a valid TCP port');

/** Each case runs for both shader sets, both backends and both transform modes; `--case=<material>` selects one. */
const selectedCase = process.argv.find((value) => value.startsWith('--case='))?.slice('--case='.length);
const cases = (
  [
    { material: 'composed', displacement: false },
    { material: 'composed', displacement: true },
    { material: 'fragment-gradient', displacement: false },
  ] as const satisfies readonly { readonly material: MaterialPositionCase; readonly displacement: boolean }[]
).filter(({ material }) => selectedCase === undefined || material === selectedCase);
if (cases.length === 0) throw new Error(`--case must be composed or fragment-gradient, not ${String(selectedCase)}`);

let server: ViteDevServer | undefined;
let browser: Awaited<ReturnType<typeof launchProjectChromium>> | undefined;
try {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'warn',
    server: { host: '127.0.0.1', port, strictPort: port !== 0 },
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
  let passed = 0;
  for (const shaders of ['stable', 'typegpu'] as const) {
    for (const backend of ['webgpu', 'webgl2'] as const) {
      for (const { material, displacement } of cases) {
        const results: MaterialPositionResult[] = [];
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
              async ({ selectedBackend, selectedMode, selectedMaterial, displace }) => {
                const probePath = '/src/benchmark/targets/conformance/material-position-probe.ts';
                const response = await fetch(probePath);
                if (!response.ok) {
                  throw new Error(
                    `probe module HTTP ${String(response.status)}: ${(await response.text()).slice(0, 500)}`,
                  );
                }
                const module = await import(/* @vite-ignore */ probePath);
                return module.probeMaterialPosition(selectedBackend, selectedMode, selectedMaterial, displace);
              },
              {
                selectedBackend: backend,
                selectedMode: transformMode,
                selectedMaterial: material,
                displace: displacement,
              },
            );
            if (errors.length > 0) throw new Error(`${backend} browser errors: ${errors.join(' | ')}`);
            if (result.backend !== backend) throw new Error(`requested ${backend} but rendered ${result.backend}`);
            results.push(result);
            passed += 1;
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
  process.stdout.write(`material-position: ${String(passed)} cases passed\n`);
} finally {
  await browser?.close();
  await server?.close();
}
