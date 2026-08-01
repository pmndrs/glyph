import type { JsonValue } from '@pmndrs/text';

export const GLYPH_DEBUG_KIND = 'glyphDebug' as const;
export const GLYPH_DEBUG_EXTENSION = 'PMNDRS_text_glyph_debug' as const;
export const GLYPH_DEBUG_FORMAT_VERSION = 0 as const;
export const GLYPH_DEBUG_GENERATOR_VERSION = '0.0.0' as const;

export interface GlyphDebugOptions {
  /** Stable color permutation written into the package-owned glyph records. */
  readonly paletteSeed?: number;
  /** Fraction of the em square removed from each side of a diagnostic frame. */
  readonly inset?: number;
}

export interface GlyphDebugDescriptor {
  readonly [key: string]: JsonValue;
  readonly generatorVersion: typeof GLYPH_DEBUG_GENERATOR_VERSION;
  readonly paletteSeed: number;
  readonly inset: number;
}

export function glyphDebugDescriptor(options: GlyphDebugOptions = {}): GlyphDebugDescriptor {
  const paletteSeed = options.paletteSeed ?? 0;
  const inset = options.inset ?? 0.08;
  if (!Number.isSafeInteger(paletteSeed) || paletteSeed < 0 || paletteSeed > 0xffff_ffff) {
    throw new RangeError('glyph-debug paletteSeed must be a uint32');
  }
  if (!Number.isFinite(inset) || inset < 0 || inset >= 0.5) {
    throw new RangeError('glyph-debug inset must be finite and in [0, 0.5)');
  }
  return { generatorVersion: GLYPH_DEBUG_GENERATOR_VERSION, paletteSeed, inset };
}
