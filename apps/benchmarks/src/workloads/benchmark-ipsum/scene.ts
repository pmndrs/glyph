import type { BenchmarkFontFixture } from '../../benchmark/font-fixtures';

import type { LiveTextScene } from '../shared/live-text-scene';

/**
 * Stable Benchmark Ipsum workload corpus for native-strike rendering checks.
 *
 * Keep each concern on its own line so a visual failure can be localized without
 * changing the corpus. Missing fixture coverage is reported rather than hidden by
 * substituting different text.
 */
export const BENCHMARK_IPSUM_CONFORMANCE_LINES = [
  'Lorem ipsum dolor sit amet.',
  'Hamburgefontsiv 0123456789.',
  'AVATAR To Wa Yo — “quotes”.',
  'ff fi fl ffi ffl; (brackets).',
  'x²+y²≈z²; 0≤α≤1; ±×÷∞√∑π→←.',
] as const;

export const BENCHMARK_IPSUM_CONFORMANCE_TEXT = BENCHMARK_IPSUM_CONFORMANCE_LINES.join('\n');

/**
 * Paragraph-scale Latin workload for the continuously rendered benchmark surface.
 *
 * This is intentionally meaningful enough to inspect while retaining repeated
 * kerning pairs, ligature candidates, numerals, punctuation, and mathematics.
 * Complex-script universality remains in its separately pinned fixture corpus.
 */
export const BENCHMARK_IPSUM_PARAGRAPHS = [
  'Typography is a moving system. AVATAR To Wa Yo repeat familiar kerning pairs while a responsive panel changes the space around them. The quick visual check is useful, but the benchmark records the cost of shaping, layout, upload, and every rendered frame.',
  'A practical interface mixes prose with 0123456789, prices such as 24.50, ranges from 8–512 px, and punctuation—“quotes”, (parentheses), brackets, commas, and semicolons. Repeated office, affine, difficult, and shuffle words retain ff, fi, fl, ffi, and ffl candidates without claiming that every font substitutes them.',
  'Scientific copy adds x²+y²≈z², 0≤α≤1, ±×÷∞, √, ∑, and π. Arrows point both ways: → ←. These symbols expose missing coverage, uneven baselines, bad advances, and atlas placement errors that plain alphabet samples can hide.',
  'Real text is rarely one centered label. It wraps into paragraphs, reflows beside controls, survives narrow and wide containers, and stays readable while the scene continues to render. This corpus repeats ordinary shapes on purpose so caches, batching, and steady-state costs become visible.',
  'Performance is experienced as motion, response, and stability. This scene keeps the paragraph visible while it reports startup, retained bytes, shaping and layout work, CPU frame time, GPU frame time when supported, and frames per second across the selected renderer.',
] as const;

export const BENCHMARK_IPSUM_TEXT = BENCHMARK_IPSUM_PARAGRAPHS.join('\n\n');

/** Exact shaped glyph count for the pinned Inter 4.1 fixture with default features. */
export const BENCHMARK_IPSUM_INTER_GLYPH_COUNT = 1_350;

const EMPTY_FONT_FEATURES = [] as const;

/** Projects the paragraph example's authored Text inputs for the live surface. */
export function benchmarkIpsumLiveTextScene(
  fontFixture: BenchmarkFontFixture,
  layoutWidthRatio: number,
): LiveTextScene {
  return {
    anchor: 'center',
    direction: 'ltr',
    expectedGlyphCount: fontFixture === 'inter' ? BENCHMARK_IPSUM_INTER_GLYPH_COUNT : undefined,
    features: EMPTY_FONT_FEATURES,
    fontFixture,
    language: 'en',
    layoutWidthRatio,
    presentation: 'static',
    text: BENCHMARK_IPSUM_TEXT,
    textAlign: 'start',
    timelineTick: undefined,
  };
}
