import type { FontFeature } from './font-feature.js';
import type { FormattedText, GlyphPaintInput, ParagraphSpan } from './formatted-text.js';
import type { FontSelection } from './loaded-font.js';
import type { AnyRasterTechnique } from './raster-technique.js';

export interface GlyphBufferCapacity {
  readonly size: number;
  /**
   * `grow` resizes to what the content needs, `chunk` resizes in multiples of `size`, and `fixed`
   * rejects an update whose glyph requirement exceeds `size` and keeps the last complete revision
   * visible. The requirement is a text-length upper bound computed before shaping, so a caller can
   * size content against the cap rather than discovering it after the fact.
   */
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
  /** Extra inline offset for the paragraph's first line, in layout units. */
  readonly firstLineIndent?: number;
  /** Block-axis space before the paragraph's first line. */
  readonly spaceBefore?: number;
  /** Block-axis space carried in measurements after the paragraph's final line. */
  readonly spaceAfter?: number;
  /**
   * Justification bounds on each word space as multiples of its natural
   * advance: `minWordSpaceRatio` in (0, 1] permits shrinking, and
   * `maxWordSpaceRatio` (at least 1) caps expansion before the remaining
   * deficit spills into per-gap letter-space expansion. Unset sides stay
   * unbounded.
   */
  readonly justify?: {
    readonly minWordSpaceRatio?: number;
    readonly maxWordSpaceRatio?: number;
    readonly letterSpaceExpansion?: number;
  };
  /** Whether the final and hard-broken lines also justify. Defaults to 'auto'. */
  readonly lastLine?: 'auto' | 'justify';
  /**
   * Flow the paragraph through side-by-side ordered columns inside the exact
   * content-box width. Text fills each column in order without balancing, so
   * the final column may run short. Requires an exact `width`; `gap` is the
   * inline space between adjacent columns in layout units.
   */
  readonly columns?: { readonly count: number; readonly gap?: number };
}

/**
 * The per-call part of a layout request: only what a layout host varies while probing one node.
 *
 * A Yoga- or flexbox-shaped host re-measures the same paragraph at many candidate boxes during a
 * single layout pass. Everything else about how the text flows -- wrap policy, alignment, line
 * caps, overflow, justification bounds, columns, indents, and block spacing -- is stable policy
 * ([`ParagraphLayoutPolicy`]) owned by the paragraph itself and changed only through `update()`,
 * so a host probe never re-states it.
 */
export interface ParagraphConstraints {
  readonly width?: ParagraphAxisConstraint;
  readonly height?: ParagraphAxisConstraint;
}

/** The stable half of [`ParagraphContentBox`]: flow policy that outlives any single measure probe. */
export type ParagraphLayoutPolicy = Omit<ParagraphContentBox, 'width' | 'height'>;

export interface ParagraphStyle {
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  /** Extra advance added to each word-separating space, in layout units. */
  readonly wordSpacing?: number;
  readonly language?: string;
  readonly direction?: 'auto' | 'ltr' | 'rtl';
  readonly features?: readonly FontFeature[];
  readonly decoration?: TextDecorationStyle;
}

/**
 * Text decoration lines for a styled range. Geometry comes from the font's baked
 * underline and strikeout metrics; `thickness` and `offset` override in layout units
 * when nonzero. Only `solid` lines are implemented: requesting another line style is
 * rejected at the boundary rather than silently rendered as solid.
 */
export interface TextDecorationStyle {
  readonly underline?: boolean;
  readonly overline?: boolean;
  readonly lineThrough?: boolean;
  readonly color?: GlyphPaintInput['color'];
  readonly style?: 'solid' | 'double' | 'dotted' | 'dashed' | 'wavy';
  readonly thickness?: number;
  readonly offset?: number;
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
