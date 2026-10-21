/* @workflow { "name": "benchmark:release-comparison-check", "summary": "Verify exact-release Labs selection, comparable latency distributions and unsafe-input rejection.", "requirements": "Workspace Node toolchain.", "writes": "stdout" } */
import assert from 'node:assert/strict';
import { cpus } from 'node:os';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { packageLabsBaseline } from './support/package-labs-suite.mts';
import {
  assertPackageLabsHarnessUnchanged,
  packageLabsHarnessDigest,
  validateSavedPackageLabs,
} from './support/saved-package-labs.mts';
import {
  acceptLabsResult,
  assertFullLabsCoverage,
  labsRunMedianTimes,
  labsRunNames,
  timingModeDifferences,
  timingModeMismatches,
} from './support/labs-result.mts';
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
  const expected = {
    version: '0.1.0',
    sha256: 'exact-package-digest',
    suite: 'full',
    blocks: 8,
    samplingPolicy: 'adaptive' as const,
  };
  const manifest = {
    ...expected,
    labsVersion: '0.9.0',
    harnessDigest: packageLabsHarnessDigest(),
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

test('retains the timing guard for benchmark inputs while allowing standalone inspector edits', () => {
  const inspectors =
    'benches/labs/package/edit-sized-publication.profile.mts\nbenches/labs/package/adapter-publication.profile.mts\n';
  assert.doesNotThrow(() => assertPackageLabsHarnessUnchanged(inspectors));
  for (const input of [
    'benches/labs/package/edit-sized.bench.ts',
    'benches/labs/package/fixture.ts',
    'benches/labs.config.ts',
    'benches/fixtures/fonts/inter.json',
    'benches/src/runtime.ts',
    'benches/package.json',
    'benches/scripts/run-package-labs.mts',
    'benches/scripts/support/labs-result.mts',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'patches/@pmndrs__labs@0.9.0.patch',
    'benches/labs/package/other.profile.mts',
  ]) {
    assert.throws(() => assertPackageLabsHarnessUnchanged(`${inspectors}${input}\n`), /harness changed/u);
  }
});

test('accepts saved timings only for the exact package and matching benchmark environment', () => {
  const { expected, manifest, result } = savedFixture();
  assert.doesNotThrow(() => validateSavedPackageLabs(manifest, result, expected));
  assert.doesNotThrow(() =>
    validateSavedPackageLabs({ ...manifest, baselineAvailability: 'published-no-outlines' }, result, expected),
  );
  assert.throws(
    () => validateSavedPackageLabs(manifest, result, { ...expected, sha256: 'another-package' }),
    /does not match/u,
  );
  assert.throws(() => validateSavedPackageLabs(manifest, result, { ...expected, suite: 'smoke' }), /does not match/u);
  assert.throws(() => validateSavedPackageLabs(manifest, result, { ...expected, blocks: 4 }), /does not match/u);
  assert.throws(
    () => validateSavedPackageLabs(manifest, result, { ...expected, samplingPolicy: 'single-call' }),
    /does not match/u,
  );
  assert.throws(
    () => validateSavedPackageLabs({ ...manifest, samplingPolicy: undefined }, result, expected),
    /does not match/u,
  );
  assert.throws(
    () => validateSavedPackageLabs({ ...manifest, profiling: { profileTag: '@target' } }, result, expected),
    /Diagnostic profiling results cannot be reused/u,
  );
  result.hardware.cpu = 'different CPU';
  assert.throws(() => validateSavedPackageLabs(manifest, result, expected), /do not compare/u);
});

test('fixed-policy saved reuse requires its digest even when an untracked dependency patch changes', () => {
  const { expected, manifest, result } = savedFixture();
  const fixedExpected = { ...expected, samplingPolicy: 'single-call' as const };
  const fixedManifest = { ...manifest, samplingPolicy: 'single-call' as const };
  const fixedResult = {
    ...result,
    files: [
      {
        file: 'fixture.bench.ts',
        benchmarks: [
          { runs: [{ name: 'fixture', stats: { plan: { batch: false }, blocks: { medians: Array(8).fill(100) } } }] },
        ],
      },
    ],
  };
  assert.doesNotThrow(() => validateSavedPackageLabs(fixedManifest, fixedResult, fixedExpected));
  const previousDirectory = process.cwd();
  const directory = mkdtempSync(join(tmpdir(), 'glyph-labs-fixed-reuse-'));
  try {
    execFileSync('git', ['init', '--quiet', directory]);
    process.chdir(directory);
    mkdirSync('benches/labs/package', { recursive: true });
    mkdirSync('patches', { recursive: true });
    writeFileSync('benches/labs/package/fixture.bench.ts', 'same benchmark');
    execFileSync('git', ['add', 'benches/labs/package/fixture.bench.ts']);
    execFileSync('git', [
      '-c',
      'user.name=Protocol Test',
      '-c',
      'user.email=protocol@example.test',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ]);
    const oldCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    writeFileSync('patches/@pmndrs__labs@0.9.0.patch', 'original untracked patch');
    const saved = { ...fixedManifest, harnessDigest: packageLabsHarnessDigest() };
    const persistedResult = { ...fixedResult, git: { commit: oldCommit } };
    assert.doesNotThrow(() => validateSavedPackageLabs(saved, persistedResult, fixedExpected));
    writeFileSync('patches/@pmndrs__labs@0.9.0.patch', 'changed untracked patch');
    assert.throws(() => validateSavedPackageLabs(saved, persistedResult, fixedExpected), /digest changed/u);
    const withoutDigest: Record<string, unknown> = { ...saved };
    delete withoutDigest.harnessDigest;
    assert.throws(
      () => validateSavedPackageLabs(withoutDigest, persistedResult, fixedExpected),
      /requires a matching/u,
    );
  } finally {
    process.chdir(previousDirectory);
    rmSync(directory, { recursive: true, force: true });
  }
});

test('full suite enforces exact declared baseline identities, including published outline absence', () => {
  const ordinary: {
    file: string;
    groupName: string;
    alias: string;
    runs: { name: string; args: Record<string, unknown>; error?: string }[];
  }[] = Array.from({ length: 143 }, (_, index) => ({
    file: 'fixture.bench.ts',
    groupName: 'fixture',
    alias: `workload ${String(index)}`,
    runs: [{ name: `workload ${String(index)}`, args: {} }],
  }));
  const outlines = [
    'copy per-glyph metrics with outlines after text change',
    'read every outline from an unchanged copy',
  ].map((name) => ({
    file: 'outlines.bench.ts',
    groupName: 'glyph outlines',
    alias: name,
    runs: [{ name, args: {} }],
  }));
  const result = (items: typeof ordinary) => ({
    files: items.map(({ file, groupName, alias, runs }) => ({ file, benchmarks: [{ groupName, alias, runs }] })),
  });
  const candidate = result([...ordinary, ...outlines]);
  const full = result([...ordinary, ...outlines]);
  const published = result(ordinary);
  assert.doesNotThrow(() => assertFullLabsCoverage(candidate, full, 'complete'));
  assert.doesNotThrow(() => assertFullLabsCoverage(candidate, published, 'published-no-outlines'));
  const failedBaseline = result([
    { ...ordinary[0]!, runs: [{ ...ordinary[0]!.runs[0]!, error: 'older API failed check' }] },
    ...ordinary.slice(1),
    ...outlines,
  ]);
  assert.doesNotThrow(() => assertFullLabsCoverage(candidate, failedBaseline, 'complete'));
  assert.equal(acceptLabsResult(failedBaseline, 'baseline').length, 1);
  assert.throws(() => assertFullLabsCoverage(candidate, published, 'complete'), /coverage mismatch/u);
  assert.throws(
    () => assertFullLabsCoverage(candidate, result(ordinary.slice(1)), 'published-no-outlines'),
    /coverage mismatch/u,
  );
  assert.throws(
    () => assertFullLabsCoverage(candidate, result([...ordinary.slice(1), ...outlines]), 'complete'),
    /coverage mismatch/u,
  );
  assert.throws(
    () => assertFullLabsCoverage(result([...ordinary.slice(1), ...outlines]), full, 'complete'),
    /145 distinct/u,
  );
  const wrongOutlines = result([...ordinary, outlines[0]!]);
  assert.throws(() => assertFullLabsCoverage(candidate, wrongOutlines, 'published-no-outlines'), /coverage mismatch/u);
  const unexpected = { ...ordinary[0]!, alias: 'unexpected', runs: [{ name: 'unexpected', args: {} }] };
  assert.throws(
    () => assertFullLabsCoverage(candidate, result([...ordinary.slice(1), ...outlines, unexpected]), 'complete'),
    /coverage mismatch/u,
  );
});

test('saved timing digests track actual edited, added, removed and fixture bytes', () => {
  const { expected, manifest, result } = savedFixture();
  const previousDirectory = process.cwd();
  const directory = mkdtempSync(join(tmpdir(), 'glyph-labs-harness-'));
  try {
    execFileSync('git', ['init', '--quiet', directory]);
    process.chdir(directory);
    mkdirSync('benches/labs/package', { recursive: true });
    mkdirSync('benches/fixtures', { recursive: true });
    mkdirSync('patches', { recursive: true });
    const benchmark = 'benches/labs/package/example.bench.ts';
    const inspector = 'benches/labs/package/edit-sized-publication.profile.mts';
    const fixture = 'benches/fixtures/font with spaces.glb';
    const patch = 'patches/@pmndrs__labs@0.9.0.patch';
    writeFileSync(benchmark, 'original benchmark');
    writeFileSync(inspector, 'standalone inspector');
    writeFileSync(fixture, Buffer.from([0, 1, 255]));
    writeFileSync(patch, 'original dependency patch');
    execFileSync('git', ['add', '-f', benchmark, inspector, fixture, patch]);
    const harnessDigest = packageLabsHarnessDigest();
    process.chdir('benches');
    assert.equal(
      packageLabsHarnessDigest(),
      harnessDigest,
      'harness identity is independent of the workflow directory',
    );
    process.chdir(directory);
    const saved = { ...manifest, harnessDigest };
    assert.doesNotThrow(() => validateSavedPackageLabs(saved, result, expected));
    writeFileSync(inspector, 'changed standalone inspector');
    assert.equal(packageLabsHarnessDigest(), harnessDigest);
    for (const [path, original, changed] of [
      [benchmark, 'original benchmark', 'edited benchmark'],
      [fixture, Buffer.from([0, 1, 255]), Buffer.from([0, 2, 255])],
      [patch, 'original dependency patch', 'edited dependency patch'],
    ] as const) {
      writeFileSync(path, changed);
      assert.throws(() => validateSavedPackageLabs(saved, result, expected), /digest changed/u);
      writeFileSync(path, original);
      assert.equal(packageLabsHarnessDigest(), harnessDigest);
    }
    const added = 'benches/labs/package/helper.ts';
    writeFileSync(added, 'new input');
    assert.notEqual(packageLabsHarnessDigest(), harnessDigest);
    rmSync(added);
    assert.equal(packageLabsHarnessDigest(), harnessDigest);
    rmSync(benchmark);
    assert.throws(() => validateSavedPackageLabs(saved, result, expected), /digest changed/u);
    assert.throws(
      () => validateSavedPackageLabs({ ...manifest, harnessDigest: null }, result, expected),
      /digest changed/u,
    );
  } finally {
    process.chdir(previousDirectory);
    rmSync(directory, { recursive: true, force: true });
  }
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

test('resolves truncated workload collisions from candidate timings instead of assigning a skipped sibling', () => {
  const measure = 'type one character into a long paragraph and measure';
  const publish = 'type one character into a long paragraph and publish a frame';
  const truncated = `${measure.slice(0, 35)}…`;
  const candidate = {
    files: [
      {
        file: 'edit.bench.ts',
        benchmarks: [
          {
            runs: [
              { name: measure, stats: { blocks: { medians: [4_261_000, 4_434_250, 4_551_916, 4_642_834] } } },
              { name: publish, stats: { blocks: { medians: [5_987_209, 6_014_625, 6_219_209, 6_832_541] } } },
            ],
          },
        ],
      },
    ],
  };
  const report = [
    `  ■ ${truncated} 6.49ms 6.12ms -5.8% -36.1% 1.000 -43.6..+21.9%`,
    'skipped (1)',
    `  · ${truncated}  clock-confounded: slower→neutral`,
    'summary',
  ].join('\n');
  const medians = labsRunMedianTimes(candidate);
  const comparison = parseLabsComparison(report, labsRunNames(candidate), [], medians);
  assert.equal(comparison.rows[0]!.name, publish);
  assert.equal(comparison.skipped[0]!.name, measure);
  const ambiguous = parseLabsComparison(
    report,
    [measure, publish],
    [],
    new Map([
      [measure, 6_120_000],
      [publish, 6_120_000],
    ]),
  );
  assert.equal(ambiguous.rows.length, 0, 'an unresolved row cannot bypass full-name timing-mode exclusions');
  assert(ambiguous.skipped.some(({ name, reason }) => name === truncated && reason === 'unresolved workload identity'));
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
