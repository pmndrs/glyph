import {
  createSpanTag,
  span as createPortableSpan,
  type SpanFormat,
  type SpanStyle,
  type SpanTag,
  type TextSpanFragment,
  type UnboundSpanTag,
} from '../formatted-text.js';
import type { FontSelection } from '../loaded-font.js';
import type { AnyRasterFormat } from '../config/raster-format.js';
import type { ThreeTextMaterial } from './material.js';

type ThreeSpanFormat<Technique extends AnyRasterFormat> = SpanFormat<Technique> | ThreeTextMaterial;

/** Structural Three span tag with an optional renderer-owned material selector. */
export function span(
  ...formats: readonly [SpanStyle | ThreeTextMaterial, ...(SpanStyle | ThreeTextMaterial)[]]
): UnboundSpanTag;
export function span<Technique extends AnyRasterFormat>(
  font: FontSelection<Technique>,
  ...formats: readonly ThreeSpanFormat<NoInfer<Technique>>[]
): SpanTag<Technique>;
export function span<Technique extends AnyRasterFormat>(
  first: FontSelection<Technique> | SpanStyle | ThreeTextMaterial,
  ...rest: readonly ThreeSpanFormat<Technique>[]
): SpanTag<Technique> | UnboundSpanTag {
  let material: ThreeTextMaterial | undefined;
  const portable: (FontSelection<Technique> | SpanStyle)[] = [];
  for (const format of [first, ...rest]) {
    if (isThreeTextMaterial(format)) {
      if (material !== undefined)
        throw new TypeError('one structural span cannot declare more than one Three material');
      material = format;
    } else {
      portable.push(format);
    }
  }

  if (portable.length === 0) {
    return createSpanTag<Technique, Readonly<{ material: ThreeTextMaterial }>>({ material: material! });
  }

  const portableTag = (
    createPortableSpan as (
      first: FontSelection<Technique> | SpanStyle,
      ...rest: readonly SpanFormat<Technique>[]
    ) => SpanTag<Technique>
  )(portable[0]!, ...portable.slice(1));
  if (material === undefined) return portableTag;
  const selected = material;
  return ((...input: Parameters<SpanTag<Technique>>) => {
    const fragment = portableTag(...input);
    return Object.freeze({
      text: fragment.text,
      spans: fragment.spans,
      properties: Object.freeze({ ...fragment.properties, material: selected }),
    }) as unknown as TextSpanFragment<Technique>;
  }) as SpanTag<Technique>;
}

function isThreeTextMaterial(value: unknown): value is ThreeTextMaterial {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'create') === 'function';
}
