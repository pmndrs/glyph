/**
 * Four Extended Arabic-Indic digits (U+06F4–U+06F7). Persian, Urdu and Sindhi
 * write the same code points with different shapes; the font's `locl` feature
 * picks the shape from `TextStyle.language`. The Amiri subset is baked to
 * these code points by `site/scripts/bake-styling-fonts.mts`.
 */
export const DIGITS = '۴۵۶۷';

export const LANGUAGES = [
  { language: 'fa', name: 'Persian' },
  { language: 'ur', name: 'Urdu' },
  { language: 'sd', name: 'Sindhi' },
] as const;

export const LANGUAGE_TEXT = DIGITS;
