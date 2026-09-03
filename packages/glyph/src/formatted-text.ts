import { type ClusterAlignableRange, resolveRangesToClusters } from './internal/graphemes.js';
import { statedProperties } from './internal/span-cascade.js';
import { isImmutableFontSelection, type FontSelection } from './loaded-font.js';
import { assertTextStyle, type TextStyle } from './text-properties.js';
import type { RasterFormatMetadata } from './config/raster-format.js';

declare const textLiteralTechnique: unique symbol;
declare const textSpanFragmentTechnique: unique symbol;

export interface ParagraphSpan<Technique extends RasterFormatMetadata> {
  readonly start: number;
  readonly end: number;
  readonly font?: FontSelection<Technique>;
  /** Text shaping and presentation overrides for this inline span. */
  readonly style?: TextStyle;
}

export interface TextLiteral<Technique extends RasterFormatMetadata = never> {
  readonly [textLiteralTechnique]: (technique: Technique) => Technique;
  readonly text: string;
  readonly spans: readonly ParagraphSpan<Technique>[];
}

export interface TextSpanFragment<
  Technique extends RasterFormatMetadata = never,
  Properties extends object = Omit<ParagraphSpan<Technique>, 'start' | 'end'>,
> {
  readonly [textSpanFragmentTechnique]: (technique: Technique) => Technique;
  readonly text: string;
  readonly spans: readonly ParagraphSpan<Technique>[];
  readonly properties: Properties;
}

/**
 * The join rule `compose` below applies, re-exported for the React `<Text>` compiler.
 *
 * `flattenText` is the second implementation of the same compiler and must resolve its joins by the
 * same rule; it reaches that rule through this module because the adapter layers do not import from
 * `internal/`. Neither compiler restates the rule, and neither is allowed to drift from the other.
 */
export { resolveRangesToClusters } from './internal/graphemes.js';

/**
 * Resolve every span boundary onto the extended grapheme cluster grid of `text`.
 *
 * The engine resolves exactly one style per extended grapheme cluster and rejects a whole frame
 * whose styles split one (`cluster_state.rs`, `build`), reporting a numeric status that names no
 * span. `Text` therefore resolves span offsets through this function before any of them reach the
 * engine, so the rule a caller sees is the constructive one -- a cluster takes the style of its
 * base -- rather than a deferred rejection.
 *
 * `txt`/`span` and the React `<Text>` tree compile a document that states no offsets at all, and each
 * resolves the boundaries it derives at its own concatenation joins
 * (`resolveRangesToClusters`), so a compiled paragraph arrives here already on the cluster grid and
 * this call finds nothing to move.
 *
 * It stays module-local to the structural compilers and engine adapter; applications never author the
 * resulting offset records.
 *
 * Text that is not well-formed UTF-16 has no cluster grid to resolve against and is the engine's to
 * reject; its spans are returned untouched so that the presence of a span cannot decide whether a
 * lone surrogate is accepted.
 */
export function alignSpansToClusters<Span extends ClusterAlignableRange>(
  text: string,
  spans: readonly Span[],
): readonly Span[] {
  return resolveRangesToClusters(text, spans);
}

export type FormattedText<Technique extends RasterFormatMetadata> = TextLiteral<Technique> | TextLiteral<never>;
export type TextInput<Technique extends RasterFormatMetadata> = string | FormattedText<Technique>;
export type SpanStyle = Readonly<TextStyle>;
export type SpanFormat<Technique extends RasterFormatMetadata> = FontSelection<Technique> | SpanStyle;

type TextTemplateValue<Technique extends RasterFormatMetadata> =
  | string
  | number
  | TextLiteral<Technique>
  | TextLiteral<never>
  | TextSpanFragment<Technique>
  | TextSpanFragment<never>;

export interface SpanTag<Technique extends RasterFormatMetadata> {
  (strings: TemplateStringsArray, ...values: readonly TextTemplateValue<Technique>[]): TextSpanFragment<Technique>;
}

export interface UnboundSpanTag {
  <Technique extends RasterFormatMetadata = never>(
    strings: TemplateStringsArray,
    ...values: readonly TextTemplateValue<Technique>[]
  ): TextSpanFragment<Technique>;
}

/** Integrator utility for adding renderer-owned properties to a structural span fragment. */
export function createSpanTag<Technique extends RasterFormatMetadata, Properties extends object>(
  properties: Readonly<Properties>,
): SpanTag<Technique> {
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    throw new TypeError('span properties must be an object');
  }
  const frozen = Object.freeze({ ...properties });
  return ((strings: TemplateStringsArray, ...values: readonly TextTemplateValue<Technique>[]) => {
    const composed = compose(strings, values);
    return Object.freeze({
      text: composed.text,
      spans: Object.freeze(composed.spans),
      properties: frozen,
    }) as TextSpanFragment<Technique, Properties>;
  }) as SpanTag<Technique>;
}

export function txt<Technique extends RasterFormatMetadata = never>(
  strings: TemplateStringsArray,
  ...values: readonly TextTemplateValue<Technique>[]
): TextLiteral<Technique> {
  const composed = compose(strings, values);
  return Object.freeze({ text: composed.text, spans: Object.freeze(composed.spans) }) as TextLiteral<Technique>;
}

export function span(...styles: readonly [SpanStyle, ...SpanStyle[]]): UnboundSpanTag;
export function span<Technique extends RasterFormatMetadata>(
  font: FontSelection<Technique>,
  ...formats: readonly SpanFormat<NoInfer<Technique>>[]
): SpanTag<Technique>;
export function span<Technique extends RasterFormatMetadata>(
  first: FontSelection<Technique> | SpanStyle,
  ...rest: readonly SpanFormat<Technique>[]
): SpanTag<Technique> | UnboundSpanTag {
  const properties = normalizeFormats([first, ...rest]);
  return createSpanTag<Technique, typeof properties>(properties) as SpanTag<Technique> | UnboundSpanTag;
}

/**
 * Compile one fragment tree into the `(text, spans)` pair the engine consumes.
 *
 * The tree states no offsets. Every boundary below is derived at a concatenation JOIN -- `start` is
 * the length before a fragment's text is appended, `end` the length after -- and concatenation can
 * fuse the tail of one fragment with the head of the next into a single extended grapheme cluster,
 * naming an offset that is not a boundary of the text just produced. `resolveRangesToClusters`
 * settles those joins against the finished text under the one rule `flattenText` uses on the React
 * tree: the fused cluster takes the style of its base, which is the earlier fragment's.
 */
function compose<Technique extends RasterFormatMetadata>(
  strings: TemplateStringsArray,
  values: readonly TextTemplateValue<Technique>[],
): { readonly text: string; readonly spans: readonly ParagraphSpan<Technique>[] } {
  let text = strings[0] ?? '';
  const spans: ParagraphSpan<Technique>[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    const start = text.length;
    if (isFragment(value)) {
      text += value.text;
      // Every resolver applies the last covering span, so an enclosing span must
      // precede the spans it contains for inner formatting to compose over it.
      if ('properties' in value && value.text.length !== 0) {
        spans.push(Object.freeze({ start, end: text.length, ...value.properties }));
      }
      for (const nested of value.spans) spans.push(offsetSpan(nested, start));
    } else {
      text += String(value);
    }
    text += strings[index + 1] ?? '';
  }
  return { text, spans: resolveRangesToClusters(text, spans) };
}

function isFragment<Technique extends RasterFormatMetadata>(
  value: TextTemplateValue<Technique>,
): value is TextLiteral<Technique> | TextSpanFragment<Technique, object> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'text') === 'string' &&
    Array.isArray(Reflect.get(value, 'spans'))
  );
}

function offsetSpan<Technique extends RasterFormatMetadata>(
  value: ParagraphSpan<Technique>,
  offset: number,
): ParagraphSpan<Technique> {
  return Object.freeze({ ...value, start: value.start + offset, end: value.end + offset });
}

function normalizeFormats<Technique extends RasterFormatMetadata>(
  formats: readonly (FontSelection<Technique> | SpanStyle)[],
): Omit<ParagraphSpan<Technique>, 'start' | 'end'> {
  let font: FontSelection<Technique> | undefined;
  let style: TextStyle | undefined;
  // A span states only what it changes. A group the format does not touch stays
  // absent so the cascade inherits it, instead of arriving as an empty object
  // that would reset the range to the default shaping style or glyph colour.
  for (const format of formats) {
    if (isFontSelection(format)) font = format;
    else {
      const styled = statedProperties<TextStyle>(format);
      if (Object.keys(styled).length !== 0) style = Object.freeze({ ...(style ?? {}), ...styled });
    }
  }
  if (style !== undefined) assertTextStyle(style, 'span style');
  return Object.freeze({
    ...(font === undefined ? {} : { font }),
    ...(style === undefined ? {} : { style }),
  });
}

function isFontSelection<Technique extends RasterFormatMetadata>(
  value: FontSelection<Technique> | SpanStyle,
): value is FontSelection<Technique> {
  return isImmutableFontSelection(value);
}
