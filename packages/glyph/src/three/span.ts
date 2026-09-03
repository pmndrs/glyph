import {
  createSpanTag,
  span as createPortableSpan,
  type SpanFormat,
  type SpanStyle,
  type SpanTag,
  type UnboundSpanTag,
} from '../formatted-text.js';
import type { FontSelection } from '../loaded-font.js';
import type { RasterFormatMetadata } from '../config/raster-format.js';
import type { ThreeTextMaterial } from './material.js';

type ThreeSpanFormat<Format extends RasterFormatMetadata> = SpanFormat<Format> | ThreeTextMaterial;

/** Structural Three span tag with an optional renderer-owned material selector. */
export function span(
  ...formats: readonly [SpanStyle | ThreeTextMaterial, ...(SpanStyle | ThreeTextMaterial)[]]
): UnboundSpanTag;
export function span<Format extends RasterFormatMetadata>(
  font: FontSelection<Format>,
  ...formats: readonly ThreeSpanFormat<NoInfer<Format>>[]
): SpanTag<Format>;
export function span<Format extends RasterFormatMetadata>(
  first: FontSelection<Format> | SpanStyle | ThreeTextMaterial,
  ...rest: readonly ThreeSpanFormat<Format>[]
): SpanTag<Format> | UnboundSpanTag {
  let material: ThreeTextMaterial | undefined;
  const portable: (FontSelection<Format> | SpanStyle)[] = [];
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
    return createSpanTag<Format, Readonly<{ material: ThreeTextMaterial }>>({ material: material! });
  }

  const portableTag = (
    createPortableSpan as (
      first: FontSelection<Format> | SpanStyle,
      ...rest: readonly SpanFormat<Format>[]
    ) => SpanTag<Format>
  )(portable[0]!, ...portable.slice(1));
  if (material === undefined) return portableTag;
  const selected = material;
  const materialTag: SpanTag<Format> = (...input: Parameters<SpanTag<Format>>) => {
    const fragment = portableTag(...input);
    return Object.freeze({
      ...fragment,
      properties: Object.freeze({ ...fragment.properties, material: selected }),
    });
  };
  return materialTag;
}

function isThreeTextMaterial(value: unknown): value is ThreeTextMaterial {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'create') === 'function';
}
