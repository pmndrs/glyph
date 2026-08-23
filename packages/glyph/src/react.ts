import { extend, useThree, type ThreeElement, type ThreeElements } from '@react-three/fiber/webgpu';
import {
  createElement,
  forwardRef,
  isValidElement,
  use,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';

import { type GlyphPaintInput, resolveRangesToClusters } from './formatted-text.js';
import type { FontSelection, FontStack, LoadedFont } from './loaded-font.js';
import type { ParagraphContentBox, ParagraphStyle } from './text-properties.js';
import type { AnyRasterTechnique } from './raster-technique.js';
import type { LoadedFontRequest, LoadedFontTechniques, LoadedFonts, LoadedFontsRequest } from './text-runtime.js';
import {
  FontLoader,
  Text as ThreeText,
  TextGroup as ThreeTextGroup,
  type StandaloneTextProperties,
  type TextGroupOptions,
  type TextSpan,
  type ThreeTextMaterial,
} from './three.js';

type Object3DProps = Omit<ThreeElements['object3D'], 'children' | 'ref'>;

// Pass-through props are forwarded to a `Text`/`TextGroup` element, not a bare `Object3D`. R3F keeps method
// signatures in element props, so props typed for the base class do not satisfy the subclass element.
type TextElementProps = Omit<ThreeElement<typeof ThreeText>, 'children' | 'ref'>;
type TextGroupElementProps = Omit<ThreeElement<typeof ThreeTextGroup>, 'children' | 'ref'>;

export type R3fTextChild<Technique extends AnyRasterTechnique> =
  | string
  | number
  | null
  | false
  | ReactElement<R3fTextProps<Technique>>
  | readonly R3fTextChild<Technique>[];

type R3fFontSelection<Technique extends AnyRasterTechnique> =
  | FontSelection<Technique>
  | (Technique extends AnyRasterTechnique ? FontSelection<Technique> : never);

type FontSelectionTechnique<Selection> =
  Selection extends LoadedFont<infer Technique>
    ? Technique
    : Selection extends FontStack<infer Technique>
      ? Technique
      : never;

export type R3fTextProps<Technique extends AnyRasterTechnique> = Object3DProps & {
  readonly font?: R3fFontSelection<Technique>;
  readonly children?: R3fTextChild<Technique>;
  readonly contentBox?: ParagraphContentBox;
  readonly style?: ParagraphStyle;
  readonly paint?: GlyphPaintInput;
  readonly rasterPixelRatio?: number;
  readonly material?: ThreeTextMaterial;
  readonly capacity?: StandaloneTextProperties<Technique>['capacity'];
  readonly pixelSnapping?: boolean;
  readonly onError?: ((error: unknown) => void) | undefined;
  readonly ref?: Ref<ThreeText<Technique>>;
};

export type R3fTextGroupProps = Object3DProps &
  TextGroupOptions & {
    readonly children?: ReactNode;
    readonly onError?: ((error: unknown) => void) | undefined;
    readonly ref?: Ref<ThreeTextGroup>;
  };

interface FlattenedText<Technique extends AnyRasterTechnique> {
  readonly text: string;
  readonly spans: readonly TextSpan<Technique>[];
}

interface InlineProperties<Technique extends AnyRasterTechnique> {
  readonly font?: FontSelection<Technique>;
  readonly style?: ParagraphStyle;
  readonly paint?: GlyphPaintInput;
  readonly material?: ThreeTextMaterial;
}

type DesiredR3fTextProperties<Technique extends AnyRasterTechnique> = Partial<StandaloneTextProperties<Technique>> & {
  readonly font: FontSelection<Technique>;
  readonly text: string;
};

interface UseFont {
  <Technique extends AnyRasterTechnique>(request: LoadedFontRequest<Technique>): LoadedFont<Technique>;
  <const Techniques extends LoadedFontTechniques>(request: LoadedFontsRequest<Techniques>): LoadedFonts<Techniques>;
  preload<Technique extends AnyRasterTechnique>(request: LoadedFontRequest<Technique>): Promise<LoadedFont<Technique>>;
  preload<const Techniques extends LoadedFontTechniques>(
    request: LoadedFontsRequest<Techniques>,
  ): Promise<LoadedFonts<Techniques>>;
  clear<Technique extends AnyRasterTechnique>(request: LoadedFontRequest<Technique>): void;
  clear<const Techniques extends LoadedFontTechniques>(request: LoadedFontsRequest<Techniques>): void;
}

const fontLoader = new FontLoader();
type AnyLoadedFontResult = LoadedFont<AnyRasterTechnique> | readonly LoadedFont<AnyRasterTechnique>[];
const fontPromises = new Map<string, Promise<AnyLoadedFontResult>>();
const techniqueIds = new WeakMap<object, number>();
let nextTechniqueId = 1;
const ThreeTextElement = extend(ThreeText);
const ThreeTextGroupElement = extend(ThreeTextGroup);

interface TextComponent {
  <const Selection, Technique extends AnyRasterTechnique = FontSelectionTechnique<Selection>>(
    input: Omit<R3fTextProps<Technique>, 'font'> & {
      readonly font: Selection & ([FontSelectionTechnique<Selection>] extends [never] ? never : unknown);
    },
  ): ReactElement | null;
  <Technique extends AnyRasterTechnique>(input: R3fTextProps<Technique>): ReactElement | null;
}

export const Text = forwardRef(function Text<Technique extends AnyRasterTechnique>(
  properties: Omit<R3fTextProps<Technique>, 'ref'>,
  forwardedRef: Ref<ThreeText<Technique>>,
): ReactElement | null {
  const flattened = useMemo(() => flattenText<Technique>(properties.children), [properties.children]);
  const desired = textProperties(properties, flattened);
  const [object, publishObject] = useState<ThreeText<Technique> | null>(null);
  useLayoutEffect(() => assignRef(forwardedRef, object ?? undefined), [forwardedRef, object]);
  if (desired.font === undefined) throw new TypeError('an outer R3F Text requires a font');
  return createElement(TextObject, {
    key: properties.pixelSnapping === true ? 'pixel-snapped' : 'unsnapped',
    desired: desired as DesiredR3fTextProperties<AnyRasterTechnique>,
    object: objectProperties(properties),
    onError: properties.onError,
    publishObject: publishObject as (value: ThreeText<AnyRasterTechnique> | null) => void,
  });
}) as TextComponent;

function TextObject({
  desired,
  object: objectProps,
  onError,
  publishObject: publishCommittedObject,
}: {
  readonly desired: DesiredR3fTextProperties<AnyRasterTechnique>;
  readonly object: TextElementProps;
  readonly onError: ((error: unknown) => void) | undefined;
  readonly publishObject: (value: ThreeText<AnyRasterTechnique> | null) => void;
}): ReactElement {
  const [constructorArguments] = useState<[StandaloneTextProperties<AnyRasterTechnique>]>(() => [
    desired as StandaloneTextProperties<AnyRasterTechnique>,
  ]);
  const appliedRef = useRef(desired);
  const capacityRef = useRef(desired.capacity);
  const [store] = useState(() => createObjectStore<ThreeText<AnyRasterTechnique>>());
  const object = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const invalidate = useThree((state) => state.invalidate);
  const publishObject = useMemo(
    () => (value: ThreeText<AnyRasterTechnique> | null) => {
      store.publish(value ?? undefined);
      publishCommittedObject(value);
    },
    [publishCommittedObject, store],
  );

  useLayoutEffect(() => {
    if (object === undefined) return;
    const { capacity, pixelSnapping: _pixelSnapping, ...update } = desired;
    if (!sameDesiredText(appliedRef.current, desired)) {
      object.set(update);
      appliedRef.current = desired;
    }
    if (capacity !== undefined && !sameCapacity(capacity, capacityRef.current)) object.setCapacity(capacity);
    capacityRef.current = capacity;
    invalidate();
  }, [desired, invalidate, object]);

  return createElement(ThreeTextElement, {
    ...objectProps,
    args: constructorArguments,
    onError,
    ref: publishObject,
  });
}

export const TextGroup: (input: R3fTextGroupProps) => ReactElement | null = forwardRef(function TextGroup(
  properties: Omit<R3fTextGroupProps, 'ref'>,
  forwardedRef: Ref<ThreeTextGroup>,
): ReactElement | null {
  const [object, publishObject] = useState<ThreeTextGroup | null>(null);
  useLayoutEffect(() => assignRef(forwardedRef, object ?? undefined), [forwardedRef, object]);
  return createElement(TextGroupObject, {
    key: `${properties.compositing ?? 'ordered'}:${properties.pixelSnapping === true ? 'pixel-snapped' : 'unsnapped'}`,
    object: groupObjectProperties(properties),
    options: properties,
    publishObject,
  });
}) as (input: R3fTextGroupProps) => ReactElement | null;

function TextGroupObject({
  object: objectProps,
  options,
  publishObject: publishCommittedObject,
}: {
  readonly object: TextGroupElementProps;
  readonly options: Omit<R3fTextGroupProps, 'ref'>;
  readonly publishObject: (value: ThreeTextGroup | null) => void;
}): ReactElement {
  const [constructorArguments] = useState<[TextGroupOptions]>(() => [
    {
      ...(options.capacity === undefined ? {} : { capacity: options.capacity }),
      ...(options.compositing === undefined ? {} : { compositing: options.compositing }),
      ...(options.renderOrder === undefined ? {} : { renderOrder: options.renderOrder }),
      ...(options.material === undefined ? {} : { material: options.material }),
      ...(options.pixelSnapping === undefined ? {} : { pixelSnapping: options.pixelSnapping }),
    },
  ]);
  const [store] = useState(() => createObjectStore<ThreeTextGroup>());
  const object = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const invalidate = useThree((state) => state.invalidate);
  const publishObject = useMemo(
    () => (value: ThreeTextGroup | null) => {
      store.publish(value ?? undefined);
      publishCommittedObject(value);
    },
    [publishCommittedObject, store],
  );

  useLayoutEffect(() => {
    if (object === undefined) return;
    if (options.capacity !== undefined && !sameCapacity(options.capacity, object)) object.setCapacity(options.capacity);
    object.setMaterial(options.material);
    invalidate();
  }, [invalidate, object, options.capacity, options.material]);

  return createElement(
    ThreeTextGroupElement,
    {
      ...objectProps,
      args: constructorArguments,
      onError: options.onError,
      ref: publishObject,
    },
    options.children,
  );
}

const useFontImplementation = ((
  request: LoadedFontRequest<AnyRasterTechnique> | LoadedFontsRequest<LoadedFontTechniques>,
): AnyLoadedFontResult => use(preloadFontInternal(request))) as UseFont;

useFontImplementation.preload = preloadFont;
useFontImplementation.clear = (
  request: LoadedFontRequest<AnyRasterTechnique> | LoadedFontsRequest<LoadedFontTechniques>,
): void => {
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
): Promise<LoadedFont<Technique>>;
function preloadFont<const Techniques extends LoadedFontTechniques>(
  request: LoadedFontsRequest<Techniques>,
): Promise<LoadedFonts<Techniques>>;
function preloadFont(
  request: LoadedFontRequest<AnyRasterTechnique> | LoadedFontsRequest<LoadedFontTechniques>,
): Promise<AnyLoadedFontResult> {
  return preloadFontInternal(request);
}

function preloadFontInternal(
  request: LoadedFontRequest<AnyRasterTechnique> | LoadedFontsRequest<LoadedFontTechniques>,
): Promise<AnyLoadedFontResult> {
  const key = fontRequestKey(request);
  let promise = fontPromises.get(key);
  if (promise !== undefined) return promise;
  const loaded = 'rasters' in request ? fontLoader.loadFontsAsync(request) : fontLoader.loadAsync(request);
  promise = loaded.catch((error: unknown) => {
    if (fontPromises.get(key) === promise) fontPromises.delete(key);
    throw error;
  });
  fontPromises.set(key, promise);
  return promise;
}

function fontRequestKey(
  request: LoadedFontRequest<AnyRasterTechnique> | LoadedFontsRequest<LoadedFontTechniques>,
): string {
  const rasters = 'rasters' in request ? request.rasters : [request.raster];
  const rasterKeys = rasters.map((raster) => [techniqueKey(raster.technique), raster.options ?? null]);
  const input =
    'baked' in request.input ? ['baked', String(request.input.baked)] : ['source', String(request.input.source)];
  return JSON.stringify([input, rasterKeys]);
}

function techniqueKey(technique: AnyRasterTechnique): number {
  let techniqueId = techniqueIds.get(technique);
  if (techniqueId === undefined) {
    techniqueId = nextTechniqueId++;
    techniqueIds.set(technique, techniqueId);
  }
  return techniqueId;
}

/**
 * Compile one `<Text>` element tree into the `(text, spans)` pair the engine consumes.
 *
 * The tree states no offsets. Every boundary below is derived at a concatenation JOIN -- `start` is
 * the length before a child's text is appended, `end` the length after -- and concatenation can
 * fuse the tail of one child with the head of the next into a single extended grapheme cluster,
 * naming an offset that is not a boundary of the text just produced. `resolveRangesToClusters`
 * settles those joins against the finished text under the one rule `compose` uses on the
 * `txt`/`span` tree: the fused cluster takes the style of its base, which is the earlier child's.
 */
function flattenText<Technique extends AnyRasterTechnique>(
  children: R3fTextChild<Technique> | undefined,
): FlattenedText<Technique> {
  const chunks: string[] = [];
  const spans: TextSpan<Technique>[] = [];
  let length = 0;

  const append = (child: R3fTextChild<Technique>, inherited: InlineProperties<Technique>): void => {
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
    if (!isValidElement<R3fTextProps<Technique>>(child) || child.type !== Text)
      throw new TypeError('R3F Text children must be text, numbers, arrays, or nested Text elements');
    const inline = inlineProperties(child.props, inherited);
    const start = length;
    const spanIndex = spans.length;
    append(child.props.children ?? null, inline);
    if (start < length && Object.keys(inline).length !== 0)
      spans.splice(spanIndex, 0, Object.freeze({ start, end: length, ...inline }));
  };

  append(children ?? null, {});
  const text = chunks.join('');
  return Object.freeze({ text, spans: Object.freeze(resolveRangesToClusters(text, spans)) });
}

function inlineProperties<Technique extends AnyRasterTechnique>(
  properties: R3fTextProps<Technique>,
  inherited: InlineProperties<Technique>,
): InlineProperties<Technique> {
  return Object.freeze({
    ...((properties.font ?? inherited.font) === undefined ? {} : { font: properties.font ?? inherited.font }),
    ...(properties.style === undefined && inherited.style === undefined
      ? {}
      : { style: Object.freeze({ ...inherited.style, ...properties.style }) }),
    ...(properties.paint === undefined && inherited.paint === undefined
      ? {}
      : { paint: Object.freeze({ ...inherited.paint, ...properties.paint }) }),
    ...((properties.material ?? inherited.material) === undefined
      ? {}
      : { material: properties.material ?? inherited.material }),
  });
}

function textProperties<Technique extends AnyRasterTechnique>(
  properties: R3fTextProps<Technique>,
  flattened: FlattenedText<Technique>,
): Partial<StandaloneTextProperties<Technique>> & { readonly text: string } {
  return Object.freeze({
    ...(properties.font === undefined ? {} : { font: properties.font }),
    text: flattened.text,
    spans: flattened.spans,
    ...(properties.contentBox === undefined ? {} : { contentBox: properties.contentBox }),
    ...(properties.style === undefined ? {} : { style: properties.style }),
    ...(properties.paint === undefined ? {} : { paint: properties.paint }),
    ...(properties.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: properties.rasterPixelRatio }),
    ...(properties.material === undefined ? {} : { material: properties.material }),
    ...(properties.capacity === undefined ? {} : { capacity: properties.capacity }),
    ...(properties.pixelSnapping === undefined ? {} : { pixelSnapping: properties.pixelSnapping }),
  });
}

function objectProperties<Technique extends AnyRasterTechnique>(properties: R3fTextProps<Technique>): TextElementProps {
  const object = { ...properties } as Record<string, unknown>;
  for (const key of [
    'font',
    'children',
    'contentBox',
    'style',
    'paint',
    'rasterPixelRatio',
    'material',
    'capacity',
    'pixelSnapping',
    'onError',
    'ref',
  ])
    delete object[key];
  return object as TextElementProps;
}

function groupObjectProperties(properties: R3fTextGroupProps): TextGroupElementProps {
  const object = { ...properties } as Record<string, unknown>;
  for (const key of ['capacity', 'compositing', 'material', 'pixelSnapping', 'children', 'onError', 'ref'])
    delete object[key];
  return object as TextGroupElementProps;
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

function sameDesiredText<Technique extends AnyRasterTechnique>(
  left: (Partial<StandaloneTextProperties<Technique>> & { readonly text: string }) | undefined,
  right: Partial<StandaloneTextProperties<Technique>> & { readonly text: string },
): boolean {
  if (
    left === undefined ||
    left.font !== right.font ||
    left.text !== right.text ||
    left.rasterPixelRatio !== right.rasterPixelRatio ||
    left.material !== right.material ||
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
      span.material === other.material &&
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
