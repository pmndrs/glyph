import { Comment, Fragment, Text as TextVNode, isVNode, type VNode, type VNodeArrayChildren } from 'vue';

import type { FontFaceSelection } from '../../font-face.js';
import { resolveRangesToClusters } from '../../formatted-text.js';
import type { FontSelection } from '../../loaded-font.js';
import { mergePropertyList } from '../../property-list.js';
import type { PropertyList, TextStyle } from '../../text-properties.js';
import type { RasterFormatMetadata } from '../../config/raster-format.js';
import type { ThreeTextMaterial } from '../../three/material.js';

export type VueFontSelectionInput = FontSelection<RasterFormatMetadata> | FontFaceSelection | string;

export interface PendingVueTextSpan {
  readonly start: number;
  readonly end: number;
  readonly font?: FontSelection<RasterFormatMetadata> | FontFaceSelection;
  readonly style?: TextStyle;
  readonly material?: ThreeTextMaterial;
}

export interface PendingFlattenedVueText {
  readonly text: string;
  readonly spans: readonly PendingVueTextSpan[];
  readonly fontFaces: readonly FontFaceSelection[];
}

export interface FlattenVueTextOptions {
  readonly isText: (type: unknown) => boolean;
  readonly resolveFont: (selection: VueFontSelectionInput) => FontSelection<RasterFormatMetadata> | FontFaceSelection;
  readonly isFontFaceSelection: (value: unknown) => value is FontFaceSelection;
}

interface InlineProperties {
  readonly font?: VueFontSelectionInput;
  readonly style?: TextStyle;
  readonly material?: ThreeTextMaterial;
}

/** Vue attaches these to every VNode; they are never Text properties. */
const VNODE_BOOKKEEPING = new Set(['key', 'ref', 'ref_for', 'ref_key']);
const INLINE_TEXT_PROPERTIES = new Set(['font', 'material', 'style']);

/** Boundaries are JOIN offsets in the concatenated text; when a JOIN fuses a grapheme cluster across children, `resolveRangesToClusters` gives the fused cluster the earlier child's style. */
export function flattenVueText(
  children: VNodeArrayChildren | string | number | undefined | null,
  options: FlattenVueTextOptions,
): PendingFlattenedVueText {
  const chunks: string[] = [];
  const spans: PendingVueTextSpan[] = [];
  const fontFaces: FontFaceSelection[] = [];
  let length = 0;

  const appendText = (value: string): void => {
    chunks.push(value);
    length += value.length;
  };

  const append = (child: unknown, inherited: InlineProperties): void => {
    if (child === null || child === undefined || child === false || child === true) return;
    if (typeof child === 'string' || typeof child === 'number') {
      appendText(String(child));
      return;
    }
    if (Array.isArray(child)) {
      for (const nested of child) append(nested, inherited);
      return;
    }
    if (!isVNode(child)) throw invalidChild();
    if (child.type === TextVNode) {
      appendText(String(child.children));
      return;
    }
    if (child.type === Comment) return;
    if (child.type === Fragment) {
      append(child.children, inherited);
      return;
    }
    if (!options.isText(child.type)) throw invalidChild();
    const properties = nestedProperties(child);
    const inline = inlineProperties(properties, inherited);
    const start = length;
    const spanIndex = spans.length;
    append(componentChildren(child), inline);
    if (start < length && Object.keys(inline).length !== 0) {
      spans.splice(spanIndex, 0, Object.freeze({ start, end: length, ...pendingInlineProperties(inline) }));
    }
  };

  const pendingInlineProperties = (properties: InlineProperties): Omit<PendingVueTextSpan, 'start' | 'end'> => {
    const { font, ...rest } = properties;
    if (font === undefined) return rest;
    const resolved = options.resolveFont(font);
    if (options.isFontFaceSelection(resolved) && !fontFaces.includes(resolved)) fontFaces.push(resolved);
    return { ...rest, font: resolved };
  };

  append(children, {});
  const text = chunks.join('');
  return Object.freeze({
    text,
    spans: Object.freeze(resolveRangesToClusters(text, spans)),
    fontFaces: Object.freeze(fontFaces),
  });
}

function invalidChild(): TypeError {
  return new TypeError('Vue Text children must be text, numbers, arrays, or nested Text components');
}

// Only the default slot is text content.
function componentChildren(vnode: VNode): unknown {
  const { children } = vnode;
  if (children === null || typeof children !== 'object' || Array.isArray(children)) return children;
  const slot = (children as Record<string, unknown>).default;
  return typeof slot === 'function' ? (slot as () => unknown)() : undefined;
}

function nestedProperties(vnode: VNode): InlineProperties {
  const props = vnode.props ?? {};
  const inline: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (VNODE_BOOKKEEPING.has(key)) continue;
    const name = camelize(key);
    if (!INLINE_TEXT_PROPERTIES.has(name)) {
      throw new TypeError(`nested Vue Text cannot use the box property ${name}`);
    }
    inline[name] = value;
  }
  return inline as InlineProperties;
}

function camelize(key: string): string {
  return key.replaceAll(/-(\w)/g, (_, letter: string) => letter.toUpperCase());
}

function inlineProperties(properties: InlineProperties, inherited: InlineProperties): InlineProperties {
  const statedStyle = mergePropertyList(properties.style as PropertyList<TextStyle>, 'nested Text style');
  const style =
    Object.keys(statedStyle).length === 0 ? inherited.style : Object.freeze({ ...inherited.style, ...statedStyle });
  const font = properties.font ?? inherited.font;
  const material = properties.material ?? inherited.material;
  return Object.freeze({
    ...(font === undefined ? {} : { font }),
    ...(style === undefined ? {} : { style }),
    ...(material === undefined ? {} : { material }),
  });
}
