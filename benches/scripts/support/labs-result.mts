import { readFile } from 'node:fs/promises';

interface LabsRun {
  readonly error?: unknown;
  readonly name?: unknown;
}

interface LabsBenchmark {
  readonly alias?: unknown;
  readonly runs?: unknown;
}

interface LabsFile {
  readonly benchmarks?: unknown;
  readonly file?: unknown;
}

export async function assertLabsResultSucceeded(path: string): Promise<void> {
  const result: unknown = JSON.parse(await readFile(path, 'utf8'));
  assertLabsResultHasNoErrors(result);
}

export function assertLabsResultHasNoErrors(result: unknown): void {
  if (!isRecord(result) || !Array.isArray(result.files)) {
    throw new TypeError('Labs result is missing its files array');
  }

  const failures: string[] = [];
  let runCount = 0;
  for (const file of result.files) {
    if (!isRecord(file) || !Array.isArray((file as LabsFile).benchmarks)) continue;
    for (const benchmark of (file as LabsFile).benchmarks as unknown[]) {
      if (!isRecord(benchmark) || !Array.isArray((benchmark as LabsBenchmark).runs)) continue;
      for (const run of (benchmark as LabsBenchmark).runs as unknown[]) {
        runCount += 1;
        if (!isRecord(run) || (run as LabsRun).error === undefined) continue;
        failures.push(
          `${displayName((file as LabsFile).file, '<unknown file>')} / ${displayName(
            (benchmark as LabsBenchmark).alias,
            '<unknown benchmark>',
          )} / ${displayName((run as LabsRun).name, '<unknown run>')}: ${displayError((run as LabsRun).error)}`,
        );
      }
    }
  }

  if (runCount === 0) throw new Error('Labs result did not contain any benchmark runs');
  if (failures.length !== 0) {
    throw new Error(`Labs recorded ${String(failures.length)} benchmark error(s):\n${failures.join('\n')}`);
  }
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
