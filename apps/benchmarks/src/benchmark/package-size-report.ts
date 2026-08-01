import { packageSizeBudgets } from './package-size-budgets.ts';

interface MeasurementHost {
  readonly platform: string;
  readonly architecture: string;
}

interface SizeEntry {
  readonly id: string;
  readonly status: string;
  readonly format?: string;
  readonly sha256?: string;
  readonly rawBytes?: number;
  readonly minifiedBytes?: number;
  readonly gzipBytes?: number;
  readonly brotliBytes?: number;
}

export interface PackageSizeReport {
  readonly schemaVersion: number;
  readonly measurementHost: MeasurementHost;
  readonly entries: readonly SizeEntry[];
}

export function assertPackageSizeReportFresh(committed: PackageSizeReport, current: PackageSizeReport): void {
  const sameHost =
    committed.measurementHost.platform === current.measurementHost.platform &&
    committed.measurementHost.architecture === current.measurementHost.architecture;
  const committedById = new Map(committed.entries.map((entry) => [entry.id, entry]));
  const comparable = sameHost
    ? current
    : {
        ...current,
        measurementHost: committed.measurementHost,
        entries: current.entries.map((entry) => committedById.get(entry.id) ?? entry),
      };
  if (JSON.stringify(comparable) !== JSON.stringify(committed)) {
    throw new Error(
      `generated package-size report is stale; run pnpm size\n${JSON.stringify({
        committedHost: committed.measurementHost,
        currentHost: current.measurementHost,
        committedEntries: committed.entries,
        currentEntries: current.entries,
      })}`,
    );
  }
  if (sameHost) return;

  for (const entry of current.entries) {
    if (entry.status !== 'measured') continue;
    const budget = packageSizeBudgets[entry.id as keyof typeof packageSizeBudgets];
    if (budget === undefined) {
      throw new Error(`foreign-host measurement has no reviewed ${entry.id} budget`);
    }
    if (
      entry.rawBytes === undefined ||
      entry.sha256 === undefined ||
      !/^[0-9a-f]{64}$/.test(entry.sha256) ||
      entry.minifiedBytes === undefined ||
      entry.gzipBytes === undefined ||
      entry.brotliBytes === undefined
    ) {
      throw new Error(`foreign-host measurement is incomplete for ${entry.id}`);
    }
    if (
      entry.rawBytes > budget.rawBytes ||
      entry.minifiedBytes > budget.minifiedBytes ||
      entry.gzipBytes > budget.gzipBytes ||
      entry.brotliBytes > budget.brotliBytes
    ) {
      throw new Error(`foreign-host measurement exceeds the reviewed ${entry.id} budget`);
    }
  }
}
