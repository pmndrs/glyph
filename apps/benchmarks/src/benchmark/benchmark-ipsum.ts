/**
 * Stable product-demo corpus for native-strike rendering checks.
 *
 * Keep each concern on its own line so a visual failure can be localized without
 * changing the corpus. The checked font fixture must cover every scalar.
 */
export const BENCHMARK_IPSUM_LINES = [
  'Lorem ipsum dolor sit amet.',
  'Hamburgefontsiv 0123456789.',
  'AVATAR To Wa Yo — “quotes”.',
  'ff fi fl ffi ffl; (brackets).',
  'x²+y²≈z²; 0≤α≤1; ±×÷∞√∑π→←.',
] as const

export const BENCHMARK_IPSUM_TEXT = BENCHMARK_IPSUM_LINES.join('\n')
