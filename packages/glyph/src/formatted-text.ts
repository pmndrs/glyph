import { statedProperties } from './internal/span-cascade.js';
import type { FontSelection } from './loaded-font.js';
import type { ParagraphStyle } from './text-properties.js';
import type { AnyRasterTechnique } from './raster-technique.js';

declare const textLiteralTechnique: unique symbol;
declare const textSpanFragmentTechnique: unique symbol;

export type LinearRgbaInput = readonly [number, number, number, number];
export type ColorInput = string | LinearRgbaInput;

export interface GlyphPaintInput {
  readonly color?: ColorInput;
  readonly opacity?: number;
  readonly outline?: { readonly color: ColorInput; readonly width: number };
  readonly shadow?: { readonly color: ColorInput; readonly offset: readonly [number, number] };
}

export interface ParagraphSpan<Technique extends AnyRasterTechnique> {
  readonly start: number;
  readonly end: number;
  readonly font?: FontSelection<Technique>;
  readonly style?: ParagraphStyle;
  readonly paint?: GlyphPaintInput;
}

export interface TextLiteral<Technique extends AnyRasterTechnique = never> {
  readonly [textLiteralTechnique]: (technique: Technique) => Technique;
  readonly text: string;
  readonly spans: readonly ParagraphSpan<Technique>[];
}

export interface TextSpanFragment<Technique extends AnyRasterTechnique = never> {
  readonly [textSpanFragmentTechnique]: (technique: Technique) => Technique;
  readonly text: string;
  readonly spans: readonly ParagraphSpan<Technique>[];
  readonly properties: Omit<ParagraphSpan<Technique>, 'start' | 'end'>;
}

export type FormattedText<Technique extends AnyRasterTechnique> = TextLiteral<Technique> | TextLiteral<never>;
export type TextInput<Technique extends AnyRasterTechnique> = string | FormattedText<Technique>;
export type SpanStyle = Readonly<ParagraphStyle & GlyphPaintInput>;
export type SpanFormat<Technique extends AnyRasterTechnique> = FontSelection<Technique> | SpanStyle;

type TextTemplateValue<Technique extends AnyRasterTechnique> =
  | string
  | number
  | TextLiteral<Technique>
  | TextLiteral<never>
  | TextSpanFragment<Technique>
  | TextSpanFragment<never>;

export interface SpanTag<Technique extends AnyRasterTechnique> {
  (strings: TemplateStringsArray, ...values: readonly TextTemplateValue<Technique>[]): TextSpanFragment<Technique>;
}

export interface UnboundSpanTag {
  <Technique extends AnyRasterTechnique = never>(
    strings: TemplateStringsArray,
    ...values: readonly TextTemplateValue<Technique>[]
  ): TextSpanFragment<Technique>;
}

export function txt<Technique extends AnyRasterTechnique = never>(
  strings: TemplateStringsArray,
  ...values: readonly TextTemplateValue<Technique>[]
): TextLiteral<Technique> {
  const composed = compose(strings, values);
  return Object.freeze({ text: composed.text, spans: Object.freeze(composed.spans) }) as TextLiteral<Technique>;
}

export function span(...styles: readonly [SpanStyle, ...SpanStyle[]]): UnboundSpanTag;
export function span<Technique extends AnyRasterTechnique>(
  font: FontSelection<Technique>,
  ...formats: readonly SpanFormat<NoInfer<Technique>>[]
): SpanTag<Technique>;
export function span<Technique extends AnyRasterTechnique>(
  first: FontSelection<Technique> | SpanStyle,
  ...rest: readonly SpanFormat<Technique>[]
): SpanTag<Technique> | UnboundSpanTag {
  const properties = normalizeFormats([first, ...rest]);
  return ((strings: TemplateStringsArray, ...values: readonly TextTemplateValue<Technique>[]) => {
    const composed = compose(strings, values);
    return Object.freeze({
      text: composed.text,
      spans: Object.freeze(composed.spans),
      properties,
    }) as TextSpanFragment<Technique>;
  }) as SpanTag<Technique>;
}

function compose<Technique extends AnyRasterTechnique>(
  strings: TemplateStringsArray,
  values: readonly TextTemplateValue<Technique>[],
): { readonly text: string; readonly spans: ParagraphSpan<Technique>[] } {
  let text = strings[0] ?? '';
  const spans: ParagraphSpan<Technique>[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    const start = text.length;
    if (isFragment(value)) {
      const fragment = value as TextLiteral<Technique> | TextSpanFragment<Technique>;
      text += fragment.text;
      // Every resolver applies the last covering span, so an enclosing span must
      // precede the spans it contains for inner formatting to compose over it.
      if ('properties' in fragment && fragment.text.length !== 0) {
        spans.push(Object.freeze({ start, end: text.length, ...fragment.properties }));
      }
      for (const nested of fragment.spans) spans.push(offsetSpan(nested, start));
    } else {
      text += String(value);
    }
    text += strings[index + 1] ?? '';
  }
  return { text, spans };
}

function isFragment(value: unknown): value is TextLiteral<AnyRasterTechnique> | TextSpanFragment<AnyRasterTechnique> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'text') === 'string' &&
    Array.isArray(Reflect.get(value, 'spans'))
  );
}

function offsetSpan<Technique extends AnyRasterTechnique>(
  value: ParagraphSpan<Technique>,
  offset: number,
): ParagraphSpan<Technique> {
  return Object.freeze({ ...value, start: value.start + offset, end: value.end + offset });
}

function normalizeFormats<Technique extends AnyRasterTechnique>(
  formats: readonly (FontSelection<Technique> | SpanStyle)[],
): Omit<ParagraphSpan<Technique>, 'start' | 'end'> {
  let font: FontSelection<Technique> | undefined;
  let style: ParagraphStyle | undefined;
  let paint: GlyphPaintInput | undefined;
  // A span states only what it changes. A group the format does not touch stays
  // absent so the cascade inherits it, instead of arriving as an empty object
  // that would reset the range to the default shaping style or glyph colour.
  for (const format of formats) {
    if (isFontSelection(format)) font = format;
    else {
      const { color, opacity, outline, shadow, ...layout } = format;
      const styled = statedProperties<ParagraphStyle>(layout);
      if (Object.keys(styled).length !== 0) style = Object.freeze({ ...(style ?? {}), ...styled });
      const painted = statedProperties<GlyphPaintInput>({ color, opacity, outline, shadow });
      if (Object.keys(painted).length !== 0) paint = Object.freeze({ ...(paint ?? {}), ...painted });
    }
  }
  return Object.freeze({
    ...(font === undefined ? {} : { font }),
    ...(style === undefined ? {} : { style }),
    ...(paint === undefined ? {} : { paint }),
  });
}

function isFontSelection(value: unknown): value is FontSelection<AnyRasterTechnique> {
  return (
    typeof value === 'object' && value !== null && ('technique' in value || 'fonts' in value) && !('fontSize' in value)
  );
}
