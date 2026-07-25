export function percentile(values: readonly number[], value: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(value * sorted.length) - 1)
  return sorted[Math.max(0, index)] ?? 0
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const high = sorted[middle] ?? 0
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? high) + high) / 2 : high
}
