import { describe, expect, it } from 'vitest'
import report from '../generated/package-sizes.json'

describe('independent package-size report', () => {
  it('contains nonzero public core, baker JavaScript, and baker Wasm measurements', () => {
    for (const id of ['browser-core', 'portable-baker-js', 'portable-baker-wasm']) {
      const entry = report.entries.find((candidate) => candidate.id === id)
      expect(entry?.status).toBe('measured')
      if (entry?.status !== 'measured') throw new Error(`Missing measured size entry: ${id}`)
      expect(entry.rawBytes).toBeGreaterThan(0)
      expect(entry.minifiedBytes).toBeGreaterThan(0)
      expect(entry.gzipBytes).toBeGreaterThan(0)
      expect(entry.brotliBytes).toBeGreaterThan(0)
    }
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
