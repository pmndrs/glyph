import { readFile } from 'node:fs/promises';

/** Which side of a comparison produced a Labs result: the published base, or the package under review. */
export type LabsResultRole = 'baseline' | 'candidate';

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
  const baselineModes = new Map(labeledRuns(baseline).flatMap(({ label, run }) => timingMode(label, run)));
  return labeledRuns(candidate).flatMap(({ label, run }) =>
    timingMode(label, run).flatMap(([, candidateBatched]) => {
      const baselineBatched = baselineModes.get(label);
      if (baselineBatched === undefined || baselineBatched === candidateBatched) return [];
      return [`${label}: baseline ${modeName(baselineBatched)}, candidate ${modeName(candidateBatched)}`];
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
