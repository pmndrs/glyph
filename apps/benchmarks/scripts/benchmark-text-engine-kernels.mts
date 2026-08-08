/* @workflow {
  "name": "text:kernel-lab-browser",
  "summary": "Runs the scalar, auto-vectorized, and explicit SIMD retained-engine kernel packet in project Chromium.",
  "requirements": "Built @pmndrs/text and package-local kernel-lab artifacts. Accepts --json.",
  "writes": "stdout only, or the JSON report path passed to --json"
} */
import { readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { Browser } from 'playwright';

import { captureKernelWorkloads } from '../../../packages/text/scripts/support/engine-kernel-fixture.mts';
import { launchProjectChromium } from './support/project-chromium.mts';

const artifactRoot = new URL('../../../packages/text/rust/shaper/target/kernel-lab/', import.meta.url);
const runnerUrl = new URL('../../../packages/text/scripts/support/engine-kernel-runner.mjs', import.meta.url);
const variants = ['scalar', 'auto', 'explicit'] as const;
const warmup = 40;
const samples = 101;
const workloads = await captureKernelWorkloads([22_000, 86_000]);

let browser: Browser | undefined;
let server: Server | undefined;
try {
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    response.end('<!doctype html><meta charset="utf-8"><title>pmndrs text kernel lab</title>');
  });
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('kernel-lab server did not expose a TCP port');
  browser = await launchProjectChromium({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'domcontentloaded' });
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  const runnerSource = await readFile(runnerUrl, 'utf8');
  const moduleUrl = await page.evaluate(
    (source) => URL.createObjectURL(new Blob([source], { type: 'text/javascript' })),
    runnerSource,
  );
  const variantReports = [];
  let oracleHashes: ReadonlyMap<string, string> | undefined;
  for (const name of variants) {
    const wasm = await readFile(new URL(`${name}.wasm`, artifactRoot));
    const reports = [];
    const hashes = new Map<string, string>();
    for (const workload of workloads) {
      const result = await page.evaluate(
        async ({
          moduleUrl: browserModuleUrl,
          wasmBase64,
          input,
          name: artifactName,
          warmup: benchmarkWarmup,
          samples: benchmarkSamples,
        }) => {
          const module = await import(browserModuleUrl);
          const decode = (value: string) => {
            const binary = atob(value);
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
            return bytes;
          };
          const typedInput = {
            label: input.label,
            glyphs: input.glyphs,
            x: new Float32Array(decode(input.x).buffer),
            y: new Float32Array(decode(input.y).buffer),
            fontSize: new Float32Array(decode(input.fontSize).buffer),
            planeLeft: new Float32Array(decode(input.planeLeft).buffer),
            planeBottom: new Float32Array(decode(input.planeBottom).buffer),
            planeRight: new Float32Array(decode(input.planeRight).buffer),
            planeTop: new Float32Array(decode(input.planeTop).buffer),
            advances: new Int32Array(decode(input.advances).buffer),
            flags: decode(input.flags),
            levels: decode(input.levels),
          };
          return module.benchmarkKernelArtifact(decode(wasmBase64), artifactName, typedInput, {
            warmup: benchmarkWarmup,
            samples: benchmarkSamples,
          });
        },
        {
          moduleUrl,
          wasmBase64: wasm.toString('base64'),
          input: encodeInput(workload),
          name,
          warmup,
          samples,
        },
      );
      reports.push(result);
      hashes.set(workload.label, result.outputHash);
    }
    if (oracleHashes === undefined) oracleHashes = hashes;
    else {
      for (const [label, hash] of hashes) {
        if (hash !== oracleHashes.get(label)) {
          throw new Error(`${name} output ${hash} does not match Chromium scalar oracle for ${label}`);
        }
      }
    }
    variantReports.push({ name, workloads: reports });
  }
  await page.evaluate((url) => URL.revokeObjectURL(url), moduleUrl);
  if (errors.length > 0) throw new Error(`kernel-lab Chromium errors: ${errors.join(' | ')}`);
  const environment = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    simdArtifactExecuted: true,
  }));
  const report = {
    generatedBy: 'text:kernel-lab-browser',
    environment,
    warmup,
    samples,
    variants: variantReports,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  const jsonPath = readArgument('--json');
  if (jsonPath !== undefined) await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
} finally {
  if (browser !== undefined) await browser.close();
  if (server !== undefined) await new Promise<void>((resolve) => server!.close(() => resolve()));
}

function encodeInput(input: (typeof workloads)[number]) {
  const encode = (value: ArrayBufferView) =>
    Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64');
  return {
    label: input.label,
    glyphs: input.glyphs,
    x: encode(input.x),
    y: encode(input.y),
    fontSize: encode(input.fontSize),
    planeLeft: encode(input.planeLeft),
    planeBottom: encode(input.planeBottom),
    planeRight: encode(input.planeRight),
    planeTop: encode(input.planeTop),
    advances: encode(input.advances),
    flags: encode(input.flags),
    levels: encode(input.levels),
  };
}

function readArgument(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index < 0 ? undefined : process.argv[index + 1];
}
