/* @workflow { "name": "benchmark:workflow-check", "summary": "Verify benchmark workflow discovery, command forwarding, and isolated loopback ports.", "requirements": "Workspace Node toolchain.", "writes": "stdout" } */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { forwardedWorkflowArguments, workflowCommandArguments } from './workflow-arguments.mts';
import { hasVitexecFailure } from './workflow-output.mts';
import { acceptLabsResult, assertLabsResultHasNoErrors, timingModeMismatches } from './support/labs-result.mts';
import { parseLabsComparison, renderLabsSummary, writeLabsSummary } from './support/labs-summary.mts';
import { LOOPBACK_HOST, selectLoopbackPort } from './support/loopback-port.mts';
import { packageLabsComparesWithCanary, selectPackageLabsSuite } from './support/package-labs-suite.mts';
import { packedArchiveDependency } from './support/packed-archive.mts';

const execute = promisify(execFile);
const workflowScript = fileURLToPath(new URL('workflows.mts', import.meta.url));

test('indexes current specialized workflows from source metadata', async () => {
  const { stdout } = await execute(process.execPath, [workflowScript, 'list']);

  assert.match(stdout, /benchmark:presentation\n/);
  assert.match(stdout, /benchmark:labs-package\n/);
  assert.match(stdout, /fixture:harfbuzz:provision\n/);
  assert.match(stdout, /release:size:check\n/);
  assert.doesNotMatch(stdout, /advanced-shaping-performance/);
  assert.doesNotMatch(stdout, /slug-fixed32-performance/);
});

test('describes requirements, writes, and source for one workflow', async () => {
  const { stdout } = await execute(process.execPath, [workflowScript, 'show', 'benchmark:presentation']);

  assert.match(stdout, /Requires: GPU-enabled Chromium and authenticated benchmark fixtures\./);
  assert.match(stdout, /Writes: Ignored browser caches only\./);
  assert.match(stdout, /Source: benches\/scripts\/run-presentation-workload-matrix\.mts/);
});

test('treats Vitexec browser and injected-module errors as workflow failures', () => {
  assert.equal(hasVitexecFailure('logs:\n[log] presentation-ready'), false);
  assert.equal(hasVitexecFailure('logs:\n[error] injected probe failed'), true);
  assert.equal(hasVitexecFailure('logs:\n[page error] renderer failed'), true);
});

test('rejects benchmark-body errors even when Labs exits successfully', () => {
  assert.doesNotThrow(() =>
    assertLabsResultHasNoErrors({
      files: [{ file: 'healthy.bench.ts', benchmarks: [{ runs: [{ name: 'healthy' }] }] }],
    }),
  );
  assert.throws(
    () =>
      assertLabsResultHasNoErrors({
        files: [
          {
            file: 'broken.bench.ts',
            benchmarks: [{ alias: 'layout', runs: [{ name: 'suffix-edit', error: { message: 'memory grew' } }] }],
          },
        ],
      }),
    /broken\.bench\.ts \/ layout \/ suffix-edit: memory grew/u,
  );
  assert.throws(() => assertLabsResultHasNoErrors({ files: [] }), /did not contain any benchmark runs/u);
});

test('lets a baseline fail checks for behavior it predates, but never the candidate', () => {
  const result = {
    files: [
      {
        file: 'adapter.bench.ts',
        benchmarks: [
          { alias: 'reuse', runs: [{ name: 'reuse snapshots', error: { message: 'expected 1000 but got 0' } }] },
          { alias: 'healthy', runs: [{ name: 'healthy' }] },
        ],
      },
    ],
  };

  assert.deepEqual(acceptLabsResult(result, 'baseline'), [
    'adapter.bench.ts / reuse / reuse snapshots: expected 1000 but got 0',
  ]);
  assert.throws(() => acceptLabsResult(result, 'candidate'), /adapter\.bench\.ts \/ reuse \/ reuse snapshots/u);
  assert.throws(() => acceptLabsResult({ files: [] }, 'baseline'), /did not contain any benchmark runs/u);
});

test('reports workloads whose baseline and candidate were timed in different modes', () => {
  const timed = (batch: boolean) => ({
    files: [
      {
        file: 'common.bench.ts',
        benchmarks: [
          { alias: 'publish', runs: [{ name: 'publish after text change', stats: { plan: { batch } } }] },
          { alias: 'measure', runs: [{ name: 'measure after text change', stats: { plan: { batch: true } } }] },
          { alias: 'skipped', runs: [{ name: 'baseline failure', error: { message: 'predates' } }] },
        ],
      },
    ],
  });

  assert.deepEqual(timingModeMismatches(timed(true), timed(true)), []);
  assert.deepEqual(timingModeMismatches(timed(true), timed(false)), [
    'common.bench.ts / publish / publish after text change: baseline batched, candidate single-call',
  ]);
});

test('routes package Labs by event and one explicit pull-request label', () => {
  assert.equal(selectPackageLabsSuite({ eventName: 'pull_request' }), 'smoke');
  assert.equal(
    selectPackageLabsSuite({ eventName: 'pull_request', labels: ['documentation', 'benchmark:layout'] }),
    'layout',
  );
  assert.equal(selectPackageLabsSuite({ eventName: 'pull_request', labels: ['benchmark:cold'] }), 'cold');
  assert.equal(
    selectPackageLabsSuite({
      eventName: 'pull_request',
      labels: ['benchmark:measure', 'benchmark:full', 'benchmark:stress'],
    }),
    'full',
  );
  assert.equal(selectPackageLabsSuite({ eventName: 'push', ref: 'refs/heads/main' }), 'full');
  assert.equal(selectPackageLabsSuite({ eventName: 'workflow_dispatch', requestedSuite: 'glyphs' }), 'glyphs');
  assert.throws(
    () =>
      selectPackageLabsSuite({
        eventName: 'pull_request',
        labels: ['benchmark:layout', 'benchmark:measure'],
      }),
    /Select one focused benchmark label/u,
  );
  assert.throws(
    () => selectPackageLabsSuite({ eventName: 'workflow_dispatch', requestedSuite: 'unknown' }),
    /Unknown Package Labs suite/u,
  );
  assert.throws(
    () => selectPackageLabsSuite({ eventName: 'pull_request', labels: ['benchmark:typo'] }),
    /Unknown Package Labs suite/u,
  );
});

test('measures a main push alone instead of against the canary released for that push', () => {
  assert.equal(packageLabsComparesWithCanary({ eventName: 'push' }), false);
  assert.equal(packageLabsComparesWithCanary({ eventName: 'pull_request' }), true);
  assert.equal(packageLabsComparesWithCanary({ eventName: 'workflow_dispatch' }), true);
});

test('forwards runner options in the position each runner parses', () => {
  assert.deepEqual(forwardedWorkflowArguments(['--', '--cpu-profile', '/tmp/profile.cpuprofile']), [
    '--cpu-profile',
    '/tmp/profile.cpuprofile',
  ]);
  assert.deepEqual(workflowCommandArguments('node', 'probe.mts', ['--fixed'], ['--samples', '7']), [
    'probe.mts',
    '--fixed',
    '--samples',
    '7',
  ]);
  assert.deepEqual(workflowCommandArguments('vitexec', 'probe.ts', ['--gpu'], ['--cpu-profile', '/tmp/profile']), [
    '--gpu',
    '--cpu-profile',
    '/tmp/profile',
    'probe.ts',
  ]);
});

test('installs the archive emitted by pnpm pack regardless of package version', () => {
  assert.equal(packedArchiveDependency(['pmndrs-glyph-0.1.0.tgz']), 'file:archives/pmndrs-glyph-0.1.0.tgz');
  assert.equal(
    packedArchiveDependency(['pmndrs-glyph-0.0.0-canary-deadbeef-20260918.tgz']),
    'file:archives/pmndrs-glyph-0.0.0-canary-deadbeef-20260918.tgz',
  );
});

test('selects and releases an available loopback port for private Vite servers', async () => {
  const port = await selectLoopbackPort();
  assert.ok(Number.isSafeInteger(port) && port > 0 && port <= 65_535);

  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen({ exclusive: true, host: LOOPBACK_HOST, port }, resolve);
  });
  await new Promise<void>((resolve, reject) => {
    listener.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
});

const fixture = (name: string) =>
  readFile(fileURLToPath(new URL(`support/__fixtures__/labs-compare-${name}.txt`, import.meta.url)), 'utf8');
const longParagraph = 'type one character into a long paragraph and measure';
const longFredoka = 'type one character into a long Fredoka paragraph and measure';
const longPublish = 'type one character into a long paragraph and publish a frame';

test('restores full names and statuses from a real Labs comparison', async () => {
  const slower = parseLabsComparison(await fixture('slower'), [longParagraph, longFredoka, longPublish]);
  assert.deepEqual(
    slower.rows.map(({ status, name, baseline, candidate, delta, p, ci }) => [
      status,
      name,
      baseline,
      candidate,
      delta,
      p,
      ci,
    ]),
    [['slower', longFredoka, '2.79ms', '3.13ms', 12, '.002', '+7.6..+25.8%']],
  );
  assert.deepEqual(slower.skipped, [
    { name: longParagraph, reason: 'clock-confounded: slower→neutral · 2.95→2.73' },
    { name: longPublish, reason: 'clock-confounded: slower→neutral · 2.94→2.73' },
  ]);
  assert.deepEqual(slower.warnings, ['candidate CPU clock drifted 8.4% during its run']);
});

test('renders slower-first table, chart, and details from mixed results', () => {
  const row = (status: 'faster' | 'slower' | 'neutral', name: string, delta: number) => ({
    status,
    name,
    baseline: '1.00ms',
    candidate: '1.10ms',
    delta,
    p: '.002',
    ci: '+1.0..+9.0%',
  });
  const markdown = renderLabsSummary({
    suite: 'edit',
    baseline: '0.1.0 (aaaaaaaa)',
    candidate: '0.1.1 (bbbbbbbb)',
    comparison: {
      rows: [
        row('faster', 'quick', -10.3),
        row('neutral', 'same | pipe', 1.2),
        row('slower', 'slow', 12),
        row('slower', 'slowest', 31),
      ],
      skipped: [{ name: 'noisy', reason: 'clock-confounded: faster→neutral · 2.68→2.93' }],
      warnings: [],
    },
  });
  const lines = markdown.split('\n');
  assert.equal(lines[0], '## Package performance: `edit` suite');
  assert.equal(lines[2], '1 faster · 2 slower · 1 neutral · 1 skipped');
  const order = lines.filter((line) => /^\| (🔴|🟢)/u.test(line)).map((line) => line.split(' | ')[1]);
  assert.deepEqual(order, ['slowest', 'slow', 'quick']);
  assert.ok(markdown.includes('  x-axis ["slowest", "slow", "quick"]'));
  assert.ok(markdown.includes('  y-axis "% vs baseline (positive = slower)" -35 --> 35'));
  assert.ok(markdown.includes('  bar [31, 12, -10.3]'));
  assert.ok(markdown.includes('<details><summary>1 neutral, 1 skipped</summary>'));
  assert.ok(markdown.includes('same \\| pipe'));
  assert.ok(markdown.includes('skipped: clock-confounded: faster→neutral · 2.68→2.93'));
});

test('omits the chart when every bench is neutral', async () => {
  const comparison = parseLabsComparison(await fixture('neutral'), [longParagraph, longFredoka, longPublish]);
  const markdown = renderLabsSummary({ suite: 'edit', baseline: 'a', candidate: 'b', comparison });
  assert.ok(markdown.includes('All 3 compared benches are neutral.'));
  assert.ok(!markdown.includes('mermaid'));
  assert.ok(markdown.includes('<details><summary>3 neutral, 0 skipped</summary>'));
});

test('keeps Mermaid labels short, unique, and free of quote-breaking characters', () => {
  const slow = (name: string) => ({
    status: 'slower' as const,
    name,
    baseline: '1ms',
    candidate: '2ms',
    delta: 100,
    p: '.001',
    ci: '+1..+2%',
  });
  const long = 'layout "wide" [rtl], mixed {scripts} paragraph with many words';
  const markdown = renderLabsSummary({
    suite: 'edit',
    baseline: 'a',
    candidate: 'b',
    comparison: { rows: [slow(long), slow(long), slow('x')], skipped: [], warnings: [] },
  });
  const axis = markdown.split('\n').find((line) => line.startsWith('  x-axis '))!;
  const labels = [...axis.matchAll(/"([^"]*)"/gu)].map((match) => match[1]!);
  assert.equal(labels.length, 3);
  assert.equal(new Set(labels).size, 3);
  for (const label of labels) assert.ok(label.length <= 32 && !/[[\],]/u.test(label));
  assert.ok(markdown.includes('--> 100'));
});

test('appends to the Actions job summary only when it is configured', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'labs-summary-'));
  try {
    const jobSummary = join(directory, 'step-summary.md');
    await writeFile(jobSummary, 'earlier\n');
    await writeLabsSummary('first', directory, {});
    assert.equal(await readFile(join(directory, 'summary.md'), 'utf8'), 'first');
    assert.equal(await readFile(jobSummary, 'utf8'), 'earlier\n');
    await writeLabsSummary('second', directory, { GITHUB_STEP_SUMMARY: jobSummary });
    assert.equal(await readFile(join(directory, 'summary.md'), 'utf8'), 'second');
    assert.equal(await readFile(jobSummary, 'utf8'), 'earlier\nsecond\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
