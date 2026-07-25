import { describe, expect, it } from 'vitest'
import report from '../generated/package-sizes.json'

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
})
