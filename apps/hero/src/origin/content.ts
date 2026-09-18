import type { FaceId } from '../typography/content';

/** The second scene's copy. Kept apart from the first hero's content so neither can quietly reshape the other's bake. */

export const ORIGIN_TITLE = { text: 'GLYPH', face: 'geist-black' } as const;

/**
 * "Glyph", around the world — each language's own word for a letter, a character, a written form, rather than the
 * English word in a different alphabet. Transliterations (グリフ, глиф, ग्लिफ़) were the first cut and read as the same
 * word ten times over; these are native. 字形 is literally "character-form", γράμμα is the Greek for letter, حرف the
 * Arabic. English keeps GLYPH as the anchor the rest are answering.
 *
 * Order is fixed, not shuffled — a recording should be repeatable take to take. English leads, and the rest are
 * interleaved by script so the ideographic words never sit back to back and the Latin ones are spread through
 * rather than clumped. Reordering is safe; nothing keys off position.
 *
 * Faces are per word because no single one covers these scripts: the Noto CJK cut carries Japanese, Chinese, Korean,
 * Greek and Russian, Geist keeps the Latin at display weight, and Arabic and Devanagari come from their own faces.
 */
export interface TitleWord {
  readonly text: string;
  readonly face: FaceId;
  /** Shown only in development, to label what is on screen. */
  readonly language: string;
}

export const TITLE_WORDS: readonly TitleWord[] = [
  { text: 'GLYPH', face: 'geist-black', language: 'English' },
  { text: '文字', face: 'noto-cjk-words', language: 'Japanese' },
  { text: 'буква', face: 'noto-cjk-words', language: 'Russian' },
  { text: '字形', face: 'noto-cjk-words', language: 'Chinese' },
  { text: 'ZEICHEN', face: 'geist-black', language: 'German' },
  { text: '글자', face: 'noto-cjk-words', language: 'Korean' },
  { text: 'حرف', face: 'amiri-bold', language: 'Arabic' },
  { text: 'LETRA', face: 'geist-black', language: 'Spanish' },
  { text: 'अक्षर', face: 'devanagari-bold', language: 'Hindi' },
  { text: 'γράμμα', face: 'noto-cjk-words', language: 'Greek' },
];

/**
 * The origin story, as one justified column. Written from what the repository actually is — a shaper, a baker, a
 * layout engine and a set of raster techniques — rather than from anything invented. Edit freely, but keep it about
 * this long: the column has to finish above the floor plane or the reflector occludes the last lines.
 */
export const ORIGIN_STORY: readonly string[] = [
  'Glyph is rooted in the long history of typography and typesetting, carrying ' +
    'forward the principles of careful design and precise layout. It brings that same ' +
    'care to real-time graphics, where every glyph can be shaped precisely, batched ' +
    'efficiently, sitting comfortably in your scene. Transformed, animated, lit, and ' +
    'composited in the world around it.',
  'From the smallest spacing decision to the architecture of its rendering pipeline, ' +
    'Glyph is built with a love of type and an insistence on performance, enabling ' +
    'expressive new typographic experiences across the web and XR without sacrificing ' +
    'beauty, control, or speed.',
];
