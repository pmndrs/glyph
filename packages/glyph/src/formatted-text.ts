import { type ClusterAlignableRange, resolveRangesToClusters } from './internal/graphemes.js';
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
 * This is the backstop for the ONE surface that carries raw offsets: the untyped `spans` array,
 * whose numbers are the caller's own arithmetic. It is no longer what discovers a split the
 * package itself derived. `txt`/`span` and the React `<Text>` tree compile a document that states
 * no offsets at all, and each resolves the boundaries it derives at its own concatenation joins
 * (`resolveRangesToClusters`), so a compiled paragraph arrives here already on the cluster grid and
 * this call finds nothing to move.
 *
 * It is exported because a caller that would rather detect the shift than accept it needs the same
 * answer the library will use. The argument array is returned by identity when nothing moves, so
 * `alignSpansToClusters(text, spans) === spans` is the whole check.
 *
 * Not published. Every span reaching the engine already passes through here -- `Text.set()` applies it to the
 * `spans` array, and the tree compilers resolve the same way before a span is ever built -- so a caller who
 * called it could not change the outcome. It stays exported from this module for the engine and for the test
 * that pins its identity property.
 *
 * ```ts
 * const resolved = alignSpansToClusters(text, spans);
 * if (resolved !== spans) reportToTheEditorThatItsOffsetsSplitACluster(resolved);
 * ```
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
function compose<Technique extends AnyRasterTechnique>(
  strings: TemplateStringsArray,
  values: readonly TextTemplateValue<Technique>[],
): { readonly text: string; readonly spans: readonly ParagraphSpan<Technique>[] } {
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
  return { text, spans: resolveRangesToClusters(text, spans) };
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
