import type { FontFeature } from '@pmndrs/glyph';

/** Paragraph inputs that determine glyph identity and visual order. */
export interface ShapedTextIdentity {
  readonly fontFixture: string;
  readonly text: string;
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
  readonly features: readonly FontFeature[];
}

/** Evidence that a retained text reflow was presented without creating detached glyph copies. */
export interface GlyphOriginPresentation {
  readonly transitioned: false;
  readonly matchedGlyphs: 0;
  readonly targetGlyphs: number;
}

/** Reports one committed retained-text reflow without allocating presentation-only glyph objects. */
export function retainedGlyphPresentation(text: {
  measure(): { readonly glyphCount: number };
}): GlyphOriginPresentation {
  return { transitioned: false, matchedGlyphs: 0, targetGlyphs: text.measure().glyphCount };
}
