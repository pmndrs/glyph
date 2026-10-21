/* @workflow {
  "name": "benchmark:labs-sampling-protocol-check",
  "summary": "Prove the pinned Labs single-call policy reaches an isolated worker and rejects invalid policies.",
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

import { assertLabsResultHasNoErrors, assertLabsSamplingPolicy } from './support/labs-result.mts';

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
    `import { defineConfig } from '${labsImport}';\nexport default defineConfig({ benchDir: './bench', resultsDir: './results', blocks: 8, blockTime: 0.001, minSamples: 1, samplingPolicy: 'single-call' });\n`,
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

  await writeFile(
    resolve(fixtureRoot, 'labs.config.ts'),
    `import { defineConfig } from '${labsImport}';\nexport default defineConfig({ benchDir: './bench', samplingPolicy: 'invalid' });\n`,
  );
  const invalidConfig = spawnSync(process.execPath, [cli, 'list'], { cwd: fixtureRoot, encoding: 'utf8' });
  assert.notEqual(invalidConfig.status, 0);
  assert.match(`${invalidConfig.stdout}${invalidConfig.stderr}`, /Invalid Labs samplingPolicy: invalid/u);

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

  const receipt = {
    labsVersion: '0.9.0',
    adaptiveControlBatched: adaptiveControl.plan.batch,
    fixedControlBatched: fixedControl.plan.batch,
    workerSingleCallPlanValidated: true,
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
