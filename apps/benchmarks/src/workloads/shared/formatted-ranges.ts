import { span, txt, type SpanStyle, type TextLiteral, type TextSpanFragment } from '@pmndrs/glyph';

export interface StyledTextRange {
  readonly start: number;
  readonly end: number;
  readonly style: SpanStyle;
}

/** Adapts the benchmark's mutable, disjoint paint ranges to Glyph's structural `txt`/`span` input; the numeric ranges stay app-private animation state, never a public Text update. */
export function formatStyledRanges(source: string, ranges: readonly StyledTextRange[]): TextLiteral<never> {
  const values: Array<string | TextSpanFragment<never>> = [];
  let cursor = 0;
  for (const range of ranges) {
    if (
      !Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.end) ||
      range.start < cursor ||
      range.end <= range.start ||
      range.end > source.length
    ) {
      throw new RangeError('styled text ranges must be ordered, disjoint, non-empty UTF-16 slices');
    }
    if (range.start > cursor) values.push(source.slice(cursor, range.start));
    values.push(span(range.style)`${source.slice(range.start, range.end)}`);
    cursor = range.end;
  }
  if (cursor < source.length) values.push(source.slice(cursor));

  const strings = Array.from({ length: values.length + 1 }, () => '') as string[] & {
    raw?: readonly string[];
  };
  strings.raw = strings;
  return txt(strings as unknown as TemplateStringsArray, ...values);
}
