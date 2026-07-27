import type { AdvancedShapingFontFixture } from './advanced-shaping'
import {
  BENCHMARK_IPSUM_CONFORMANCE_TEXT,
  BENCHMARK_IPSUM_TEXT,
  DISPLAY_FACE_CONFORMANCE_TEXT,
  DISPLAY_FACE_IPSUM_TEXT,
} from './benchmark-ipsum'

export type BenchmarkFontFixture = AdvancedShapingFontFixture | 'source-serif-4' | 'dancing-script'

export type SelectableFontFixture = 'inter' | 'source-serif-4' | 'dancing-script'

export interface BenchmarkFontFixtureDefinition {
  readonly id: SelectableFontFixture
  readonly label: string
  readonly metadata: string
}

export const SELECTABLE_FONT_FIXTURES: readonly BenchmarkFontFixtureDefinition[] = [
  { id: 'inter', label: 'Inter Regular', metadata: 'Sans · 4.1 · TrueType' },
  {
    id: 'source-serif-4',
    label: 'Source Serif 4',
    metadata: 'Serif · 4.005 · TrueType',
  },
  {
    id: 'dancing-script',
    label: 'Dancing Script',
    metadata: 'Script · 3.000 · CFF',
  },
] as const

export const BENCHMARK_FONT_LABELS: Readonly<Record<BenchmarkFontFixture, string>> = {
  inter: 'Inter Regular 4.1',
  amiri: 'Amiri Regular 1.002',
  'noto-sans-devanagari': 'Noto Sans Devanagari',
  'dot-gothic-16': 'DotGothic16 Japanese',
  'source-serif-4': 'Source Serif 4 Regular 4.005',
  'dancing-script': 'Dancing Script Regular 3.000',
}

export function selectableFontFixture(value: string): SelectableFontFixture {
  switch (value) {
    case 'inter':
    case 'source-serif-4':
    case 'dancing-script':
      return value
    default:
      throw new TypeError(`Unknown selectable font fixture: ${value}`)
  }
}

export function benchmarkIpsumForFont(fontFixture: BenchmarkFontFixture): string {
  return fontFixture === 'dancing-script' ? DISPLAY_FACE_IPSUM_TEXT : BENCHMARK_IPSUM_TEXT
}

export function conformanceTextForFont(fontFixture: BenchmarkFontFixture): string {
  return fontFixture === 'dancing-script'
    ? DISPLAY_FACE_CONFORMANCE_TEXT
    : BENCHMARK_IPSUM_CONFORMANCE_TEXT
}
