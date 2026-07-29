import type { AdvancedShapingFontFixture } from './advanced-shaping';
import { BENCHMARK_IPSUM_CONFORMANCE_TEXT, BENCHMARK_IPSUM_TEXT } from './benchmark-ipsum';

export type BenchmarkFontFixture =
  | AdvancedShapingFontFixture
  | 'dot-gothic-16'
  | 'font-awesome-free-6.7.2'
  | 'source-serif-4'
  | 'dancing-script';

export type SelectableFontFixture = 'inter' | 'source-serif-4' | 'dancing-script';

export const ICON_GRID_FONT_FIXTURE = 'font-awesome-free-6.7.2' as const;

export type LiveWorkloadFontFixtures =
  | {
      readonly kind: 'single';
      readonly primary: BenchmarkFontFixture;
    }
  | {
      readonly kind: 'icon-grid';
      readonly primary: typeof ICON_GRID_FONT_FIXTURE;
      readonly labels: BenchmarkFontFixture;
    };

export interface BenchmarkFontFixtureDefinition {
  readonly id: SelectableFontFixture;
  readonly label: string;
  readonly metadata: string;
}

export interface AdvancedFontFixtureDefinition {
  readonly id: BenchmarkFontFixture;
  readonly label: string;
  readonly metadata: string;
}

export interface RasterConformanceSpecimen {
  readonly text: string;
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
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
] as const;

export const SELECTABLE_FONT_FIXTURE_IDS: readonly SelectableFontFixture[] = SELECTABLE_FONT_FIXTURES.map(
  ({ id }) => id,
);

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
] as const;

export const BENCHMARK_FONT_LABELS: Readonly<Record<BenchmarkFontFixture, string>> = {
  inter: 'Inter Regular 4.1',
  amiri: 'Amiri Regular 1.002',
  'noto-sans-devanagari': 'Noto Sans Devanagari',
  'noto-sans-cjk-showcase': 'Noto Sans CJK JP',
  'dot-gothic-16': 'DotGothic16 Japanese',
  'font-awesome-free-6.7.2': 'Font Awesome Free Solid 6.7.2',
  'source-serif-4': 'Source Serif 4 Regular 4.005',
  'dancing-script': 'Dancing Script Regular 3.000',
};

export function liveWorkloadFontFixtures(workload: string, selected: BenchmarkFontFixture): LiveWorkloadFontFixtures {
  return workload === 'icon-grid'
    ? { kind: 'icon-grid', primary: ICON_GRID_FONT_FIXTURE, labels: selected }
    : { kind: 'single', primary: selected };
}

export function selectableFontFixture(value: string): SelectableFontFixture {
  const fixture = SELECTABLE_FONT_FIXTURE_IDS.find((candidate) => candidate === value);
  if (fixture === undefined) throw new TypeError(`Unknown selectable font fixture: ${value}`);
  return fixture;
}

export function benchmarkIpsumText(): string {
  return BENCHMARK_IPSUM_TEXT;
}

export function conformanceText(): string {
  return BENCHMARK_IPSUM_CONFORMANCE_TEXT;
}

const LATIN_RASTER_CONFORMANCE_SPECIMEN: RasterConformanceSpecimen = {
  text: BENCHMARK_IPSUM_CONFORMANCE_TEXT,
  language: 'en',
  direction: 'ltr',
};

const FONT_AWESOME_ICON_SPECIMEN: RasterConformanceSpecimen = {
  text: '\uf004\uf005\uf015\uf007\uf013\uf0e7\uf164\uf1d8\uf121\uf0f4\uf135\uf02d',
  language: 'en',
  direction: 'ltr',
};

const rasterConformanceSpecimens: Readonly<Record<BenchmarkFontFixture, RasterConformanceSpecimen>> = {
  inter: LATIN_RASTER_CONFORMANCE_SPECIMEN,
  'source-serif-4': LATIN_RASTER_CONFORMANCE_SPECIMEN,
  'dancing-script': {
    text: 'The quick brown fox jumps over the lazy dog. AVATAR office affine forms flow.',
    language: 'en',
    direction: 'ltr',
  },
  amiri: {
    text: 'النص العربي يتدفق بوضوح، وتتصل الحروف وتتغير أشكالها مع التشكيل والالتفاف.',
    language: 'ar',
    direction: 'rtl',
  },
  'noto-sans-devanagari': {
    text: 'कर्म क्षेत्र में प्रगति निरंतर चलती है। मात्राएँ सही स्थान पर आती हैं और संयुक्त रूप बदलते हैं।',
    language: 'hi',
    direction: 'ltr',
  },
  'noto-sans-cjk-showcase': {
    text: '文字組版では、空白なしでも自然に改行します。句読点の位置を保ちながら段落が伸びていきます。',
    language: 'ja',
    direction: 'ltr',
  },
  'dot-gothic-16': {
    text: '文字組版では、空白なしでも自然に改行します。句読点の位置を保ちながら段落が伸びていきます。',
    language: 'ja',
    direction: 'ltr',
  },
  'font-awesome-free-6.7.2': FONT_AWESOME_ICON_SPECIMEN,
};

export function rasterConformanceSpecimen(fontFixture: BenchmarkFontFixture): RasterConformanceSpecimen {
  return rasterConformanceSpecimens[fontFixture];
}
