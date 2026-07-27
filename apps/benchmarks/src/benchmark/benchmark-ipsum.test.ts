import { describe, expect, it } from 'vitest'

import {
  BENCHMARK_IPSUM_CONFORMANCE_LINES,
  BENCHMARK_IPSUM_CONFORMANCE_TEXT,
  BENCHMARK_IPSUM_INTER_GLYPH_COUNT,
  BENCHMARK_IPSUM_PARAGRAPHS,
  BENCHMARK_IPSUM_TEXT,
} from './benchmark-ipsum'

describe('benchmark ipsum', () => {
  it('keeps five independently diagnosable conformance lanes', () => {
    expect(BENCHMARK_IPSUM_CONFORMANCE_LINES).toHaveLength(5)
    expect(BENCHMARK_IPSUM_CONFORMANCE_TEXT).toBe(BENCHMARK_IPSUM_CONFORMANCE_LINES.join('\n'))
  })

  it('provides paragraph-scale benchmark copy with the same diagnostic vocabulary', () => {
    expect(BENCHMARK_IPSUM_PARAGRAPHS).toHaveLength(5)
    expect(BENCHMARK_IPSUM_TEXT.length).toBeGreaterThan(1_000)
    expect(BENCHMARK_IPSUM_TEXT).toBe(BENCHMARK_IPSUM_PARAGRAPHS.join('\n\n'))
    expect(BENCHMARK_IPSUM_TEXT).toContain('AVATAR To Wa Yo')
    expect(BENCHMARK_IPSUM_TEXT).toContain('ff, fi, fl, ffi, and ffl')
    expect(BENCHMARK_IPSUM_TEXT).toContain('0123456789')
    expect(BENCHMARK_IPSUM_TEXT).toContain('x²+y²≈z²')
    expect(BENCHMARK_IPSUM_INTER_GLYPH_COUNT).toBe(1_151)
  })
})
