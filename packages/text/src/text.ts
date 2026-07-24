import type { ColorRepresentation } from 'three'
import type { AnyFontToken, FontInput, RegisteredFont } from './font.js'
import type { ParagraphLayout } from './layout.js'
import type { AnyRasterInput } from './raster.js'

export interface FontFeature {
  readonly tag: string
  readonly value?: number
  readonly start?: number
  readonly end?: number
}

/** Resolved, absolute UTF-16 feature range passed to the shaping ABI. */
export interface ResolvedFontFeature {
  readonly tag: string
  readonly value: number
  readonly start: number
  readonly end: number
}

export interface TextLayoutProperties {
  readonly width?: number
  readonly height?: number
  readonly maxLines?: number
  readonly wrap?: 'none' | 'word' | 'character'
  readonly overflow?: 'visible' | 'clip' | 'ellipsis'
  readonly textAlign?: 'start' | 'center' | 'end' | 'justify'
}

export interface TextShapingProperties {
  readonly fontSize?: number
  readonly lineHeight?: number
  readonly letterSpacing?: number
  readonly language?: string
  readonly direction?: 'auto' | 'ltr' | 'rtl'
  readonly features?: readonly FontFeature[]
}

export interface TextPaintProperties {
  readonly color?: ColorRepresentation
  readonly opacity?: number
  readonly outline?: {
    readonly color: ColorRepresentation
    /** Paragraph-local layout units. */
    readonly width: number
  }
  readonly shadow?: {
    readonly color: ColorRepresentation
    /** Paragraph-local layout units: positive X is right and positive Y is down. */
    readonly offset: readonly [number, number]
  }
}

export interface TextSpan extends TextShapingProperties, TextPaintProperties {
  readonly start: number
  readonly end: number
  readonly font?: AnyFontToken | FontInput | RegisteredFont
}

export type TextFontProperties =
  | {
      readonly font: AnyFontToken
      readonly raster?: never
    }
  | {
      readonly font: FontInput | RegisteredFont
      readonly raster: AnyRasterInput
    }
  | {
      readonly font?: undefined
      readonly raster?: undefined
    }

export type TextContentProperties =
  | {
      readonly text?: string
      readonly spans?: never
    }
  | {
      readonly text: string
      readonly spans: readonly TextSpan[]
    }

export type TextProperties = TextLayoutProperties &
  TextShapingProperties &
  TextPaintProperties &
  TextFontProperties &
  TextContentProperties & {
    readonly onLayout?: (layout: ParagraphLayout) => void
  }

type TextContentUpdate =
  | { readonly text?: never; readonly spans?: never }
  | { readonly text: string; readonly spans?: readonly TextSpan[] }

type TextFontUpdate =
  | { readonly font?: never; readonly raster?: never }
  | { readonly font: AnyFontToken; readonly raster?: never }
  | {
      readonly font: FontInput | RegisteredFont
      readonly raster: AnyRasterInput
    }

/**
 * A patch whose coupled content and font/raster fields remain atomic.
 * The complete merged Text state is validated before it is committed.
 */
export type TextUpdateProperties = Partial<
  Omit<TextProperties, 'text' | 'spans' | 'font' | 'raster'>
> &
  TextContentUpdate &
  TextFontUpdate
