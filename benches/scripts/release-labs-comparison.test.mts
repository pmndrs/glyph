/* @workflow { "name": "benchmark:release-comparison-check", "summary": "Verify exact-release Labs selection, comparable latency distributions and unsafe-input rejection.", "requirements": "Workspace Node toolchain.", "writes": "stdout" } */
import assert from 'node:assert/strict';
import { cpus } from 'node:os';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

import { packageLabsBaseline } from './support/package-labs-suite.mts';
import { validateSavedPackageLabs } from './support/saved-package-labs.mts';
import { labsRunNames, timingModeDifferences, timingModeMismatches } from './support/labs-result.mts';
import { parseLabsComparison, renderLabsSummary } from './support/labs-summary.mts';

test('pins manual release comparisons while preserving push and PR baselines', () => {
  assert.equal(
    packageLabsBaseline({ eventName: 'workflow_dispatch', requestedVersion: '0.1.0' }),
    '@pmndrs/glyph@0.1.0',
  );
  assert.equal(packageLabsBaseline({ eventName: 'workflow_dispatch', requestedVersion: '' }), '@pmndrs/glyph@canary');
  assert.equal(packageLabsBaseline({ eventName: 'workflow_dispatch' }), '@pmndrs/glyph@canary');
  assert.equal(packageLabsBaseline({ eventName: 'push', requestedVersion: '0.1.0' }), undefined);
  assert.equal(packageLabsBaseline({ eventName: 'pull_request', requestedVersion: '0.1.0' }), '@pmndrs/glyph@canary');
  for (const requestedVersion of ['latest', '^0.1.0', '0.1', '0.1.0 --suite full', '0.1.0; echo bad', '01.1.0']) {
    assert.throws(
      () => packageLabsBaseline({ eventName: 'workflow_dispatch', requestedVersion }),
      /exact stable version/u,
    );
  }
});

function savedFixture() {
  const expected = { version: '0.1.0', sha256: 'exact-package-digest', suite: 'full', blocks: 8 };
  const manifest = {
    ...expected,
    labsVersion: '0.9.0',
    candidate: { version: expected.version, sha256: expected.sha256 },
  };
  const result = {
    git: { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() },
    blocks: 8,
    hardware: { cpu: cpus()[0]!.model.trim(), arch: `${process.arch}-${process.platform}`, runtime: 'node' },
    context: { version: process.versions.node },
    files: [{ file: 'fixture.bench.ts', benchmarks: [{ runs: [{ name: 'fixture' }] }] }],
  };
  return { expected, manifest, result };
}

test('accepts saved timings only for the exact package and matching benchmark environment', () => {
  const { expected, manifest, result } = savedFixture();
  assert.doesNotThrow(() => validateSavedPackageLabs(manifest, result, expected));
  assert.throws(
    () => validateSavedPackageLabs(manifest, result, { ...expected, sha256: 'another-package' }),
    /does not match/u,
  );
  assert.throws(() => validateSavedPackageLabs(manifest, result, { ...expected, suite: 'smoke' }), /does not match/u);
  assert.throws(() => validateSavedPackageLabs(manifest, result, { ...expected, blocks: 4 }), /does not match/u);
  result.hardware.cpu = 'different CPU';
  assert.throws(() => validateSavedPackageLabs(manifest, result, expected), /do not compare/u);
});

test('rejects saved candidate benchmark failures', () => {
  const { expected, manifest, result } = savedFixture();
  const failed = {
    ...result,
    files: [{ file: 'bad.bench.ts', benchmarks: [{ runs: [{ name: 'bad', error: 'failed' }] }] }],
  };
  assert.throws(() => validateSavedPackageLabs(manifest, failed, expected), /benchmark error/u);
});

test('excludes incompatible timing modes from counts and plots while preserving comparable rows', () => {
  const name = 'write one paragraph and text mutation';
  const result = (batch: boolean) => ({
    files: [
      {
        file: 'request-arena.bench.ts',
        benchmarks: [
          {
            alias: 'write',
            runs: [
              { name, stats: { plan: { batch } } },
              { name: 'comparable control', stats: { plan: { batch: true } } },
            ],
          },
        ],
      },
    ],
  });
  const baseline = result(true);
  const candidate = result(false);
  const report = [
    `  ▼ ${name} 11.28µs 60.63µs +437.4% +0.0% <.001 +396.7..+476.9%`,
    '  ■ comparable control 1.00ms 1.00ms +0.0% +0.0% 1.000 -1.0..+1.0%',
  ].join('\n');
  assert.deepEqual(timingModeMismatches(baseline, candidate), [
    `request-arena.bench.ts / write / ${name}: baseline batched, candidate single-call`,
  ]);
  const comparison = parseLabsComparison(
    report,
    labsRunNames(candidate),
    timingModeDifferences(baseline, candidate).map((difference) => difference.name),
  );
  assert.deepEqual(
    comparison.rows.map((row) => row.name),
    ['comparable control'],
  );
  assert.deepEqual(comparison.skipped, [{ name, reason: 'timing-mode mismatch' }]);
  const summary = renderLabsSummary({ suite: 'full', baseline: '0.1.0', candidate: 'main', comparison });
  assert.match(summary, /0 faster · 0 slower · 1 neutral · 1 skipped/u);
  assert.match(summary, /timing-mode mismatch/u);
  assert.doesNotMatch(summary, /437\.4|60\.63/u);
  assert.equal(parseLabsComparison(report, labsRunNames(candidate)).rows.length, 2);
});

test('reports absolute changes and workload medians without hiding large neutral workloads', () => {
  const report = [
    '  ▼ tiny 1000ns 2us +100.0% +0.0% .001 +90.0..+110.0%',
    '  ▼ small 500µs 1ms +100.0% +0.0% .001 +90.0..+110.0%',
    '  ▼ medium 2ms 3ms +50.0% +0.0% .001 +40.0..+60.0%',
    '  ■ large 4ms 6ms +50.0% +0.0% .100 -10.0..+70.0%',
    '  ▼ incompatible 1s 2s +100.0% +0.0% .001 +90.0..+110.0%',
  ].join('\n');
  const comparison = parseLabsComparison(report, [], ['incompatible']);
  const summary = renderLabsSummary({ suite: 'full', baseline: 'old', candidate: 'new', comparison });
  assert.match(summary, /Latency distribution across 4 comparable workload p50s/u);
  assert.match(summary, /\| Median workload p50 \| 1\.250ms \| 2\.000ms \|/u);
  assert.match(summary, /\| Workloads ≤1 ms \| 2 \| 2 \|/u);
  assert.match(summary, /\| Workloads ≤2 ms \| 3 \| 2 \|/u);
  assert.match(summary, /\| Workloads ≤3 ms \| 3 \| 3 \|/u);
  assert.match(summary, /\| Workloads >3 ms \| 1 \| 1 \|/u);
  assert.match(summary, /\| large \| 4ms \| 6ms \| \+2\.000ms \|/u);
  assert.match(summary, /\| tiny \| 1000ns \| 2us \| \+0\.001ms \|/u);
  assert.match(summary, /not frame times/u);
  assert.ok(summary.indexOf('| large |') < summary.indexOf('| medium |'));
  assert.doesNotMatch(summary, /\| incompatible \| 1s|2s/u);
});

test('handles zero and second-scale medians without manufacturing timings for unsupported values', () => {
  const report = [
    '  ■ zero 0ns 0ns +0.0% +0.0% 1.000 -1.0..+1.0%',
    '  ▼ slow 1s 2s +100.0% +0.0% .001 +90.0..+110.0%',
    '  ■ unknown unavailable unavailable +0.0% +0.0% 1.000 -1.0..+1.0%',
  ].join('\n');
  const summary = renderLabsSummary({
    suite: 'full',
    baseline: 'old',
    candidate: 'new',
    comparison: parseLabsComparison(report, []),
  });
  assert.match(summary, /across 2 comparable workload p50s/u);
  assert.match(summary, /\| Median workload p50 \| 500\.000ms \| 1000\.000ms \|/u);
  assert.match(summary, /\| unknown \| unavailable \| unavailable \|  \|/u);
  assert.doesNotMatch(summary, /NaN|Infinity/u);
});
