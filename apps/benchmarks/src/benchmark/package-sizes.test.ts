import { describe, expect, it } from 'vitest'
import report from '../generated/package-sizes.json'
import { packageSizeBudgets } from './package-size-budgets'
import { assertPackageSizeReportFresh } from './package-size-report'

describe('independent package-size report', () => {
  it('contains nonzero public core, baker JavaScript, and baker Wasm measurements', () => {
    for (const id of [
      'browser-core',
      'font-validator-js',
      'runtime-baker-host-js',
      'runtime-baker-worker-js',
      'text-shaper-js',
      'text-shaper-wasm',
      'mtsdf-generator-js',
      'mtsdf-generator-wasm',
      'portable-baker-js',
      'portable-baker-wasm',
      'unicode-analysis-js',
    ]) {
      const entry = report.entries.find((candidate) => candidate.id === id)
      expect(entry?.status).toBe('measured')
      if (entry?.status !== 'measured') throw new Error(`Missing measured size entry: ${id}`)
      expect(entry.rawBytes).toBeGreaterThan(0)
      expect(entry.minifiedBytes).toBeGreaterThan(0)
      expect(entry.gzipBytes).toBeGreaterThan(0)
      expect(entry.brotliBytes).toBeGreaterThan(0)
    }
  })

  it('enforces every reviewed runtime and Wasm ceiling', () => {
    for (const [id, budget] of Object.entries(packageSizeBudgets)) {
      const entry = report.entries.find((candidate) => candidate.id === id)
      expect(entry?.status).toBe('measured')
      if (entry?.status !== 'measured') throw new Error(`Missing measured size entry: ${id}`)
      expect(entry.rawBytes).toBeLessThanOrEqual(budget.rawBytes)
      expect(entry.minifiedBytes).toBeLessThanOrEqual(budget.minifiedBytes)
      expect(entry.gzipBytes).toBeLessThanOrEqual(budget.gzipBytes)
      expect(entry.brotliBytes).toBeLessThanOrEqual(budget.brotliBytes)
    }
  })

  it('keeps the lazy validator out of the initial browser-core measurement', () => {
    const core = report.entries.find((candidate) => candidate.id === 'browser-core')
    const validator = report.entries.find((candidate) => candidate.id === 'font-validator-js')
    expect(core?.status).toBe('measured')
    expect(validator?.status).toBe('measured')
    if (core?.status !== 'measured' || validator?.status !== 'measured') return
    if (core.minifiedBytes === undefined || validator.minifiedBytes === undefined) {
      throw new Error('Measured entries must contain minified byte counts')
    }
    expect(core.minifiedBytes).toBeLessThan(validator.minifiedBytes)
  })

  it('reports Unicode analysis independently from the initial browser graph', () => {
    const core = report.entries.find((candidate) => candidate.id === 'browser-core')
    const unicode = report.entries.find((candidate) => candidate.id === 'unicode-analysis-js')
    expect(core?.status).toBe('measured')
    expect(unicode?.status).toBe('measured')
    if (core?.status !== 'measured' || unicode?.status !== 'measured') return
    expect(unicode.minifiedBytes).toBeGreaterThan(0)
    expect(core.minifiedBytes).toBeGreaterThan(unicode.minifiedBytes)
  })

  it('keeps foreign-host native-tool variance inside complete reviewed budgets', () => {
    const foreign = structuredClone(report)
    foreign.measurementHost = { platform: 'linux', architecture: 'x64' }
    const linuxX64Measurements = {
      'browser-core': [271_169, 211_199, 62_771, 48_040],
      'font-validator-js': [740_402, 584_255, 137_585, 112_927],
      'runtime-baker-host-js': [5_264, 3_861, 1_480, 1_322],
      'runtime-baker-worker-js': [13_315, 9_010, 3_030, 2_665],
      'text-shaper-js': [43_944, 30_648, 8_798, 7_832],
      'text-shaper-wasm': [692_111, 692_111, 258_524, 202_634],
      'portable-baker-js': [10_046, 6_647, 2_338, 2_060],
      'portable-baker-wasm': [433_755, 433_755, 168_266, 136_961],
      'unicode-analysis-js': [164_786, 139_936, 42_047, 30_989],
    } as const
    for (const [id, [rawBytes, minifiedBytes, gzipBytes, brotliBytes]] of Object.entries(
      linuxX64Measurements,
    )) {
      const entry = foreign.entries.find((candidate) => candidate.id === id)
      if (entry?.status !== 'measured') throw new Error(`Missing foreign-host measurement: ${id}`)
      Object.assign(entry, { rawBytes, minifiedBytes, gzipBytes, brotliBytes })
    }
    expect(() => assertPackageSizeReportFresh(report, foreign)).not.toThrow()

    const changedSameHost = structuredClone(report)
    const browserCore = changedSameHost.entries.find(({ id }) => id === 'browser-core')
    if (browserCore?.status !== 'measured') throw new Error('Missing browser-core measurement')
    browserCore.minifiedBytes += 1
    expect(() => assertPackageSizeReportFresh(report, changedSameHost)).toThrow(/stale/)

    const oversizedForeign = structuredClone(foreign)
    const shaper = oversizedForeign.entries.find(({ id }) => id === 'text-shaper-wasm')
    if (shaper?.status !== 'measured') throw new Error('Missing text-shaper-wasm measurement')
    shaper.minifiedBytes = packageSizeBudgets['text-shaper-wasm'].minifiedBytes + 1
    expect(() => assertPackageSizeReportFresh(report, oversizedForeign)).toThrow(/exceeds/)
  })
})
