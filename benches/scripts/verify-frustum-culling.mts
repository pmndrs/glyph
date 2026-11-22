/* @workflow { "name": "benchmark:frustum-culling", "summary": "Prove automatic Three frustum culling renders identically to unculled draws (Bitmap, MSDF effects, Slug; edges, shear, grazing perspective, edits, removal, detached glyphs, second pass, caller materials culled by declared padding with an undersized-padding negative control, frustumCulled: false materials, and Three's frustumCulled = false on Text, TextGroup and Glyphs) and time many mostly off-screen labels with culling on and off.", "requirements": "Built Glyph, project Chromium with WebGPU and WebGL2, and the Inter Bitmap, MTSDF and Slug fixtures. Optional --labels=<n> and --samples=<n> size the timing scene; --output=<path> saves the raw report; --software-gpu selects SwiftShader (compatibility evidence only).", "writes": "Optional external JSON report; no tracked artifacts." } */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

import type { FrustumCullingReport, TimingWorkload } from '../src/frustum-culling-contract.ts';

import { launchProjectChromium } from './support/project-chromium.mts';

const softwareGpu = process.argv.includes('--software-gpu');
const output = option('--output=');
const labels = option('--labels=') ?? '2000';
const samples = option('--samples=') ?? '40';
let server: ViteDevServer | undefined;
let browser: Awaited<ReturnType<typeof launchProjectChromium>> | undefined;
try {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'error',
    optimizeDeps: { entries: ['frustum-culling.html'] },
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
  const reports: FrustumCullingReport[] = [];
  for (const backend of ['webgpu', 'webgl2'] as const) {
    for (const transforms of ['indexed', 'direct'] as const) {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.goto(
        `${origin}/frustum-culling.html?backend=${backend}&transforms=${transforms}&labels=${labels}&samples=${samples}`,
      );
      await page.waitForFunction(
        () =>
          (window as typeof window & { frustumCullingReady?: Promise<FrustumCullingReport> }).frustumCullingReady !==
          undefined,
      );
      // The page resolves after its last GPU readback or timestamp resolution; no frame count or sleep decides success.
      const report = await page.evaluate(
        () => (window as typeof window & { frustumCullingReady: Promise<FrustumCullingReport> }).frustumCullingReady,
      );
      await page.close();
      if (errors.length !== 0) throw new Error(`${backend}/${transforms}: ${errors.join(' | ')}`);
      if (report.backend !== backend || report.transformMode !== transforms) throw new Error('backend/mode mismatch');
      reports.push(report);
      const culledCases = report.cases.filter((entry) => entry.culledDraws > 0).length;
      process.stdout.write(
        `${backend}/${transforms}: ${String(report.cases.length)} identical cases (${String(culledCases)} with culled draws); negative control detected\n`,
      );
      const { materialCulling: material, optOut } = report;
      process.stdout.write(
        `  caller material: undeclared displacement culled with its source ${String(material.undeclaredPops)}; ` +
          `${String(material.paddedCases)} identical cases with declared padding; half padding changed ` +
          `${String(material.undersizedPaddingChannels)} channels (negative control); frustumCulled: false never culled ` +
          `${String(material.neverCulled)}\n` +
          `  frustumCulled = false off screen, draw calls kept: batched member ${String(optOut.memberCalls)}, ` +
          `standalone ${String(optOut.standaloneCalls)}, group ${String(optOut.groupCalls)}, ` +
          `detached glyphs ${String(optOut.glyphsCalls)}\n`,
      );
      for (const workload of report.timings) process.stdout.write(`  ${summarize(workload)}\n`);
    }
  }
  const report = { capturedAt: new Date().toISOString(), chromium: browser.version(), softwareGpu, reports };
  if (output !== undefined) {
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`Raw report: ${output}\n`);
  }
} finally {
  await browser?.close();
  await server?.close();
}

function summarize(workload: TimingWorkload): string {
  const pick = (culling: boolean, key: 'publishMs' | 'renderMs' | 'gpuMs' | 'calls') =>
    median(
      workload.samples
        .filter((sample) => sample.culling === culling)
        .map((sample) => sample[key])
        .filter((value): value is number => value !== null),
    );
  const cell = (key: 'publishMs' | 'renderMs' | 'gpuMs') =>
    `${key} ${pick(false, key).toFixed(3)} -> ${pick(true, key).toFixed(3)}`;
  return `${workload.name} (${String(workload.labels)} labels, ${String(workload.onScreenLabels)} on screen): calls ${String(
    pick(false, 'calls'),
  )} -> ${String(pick(true, 'calls'))}, ${cell('publishMs')}, ${cell('renderMs')}, ${cell('gpuMs')}`;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function option(prefix: string): string | undefined {
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}
