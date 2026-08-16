/**
 * One span cascade for every span property.
 *
 * A span states only the properties it changes. Resolution folds the spans
 * covering an offset from the outermost inward and merges them per property, so
 * a span that states only a colour keeps the font, size, outline, and shadow of
 * the scope enclosing it. Shaping properties and paint properties travel
 * through this single fold and part company only where each is consumed:
 * shaping before run segmentation, paint at glyph-instance packing.
 *
 * Precedence follows containment rather than array order, so a producer cannot
 * invert a cascade by emitting a contained span before the span enclosing it.
 * Spans covering exactly the same range have no innermost member, so those ties
 * fall back to array order. Partial overlap has no innermost span at all and is
 * rejected instead of silently resolved.
 */

export interface SpanRange {
  readonly start: number;
  readonly end: number;
}

export interface IdentifiedSpanRange extends SpanRange {
  /** Position in the authored span array. */
  readonly index: number;
}

export interface SpanCascadeEntry<Properties extends object> extends SpanRange {
  /** Only the properties this span states; an absent key inherits. */
  readonly properties: Properties;
}

export interface SpanCascadeSegment<Properties extends object> extends SpanRange {
  /** Only the properties some covering span states; an absent key inherits. */
  readonly properties: Properties;
}

/** Two spans overlap while neither contains the other, so neither is innermost. */
export class SpanNestingError extends RangeError {
  readonly enclosing: IdentifiedSpanRange;
  readonly overlapping: IdentifiedSpanRange;

  constructor(label: string, enclosing: IdentifiedSpanRange, overlapping: IdentifiedSpanRange) {
    super(
      `${label}s must be disjoint or nested: ${describeSpan(enclosing)} partially overlaps ${describeSpan(overlapping)}`,
    );
    this.name = 'SpanNestingError';
    this.enclosing = enclosing;
    this.overlapping = overlapping;
  }
}

/**
 * Validate that every pair of spans is disjoint or nested, and return the
 * indexes of the spans that cover text in outermost-to-innermost order.
 */
export function assertSpanNesting(spans: readonly SpanRange[], label: string): readonly number[] {
  const order = containmentOrder(spans);
  const open: number[] = [];
  for (const index of order) {
    const span = spans[index]!;
    while (open.length !== 0 && spans[open[open.length - 1]!]!.end <= span.start) open.pop();
    const enclosing = open[open.length - 1];
    if (enclosing !== undefined && spans[enclosing]!.end < span.end) {
      throw new SpanNestingError(label, identify(spans, enclosing), identify(spans, index));
    }
    open.push(index);
  }
  return order;
}

/**
 * Partition `[0, textLength)` into segments whose properties are the covering
 * spans merged per property from the outermost inward.
 */
export function resolveSpanCascade<Properties extends object>(
  spans: readonly SpanCascadeEntry<Properties>[],
  textLength: number,
  label: string,
): readonly SpanCascadeSegment<Properties>[] {
  const order = assertSpanNesting(spans, label);
  if (textLength === 0) return [];
  const inherited = Object.freeze({}) as Properties;
  const offsets = [textLength, 0];
  for (const index of order) offsets.push(spans[index]!.start, spans[index]!.end);
  const boundaries = [...new Set(offsets)].sort((left, right) => left - right);
  // Nesting makes the covering spans a stack, so each entry can carry the merge
  // of everything below it and no offset has to refold its enclosing scopes.
  const open: { readonly end: number; readonly properties: Properties }[] = [];
  const segments: SpanCascadeSegment<Properties>[] = [];
  let opening = 0;
  for (let index = 0; index + 1 < boundaries.length; index += 1) {
    const start = boundaries[index]!;
    const end = boundaries[index + 1]!;
    while (open.length !== 0 && open[open.length - 1]!.end <= start) open.pop();
    while (opening < order.length && spans[order[opening]!]!.start === start) {
      const span = spans[order[opening]!]!;
      open.push({
        end: span.end,
        properties: { ...(open[open.length - 1]?.properties ?? inherited), ...span.properties },
      });
      opening += 1;
    }
    const properties = open[open.length - 1]?.properties ?? inherited;
    const previous = segments[segments.length - 1];
    if (previous !== undefined && previous.end === start && sameProperties(previous.properties, properties)) {
      segments[segments.length - 1] = { start: previous.start, end, properties: previous.properties };
    } else {
      segments.push({ start, end, properties });
    }
  }
  return segments;
}

/** A source that may hold an explicit `undefined` for any property it does not state. */
export type StatedSource<Properties extends object> = {
  readonly [Key in keyof Properties]?: Properties[Key] | undefined;
};

/** Copy the keys a caller states, so an explicit `undefined` cannot shadow an enclosing value. */
export function statedProperties<Properties extends object>(
  ...sources: readonly (StatedSource<Properties> | undefined)[]
): Properties {
  const stated: Record<string, unknown> = {};
  for (const source of sources) {
    if (source === undefined) continue;
    for (const [key, value] of Object.entries(source)) if (value !== undefined) stated[key] = value;
  }
  return stated as Properties;
}

function containmentOrder(spans: readonly SpanRange[]): readonly number[] {
  const order: number[] = [];
  for (let index = 0; index < spans.length; index += 1) if (spans[index]!.start < spans[index]!.end) order.push(index);
  order.sort(
    (left, right) => spans[left]!.start - spans[right]!.start || spans[right]!.end - spans[left]!.end || left - right,
  );
  return order;
}

function identify(spans: readonly SpanRange[], index: number): IdentifiedSpanRange {
  return { index, start: spans[index]!.start, end: spans[index]!.end };
}

function describeSpan(span: IdentifiedSpanRange): string {
  return `span ${span.index} [${span.start}, ${span.end})`;
}

function sameProperties<Properties extends object>(left: Properties, right: Properties): boolean {
  if (left === right) return true;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.is(Reflect.get(left, key), Reflect.get(right, key)));
}
