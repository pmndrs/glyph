/* @workflow {
  "name": "benchmark:labs-sampling-protocol-check",
  "summary": "Prove pinned Labs single-call and fixed untimed warmup reach an isolated worker and reject invalid policies.",
  "requirements": "The pinned @pmndrs/labs 0.9.0 pnpm patch must be installed. Runs only a tiny generated Labs fixture; no Glyph benchmark or package build.",
  "writes": "Temporary fixture results are removed. Optional --output <path> saves a protocol-only JSON receipt."
} */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  assertLabsResultHasNoErrors,
  assertLabsSamplingPolicy,
  assertLabsWarmupPolicy,
} from './support/labs-result.mts';

const benchesRoot = fileURLToPath(new URL('..', import.meta.url));
const labsRoot = realpathSync(resolve(benchesRoot, 'node_modules/@pmndrs/labs/dist'));
const cli = resolve(labsRoot, 'cli/cli.mjs');
const { l: measure } = await import(pathToFileURL(resolve(labsRoot, 'src-DNyOXr2d.mjs')).href);
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && (outputIndex !== 2 || !process.argv[3] || process.argv.length !== 4)) {
  throw new Error('Usage: benchmark:labs-sampling-protocol-check -- --output <path>');
}
if (outputIndex < 0 && process.argv.length !== 2) throw new Error('Unknown protocol-check argument');
const output = outputIndex < 0 ? undefined : resolve(process.argv[3]!);

// Infinite eligibility thresholds make this a deterministic batch-mode control, independent of clock speed.
const tune = {
  batch_threshold: Infinity,
  warmup_threshold: Infinity,
  warmup_samples: 1,
  min_cpu_time: 1e5,
  min_samples: 1,
};
const adaptiveControl = await measure(() => 0, tune);
const fixedControl = await measure(() => 0, { ...tune, batch: false });
assert.equal(adaptiveControl.plan.batch, true);
assert.equal(fixedControl.plan.batch, false);

// The fixed policy runs 20 extra untimed calls even when the ordinary warmup threshold excludes them.
const fixedWarmupTune = {
  ...tune,
  warmup_threshold: -Infinity,
  warmup_samples: 2,
  batch: false,
  fixed_warmup_calls: 20,
  min_cpu_time: 0,
  min_samples: 1,
  heap: null,
  gc: false,
};
let callbackCalls = 0;
let callsBeforeFirstTimedSample: number | undefined;
let paramCalls = 0;
let consumed = 0;
let afterCalls = 0;
let firstResult: number | undefined;
const fixedWarmupFn = await measure(
  async (...values: number[]) => {
    callbackCalls++;
    return values[0];
  },
  {
    ...fixedWarmupTune,
    now: () => {
      callsBeforeFirstTimedSample ??= callbackCalls;
      return 0;
    },
    params: { 0: () => ++paramCalls },
    $consume: () => consumed++,
    $first: (value: number) => {
      firstResult = value;
    },
    after: () => {
      afterCalls++;
    },
  },
);
const expectedCalls = 21 + fixedWarmupFn.plan.samples;
assert.equal(firstResult, 1);
assert.equal(callsBeforeFirstTimedSample, 21);
assert.equal(callbackCalls, expectedCalls);
assert.equal(paramCalls, expectedCalls);
assert.equal(consumed, expectedCalls);
assert.equal(afterCalls, expectedCalls);
assert.equal(fixedWarmupFn.plan.batch, false);
assert.equal(fixedWarmupFn.plan.warmup_calls, 21);
let iteratorCalls = 0;
let iteratorCallsBeforeFirstTimedSample: number | undefined;
const fixedWarmupIter = await measure(
  (context: Iterable<void>) => {
    for (const _ of context) iteratorCalls++;
  },
  {
    ...fixedWarmupTune,
    now: () => {
      iteratorCallsBeforeFirstTimedSample ??= iteratorCalls;
      return 0;
    },
  },
);
assert.equal(iteratorCallsBeforeFirstTimedSample, 21);
assert.equal(iteratorCalls, 21 + fixedWarmupIter.plan.samples);
assert.equal(fixedWarmupIter.plan.batch, false);
assert.equal(fixedWarmupIter.plan.warmup_calls, 21);
let generatorCalls = 0;
let generatorFirst: number | undefined;
let generatorCallsBeforeFirstTimedSample: number | undefined;
const fixedWarmupGenerator = await measure(
  function* (): Generator<() => number, { first: number }, number> {
    const first = yield () => ++generatorCalls;
    generatorFirst = first;
    return { first };
  },
  {
    ...fixedWarmupTune,
    now: () => {
      generatorCallsBeforeFirstTimedSample ??= generatorCalls;
      return 0;
    },
  },
);
assert.equal(generatorCallsBeforeFirstTimedSample, 21);
assert.equal(generatorFirst, 1);
assert.equal(generatorCalls, 21 + fixedWarmupGenerator.plan.samples);
assert.equal(fixedWarmupGenerator.plan.warmup_calls, 21);
let conditionalCalls = 0;
let conditionalCallsBeforeFirstTimedSample: number | undefined;
const conditional = await measure(() => ++conditionalCalls, {
  ...fixedWarmupTune,
  fixed_warmup_calls: undefined,
  warmup_threshold: Infinity,
  now: () => {
    conditionalCallsBeforeFirstTimedSample ??= conditionalCalls;
    return 0;
  },
});
assert.equal(conditionalCallsBeforeFirstTimedSample, 2);
assert.equal(conditional.plan.warmup_calls, 2);
assert.equal(conditionalCalls, 2 + conditional.plan.samples);
let conditionalIterCalls = 0;
let conditionalIterCallsBeforeFirstTimedSample: number | undefined;
const conditionalIter = await measure(
  (context: Iterable<void>) => {
    for (const _ of context) conditionalIterCalls++;
  },
  {
    ...fixedWarmupTune,
    fixed_warmup_calls: undefined,
    warmup_threshold: Infinity,
    now: () => {
      conditionalIterCallsBeforeFirstTimedSample ??= conditionalIterCalls;
      return 0;
    },
  },
);
assert.equal(conditionalIterCallsBeforeFirstTimedSample, 3);
assert.equal(conditionalIter.plan.warmup_calls, 3);
assert.equal(conditionalIterCalls, 3 + conditionalIter.plan.samples);

const fixtureRoot = await mkdtemp(resolve(tmpdir(), 'glyph-labs-policy-proof-'));
try {
  await mkdir(resolve(fixtureRoot, 'bench'), { recursive: true });
  await mkdir(resolve(fixtureRoot, 'node_modules/@pmndrs'), { recursive: true });
  await symlink(resolve(labsRoot, '..'), resolve(fixtureRoot, 'node_modules/@pmndrs/labs'));
  await writeFile(resolve(fixtureRoot, 'package.json'), '{"private":true,"type":"module"}\n');
  const labsImport = pathToFileURL(resolve(labsRoot, 'index.mjs')).href;
  await writeFile(
    resolve(fixtureRoot, 'bench/protocol.bench.ts'),
    `import { bench, group } from '@pmndrs/labs';\ngroup('policy proof', () => { bench('single-call worker route', function* () { let calls = 0; const count = yield () => ++calls; if (count < 1) throw new Error('callback did not run'); }); });\n`,
  );
  await writeFile(
    resolve(fixtureRoot, 'labs.config.ts'),
    `import { defineConfig } from '${labsImport}';\nexport default defineConfig({ benchDir: './bench', resultsDir: './results', blocks: 8, blockTime: 0.001, minSamples: 1, samplingPolicy: 'single-call', warmupPolicy: 'fixed-20' });\n`,
  );
  execFileSync(process.execPath, [cli, 'run', 'protocol', '--name', 'policy-proof', '--blocks', '8', '--force'], {
    cwd: fixtureRoot,
    stdio: 'pipe',
  });
  const result = JSON.parse(
    await readFile(resolve(fixtureRoot, 'results/results/policy-proof.json'), 'utf8'),
  ) as unknown;
  assertLabsResultHasNoErrors(result);
  assertLabsSamplingPolicy(result, 'single-call', 8);
  assertLabsWarmupPolicy(result, 'fixed-20', 8);

  await writeFile(
    resolve(fixtureRoot, 'labs.config.ts'),
    `import { defineConfig } from '${labsImport}';\nexport default defineConfig({ benchDir: './bench', samplingPolicy: 'invalid' });\n`,
  );
  const invalidConfig = spawnSync(process.execPath, [cli, 'list'], { cwd: fixtureRoot, encoding: 'utf8' });
  assert.notEqual(invalidConfig.status, 0);
  assert.match(`${invalidConfig.stdout}${invalidConfig.stderr}`, /Invalid Labs samplingPolicy: invalid/u);

  await writeFile(
    resolve(fixtureRoot, 'labs.config.ts'),
    `import { defineConfig } from '${labsImport}';\nexport default defineConfig({ benchDir: './bench', samplingPolicy: 'adaptive', warmupPolicy: 'fixed-20' });\n`,
  );
  const incompatibleConfig = spawnSync(process.execPath, [cli, 'list'], { cwd: fixtureRoot, encoding: 'utf8' });
  assert.notEqual(incompatibleConfig.status, 0);
  assert.match(`${incompatibleConfig.stdout}${incompatibleConfig.stderr}`, /fixed-20 warmup requires single-call/u);

  const invalidRunner = spawnSync(
    process.execPath,
    [resolve(benchesRoot, 'scripts/run-package-labs.mts'), '--sampling', 'invalid'],
    {
      cwd: benchesRoot,
      encoding: 'utf8',
    },
  );
  assert.notEqual(invalidRunner.status, 0);
  assert.match(`${invalidRunner.stdout}${invalidRunner.stderr}`, /--sampling must be adaptive or single-call/u);
  const incompatibleRunner = spawnSync(
    process.execPath,
    [resolve(benchesRoot, 'scripts/run-package-labs.mts'), '--warmup', 'fixed-20'],
    { cwd: benchesRoot, encoding: 'utf8' },
  );
  assert.notEqual(incompatibleRunner.status, 0);
  assert.match(`${incompatibleRunner.stdout}${incompatibleRunner.stderr}`, /requires --sampling single-call/u);

  const receipt = {
    labsVersion: '0.9.0',
    adaptiveControlBatched: adaptiveControl.plan.batch,
    fixedControlBatched: fixedControl.plan.batch,
    workerSingleCallPlanValidated: true,
    fixedUntimedWarmupCalls: 20,
    functionIteratorAndGeneratorWarmupValidated: true,
    historicalConditionalWarmupValidated: true,
    workerBlocks: 8,
    invalidConfigRejected: true,
    invalidRunnerOptionRejected: true,
    scope: 'Labs protocol correctness fixture; timings are not product performance evidence',
  };
  if (output !== undefined) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
