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

  it('keeps foreign-host Wasm variance bounded without hiding JavaScript drift', () => {
    const foreign = structuredClone(report)
    foreign.measurementHost = { platform: 'linux', architecture: 'x64' }
    const foreignShaper = foreign.entries.find(({ id }) => id === 'text-shaper-wasm')
    const foreignBaker = foreign.entries.find(({ id }) => id === 'portable-baker-wasm')
    if (foreignShaper?.status !== 'measured' || foreignBaker?.status !== 'measured') {
      throw new Error('Missing foreign-host Wasm measurements')
    }
    Object.assign(foreignShaper, {
      rawBytes: 692_111,
      minifiedBytes: 692_111,
      gzipBytes: 258_524,
      brotliBytes: 202_634,
    })
    Object.assign(foreignBaker, {
      rawBytes: 433_755,
      minifiedBytes: 433_755,
      gzipBytes: 168_266,
      brotliBytes: 136_961,
    })
    expect(() => assertPackageSizeReportFresh(report, foreign)).not.toThrow()

    const changedJavaScript = structuredClone(foreign)
    const browserCore = changedJavaScript.entries.find(({ id }) => id === 'browser-core')
    if (browserCore?.status !== 'measured') throw new Error('Missing browser-core measurement')
    browserCore.minifiedBytes += 1
    expect(() => assertPackageSizeReportFresh(report, changedJavaScript)).toThrow(/stale/)

    const oversizedWasm = structuredClone(foreign)
    const shaper = oversizedWasm.entries.find(({ id }) => id === 'text-shaper-wasm')
    if (shaper?.status !== 'measured') throw new Error('Missing text-shaper-wasm measurement')
    shaper.minifiedBytes = packageSizeBudgets['text-shaper-wasm'].minifiedBytes + 1
    expect(() => assertPackageSizeReportFresh(report, oversizedWasm)).toThrow(/exceeds/)
  })
})
