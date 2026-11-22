/* @workflow {
  "name": "benchmark:headline-bidi-edit",
  "summary": "Time the mixed-bidi editing headline (15,000 units of Latin and Arabic in Amiri Bitmap 16: type-end, insert-middle, delete-middle, paste-middle) as complete GPU-completed frames, baseline against candidate archive in interleaved rounds.",
  "requirements": "Two packed @pmndrs/glyph .tgz archives (--baseline ABS --candidate ABS), the offline pnpm store, and project Chromium with WebGPU. Optional --rounds N (default 3) and --output DIR.",
  "writes": "Two isolated consumer builds, one JSON result per load and summary.md under --output (default benches/.cache/headline-bidi-edit); prints the summary."
} */
import { execFile as execFileCallback } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'vite';

import type { HeadlineResult } from '../headline/bidi-edit.ts';
import { LOOPBACK_HOST } from './support/loopback-port.mts';
import { installedPackageDependencies } from './support/package-labs-dependencies.mts';
import { launchProjectChromium } from './support/project-chromium.mts';

const execFile = promisify(execFileCallback);
const benchesRoot = fileURLToPath(new URL('..', import.meta.url));
const pageSource = join(benchesRoot, 'headline/bidi-edit.ts');
const fontSource = join(benchesRoot, 'fixtures/rendering/amiri-bitmap-16.font.glb');
const operations = ['type-end', 'insert-middle', 'delete-middle', 'paste-middle'] as const;
const arms = ['baseline', 'candidate'] as const;
type Arm = (typeof arms)[number];

const options = parseOptions(process.argv.slice(2));
await mkdir(options.output, { recursive: true });
const roots: Record<Arm, string> = {
  baseline: await buildConsumer('baseline', options.baseline),
  candidate: await buildConsumer('candidate', options.candidate),
};
const server = await serve(roots);
const address = server.address();
if (address === null || typeof address === 'string') throw new Error('the headline server has no TCP address');
const origin = `http://${LOOPBACK_HOST}:${String(address.port)}`;
const results: Record<Arm, HeadlineResult[]> = { baseline: [], candidate: [] };
try {
  // Baseline first in every round; one fresh browser per load.
  for (let round = 0; round < options.rounds; round += 1) {
    for (const arm of arms) {
      const result = await load(`${origin}/${arm}/index.html`);
      if (result.error !== undefined) throw new Error(`${arm} round ${String(round)}: ${result.error}`);
      results[arm].push(result);
      await writeFile(join(options.output, `${arm}.${String(round).padStart(2, '0')}.json`), JSON.stringify(result));
      process.stderr.write(`${arm} round ${String(round)} done\n`);
    }
  }
} finally {
  await new Promise<void>((done) => server.close(() => done()));
}
const summary = summarize(results);
await writeFile(join(options.output, 'summary.md'), summary);
process.stdout.write(summary);

interface Options {
  readonly baseline: string;
  readonly candidate: string;
  readonly rounds: number;
  readonly output: string;
}

function parseOptions(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const [name, value] = [argv[index]!, argv[index + 1]];
    if (!['--baseline', '--candidate', '--rounds', '--output'].includes(name))
      throw new Error(`unknown option ${name}`);
    if (value === undefined) throw new Error(`${name} needs a value`);
    values.set(name, value);
  }
  const archive = (name: string) => {
    const value = values.get(name);
    if (value === undefined || !value.endsWith('.tgz')) throw new Error(`${name} must name a packed .tgz archive`);
    return resolve(value);
  };
  const rounds = Number(values.get('--rounds') ?? 3);
  if (!Number.isInteger(rounds) || rounds < 1) throw new Error('--rounds must be a positive integer');
  return {
    baseline: archive('--baseline'),
    candidate: archive('--candidate'),
    rounds,
    output: resolve(values.get('--output') ?? join(benchesRoot, '.cache/headline-bidi-edit')),
  };
}

/** Installs one archive offline into its own consumer and bundles the page for production. */
async function buildConsumer(arm: Arm, archive: string): Promise<string> {
  const consumer = join(options.output, 'consumers', arm);
  await rm(consumer, { recursive: true, force: true });
  await mkdir(join(consumer, 'public'), { recursive: true });
  await Promise.all([
    copyFile(pageSource, join(consumer, 'bidi-edit.ts')),
    copyFile(fontSource, join(consumer, 'public/amiri-bitmap-16.font.glb')),
    writeFile(
      join(consumer, 'index.html'),
      '<!doctype html><html lang="en"><head><meta charset="UTF-8" /><link rel="icon" href="data:," /></head>' +
        '<body style="margin:0;background:#101014"><canvas style="width:1280px;height:800px;display:block"></canvas>' +
        '<script type="module" src="./bidi-edit.ts"></script></body></html>\n',
    ),
    writeFile(
      join(consumer, 'package.json'),
      `${JSON.stringify({ private: true, type: 'module', dependencies: installedPackageDependencies(`file:${archive}`) }, null, 2)}\n`,
    ),
  ]);
  await execFile(
    'pnpm',
    ['install', '--ignore-workspace', '--offline', '--config.node-linker=hoisted', '--config.auto-install-peers=false'],
    { cwd: consumer, env: { ...process.env, CI: 'true' } },
  );
  await build({
    root: consumer,
    base: './',
    logLevel: 'warn',
    configFile: false,
    resolve: { dedupe: ['three'], preserveSymlinks: true },
    build: { outDir: 'dist', emptyOutDir: true, target: 'esnext', chunkSizeWarningLimit: 100_000 },
  });
  return join(consumer, 'dist');
}

/** Serves each consumer's bundle under its arm name, cross-origin isolated and uncached. */
async function serve(directories: Record<Arm, string>): Promise<Server> {
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.wasm': 'application/wasm',
    '.glb': 'model/gltf-binary',
  };
  const listening = createServer((request, response) => {
    const [, arm, ...rest] = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname).split('/');
    const root = arm === 'baseline' || arm === 'candidate' ? directories[arm] : undefined;
    const relative = normalize(rest.join('/') || 'index.html');
    if (root === undefined || relative.startsWith('..')) {
      response.writeHead(404).end();
      return;
    }
    const file = join(root, relative);
    stat(file).then(
      (info) => {
        response.writeHead(200, {
          'Content-Type': types[extname(file)] ?? 'application/octet-stream',
          'Content-Length': String(info.size),
          'Cache-Control': 'no-store',
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
        });
        createReadStream(file).pipe(response);
      },
      () => response.writeHead(404).end(),
    );
  });
  await new Promise<void>((done) => listening.listen(0, LOOPBACK_HOST, done));
  return listening;
}

async function load(url: string): Promise<HeadlineResult> {
  const browser = await launchProjectChromium({
    headless: true,
    args: [
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-webgpu',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(url, { waitUntil: 'commit' });
    await page.waitForFunction(() => window.glyphHeadlineDone === true, undefined, { timeout: 600_000, polling: 50 });
    const result = (await page.evaluate(() => window.glyphHeadlineResult)) as HeadlineResult;
    if (errors.length > 0 && result.error === undefined) result.error = errors.join('\n');
    return result;
  } finally {
    await browser.close();
  }
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** Per operation: the median over loads of each load's per-step median complete-frame time. */
function summarize(loads: Record<Arm, HeadlineResult[]>): string {
  const lines = [
    `### Mixed-bidi edit headline, ${String(options.rounds)} interleaved rounds`,
    '',
    `Baseline \`${options.baseline}\`; candidate \`${options.candidate}\`. Per-step median ms of a complete frame (edit and measure, publish, render, GPU completion), median of loads.`,
    '',
    '| operation | baseline | candidate | candidate/baseline | baseline loads | candidate loads |',
    '|---|---:|---:|---:|---|---|',
  ];
  for (const operation of operations) {
    const values = (arm: Arm) => loads[arm].map((result) => result.operations[operation]!.totalMedian);
    const [baseline, candidate] = [values('baseline'), values('candidate')];
    const list = (series: readonly number[]) => series.map((value) => value.toFixed(2)).join(', ');
    lines.push(
      `| ${operation} | ${median(baseline).toFixed(2)} | ${median(candidate).toFixed(2)} | ${(median(candidate) / median(baseline)).toFixed(2)} | ${list(baseline)} | ${list(candidate)} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}
