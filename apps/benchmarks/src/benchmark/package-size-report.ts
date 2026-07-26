import { packageSizeBudgets } from './package-size-budgets'

interface MeasurementHost {
  readonly platform: string
  readonly architecture: string
}

interface SizeEntry {
  readonly id: string
  readonly status: string
  readonly format?: string
  readonly minifiedBytes?: number
  readonly gzipBytes?: number
  readonly brotliBytes?: number
}

export interface PackageSizeReport {
  readonly schemaVersion: number
  readonly measurementHost: MeasurementHost
  readonly entries: readonly SizeEntry[]
}

export function assertPackageSizeReportFresh(
  committed: PackageSizeReport,
  current: PackageSizeReport,
): void {
  const sameHost =
    committed.measurementHost.platform === current.measurementHost.platform &&
    committed.measurementHost.architecture === current.measurementHost.architecture
  const committedById = new Map(committed.entries.map((entry) => [entry.id, entry]))
  const comparable = sameHost
    ? current
    : {
        ...current,
        measurementHost: committed.measurementHost,
        entries: current.entries.map((entry) =>
          entry.status === 'measured' && entry.format === 'wasm'
            ? (committedById.get(entry.id) ?? entry)
            : entry,
        ),
      }
  if (JSON.stringify(comparable) !== JSON.stringify(committed)) {
    throw new Error('generated package-size report is stale; run pnpm size')
  }
  if (sameHost) return

  for (const entry of current.entries) {
    if (entry.status !== 'measured' || entry.format !== 'wasm') continue
    const budget = packageSizeBudgets[entry.id as keyof typeof packageSizeBudgets]
    if (budget === undefined) {
      throw new Error(`foreign-host Wasm measurement has no reviewed ${entry.id} budget`)
    }
    if (
      entry.minifiedBytes === undefined ||
      entry.gzipBytes === undefined ||
      entry.brotliBytes === undefined
    ) {
      throw new Error(`foreign-host Wasm measurement is incomplete for ${entry.id}`)
    }
    if (
      entry.minifiedBytes > budget.minifiedBytes ||
      entry.gzipBytes > budget.gzipBytes ||
      entry.brotliBytes > budget.brotliBytes
    ) {
      throw new Error(`foreign-host Wasm measurement exceeds the reviewed ${entry.id} budget`)
    }
  }
}
