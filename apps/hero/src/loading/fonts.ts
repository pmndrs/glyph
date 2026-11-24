import { createFontStack, type Font, type slug } from '@pmndrs/glyph';
import { useSlug } from '@pmndrs/glyph/react';
import { useMemo } from 'react';
import arabic from '../../assets/amiri.font.glb?url';
import display from '../../assets/geist-black.font.glb?url';
import mono from '../../assets/geist-mono-bold.font.glb?url';
import devanagari from '../../assets/noto-devanagari.font.glb?url';
import japanese from '../../assets/noto-japanese.font.glb?url';
import thai from '../../assets/noto-thai.font.glb?url';
import serif from '../../assets/source-serif.font.glb?url';

export type SlugFont = Font<typeof slug>;

for (const url of [serif, display, mono, arabic, devanagari, thai, japanese]) useSlug.preload(url);

/** Every face the spread sets, loaded before playback begins. */
export function useFonts() {
  const fonts = {
    serif: useSlug(serif),
    display: useSlug(display),
    mono: useSlug(mono),
    arabic: useSlug(arabic),
    devanagari: useSlug(devanagari),
    thai: useSlug(thai),
    japanese: useSlug(japanese),
  };
  // Latin with Arabic inside it: the serif shapes what it can and hands the rest down the stack.
  const mixed = useMemo(() => createFontStack(fonts.serif, fonts.arabic), [fonts.serif, fonts.arabic]);

  return { ...fonts, mixed };
}

export type Fonts = ReturnType<typeof useFonts>;
