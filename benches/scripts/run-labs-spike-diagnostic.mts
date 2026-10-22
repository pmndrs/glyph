/* @workflow {
  "name": "benchmark:labs-spike-diagnostic",
  "summary": "Trace the exact installed-package Labs rewrite-512 callback in eight paired fresh-process blocks per warmup arm.",
  "requirements": "Pinned mise/pnpm, installed patched Labs 0.9.0, offline pnpm cache, and --artifact ABS --expected-sha256 HEX --output ABS-directory. Diagnostic-only fixed replay of the saved candidate's 20-sample single-call plan.",
  "writes": "One immutable diagnostic directory containing original/trace Labs sources and diff, full raw call/sample/GC ledgers, block outcomes, and a failure receipt if interrupted. Removes its isolated package consumer."
} */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertArchiveSha256, assertInstalledDist, distInventory, sha256 } from './support/archive-dist-proof.mts';
import { installedPackageDependencies } from './support/package-labs-dependencies.mts';

const benchesRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = resolve(benchesRoot, '..');
const originals = resolve(benchesRoot, 'node_modules/@pmndrs/labs');
const originalDist = resolve(originals, 'dist');
const fixture = resolve(benchesRoot, 'labs/package/fixture.ts');
const benchmark = resolve(benchesRoot, 'labs/package/batching.bench.ts');
const fontNames = [
  'inter-bitmap-16.font.glb',
  'dot-gothic-16-bitmap-16-32.font.glb',
  'fredoka-issue-216-bitmap-16.font.glb',
];
const pinned = {
  'dist/worker.mjs': 'baa7454da0fd065a101df5037b7346bf8afc6a590c68a5016a2d8fb739130b4d',
  'dist/src-DNyOXr2d.mjs': 'fff1017f8b652aaccb374d79b0fd1519e643f5cb51375849853bcb4a0d0ea30f',
  'dist/index.mjs': 'db8b062c6146b2ea8d32848adce8fa1d0f16e4a726d1971e67f44e4e830502da',
  patch: '1475111a563f675ba8de804b57a4a7500acad4f500771713dad8ad33b5be3002',
  benchmark: 'ebbf03ef22b7a7e80877692531b1dc8cd57d97597ed89087732f490303f61bde',
  fixture: '34b97032e1f035d6b15ae385f4a6aa4e6cc0b78d9239dc14e8253a1a6644dfe3',
  fonts: [
    'acdca408ed169c7aa1c2791dbbc2982afa1939c56fbc59ef43cc38f7ff366c14',
    'f1895ea3bf8b69ee7430940a2ccf5d398c7a5f8c469635845c4b4b3b457b112b',
    '2be09acf3c5ebd2d08859eb8d5282cf9018d70f8e84b4bda9eb80c410ff532c0',
  ],
} as const;
const savedPlan = { batch: false, batch_samples: 0, batch_unroll: 4, samples: 20 } as const;
const target = 'rewrite 512 labels in one group';
const options = parseOptions(process.argv.slice(2));
const receipt: Record<string, unknown> = {
  status: 'started',
  diagnosticOnly: true,
  causeUnprovenIfNoSpikeRecurs: true,
  planMode: 'fixed-saved-candidate-plan-for-every-block; no fresh pilot or time-budget stop',
  plan: savedPlan,
  target,
  artifact: { path: options.artifact, sha256: options.expectedSha256 },
  blocks: [],
  originalSavedCandidate: {
    source: 'boundary-wave-20261022/matrix-candidate/candidate.json',
    retainedP50Ns: 10295208,
    retainedP90Ns: 77718584,
    retainedP95Ns: 117498792,
    blockMediansNs: [113293458, 11487834, 10573292, 12660042, 9508167, 9233583, 9447208, 9190500],
    note: 'Exact saved nearest-rank pooled percentiles and block medians from the 2026-10-22 audit',
  },
};
await mkdir(options.output, { recursive: false });
let consumer: string | undefined;
try {
  const archiveBytes = await readFile(options.artifact);
  assert.equal(
    options.expectedSha256,
    '06fe22b7f05dceb27f59b2e82d33fab541c8cee04c37b1a1ccdf078f6ecdc9be',
    'Expected exact candidate archive',
  );
  assertArchiveSha256(archiveBytes, options.expectedSha256);
  await assertPinnedSources();
  consumer = await mkdtemp(join(tmpdir(), 'glyph-labs-spike-'));
  await writeFile(
    join(consumer, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module', dependencies: installedPackageDependencies(`file:${options.artifact}`) }, null, 2)}\n`,
  );
  await runPinnedPnpm(['install', '--offline', '--ignore-scripts', '--config.confirmModulesPurge=false'], consumer);
  const packageRoot = resolve(consumer, 'node_modules/@pmndrs/glyph');
  const extracted = resolve(consumer, 'archive');
  await mkdir(extracted);
  await run('tar', ['-xzf', options.artifact, '-C', extracted], consumer);
  const archiveDist = await distInventory(resolve(extracted, 'package/dist'));
  const installedDist = await distInventory(resolve(packageRoot, 'dist'));
  assertInstalledDist(archiveDist, installedDist);
  receipt.archiveDist = archiveDist;
  const traceRoot = resolve(consumer, 'trace-labs');
  await mkdir(traceRoot);
  await cp(originalDist, resolve(traceRoot, 'dist'), { recursive: true });
  await writeFile(resolve(traceRoot, 'package.json'), await readFile(resolve(originals, 'package.json')));
  await prepareTraceSources(traceRoot, options.output);
  const copiedBench = resolve(consumer, 'batching.bench.ts');
  const originalBench = await readFile(benchmark, 'utf8');
  const copied = replaceOnce(
    replaceOnce(
      originalBench,
      "from '@pmndrs/labs'",
      `from '${pathToFileURL(resolve(traceRoot, 'dist/index.mjs')).href}'`,
    ),
    "from './fixture.ts'",
    `from '${pathToFileURL(fixture).href}'`,
  );
  await writeFile(copiedBench, copied);
  receipt.sources = {
    pinned,
    copiedBenchSha256: sha256(Buffer.from(copied)),
    traceWorkerSha256: sha256(await readFile(resolve(traceRoot, 'dist/worker.mjs'))),
    traceEngineSha256: sha256(await readFile(resolve(traceRoot, 'dist/src-DNyOXr2d.mjs'))),
    runnerSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
  };
  const tsx = createRequire(await realpath(resolve(originals, 'package.json'))).resolve('tsx');
  const worker = resolve(traceRoot, 'dist/worker.mjs');
  const diagnosticArms = {
    stock: { retained: [] as number[], blockMedians: [] as number[] },
    warmed: { retained: [] as number[], blockMedians: [] as number[] },
  };
  for (let pair = 0; pair < 8; pair++) {
    const arms = pair % 2 === 0 ? (['stock', 'warmed'] as const) : (['warmed', 'stock'] as const);
    for (const arm of arms) {
      const resultFile = resolve(consumer, `block-${pair}-${arm}.json`);
      try {
        await run(process.execPath, ['--expose-gc', '--import', pathToFileURL(tsx).href, worker], consumer, {
          LABS_BENCH_FILE: copiedBench,
          LABS_GREP_TAGS: '',
          LABS_ONLY_INDEX: '4',
          LABS_RESULT_FILE: resultFile,
          LABS_BLOCK_PLANS: JSON.stringify([savedPlan]),
          LABS_BLOCK_TIME: '500000000',
          LABS_MIN_SAMPLES: '20',
          LABS_SAMPLING_POLICY: 'single-call',
          LABS_SPIKE_ARM: arm,
          LABS_SPIKE_BLOCK: String(pair),
          GLYPH_LABS_PACKAGE_ROOT: packageRoot,
          LABS_SPIKE_ARCHIVE_SHA256: options.expectedSha256,
          LABS_SPIKE_ORIGINAL_SOURCE_SHA256: pinned['dist/src-DNyOXr2d.mjs'],
          LABS_SPIKE_ORIGINAL_WORKER_SHA256: pinned['dist/worker.mjs'],
          LABS_SPIKE_TRACE_SOURCE_SHA256: (receipt.sources as { traceEngineSha256: string }).traceEngineSha256,
          LABS_SPIKE_TRACE_WORKER_SHA256: (receipt.sources as { traceWorkerSha256: string }).traceWorkerSha256,
          LABS_SPIKE_BENCH_COPY_SHA256: (receipt.sources as { copiedBenchSha256: string }).copiedBenchSha256,
        });
      } catch (error) {
        const failedBlock = resolve(options.output, `failed-block-${String(pair).padStart(2, '0')}-${arm}.json`);
        try {
          await writeFile(failedBlock, await readFile(resultFile), { flag: 'wx' });
          receipt.failedBlock = { pair, arm, file: basename(failedBlock), sha256: sha256(await readFile(failedBlock)) };
        } catch (copyError) {
          receipt.failedBlock = { pair, arm, traceUnavailable: String(copyError) };
        }
        throw error;
      }
      const result = JSON.parse(await readFile(resultFile, 'utf8')) as {
        trial: {
          alias: string;
          runs: Array<{ stats?: { samples: number[]; plan: unknown; p50: number }; error?: unknown }>;
        };
        trace: { samples: Array<{ index: number; diff: number; survived: boolean }>; calls: unknown[] };
      };
      const name = `block-${String(pair).padStart(2, '0')}-${arm}.json`;
      await writeFile(resolve(options.output, name), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
      (receipt.blocks as unknown[]).push({
        pair,
        arm,
        file: name,
        sha256: sha256(await readFile(resolve(options.output, name))),
      });
      await writeFile(resolve(options.output, 'progress.json'), `${JSON.stringify(receipt, null, 2)}\n`);
      assert.equal(result.trial.alias, target);
      assert.equal(result.trial.runs.length, 1);
      assert.equal(result.trial.runs[0]?.error, undefined);
      assert.deepEqual(result.trial.runs[0]?.stats?.plan, savedPlan);
      const retained = result.trace.samples
        .filter((s) => s.survived)
        .map((s) => s.diff)
        .sort((a, b) => a - b);
      assert.deepEqual(retained, result.trial.runs[0]?.stats?.samples);
      assert.equal(result.trace.samples.length, 20);
      assert.equal(result.trace.calls.length, arm === 'stock' ? 21 : 41);
      diagnosticArms[arm].retained.push(...retained);
      diagnosticArms[arm].blockMedians.push(result.trial.runs[0]!.stats!.p50);
    }
  }
  receipt.diagnosticArmSummaries = Object.fromEntries(
    Object.entries(diagnosticArms).map(([arm, data]) => {
      const sorted = data.retained.sort((a, b) => a - b);
      return [
        arm,
        {
          retainedCount: sorted.length,
          retainedP50Ns: sorted[Math.ceil(0.5 * sorted.length) - 1],
          retainedP90Ns: sorted[Math.ceil(0.9 * sorted.length) - 1],
          retainedP95Ns: sorted[Math.ceil(0.95 * sorted.length) - 1],
          blockMediansNs: data.blockMedians,
          retainedAbove50Ms: sorted.filter((value) => value > 50e6).length,
        },
      ];
    }),
  );
  receipt.interpretation =
    'Labs t0/t1 are ns from performance.now() * 1e6; callback/GC timestamps are ms from the same child performance clock. process.cpuUsage deltas are process-wide and may include background threads. All values include trace overhead. Compare paired stock/warmed blocks only as diagnostic evidence; absence of a recurring stock spike is inconclusive and never replaces the saved candidate.';
  receipt.status = 'complete';
  receipt.completedAt = new Date().toISOString();
  await writeFile(resolve(options.output, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  await rm(resolve(options.output, 'progress.json'));
} catch (error) {
  receipt.status = 'failed';
  receipt.error =
    error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error);
  await writeFile(resolve(options.output, 'failure.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  throw error;
} finally {
  if (consumer !== undefined) await rm(consumer, { recursive: true, force: true });
}

function parseOptions(args: readonly string[]) {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (!['--artifact', '--expected-sha256', '--output'].includes(key ?? '') || !value || values.has(key!)) {
      throw new Error('Use --artifact ABS --expected-sha256 HEX --output ABS-directory');
    }
    values.set(key!, value);
  }
  const artifact = values.get('--artifact');
  const expectedSha256 = values.get('--expected-sha256');
  const output = values.get('--output');
  if (
    values.size !== 3 ||
    !artifact ||
    !output ||
    !expectedSha256 ||
    !isAbsolute(artifact) ||
    !isAbsolute(output) ||
    !/^[a-f0-9]{64}$/u.test(expectedSha256)
  ) {
    throw new Error('Use --artifact ABS --expected-sha256 HEX --output ABS-directory');
  }
  if (resolve(artifact) === resolve(output)) throw new Error('Archive and output must differ');
  return { artifact: resolve(artifact), expectedSha256, output: resolve(output) };
}

async function assertPinnedSources(): Promise<void> {
  const files = [
    [resolve(originalDist, 'worker.mjs'), pinned['dist/worker.mjs']],
    [resolve(originalDist, 'src-DNyOXr2d.mjs'), pinned['dist/src-DNyOXr2d.mjs']],
    [resolve(originalDist, 'index.mjs'), pinned['dist/index.mjs']],
    [resolve(repoRoot, 'patches/@pmndrs__labs@0.9.0.patch'), pinned.patch],
    [benchmark, pinned.benchmark],
    [fixture, pinned.fixture],
    ...fontNames.map((name, i) => [resolve(benchesRoot, 'fixtures/rendering', name), pinned.fonts[i]!] as const),
  ] as const;
  for (const [path, expected] of files)
    assert.equal(sha256(await readFile(path)), expected, `Pinned source changed: ${path}`);
  const manifest = JSON.parse(await readFile(resolve(originals, 'package.json'), 'utf8')) as { version?: string };
  assert.equal(manifest.version, '0.9.0');
  const archiveInfo = await stat(options.artifact);
  assert.ok(archiveInfo.isFile() && options.artifact.endsWith('.tgz'));
}

function replaceOnce(source: string, before: string, after: string): string {
  const index = source.indexOf(before);
  if (index < 0 || source.indexOf(before, index + before.length) >= 0)
    throw new Error(`Expected exactly one injection anchor: ${before}`);
  return source.slice(0, index) + after + source.slice(index + before.length);
}

async function prepareTraceSources(traceRoot: string, output: string): Promise<void> {
  const source = resolve(traceRoot, 'dist/src-DNyOXr2d.mjs');
  const worker = resolve(traceRoot, 'dist/worker.mjs');
  const originalSource = await readFile(source, 'utf8');
  const originalWorker = await readFile(worker, 'utf8');
  let tracedSource = replaceOnce(
    originalSource,
    'let $fn = n.value;',
    'let $fn = n.value;\n\tif (globalThis.__labsSpike) $fn = globalThis.__labsSpike.wrap($fn);',
  );
  tracedSource = replaceOnce(
    tracedSource,
    '\tif (opts.batch !== void 0) batch = !!opts.batch;\n\tif (opts.manual) {',
    '\tif (globalThis.__labsSpike?.arm === "warmed" && globalThis.__labsSpike?.active) for (let o = 0; o < 20; o++) { const value = await fn(); if (!opts.manual && value !== void 0) consume(value); if (opts.after) await opts.after(); }\n\tif (opts.batch !== void 0) batch = !!opts.batch;\n\tif (opts.manual) {',
  );
  tracedSource = replaceOnce(
    tracedSource,
    '\n      samples[_] = diff ${!batch ? "" : `/ ${batchSamples}`};',
    '\n      samples[_] = diff ${!batch ? "" : `/ ${batchSamples}`};\n      if (globalThis.__labsSpike?.active) globalThis.__labsSpike.sample(_, t0, t1, diff);',
  );
  tracedSource = replaceOnce(
    tracedSource,
    'const t0 = $now();\n          $gc(); t += $now() - t0;',
    'if (globalThis.__labsSpike?.active) globalThis.__labsSpike.gcMarker(_,  "before", "start");\n          const t0 = $now();\n          $gc(); t += $now() - t0;\n          if (globalThis.__labsSpike?.active) globalThis.__labsSpike.gcMarker(_,  "before", "end");',
  );
  tracedSource = replaceOnce(
    tracedSource,
    'const t0 = $now();\n          $gc(); const t1 = $now() - t0;',
    'if (globalThis.__labsSpike?.active) globalThis.__labsSpike.gcMarker(_,  "after", "start");\n          const t0 = $now();\n          $gc(); const t1 = $now() - t0;\n          if (globalThis.__labsSpike?.active) globalThis.__labsSpike.gcMarker(_,  "after", "end");',
  );
  let tracedWorker = replaceOnce(
    originalWorker,
    'import { join } from "node:path";',
    'import { join } from "node:path";\nimport { PerformanceObserver, performance } from "node:perf_hooks";',
  );
  tracedWorker = replaceOnce(
    tracedWorker,
    'async function childMain(index) {',
    'async function childMain(index) {\n\tlet trace;\n\ttry {',
  );
  tracedWorker = replaceOnce(
    tracedWorker,
    '\tawait import(file);\n\tconst calibrationRate',
    `\ttrace = makeSpikeTrace();\n\tawait import(file);\n\tif (getBenchRegistry()[index]?.alias !== '${target}') throw new Error('Benchmark registry identity changed');\n\tconst calibrationRate`,
  );
  tracedWorker = replaceOnce(
    tracedWorker,
    '\tconst calibrationRate = await probeCalibrationRate();',
    '\tconst calibrationRate = await probeCalibrationRate();\n\tglobalThis.__labsSpike = trace;',
  );
  tracedWorker = replaceOnce(
    tracedWorker,
    '\twriteFileSync(process.env.LABS_RESULT_FILE, JSON.stringify({\n\t\ttrial,\n\t\tcalibrationRate',
    '\tawait new Promise((resolve) => setImmediate(resolve));\n\ttrace.finish(trial.runs[0]?.stats?.samples);\n\twriteFileSync(process.env.LABS_RESULT_FILE, JSON.stringify({\n\t\ttrial,\n\t\ttrace,\n\t\tcalibrationRate',
  );
  tracedWorker = replaceOnce(
    tracedWorker,
    '\t}, errorReplacer));\n}\nlet childSeq = 0;',
    `\t}, errorReplacer));
	} catch (error) {
		await new Promise((resolve) => setImmediate(resolve));
		if (trace) { trace.drain(); trace.faults.push({ stage: 'childMain', message: String(error), stack: error?.stack }); }
		writeFileSync(process.env.LABS_RESULT_FILE, JSON.stringify({ failure: error, trace }, errorReplacer));
		throw error;
	}
}
let childSeq = 0;`,
  );
  tracedWorker = replaceOnce(
    tracedWorker,
    'let childSeq = 0;',
    `function makeSpikeTrace() {
  const arm = process.env.LABS_SPIKE_ARM;
  if (arm !== 'stock' && arm !== 'warmed') throw new Error('Unknown diagnostic arm');
  const trace = { arm, block: Number(process.env.LABS_SPIKE_BLOCK), pid: process.pid,
    timeOrigin: performance.timeOrigin, clockAlignment: 'Labs now() = performance.now() * 1e6 ns; callback and GC event timestamps are performance.now() ms in the same child', processCpuScope: 'process-wide; may include V8 background threads', monotonicProcessStartEstimateNs: (process.hrtime.bigint() - BigInt(Math.round(process.uptime() * 1e9))).toString(),
    input: { plan: JSON.parse(process.env.LABS_BLOCK_PLANS), gc: 'Labs default true', samplingPolicy: process.env.LABS_SAMPLING_POLICY, nodeExecArgv: process.execArgv, nodeOptions: process.env.NODE_OPTIONS ?? null, archiveSha256: process.env.LABS_SPIKE_ARCHIVE_SHA256, originalSourceSha256: process.env.LABS_SPIKE_ORIGINAL_SOURCE_SHA256, originalWorkerSha256: process.env.LABS_SPIKE_ORIGINAL_WORKER_SHA256, traceSourceSha256: process.env.LABS_SPIKE_TRACE_SOURCE_SHA256, traceWorkerSha256: process.env.LABS_SPIKE_TRACE_WORKER_SHA256, benchmarkCopySha256: process.env.LABS_SPIKE_BENCH_COPY_SHA256 },
    active: false, calls: [], samples: [], gcEvents: [], forcedGcSpans: [], faults: [],
    gcMarker(index, phase, edge) { trace.forcedGcSpans.push({ index, phase, edge, at: performance.now() }); },
    drain() { recordGc(observer.takeRecords()); observer.disconnect(); },
    wrap(fn) { trace.active = true; return (...args) => {
      const index = trace.calls.length;
      const start = performance.now();
      const cpu = process.cpuUsage();
      const resources = process.resourceUsage();
      let outcome = 'returned';
      try { return fn(...args); }
      catch (error) { outcome = 'threw'; trace.faults.push({ index, message: String(error) }); throw error; }
      finally {
        const end = performance.now();
        const delta = process.cpuUsage(cpu);
        const after = process.resourceUsage();
        trace.calls.push({ index, start, end, wallMs: end - start,
          processCpuUs: delta.user + delta.system,
          voluntaryContextSwitches: after.voluntaryContextSwitches - resources.voluntaryContextSwitches,
          involuntaryContextSwitches: after.involuntaryContextSwitches - resources.involuntaryContextSwitches,
          outcome });
      }
    }; },
    sample(index, t0, t1, diff) { trace.samples.push({ index, callbackIndex: trace.calls.length - 1, t0, t1, diff, survived: false }); },
    finish(retained) {
      trace.drain();
      trace.warmupCallCount = trace.calls.length - trace.samples.length;
      const ordered = [...trace.samples].sort((a, b) => a.diff - b.diff || a.index - b.index);
      const survivors = ordered.length > 12 ? ordered.slice(2, -2) : ordered;
      for (const sample of survivors) sample.survived = true;
      const computed = survivors.map((sample) => sample.diff).sort((a, b) => a - b);
      if (retained === undefined) { trace.faults.push({ message: 'Trial produced no retained samples' }); return; }
      if (JSON.stringify(computed) !== JSON.stringify(retained)) throw new Error('Chronological sample identity does not reproduce Labs trim');
    }
  };
  const recordGc = (entries) => {
    for (const event of entries) trace.gcEvents.push({ startTime: event.startTime, duration: event.duration, kind: event.kind, flags: event.flags });
  };
  const observer = new PerformanceObserver((list) => recordGc(list.getEntries()));
  observer.observe({ entryTypes: ['gc'] });
  return trace;
}
let childSeq = 0;`,
  );
  await writeFile(source, tracedSource);
  await writeFile(worker, tracedWorker);
  await writeFile(resolve(output, 'labs-original-src.mjs'), originalSource, { flag: 'wx' });
  await writeFile(resolve(output, 'labs-trace-src.mjs'), tracedSource, { flag: 'wx' });
  await writeFile(resolve(output, 'labs-original-worker.mjs'), originalWorker, { flag: 'wx' });
  await writeFile(resolve(output, 'labs-trace-worker.mjs'), tracedWorker, { flag: 'wx' });
  for (const [label, before, after] of [
    ['engine', resolve(output, 'labs-original-src.mjs'), resolve(output, 'labs-trace-src.mjs')],
    ['worker', resolve(output, 'labs-original-worker.mjs'), resolve(output, 'labs-trace-worker.mjs')],
  ] as const) {
    const diff = spawnSync('diff', ['-u', before, after], { encoding: 'utf8' });
    if (diff.status !== 1 || diff.error) throw new Error(`Could not create exact ${label} trace diff`);
    await writeFile(resolve(output, `labs-${label}.diff`), diff.stdout, { flag: 'wx' });
  }
  await writeFile(
    resolve(output, 'README.md'),
    `# Labs spike diagnostic

This output is diagnostic only. It replays the saved candidate's exact 20-raw-sample, single-call plan in every child; unlike the original Labs run, it does not run a fresh pilot or apply the 0.5-second stop rule to the first block. The same plan keeps work fixed across stock and 20-extra-warmup arms. Every arm has eight fresh children, alternated by pair. Each child uses the original Labs worker childMain/runTrialAt, default forced GC policy, result arithmetic, and 2-low/2-high trim.

The original benchmark source and fixture are authenticated before a temporary import-only benchmark copy is made. The installed Labs package is untouched. labs-original-* and labs-trace-* preserve the edited engine/worker sources; labs-engine.diff and labs-worker.diff are exact unified diffs. Block JSON files retain chronological raw calls, Labs samples, GC events, forced-GC spans, original trial results, and calibration. The receipt preserves saved candidate context and both diagnostic arm summaries. Any child failure is copied before temporary consumer teardown when the child emitted a trace; stderr is carried in failure.json.

Labs sample t0/t1/diff are nanoseconds from performance.now() × 1e6. Callback wall and GC timestamps are milliseconds on the same child performance clock. process.cpuUsage() and resourceUsage() deltas cover the process, including possible V8 background work. The wrapper and trace hooks perturb timing. PerformanceObserver GC capture can be incomplete even after the bounded post-loop drain. A missing spike is inconclusive, and these timings never replace saved admission results.
`,
    { flag: 'wx' },
  );
  await writeFile(
    resolve(output, 'injection-rationale.txt'),
    'Trace-only copy. benchGenerator activates tracing only for the selected yielded callback, after the original per-child calibration; benchFn adds 20 untimed callbacks after its original first-call/conditional-warmup block in the warmed arm and records each raw sample before the original sort/trim. Worker retains childMain/runTrialAt/calibration and writes trace after a causal setImmediate GC-observer drain. Forced GC before/after each sample is marked separately from callback spans. GC PerformanceObserver records are drained with takeRecords before disconnect, but GC event capture may still be incomplete if an event is not observable by that point. Both arms replay the saved 20-sample plan. No result arithmetic, callback body, GC setting, trim, or benchmark output path changes. CPU counters are process-wide and may include background threads. Tracing perturbs timing and is diagnostic only.\n',
    { flag: 'wx' },
  );
}

async function runPinnedPnpm(args: readonly string[], cwd: string): Promise<void> {
  const pnpm = process.env.npm_execpath;
  if (!pnpm) throw new Error('Run through pinned mise exec -- pnpm scripts run');
  await run(pnpm, args, cwd);
}

async function run(
  command: string,
  args: readonly string[],
  cwd: string,
  extra: Record<string, string> = {},
): Promise<void> {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...extra },
      stdio: ['ignore', 'inherit', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      stderr = (stderr + chunk.toString('utf8')).slice(-65536);
    });
    child.once('error', reject);
    child.once('close', (code, signal) =>
      code === 0
        ? resolveRun()
        : reject(new Error(`${basename(command)} exited ${String(code ?? signal)}; stderr tail: ${stderr}`)),
    );
  });
}
