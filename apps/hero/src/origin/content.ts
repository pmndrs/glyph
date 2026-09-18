import type { FaceId } from '../typography/content';

/**
 * The second scene's copy. Kept apart from the first hero's content so neither can quietly reshape the other's
 * bake.
 */

export const ORIGIN_TITLE = { text: 'GLYPH', face: 'geist-black' } as const;

/**
 * Native words for a letter or written form, in a fixed order with scripts interleaved. Each word selects a font
 * that covers its script.
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

/** Origin copy for the justified column. Keep the final line above the floor to avoid reflector occlusion. */
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
