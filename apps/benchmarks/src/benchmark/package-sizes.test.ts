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

  it('reports the future Unicode table entry as unavailable, never zero bytes', () => {
    const entry = report.entries.find((candidate) => candidate.id === 'unicode-properties')
    expect(entry).toEqual({
      id: 'unicode-properties',
      label: 'Unicode property tables',
      status: 'unavailable',
      reason: 'Version-pinned JavaScript tables land with the paragraph engine in milestone 5.',
    })
  })
})
