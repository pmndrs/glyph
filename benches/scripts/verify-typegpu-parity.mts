/* @workflow { "name": "benchmark:typegpu-parity", "summary": "Render the direct TypeGPU renderer on a real WebGPU device and compare its pixels with the Three MSDF path and a saved capture; --perf reports draws, bind groups and frame cost.", "requirements": "Playwright Chromium with WebGPU and the baked rendering fixtures. --scenes=a,b selects scenes; --baseline=<dir> compares with saved captures (default benches/render-reference/typegpu-start); --capture=<dir> writes captures; --out=<dir> writes this run's images; --tolerance=<n> sets the channel tolerance (default 8; a pixel may leave the capture only towards Three); --perf adds the one-text, 200 and 1,000 label measurements.", "writes": "Only the directories named by --capture and --out." } */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

import type { ParityCapture, ParityPerf } from '../src/typegpu-parity-contract.ts';
import { launchProjectChromium } from './support/project-chromium.mts';

const root = fileURLToPath(new URL('..', import.meta.url));
const option = (name: string): string | undefined =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const tolerance = Number(option('tolerance') ?? 8);
const baselineDirectory = resolve(option('baseline') ?? resolve(root, 'render-reference/typegpu-start'));
const captureDirectory = option('capture');
const outDirectory = option('out');
const selected = option('scenes')?.split(',');
const withPerf = process.argv.includes('--perf');

/**
 * What the renderers are allowed to disagree on, per scene, as a count of pixels over the tolerance.
 * Bitmap is compared with its own capture only: the Three path snaps bitmap quads to the pixel grid.
 */
const threeBudget: Readonly<Record<string, number | undefined>> = {
  bitmap: undefined,
};

interface Difference {
  readonly differing: number;
  readonly over: number;
  readonly max: number;
  readonly lost: number;
  readonly lit: number;
  /** The first pixels over the tolerance as `x,y candidate/reference`, for --where. */
  readonly where: readonly string[];
}

function compare(candidate: Uint8Array, reference: Uint8Array, width: number): Difference {
  let differing = 0;
  let over = 0;
  let max = 0;
  let lost = 0;
  let lit = 0;
  const where: string[] = [];
  for (let offset = 0; offset < candidate.length; offset += 4) {
    let delta = 0;
    let candidateLit = 0;
    let referenceLit = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      delta = Math.max(delta, Math.abs(candidate[offset + channel]! - reference[offset + channel]!));
      candidateLit = Math.max(candidateLit, candidate[offset + channel]!);
      referenceLit = Math.max(referenceLit, reference[offset + channel]!);
    }
    if (candidateLit > 0) lit += 1;
    if (delta > 0) differing += 1;
    if (delta > tolerance) {
      over += 1;
      if (where.length < 12) {
        const pixel = offset / 4;
        const rgb = (bytes: Uint8Array): string => Array.from(bytes.subarray(offset, offset + 3)).join(' ');
        where.push(
          `${String(pixel % width)},${String(Math.floor(pixel / width))} ${rgb(candidate)} / ${rgb(reference)}`,
        );
      }
    }
    if (referenceLit > tolerance && candidateLit === 0) lost += 1;
    max = Math.max(max, delta);
  }
  return { differing, over, max, lost, lit, where };
}

/**
 * Pixels that moved away from the saved capture by more than the tolerance without landing within it of Three.
 * A change towards the Three path (an intended parity fix) is not drift; any other change is.
 */
function driftAwayFromThree(candidate: Uint8Array, baseline: Uint8Array, three: Uint8Array): number {
  let away = 0;
  for (let offset = 0; offset < candidate.length; offset += 4) {
    let fromBaseline = 0;
    let fromThree = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = candidate[offset + channel]!;
      fromBaseline = Math.max(fromBaseline, Math.abs(value - baseline[offset + channel]!));
      fromThree = Math.max(fromThree, Math.abs(value - three[offset + channel]!));
    }
    if (fromBaseline > tolerance && fromThree > tolerance) away += 1;
  }
  return away;
}

const decode = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'base64'));
const row = (cells: readonly (string | number)[]): string => `| ${cells.join(' | ')} |`;

let browser: Awaited<ReturnType<typeof launchProjectChromium>> | undefined;
let server: ViteDevServer | undefined;
const failures: string[] = [];
try {
  server = await createServer({ root, logLevel: 'warn', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error('Vite did not publish its loopback TCP address');
  }
  browser = await launchProjectChromium({
    headless: true,
    args: [
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-webgpu',
      // Unquantized timestamp queries for the GPU pass time.
      '--enable-webgpu-developer-features',
      '--enable-dawn-features=allow_unsafe_apis',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 832, height: 600 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${String(address.port)}/typegpu-parity.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.typegpuParity !== undefined, undefined, { timeout: 120_000 });
  const scenes = await page.evaluate(async () => (await window.typegpuParity).scenes);
  const toPng = async (rgba: string, width: number, height: number): Promise<Buffer> =>
    Buffer.from(
      await page.evaluate(async ([data, w, h]) => (await window.typegpuParity).toPng(data, w, h), [
        rgba,
        width,
        height,
      ] as const),
      'base64',
    );

  process.stdout.write(`Channel tolerance ${String(tolerance)}/255; "lost" = lit in the reference, black here.\n\n`);
  process.stdout.write(
    `${row(['scene', 'lit px', 'GPU ms', 'vs Three: differ', 'over', 'max', 'lost', 'vs capture: differ', 'over', 'max', 'lost'])}\n`,
  );
  process.stdout.write(`${row(Array.from({ length: 11 }, () => '---'))}\n`);
  for (const scene of scenes) {
    if (selected !== undefined && !selected.includes(scene)) continue;
    const capture: ParityCapture = await page.evaluate(
      async (name) => (await window.typegpuParity).capture(name, true),
      scene,
    );
    if (errors.length !== 0) throw new Error(`${scene}: browser errors: ${errors.join(' | ')}`);
    const candidate = decode(capture.typegpu);
    const threeDifference =
      capture.three === undefined ? undefined : compare(candidate, decode(capture.three), capture.width);
    let baselineDifference: Difference | undefined;
    let drift: number | undefined;
    const baselinePng = await readFile(resolve(baselineDirectory, `${scene}.png`)).catch(() => undefined);
    if (baselinePng !== undefined) {
      const baseline = await page.evaluate(
        async (png) => (await window.typegpuParity).fromPng(png),
        baselinePng.toString('base64'),
      );
      baselineDifference = compare(candidate, decode(baseline), capture.width);
      drift =
        capture.three === undefined || (threeBudget[scene] === undefined && scene in threeBudget)
          ? baselineDifference.over
          : driftAwayFromThree(candidate, decode(baseline), decode(capture.three));
    }
    for (const directory of [captureDirectory, outDirectory]) {
      if (directory === undefined) continue;
      await mkdir(resolve(directory), { recursive: true });
      await writeFile(resolve(directory, `${scene}.png`), await toPng(capture.typegpu, capture.width, capture.height));
      if (directory === outDirectory && capture.three !== undefined) {
        await writeFile(
          resolve(directory, `${scene}.three.png`),
          await toPng(capture.three, capture.width, capture.height),
        );
      }
    }
    const cells = (difference: Difference | undefined): (string | number)[] =>
      difference === undefined
        ? ['-', '-', '-', '-']
        : [difference.differing, difference.over, difference.max, difference.lost];
    const lit = compare(candidate, candidate, capture.width).lit;
    const gpu = capture.gpuMs === undefined ? 'n/a' : capture.gpuMs.toFixed(4);
    process.stdout.write(`${row([scene, lit, gpu, ...cells(threeDifference), ...cells(baselineDifference)])}\n`);
    if (process.argv.includes('--where')) {
      for (const at of threeDifference?.where ?? []) process.stdout.write(`    Three   ${at}\n`);
      for (const at of baselineDifference?.where ?? []) process.stdout.write(`    capture ${at}\n`);
    }
    if (lit < 100) failures.push(`${scene}: the TypeGPU renderer drew ${String(lit)} lit pixels`);
    const budget = scene in threeBudget ? threeBudget[scene] : 0;
    if (budget !== undefined && threeDifference !== undefined && threeDifference.over > budget) {
      failures.push(
        `${scene}: ${String(threeDifference.over)} pixels differ from Three by more than ${String(tolerance)}/255`,
      );
    }
    if (drift !== undefined && drift > 0 && !process.argv.includes('--allow-capture-drift')) {
      failures.push(
        `${scene}: ${String(drift)} pixels differ from the saved capture by more than ${String(tolerance)}/255 and are not within it of Three`,
      );
    }
  }

  if (withPerf) {
    for (const labels of [1, 200, 1000]) {
      const perf: ParityPerf = await page.evaluate(async (count) => (await window.typegpuParity).perf(count), labels);
      if (errors.length !== 0) throw new Error(`perf ${String(labels)}: browser errors: ${errors.join(' | ')}`);
      if (perf.growth.error !== undefined)
        failures.push(`perf ${String(labels)}: ${perf.growth.error.split('\n')[0]!}`);
      process.stdout.write(
        `\n${labels === 1 ? 'one text (the "one" scene)' : `${String(labels)} labels`}, ${String(perf.glyphs)} glyphs\n`,
      );
      const ms = (value: number | undefined): string => (value === undefined ? 'n/a' : value.toFixed(4));
      process.stdout.write(
        [
          row(['measure', 'value']),
          row(['---', '---']),
          row(['draws per frame', perf.frame.draws]),
          row(['setBindGroup per frame', perf.frame.setBindGroup]),
          row(['setPipeline per frame', perf.frame.setPipeline]),
          row(['setVertexBuffer per frame', perf.frame.setVertexBuffer]),
          row(['bind groups created at mount', perf.mount.createBindGroup]),
          row(['buffers created at mount', perf.mount.createBuffer]),
          row(['buffer bytes created at mount', perf.mount.bufferBytes]),
          row(['texture bytes created at mount', perf.mount.textureBytes]),
          row([
            'shader modules / pipelines at mount',
            `${String(perf.mount.createShaderModule)} / ${String(perf.mount.createRenderPipeline)}`,
          ]),
          row(['mount + shape + first frame, ms', ms(perf.mount.ms)]),
          row(['CPU per frame, ms', ms(perf.cpuFrameMs)]),
          row(['GPU pass (timestamp query), ms', ms(perf.gpuFrameMs)]),
          row(['frame, batch completion, ms', ms(perf.batchFrameMs)]),
          row(['edit one label (same count): ms', ms(perf.edit.ms)]),
          row([
            '  writeBuffer calls / bytes',
            `${String(perf.edit.writeBuffer)} / ${String(perf.edit.writeBufferBytes)}`,
          ]),
          row([
            '  bind groups / buffers created',
            `${String(perf.edit.createBindGroup)} / ${String(perf.edit.createBuffer)}`,
          ]),
          row(['edit one label (count changes): ms', ms(perf.editCount.ms)]),
          row([
            '  writeBuffer calls / bytes',
            `${String(perf.editCount.writeBuffer)} / ${String(perf.editCount.writeBufferBytes)}`,
          ]),
          row([
            '  bind groups / buffers created',
            `${String(perf.editCount.createBindGroup)} / ${String(perf.editCount.createBuffer)}`,
          ]),
          row(['move 10 labels: ms', ms(perf.move10.ms)]),
          row([
            '  writeBuffer calls / bytes',
            `${String(perf.move10.writeBuffer)} / ${String(perf.move10.writeBufferBytes)}`,
          ]),
          row([
            '  bind groups / buffers created',
            `${String(perf.move10.createBindGroup)} / ${String(perf.move10.createBuffer)}`,
          ]),
          row([
            `growth (+${String(perf.growth.labelsAdded)} labels): shader modules / pipelines`,
            `${String(perf.growth.createShaderModule)} / ${String(perf.growth.createRenderPipeline)}`,
          ]),
          row([
            '  bind groups / buffers created',
            `${String(perf.growth.createBindGroup)} / ${String(perf.growth.createBuffer)}`,
          ]),
          ...(perf.growth.error === undefined
            ? []
            : [row(['  DEVICE ERROR during growth', perf.growth.error.split('\n')[0]!])]),
          '',
        ].join('\n'),
      );
    }
  }
  await page.close();
} finally {
  await browser?.close();
  await server?.close();
}
if (failures.length !== 0) {
  process.stderr.write(`\n${failures.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write('\ntypegpu-parity-ok\n');
