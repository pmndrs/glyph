/**
 * The strings the line-breaking scene draws. The M PLUS 1p subset in
 * `docs/assets/fonts/styling/mplus1p-cjk.font.glb` is baked to exactly these
 * code points by `site/scripts/bake-styling-fonts.mts`.
 */

/** The opening of Natsume Soseki's "I Am a Cat" (1905, public domain). */
export const JAPANESE = '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。';

/** Japanese with Latin words: breaks between ideographs and kana, at spaces in Latin, never inside a Latin word. */
export const MIXED = '猫は cat、犬は dog、鳥は bird と言う。';

export const CJK_TEXT = [JAPANESE, MIXED].join(' ');
