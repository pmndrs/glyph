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
  assert.match(stdout, /release:size:generate\n/);
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
  assert.equal(selectPackageLabsSuite({ eventName: 'pull_request', labels: ['benchmark:edit'] }), 'edit');
  assert.equal(
    selectPackageLabsSuite({ eventName: 'pull_request', labels: ['benchmark:read-publication'] }),
    'read-publication',
  );
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

test('renders a forest plot, slower-first table, and details from mixed results', () => {
  const row = (status: 'faster' | 'slower' | 'neutral', name: string, delta: number, ci: string) => ({
    status,
    name,
    baseline: '1.00ms',
    candidate: '1.10ms',
    delta,
    p: '.002',
    ci,
  });
  const markdown = renderLabsSummary({
    suite: 'edit',
    baseline: '0.1.0 (aaaaaaaa)',
    candidate: '0.1.1 (bbbbbbbb)',
    comparison: {
      rows: [
        row('faster', 'quick', -10.3, '-14.0..-6.0%'),
        row('neutral', 'same | pipe', 8, '-6.0..+20.0%'),
        row('slower', 'slow', 12, '+7.0..+18.0%'),
        row('slower', 'slowest', 31, '+20.0..+44.0%'),
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

  // A diff block colours `-` rows red and `+` rows green on GitHub; neutral rows stay plain.
  const plot = plotLines(markdown);
  assert.deepEqual(
    plot.slice(1, 5).map((line) => [line[0], line.slice(2, 13).trim()]),
    [
      ['-', 'slowest'],
      ['-', 'slow'],
      ['+', 'quick'],
      [' ', 'same | pipe'],
    ],
  );
  assert.match(plot[0]!, /faster ◀ +┊ +▶ slower +Δ p50 +p$/u);
  assert.match(plot[1]!, /├─+●─+┤ +\+31\.0% +\.002$/u);
  assert.match(plot[4]!, /├─*┼─*●─*┤/u, 'an interval across zero keeps the zero line');
  assert.equal(plot.at(-1)!.trim(), '-45%           0           +45%');
  assert.ok(markdown.includes('<details><summary>1 neutral, 1 skipped</summary>'));
  assert.ok(markdown.includes('same \\| pipe'));
  assert.ok(markdown.includes('skipped: clock-confounded: faster→neutral · 2.68→2.93'));
});

test('plots neutral-only results and carries Labs sparklines', async () => {
  const comparison = parseLabsComparison(await fixture('neutral'), [longParagraph, longFredoka, longPublish]);
  assert.deepEqual(
    comparison.rows.map((row) => [row.baselineSpark, row.candidateSpark]),
    [
      ['▂█▅▁▁▁▁▁▁▁', '▁▆█▃▂▂▁▁▁▁'],
      ['▂█▇▄▃▁▁▁▁▁', '▁▆█▆▄▃▁▁▁▁'],
      ['▃██▄▂▁▁▁▁▁', '▃██▅▂▁▁▁▁▁'],
    ],
  );
  const markdown = renderLabsSummary({ suite: 'edit', baseline: 'a', candidate: 'b', comparison });
  assert.ok(markdown.includes('All 3 compared benches are neutral.'));
  assert.ok(markdown.includes('<details><summary>3 neutral, 0 skipped</summary>'));
  const plot = plotLines(markdown);
  assert.ok(
    plot.slice(1, 4).every((line) => line.startsWith('  ')),
    'neutral rows are never coloured',
  );
  assert.match(plot[0]!, /baseline +candidate$/u);
  assert.match(plot[1]!, /▂█▅▁▁▁▁▁▁▁ ▁▆█▃▂▂▁▁▁▁$/u);
});

test('hoists a shared name prefix, shortens long names in the middle, and caps the axis', () => {
  const slow = (name: string, delta: number, ci: string) => ({
    status: 'slower' as const,
    name,
    baseline: '1ms',
    candidate: '2ms',
    delta,
    p: '.001',
    ci,
  });
  const shared = renderLabsSummary({
    suite: 'edit',
    baseline: 'a',
    candidate: 'b',
    comparison: {
      rows: [slow(longParagraph, 12, '+8.0..+16.0%'), slow(longFredoka, 9, '+6.0..+12.0%')],
      skipped: [],
      warnings: [],
    },
  });
  assert.ok(shared.includes('Every bench below starts with “type one character into a long”.'));
  assert.deepEqual(
    plotLines(shared)
      .slice(1, 3)
      .map((line) => line.slice(2, 32).trimEnd()),
    ['…paragraph and measure', '…Fredoka paragraph and measure'],
  );

  const long =
    'layout across a very long mixed-script paragraph with many words, spans, and runs, and a distinct ending';
  const noisy = renderLabsSummary({
    suite: 'edit',
    baseline: 'a',
    candidate: 'b',
    comparison: {
      rows: [slow(long, 140, '+60.0..+300.0%'), slow('x', 4, '+1.0..+7.0%')],
      skipped: [],
      warnings: [],
    },
  });
  const plot = plotLines(noisy);
  const name = plot[1]!.slice(2, 62);
  assert.equal(name.length, 60);
  assert.ok(name.startsWith('layout across') && name.trimEnd().endsWith('distinct ending') && name.includes('…'));
  assert.ok(plot[1]!.includes('┊              ▶'), 'a bench past the capped axis draws as an arrow at its edge');
  assert.ok(!plot[1]!.includes('●') && !plot[1]!.includes('├'));
  assert.equal(plot.at(-1)!.trim(), '-50%           0           +50%');
});

/** The lines inside the summary's ```diff block, header first and the tick labels last. */
function plotLines(markdown: string): string[] {
  const lines = markdown.split('\n');
  const start = lines.indexOf('```diff');
  return lines.slice(start + 1, lines.indexOf('```', start + 1));
}

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
