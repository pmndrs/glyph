/**
 * Stable product-demo corpus for native-strike rendering checks.
 *
 * Keep each concern on its own line so a visual failure can be localized without
 * changing the corpus. The checked font fixture must cover every scalar.
 */
export const BENCHMARK_IPSUM_CONFORMANCE_LINES = [
  'Lorem ipsum dolor sit amet.',
  'Hamburgefontsiv 0123456789.',
  'AVATAR To Wa Yo — “quotes”.',
  'ff fi fl ffi ffl; (brackets).',
  'x²+y²≈z²; 0≤α≤1; ±×÷∞√∑π→←.',
] as const

export const BENCHMARK_IPSUM_CONFORMANCE_TEXT = BENCHMARK_IPSUM_CONFORMANCE_LINES.join('\n')

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
] as const

export const BENCHMARK_IPSUM_TEXT = BENCHMARK_IPSUM_PARAGRAPHS.join('\n\n')

/** Latin-only companion for display faces whose intentional coverage omits Greek and math. */
export const DISPLAY_FACE_IPSUM_PARAGRAPHS = [
  'Typography moves through a responsive page as every word remains shaped, measured, and drawn. AVATAR To Wa Yo repeat familiar kerning pairs while office, affine, difficult, and shuffle retain common ligature candidates.',
  'A practical interface mixes prose with 0123456789, prices such as 24.50, sizes from 8 to 512 px, and punctuation: “quotes”, parentheses, brackets, commas, dashes, and semicolons. The text stays readable while its container changes.',
  'Script lettering tests joins, rhythm, texture, and the spaces between words. A lively display face should still wrap into paragraphs, align against a changing measure, and preserve the author’s sentence as the renderer updates.',
  'Real text is rarely one centered label. It reflows beside controls, survives narrow and wide containers, and remains visible while the scene reports startup, retained bytes, CPU frame time, GPU frame time, and frames per second.',
  'Performance is experienced as motion, response, and stability. This workload repeats ordinary Latin shapes on purpose so shaping, layout, caching, batching, and steady-state rendering costs stay visible to the reader.',
] as const

export const DISPLAY_FACE_IPSUM_TEXT = DISPLAY_FACE_IPSUM_PARAGRAPHS.join('\n\n')

export const DISPLAY_FACE_CONFORMANCE_TEXT = [
  'Typography moves in measured lines.',
  'Hamburgefontsiv 0123456789.',
  'AVATAR To Wa Yo — “quotes”.',
  'ff fi fl ffi ffl; (brackets).',
  'Office affine difficult shuffle.',
].join('\n')

/** Exact rendered glyph count for the pinned Inter 4.1 fixture with default features. */
export const BENCHMARK_IPSUM_INTER_GLYPH_COUNT = 1_151
