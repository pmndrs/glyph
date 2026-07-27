import type { AdvancedShapingFontFixture } from './advanced-shaping'
import { BENCHMARK_IPSUM_CONFORMANCE_TEXT, BENCHMARK_IPSUM_TEXT } from './benchmark-ipsum'

export type BenchmarkFontFixture =
  | AdvancedShapingFontFixture
  | 'dot-gothic-16'
  | 'source-serif-4'
  | 'dancing-script'

export type SelectableFontFixture = 'inter' | 'source-serif-4' | 'dancing-script'

export interface BenchmarkFontFixtureDefinition {
  readonly id: SelectableFontFixture
  readonly label: string
  readonly metadata: string
}

export interface AdvancedFontFixtureDefinition {
  readonly id: BenchmarkFontFixture
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

export const SELECTABLE_FONT_FIXTURE_IDS: readonly SelectableFontFixture[] =
  SELECTABLE_FONT_FIXTURES.map(({ id }) => id)

export const ADVANCED_FONT_FIXTURES: readonly AdvancedFontFixtureDefinition[] = [
  { id: 'inter', label: 'Inter Regular', metadata: 'Sans · Latin' },
  { id: 'source-serif-4', label: 'Source Serif 4', metadata: 'Serif · Latin' },
  { id: 'dancing-script', label: 'Dancing Script', metadata: 'Script · Latin' },
  { id: 'amiri', label: 'Amiri Regular', metadata: 'Naskh · Arabic' },
  {
    id: 'noto-sans-devanagari',
    label: 'Noto Sans Devanagari',
    metadata: 'Sans · Devanagari',
  },
  {
    id: 'noto-sans-cjk-showcase',
    label: 'Noto Sans CJK JP',
    metadata: 'Sans · authored Japanese subset',
  },
  { id: 'dot-gothic-16', label: 'DotGothic16', metadata: 'Pixel style · Japanese' },
] as const

export const BENCHMARK_FONT_LABELS: Readonly<Record<BenchmarkFontFixture, string>> = {
  inter: 'Inter Regular 4.1',
  amiri: 'Amiri Regular 1.002',
  'noto-sans-devanagari': 'Noto Sans Devanagari',
  'noto-sans-cjk-showcase': 'Noto Sans CJK JP',
  'dot-gothic-16': 'DotGothic16 Japanese',
  'source-serif-4': 'Source Serif 4 Regular 4.005',
  'dancing-script': 'Dancing Script Regular 3.000',
}

export function selectableFontFixture(value: string): SelectableFontFixture {
  const fixture = SELECTABLE_FONT_FIXTURE_IDS.find((candidate) => candidate === value)
  if (fixture === undefined) throw new TypeError(`Unknown selectable font fixture: ${value}`)
  return fixture
}

export function benchmarkIpsumText(): string {
  return BENCHMARK_IPSUM_TEXT
}

export function conformanceText(): string {
  return BENCHMARK_IPSUM_CONFORMANCE_TEXT
}
