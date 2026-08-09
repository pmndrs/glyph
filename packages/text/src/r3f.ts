import { useThree, type ThreeElements } from '@react-three/fiber/webgpu';
import {
  createElement,
  isValidElement,
  use,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';

import type { GlyphPaintInput, ParagraphSpan } from './formatted-text.js';
import type { FontSelection, LoadedFont } from './loaded-font.js';
import type { ParagraphContentBox } from './paragraph-batch.js';
import type { ParagraphStyle } from './paragraph.js';
import type { AnyRasterTechnique } from './raster-technique.js';
import type { LoadedFontRequest } from './text-runtime.js';
import {
  FontLoader,
  Text as ThreeText,
  TextGroup as ThreeTextGroup,
  type StandaloneTextProperties,
  type TextGroupOptions,
  type ThreeRenderVariant,
} from './three.js';

type Object3DProps = Omit<ThreeElements['object3D'], 'children' | 'ref'>;

export type R3fTextChild<Technique extends AnyRasterTechnique, Variant> =
  | string
  | number
  | null
  | false
  | ReactElement<R3fTextProps<Technique, Variant>>
  | readonly R3fTextChild<Technique, Variant>[];

export type R3fTextProps<Technique extends AnyRasterTechnique, Variant = ThreeRenderVariant> = Object3DProps & {
  readonly font?: FontSelection<Technique>;
  readonly children?: R3fTextChild<Technique, Variant>;
  readonly contentBox?: ParagraphContentBox;
  readonly style?: ParagraphStyle;
  readonly paint?: GlyphPaintInput;
  readonly rasterPixelRatio?: number;
  readonly renderVariant?: Variant;
  readonly capacity?: StandaloneTextProperties<Technique, Variant>['capacity'];
  readonly onError?: ((error: unknown) => void) | undefined;
  readonly ref?: Ref<ThreeText<Technique, Variant>>;
};

export type R3fTextGroupProps<Technique extends AnyRasterTechnique, Variant = ThreeRenderVariant> = Object3DProps &
  TextGroupOptions<Technique, Variant> & {
    readonly children?: ReactNode;
    readonly onError?: ((error: unknown) => void) | undefined;
    readonly ref?: Ref<ThreeTextGroup<Technique, Variant>>;
  };

interface FlattenedText<Technique extends AnyRasterTechnique, Variant> {
  readonly text: string;
  readonly spans: readonly ParagraphSpan<Technique, Variant>[];
}

interface InlineProperties<Technique extends AnyRasterTechnique, Variant> {
  readonly font?: FontSelection<Technique>;
  readonly style?: ParagraphStyle;
  readonly paint?: GlyphPaintInput;
  readonly renderVariant?: Variant;
}

interface UseFont {
  <Technique extends AnyRasterTechnique>(request: LoadedFontRequest<Technique>): LoadedFont<Technique>;
  preload<Technique extends AnyRasterTechnique>(request: LoadedFontRequest<Technique>): Promise<LoadedFont<Technique>>;
  clear<Technique extends AnyRasterTechnique>(request: LoadedFontRequest<Technique>): void;
}

const fontLoader = new FontLoader();
const fontPromises = new Map<string, Promise<LoadedFont<AnyRasterTechnique>>>();
const techniqueIds = new WeakMap<object, number>();
let nextTechniqueId = 1;

export function Text<Technique extends AnyRasterTechnique, Variant = ThreeRenderVariant>(
  input: R3fTextProps<Technique, Variant>,
): ReactElement | null {
  const { ref: forwardedRef, ...properties } = input;
  const flattened = useMemo(() => flattenText<Technique, Variant>(properties.children), [properties.children]);
  const desired = textProperties(properties, flattened);
  const appliedRef = useRef<typeof desired | undefined>(undefined);
  const capacityRef = useRef(properties.capacity);
  const [store] = useState(() => createObjectStore<ThreeText<Technique, Variant>>());
  const object = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const invalidate = useThree((state) => state.invalidate);
  const onErrorRef = useRef(properties.onError);
  const createObject = useEffectEvent(() => {
    if (desired.font === undefined) throw new TypeError('an outer R3F Text requires a font');
    const created = new ThreeText(desired as StandaloneTextProperties<Technique, Variant>);
    created.onError = (error: unknown) => onErrorRef.current?.(error);
    appliedRef.current = desired;
    return created;
  });

  useLayoutEffect(() => {
    const created = createObject();
    store.publish(created);
    return () => {
      store.publish(undefined);
      created.dispose();
    };
  }, [store]);

  useLayoutEffect(() => assignRef(forwardedRef, object), [forwardedRef, object]);

  useLayoutEffect(() => {
    if (object === undefined || desired.font === undefined) return;
    const { capacity, ...update } = desired;
    if (!sameDesiredText(appliedRef.current, desired)) {
      object.set(update as StandaloneTextProperties<Technique, Variant>);
      appliedRef.current = desired;
    }
    if (capacity !== undefined && !sameCapacity(capacity, capacityRef.current)) object.setCapacity(capacity);
    capacityRef.current = capacity;
    invalidate();
  }, [desired, invalidate, object]);

  useLayoutEffect(() => {
    onErrorRef.current = properties.onError;
  }, [properties.onError]);

  if (object === undefined) return null;
  return createElement('primitive', {
    ...objectProperties(properties),
    object,
  });
}

export function TextGroup<Technique extends AnyRasterTechnique, Variant = ThreeRenderVariant>(
  input: R3fTextGroupProps<Technique, Variant>,
): ReactElement | null {
  const { ref: forwardedRef, ...properties } = input;
  const [store] = useState(() => createObjectStore<ThreeTextGroup<Technique, Variant>>());
  const object = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const invalidate = useThree((state) => state.invalidate);
  const onErrorRef = useRef(properties.onError);
  const createObject = useEffectEvent(() => {
    const created = new ThreeTextGroup<Technique, Variant>({
      ...(properties.capacity === undefined ? {} : { capacity: properties.capacity }),
      ...(properties.renderOrder === undefined ? {} : { renderOrder: properties.renderOrder }),
      ...(properties.renderVariant === undefined ? {} : { renderVariant: properties.renderVariant }),
    });
    created.onError = (error: unknown) => onErrorRef.current?.(error);
    return created;
  });

  useLayoutEffect(() => {
    const created = createObject();
    store.publish(created);
    return () => {
      store.publish(undefined);
      created.dispose();
    };
  }, [store]);

  useLayoutEffect(() => assignRef(forwardedRef, object), [forwardedRef, object]);

  useLayoutEffect(() => {
    if (object === undefined) return;
    if (properties.capacity !== undefined && !sameCapacity(properties.capacity, object))
      object.setCapacity(properties.capacity);
    object.setRenderVariant(properties.renderVariant);
    invalidate();
  }, [invalidate, object, properties.capacity, properties.renderVariant]);

  useLayoutEffect(() => {
    onErrorRef.current = properties.onError;
  }, [properties.onError]);

  if (object === undefined) return null;
  return createElement(
    'primitive',
    {
      ...groupObjectProperties(properties),
      object,
    },
    properties.children,
  );
}

const useFontImplementation = (<Technique extends AnyRasterTechnique>(
  request: LoadedFontRequest<Technique>,
): LoadedFont<Technique> => use(preloadFont(request))) as UseFont;

useFontImplementation.preload = preloadFont;
useFontImplementation.clear = (request): void => {
  fontPromises.delete(fontRequestKey(request));
};

export const useFont: UseFont = useFontImplementation;

interface ObjectStore<Value> {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => Value | undefined;
  readonly publish: (value: Value | undefined) => void;
}

function createObjectStore<Value>(): ObjectStore<Value> {
  let current: Value | undefined;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => current,
    publish(value) {
      if (current === value) return;
      current = value;
      for (const listener of listeners) listener();
    },
  };
}

function assignRef<Value>(ref: Ref<Value> | undefined, value: Value | undefined): () => void {
  const resolved = value ?? null;
  if (typeof ref === 'function') ref(resolved);
  else if (ref !== undefined && ref !== null) ref.current = resolved;
  return () => {
    if (typeof ref === 'function') ref(null);
    else if (ref !== undefined && ref !== null) ref.current = null;
  };
}

function preloadFont<Technique extends AnyRasterTechnique>(
  request: LoadedFontRequest<Technique>,
): Promise<LoadedFont<Technique>> {
  const key = fontRequestKey(request);
  let promise = fontPromises.get(key) as Promise<LoadedFont<Technique>> | undefined;
  if (promise !== undefined) return promise;
  promise = fontLoader.loadAsync(request).catch((error: unknown) => {
    if (fontPromises.get(key) === promise) fontPromises.delete(key);
    throw error;
  });
  fontPromises.set(key, promise as Promise<LoadedFont<AnyRasterTechnique>>);
  return promise;
}

function fontRequestKey<Technique extends AnyRasterTechnique>(request: LoadedFontRequest<Technique>): string {
  let techniqueId = techniqueIds.get(request.raster.technique);
  if (techniqueId === undefined) {
    techniqueId = nextTechniqueId++;
    techniqueIds.set(request.raster.technique, techniqueId);
  }
  const input =
    'baked' in request.input ? ['baked', String(request.input.baked)] : ['source', String(request.input.source)];
  return JSON.stringify([input, techniqueId, request.raster.options ?? null]);
}

function flattenText<Technique extends AnyRasterTechnique, Variant>(
  children: R3fTextChild<Technique, Variant> | undefined,
): FlattenedText<Technique, Variant> {
  const chunks: string[] = [];
  const spans: ParagraphSpan<Technique, Variant>[] = [];
  let length = 0;

  const append = (child: R3fTextChild<Technique, Variant>, inherited: InlineProperties<Technique, Variant>): void => {
    if (child === null || child === false) return;
    if (typeof child === 'string' || typeof child === 'number') {
      const value = String(child);
      chunks.push(value);
      length += value.length;
      return;
    }
    if (Array.isArray(child)) {
      for (const nested of child) append(nested, inherited);
      return;
    }
    if (!isValidElement<R3fTextProps<Technique, Variant>>(child) || child.type !== Text)
      throw new TypeError('R3F Text children must be text, numbers, arrays, or nested Text elements');
    const inline = inlineProperties(child.props, inherited);
    const start = length;
    const spanIndex = spans.length;
    append(child.props.children ?? null, inline);
    if (start < length && Object.keys(inline).length !== 0)
      spans.splice(spanIndex, 0, Object.freeze({ start, end: length, ...inline }));
  };

  append(children ?? null, {});
  return Object.freeze({ text: chunks.join(''), spans: Object.freeze(spans) });
}

function inlineProperties<Technique extends AnyRasterTechnique, Variant>(
  properties: R3fTextProps<Technique, Variant>,
  inherited: InlineProperties<Technique, Variant>,
): InlineProperties<Technique, Variant> {
  return Object.freeze({
    ...((properties.font ?? inherited.font) === undefined ? {} : { font: properties.font ?? inherited.font }),
    ...(properties.style === undefined && inherited.style === undefined
      ? {}
      : { style: Object.freeze({ ...inherited.style, ...properties.style }) }),
    ...(properties.paint === undefined && inherited.paint === undefined
      ? {}
      : { paint: Object.freeze({ ...inherited.paint, ...properties.paint }) }),
    ...((properties.renderVariant ?? inherited.renderVariant) === undefined
      ? {}
      : { renderVariant: properties.renderVariant ?? inherited.renderVariant }),
  });
}

function textProperties<Technique extends AnyRasterTechnique, Variant>(
  properties: R3fTextProps<Technique, Variant>,
  flattened: FlattenedText<Technique, Variant>,
): Partial<StandaloneTextProperties<Technique, Variant>> & { readonly text: string } {
  return Object.freeze({
    ...(properties.font === undefined ? {} : { font: properties.font }),
    text: flattened.text,
    spans: flattened.spans,
    ...(properties.contentBox === undefined ? {} : { contentBox: properties.contentBox }),
    ...(properties.style === undefined ? {} : { style: properties.style }),
    ...(properties.paint === undefined ? {} : { paint: properties.paint }),
    ...(properties.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: properties.rasterPixelRatio }),
    ...(properties.renderVariant === undefined ? {} : { renderVariant: properties.renderVariant }),
    ...(properties.capacity === undefined ? {} : { capacity: properties.capacity }),
  });
}

function objectProperties<Technique extends AnyRasterTechnique, Variant>(
  properties: R3fTextProps<Technique, Variant>,
): Object3DProps {
  const object = { ...properties } as Record<string, unknown>;
  for (const key of [
    'font',
    'children',
    'contentBox',
    'style',
    'paint',
    'rasterPixelRatio',
    'renderVariant',
    'capacity',
    'onError',
    'ref',
  ])
    delete object[key];
  return object as Object3DProps;
}

function groupObjectProperties<Technique extends AnyRasterTechnique, Variant>(
  properties: R3fTextGroupProps<Technique, Variant>,
): Object3DProps {
  const object = { ...properties } as Record<string, unknown>;
  for (const key of ['capacity', 'renderVariant', 'children', 'onError', 'ref']) delete object[key];
  return object as Object3DProps;
}

export { span, txt } from './formatted-text.js';
export type { SpanFormat, SpanStyle, SpanTag, UnboundSpanTag } from './formatted-text.js';

function sameCapacity(
  capacity: NonNullable<StandaloneTextProperties<AnyRasterTechnique>['capacity']>,
  owner:
    | NonNullable<StandaloneTextProperties<AnyRasterTechnique>['capacity']>
    | { readonly capacity?: NonNullable<StandaloneTextProperties<AnyRasterTechnique>['capacity']> }
    | undefined,
): boolean {
  const current = owner === undefined ? undefined : 'size' in owner ? owner : owner.capacity;
  return current?.size === capacity.size && current.policy === capacity.policy;
}

function sameDesiredText<Technique extends AnyRasterTechnique, Variant>(
  left: (Partial<StandaloneTextProperties<Technique, Variant>> & { readonly text: string }) | undefined,
  right: Partial<StandaloneTextProperties<Technique, Variant>> & { readonly text: string },
): boolean {
  if (
    left === undefined ||
    left.font !== right.font ||
    left.text !== right.text ||
    left.rasterPixelRatio !== right.rasterPixelRatio ||
    left.renderVariant !== right.renderVariant ||
    !sameSnapshot(left.contentBox, right.contentBox) ||
    !sameSnapshot(left.style, right.style) ||
    !sameSnapshot(left.paint, right.paint)
  )
    return false;
  const leftSpans = left.spans ?? [];
  const rightSpans = right.spans ?? [];
  if (leftSpans.length !== rightSpans.length) return false;
  return leftSpans.every((span, index) => {
    const other = rightSpans[index];
    return (
      other !== undefined &&
      span.start === other.start &&
      span.end === other.end &&
      span.font === other.font &&
      span.renderVariant === other.renderVariant &&
      sameSnapshot(span.style, other.style) &&
      sameSnapshot(span.paint, other.paint)
    );
  });
}

function sameSnapshot(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => sameSnapshot(value, right[index]));
  }
  const leftRecord = left as Readonly<Record<string, unknown>>;
  const rightRecord = right as Readonly<Record<string, unknown>>;
  const keys = Object.keys(leftRecord);
  if (keys.length !== Object.keys(rightRecord).length) return false;
  return keys.every((key) => key in rightRecord && sameSnapshot(leftRecord[key], rightRecord[key]));
}
