import type { PackageSizeReport } from './package-size-report.ts';
import { parsePackageSizeReport } from './package-size-report.ts';

export interface PackageSizeBaseline {
  readonly schemaVersion: 1;
  readonly commitSha: string;
  readonly report: PackageSizeReport;
}

export function createPackageSizeBaseline(commitSha: string, report: unknown): PackageSizeBaseline {
  assertCommitSha(commitSha);
  return { schemaVersion: 1, commitSha, report: parsePackageSizeReport(report) };
}

export function parsePackageSizeBaseline(value: unknown, expectedCommitSha: string): PackageSizeBaseline {
  assertCommitSha(expectedCommitSha);
  if (!isObject(value) || value.schemaVersion !== 1 || value.commitSha !== expectedCommitSha) {
    throw new Error(`package-size baseline does not describe commit ${expectedCommitSha}`);
  }
  return createPackageSizeBaseline(value.commitSha, value.report);
}

function assertCommitSha(value: string): void {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error(`invalid package-size baseline commit SHA: ${value}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
