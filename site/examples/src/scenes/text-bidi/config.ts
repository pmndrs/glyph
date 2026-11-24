/**
 * The strings the bidirectional scene draws. The Amiri subset in
 * `docs/assets/fonts/styling/amiri-arabic.font.glb` is baked to exactly these
 * code points (see `site/scripts/bake-styling-fonts.mts`), so a new character
 * here needs a re-bake.
 */

/** "Hello, world" — the right-to-left run every row shares. */
export const HELLO = 'مرحبا بالعالم';

/** Starts with a Latin letter, so `direction: 'auto'` resolves left to right. */
export const MIXED = `glyph: ${HELLO} (hello)`;

/** Sea, sand, salt, flag, dream, work: enough words to overflow one line. */
export const LONG = `${HELLO} بحر رمل ملح علم حلم عمل`;

export const BIDI_TEXT = [HELLO, MIXED, LONG, '…'].join(' ');
