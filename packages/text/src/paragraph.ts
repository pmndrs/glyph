import type { FontHandle } from './identity.js'
import type { ParagraphLayout, ParagraphMeasurement } from './layout.js'
import type { FontFeature } from './text.js'

/**
 * A layout-system-neutral axis constraint.
 *
 * These modes describe the common constraint vocabulary used by flex, grid,
 * retained UI, and application-owned layout systems.
 */
export type ParagraphAxisConstraint =
  | { readonly mode: 'unconstrained' }
  | { readonly mode: 'at-most'; readonly size: number }
  | { readonly mode: 'exactly'; readonly size: number }

export interface ParagraphStyle {
  readonly fontSize?: number
  readonly lineHeight?: number
  readonly letterSpacing?: number
  readonly language?: string
  readonly direction?: 'auto' | 'ltr' | 'rtl'
  readonly features?: readonly FontFeature[]
}

export interface ParagraphSpan extends ParagraphStyle {
  readonly start: number
  readonly end: number
  readonly font?: FontHandle
}

export interface ParagraphInput {
  readonly text: string
  readonly font: FontHandle
  readonly spans?: readonly ParagraphSpan[]
  readonly style?: ParagraphStyle
}

export interface ParagraphConstraints {
  /** Defaults to `{ mode: 'unconstrained' }`. */
  readonly width?: ParagraphAxisConstraint
  /** Defaults to `{ mode: 'unconstrained' }`. */
  readonly height?: ParagraphAxisConstraint
  readonly maxLines?: number
  readonly wrap?: 'none' | 'word' | 'character'
  readonly align?: 'start' | 'center' | 'end' | 'justify'
  readonly overflow?: 'visible' | 'clip' | 'ellipsis'
}

/**
 * A prepared paragraph has no asynchronous methods. Font and shaper
 * dependencies must be loaded before it is exposed to a synchronous host
 * layout system.
 */
export interface Paragraph {
  /** Resolve box metrics without materializing positioned glyph arrays. */
  measure(constraints?: ParagraphConstraints): ParagraphMeasurement
  /** Resolve the final box and materialize positioned glyph output. */
  layout(constraints?: ParagraphConstraints): ParagraphLayout
  update(input: ParagraphInput): void
  dispose(): void
}

export interface ParagraphEngine {
  create(input: ParagraphInput): Paragraph
}
