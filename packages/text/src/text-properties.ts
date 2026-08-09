import type { FontFeature } from './font-feature.js';
import type { FormattedText, GlyphPaintInput, ParagraphSpan } from './formatted-text.js';
import type { FontSelection } from './loaded-font.js';
import type { AnyRasterTechnique } from './raster-technique.js';

export interface GlyphBufferCapacity {
  readonly size: number;
  readonly policy: 'grow' | 'chunk' | 'fixed';
}

/** A layout-system-neutral axis constraint. */
export type ParagraphAxisConstraint =
  | { readonly mode: 'unconstrained' }
  | { readonly mode: 'at-most'; readonly size: number }
  | { readonly mode: 'exact'; readonly size: number };

export interface ParagraphContentBox {
  readonly width?: ParagraphAxisConstraint;
  readonly height?: ParagraphAxisConstraint;
  readonly maxLines?: number;
  readonly wrap?: 'none' | 'word' | 'character';
  readonly align?: 'start' | 'center' | 'end' | 'justify';
  readonly overflow?: 'visible' | 'clip' | 'ellipsis';
}

export interface ParagraphStyle {
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  readonly language?: string;
  readonly direction?: 'auto' | 'ltr' | 'rtl';
  readonly features?: readonly FontFeature[];
}

export interface ParagraphBaseProperties<Technique extends AnyRasterTechnique> {
  readonly font: FontSelection<Technique>;
  readonly contentBox?: ParagraphContentBox;
  readonly style?: ParagraphStyle;
  readonly paint?: GlyphPaintInput;
  readonly rasterPixelRatio?: number;
  readonly order?: number;
}

export type ParagraphContentProperties<Technique extends AnyRasterTechnique> =
  | Readonly<{ text: string; spans?: readonly ParagraphSpan<Technique>[] }>
  | Readonly<{ text: FormattedText<Technique>; spans?: never }>;

export type ParagraphProperties<Technique extends AnyRasterTechnique> = ParagraphBaseProperties<Technique> &
  ParagraphContentProperties<Technique>;
