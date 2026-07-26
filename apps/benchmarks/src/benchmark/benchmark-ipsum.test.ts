import { describe, expect, it } from 'vitest'

import { BENCHMARK_IPSUM_LINES, BENCHMARK_IPSUM_TEXT } from './benchmark-ipsum'

describe('benchmark ipsum', () => {
  it('keeps its five independently diagnosable shaping lanes', () => {
    expect(BENCHMARK_IPSUM_LINES).toHaveLength(5)
    expect(BENCHMARK_IPSUM_TEXT).toBe(BENCHMARK_IPSUM_LINES.join('\n'))
  })

  it('retains the intended ligature, kerning, numeral, and math probes', () => {
    expect(BENCHMARK_IPSUM_TEXT).toContain('AVATAR To Wa Yo')
    expect(BENCHMARK_IPSUM_TEXT).toContain('ff fi fl ffi ffl')
    expect(BENCHMARK_IPSUM_TEXT).toContain('0123456789')
    expect(BENCHMARK_IPSUM_TEXT).toContain('x²+y²≈z²; 0≤α≤1; ±×÷∞√∑π→←')
  })
})
