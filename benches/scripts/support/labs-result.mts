import { readFile } from 'node:fs/promises';

/** Which side of a comparison produced a Labs result: the published base, or the package under review. */
export type LabsResultRole = 'baseline' | 'candidate';
export type LabsSamplingPolicy = 'adaptive' | 'single-call';
export type LabsBaselineAvailability = 'complete' | 'published-no-outlines';

const publishedUnavailableOutlines = [
  [
    'outlines.bench.ts',
    'glyph outlines',
    'copy per-glyph metrics with outlines after text change',
    'copy per-glyph metrics with outlines after text change',
    {},
  ],
  [
    'outlines.bench.ts',
    'glyph outlines',
    'read every outline from an unchanged copy',
    'read every outline from an unchanged copy',
    {},
  ],
].map((identity) => JSON.stringify(identity));

/** A full comparison must preserve every candidate identity, except the two declared unavailable published outlines. */
export function assertFullLabsCoverage(
  candidate: unknown,
  baseline: unknown,
  availability: LabsBaselineAvailability,
): void {
  const candidateIdentities = labsIdentitySet(candidate);
  if (candidateIdentities.size !== 145) {
    throw new Error(
      `Full Labs candidate must contain 145 distinct identities; found ${String(candidateIdentities.size)}`,
    );
  }
  if (baseline === undefined) return;
  const expected = new Set(candidateIdentities);
  if (availability === 'published-no-outlines') {
    for (const identity of publishedUnavailableOutlines) {
      if (!expected.delete(identity)) throw new Error('Full Labs candidate is missing a documented outline identity');
    }
  }
  const actual = labsIdentitySet(baseline);
  const missing = [...expected].filter((identity) => !actual.has(identity));
  const extra = [...actual].filter((identity) => !expected.has(identity));
  if (missing.length !== 0 || extra.length !== 0) {
    throw new Error(
      `Full Labs baseline identity coverage mismatch (${availability}): ${String(missing.length)} missing, ${String(extra.length)} extra`,
    );
  }
}

function labsIdentitySet(result: unknown): Set<string> {
  if (!isRecord(result) || !Array.isArray(result.files)) throw new TypeError('Labs result is missing its files array');
  const identities = new Set<string>();
  for (const file of result.files) {
    if (!isRecord(file) || typeof file.file !== 'string' || !Array.isArray(file.benchmarks)) {
      throw new TypeError('Labs result has an invalid file identity');
    }
    for (const benchmark of file.benchmarks) {
      if (
        !isRecord(benchmark) ||
        typeof benchmark.groupName !== 'string' ||
        typeof benchmark.alias !== 'string' ||
        !Array.isArray(benchmark.runs)
      ) {
        throw new TypeError('Labs result has an invalid benchmark identity');
      }
      for (const run of benchmark.runs) {
        if (!isRecord(run) || typeof run.name !== 'string' || !isRecord(run.args) || Array.isArray(run.args)) {
          throw new TypeError('Labs result has an invalid run identity');
        }
        const identity = JSON.stringify([file.file, benchmark.groupName, benchmark.alias, run.name, run.args]);
        if (identities.has(identity)) throw new Error(`Full Labs result has a duplicate identity: ${identity}`);
        identities.add(identity);
      }
    }
  }
  return identities;
}

/** Validate the complete saved worker output when fixed sampling was requested. */
export function assertLabsSamplingPolicy(result: unknown, policy: LabsSamplingPolicy, blocks: number): void {
  if (policy === 'adaptive') return;
  const runs = labeledRuns(result);
  if (runs.length === 0) throw new Error('Labs result did not contain any benchmark runs');
  for (const { label, run } of runs) {
    if (run.error !== undefined) continue;
    if (!isRecord(run.stats) || !isRecord(run.stats.plan) || run.stats.plan.batch !== false) {
      throw new Error(`Labs single-call sampling policy was not applied: ${label}`);
    }
    if (
      !isRecord(run.stats.blocks) ||
      !Array.isArray(run.stats.blocks.medians) ||
      run.stats.blocks.medians.length !== blocks ||
      !run.stats.blocks.medians.every((value): value is number => typeof value === 'number' && Number.isFinite(value))
    ) {
      throw new Error(`Labs result did not retain ${String(blocks)} valid block medians: ${label}`);
    }
  }
}

interface LabsRun {
  readonly error?: unknown;
  readonly name?: unknown;
  readonly stats?: unknown;
}

interface LabsBenchmark {
  readonly alias?: unknown;
  readonly runs?: unknown;
}

interface LabsFile {
  readonly benchmarks?: unknown;
  readonly file?: unknown;
}

interface LabeledRun {
  readonly label: string;
  readonly run: LabsRun;
}

export async function readLabsResult(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function assertLabsResultSucceeded(path: string): Promise<void> {
  assertLabsResultHasNoErrors(await readLabsResult(path));
}

export function assertLabsResultHasNoErrors(result: unknown): void {
  acceptLabsResult(result, 'candidate');
}

/**
 * The candidate must pass every benchmark check. A baseline may fail checks that guard behavior it predates; those
 * workloads have nothing to compare, so they are returned as not comparable rather than aborting the comparison.
 */
export function acceptLabsResult(result: unknown, role: LabsResultRole): readonly string[] {
  const runs = labeledRuns(result);
  if (runs.length === 0) throw new Error('Labs result did not contain any benchmark runs');
  const failures = runs.flatMap(({ label, run }) =>
    run.error === undefined ? [] : [`${label}: ${displayError(run.error)}`],
  );
  if (role === 'candidate' && failures.length !== 0) {
    throw new Error(`Labs recorded ${String(failures.length)} benchmark error(s):\n${failures.join('\n')}`);
  }
  return failures;
}

/**
 * Labs decides per run whether to batch iterations or time single calls, from the cost of the first calls. A workload
 * timed in different modes on each side reports a delta that measures the mode, not the package.
 */
export function timingModeMismatches(baseline: unknown, candidate: unknown): readonly string[] {
  return timingModeDifferences(baseline, candidate).map(
    ({ label, baselineBatched, candidateBatched }) =>
      `${label}: baseline ${modeName(baselineBatched)}, candidate ${modeName(candidateBatched)}`,
  );
}

/** Workload identities whose timing plans differ, before formatting report text. */
export function timingModeDifferences(baseline: unknown, candidate: unknown) {
  const baselineModes = new Map(labeledRuns(baseline).flatMap(({ label, run }) => timingMode(label, run)));
  return labeledRuns(candidate).flatMap(({ label, run }) =>
    timingMode(label, run).flatMap(([, candidateBatched]) => {
      const baselineBatched = baselineModes.get(label);
      if (baselineBatched === undefined || baselineBatched === candidateBatched) return [];
      return [{ label, name: displayName(run.name, '<unknown run>'), baselineBatched, candidateBatched }];
    }),
  );
}

function labeledRuns(result: unknown): readonly LabeledRun[] {
  if (!isRecord(result) || !Array.isArray(result.files)) {
    throw new TypeError('Labs result is missing its files array');
  }
  const runs: LabeledRun[] = [];
  for (const file of result.files) {
    if (!isRecord(file) || !Array.isArray((file as LabsFile).benchmarks)) continue;
    for (const benchmark of (file as LabsFile).benchmarks as unknown[]) {
      if (!isRecord(benchmark) || !Array.isArray((benchmark as LabsBenchmark).runs)) continue;
      for (const run of (benchmark as LabsBenchmark).runs as unknown[]) {
        if (!isRecord(run)) continue;
        const label = `${displayName((file as LabsFile).file, '<unknown file>')} / ${displayName(
          (benchmark as LabsBenchmark).alias,
          '<unknown benchmark>',
        )} / ${displayName((run as LabsRun).name, '<unknown run>')}`;
        runs.push({ label, run: run as LabsRun });
      }
    }
  }
  return runs;
}

function timingMode(label: string, run: LabsRun): readonly (readonly [string, boolean])[] {
  if (!isRecord(run.stats) || !isRecord(run.stats.plan) || typeof run.stats.plan.batch !== 'boolean') return [];
  return [[label, run.stats.plan.batch]];
}

function modeName(batched: boolean): string {
  return batched ? 'batched' : 'single-call';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function displayName(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length !== 0 ? value : fallback;
}

function displayError(value: unknown): string {
  if (isRecord(value) && typeof value.message === 'string') return value.message;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Run names in result order, the full text behind the truncated labels `labs compare` prints. */
export function labsRunNames(result: unknown): readonly string[] {
  return labeledRuns(result).map(({ run }) => displayName(run.name, '<unknown run>'));
}

/** Candidate block medians disambiguate truncated names when another matching run was excluded. */
export function labsRunMedianTimes(result: unknown): ReadonlyMap<string, number> {
  const medians = new Map<string, number>();
  for (const { run } of labeledRuns(result)) {
    if (!isRecord(run.stats) || !isRecord(run.stats.blocks) || !Array.isArray(run.stats.blocks.medians)) continue;
    const values: unknown[] = run.stats.blocks.medians;
    if (
      values.length === 0 ||
      !values.every((value): value is number => typeof value === 'number' && Number.isFinite(value))
    )
      continue;
    const sorted = values.toSorted((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
    medians.set(displayName(run.name, '<unknown run>'), median);
  }
  return medians;
}
