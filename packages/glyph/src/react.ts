import { extend, useLoader, useThree, type ThreeElement, type ThreeElements } from '@react-three/fiber/webgpu';
import {
  createElement,
  forwardRef,
  isValidElement,
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
import type { Font } from './font.js';
import { immutableFontRequestKey, type LoadFontInput } from './loader.js';
import { cloneImmutableFont, type FontSelection, type FontStack } from './loaded-font.js';
import type { ParagraphContentBox, ParagraphStyle } from './text-properties.js';
import type { AnyRasterTechnique, RasterOptionsOf } from './raster-technique.js';
import {
  FontLoader as ThreeFontLoader,
  Text as ThreeText,
  TextGroup as ThreeTextGroup,
  type StandaloneTextProperties,
  type TextGroupOptions,
  type TextSpan as ThreeTextSpanRecord,
  type ThreeFontLoadRequest,
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

type R3fFontSelection<Technique extends AnyRasterTechnique> = FontSelection<Technique>;

type FontSelectionTechnique<Selection> =
  Selection extends Font<infer Technique>
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
  readonly spans: readonly ThreeTextSpanRecord<Technique>[];
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

type TechniqueOptions<Technique extends AnyRasterTechnique> = [RasterOptionsOf<Technique>] extends [never]
  ? []
  : undefined extends RasterOptionsOf<Technique>
    ? [options?: RasterOptionsOf<Technique>]
    : [options: RasterOptionsOf<Technique>];

/** Generic R3F font hook for built-in and third-party raster techniques. */
export interface UseFont {
  /** Load one font and retain its mounted lease through React. */
  <Technique extends AnyRasterTechnique>(
    input: LoadFontInput,
    technique: Technique,
    ...options: TechniqueOptions<Technique>
  ): Font<Technique>;
  /** Start the same cached load before a component requests it. */
  preload<Technique extends AnyRasterTechnique>(
    input: LoadFontInput,
    technique: Technique,
    ...options: TechniqueOptions<Technique>
  ): void;
  /** Release the cached lease without invalidating mounted consumers. */
  clear<Technique extends AnyRasterTechnique>(
    input: LoadFontInput,
    technique: Technique,
    ...options: TechniqueOptions<Technique>
  ): void;
}

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

/** R3F paragraph component backed by one retained Three text instance. */
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

/** R3F retained batching boundary for descendant Text components. */
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

/** Load a typed Font through R3F's shared Suspense cache. */
export const useFont = ((
  input: LoadFontInput,
  technique: AnyRasterTechnique,
  ...options: readonly [unknown?]
): Font<AnyRasterTechnique> => {
  const { key, request } = reactFontRequest(input, technique, options);
  const retained = useReactFontLoader(ReactFontLoader, request, undefined, undefined, key);
  const store = useMemo(() => createMountedFontStore(retained), [retained]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}) as UseFont;
useFont.preload = (input: LoadFontInput, technique: AnyRasterTechnique, ...options: readonly [unknown?]): void => {
  const { key, request } = reactFontRequest(input, technique, options);
  useReactFontLoader.preload(ReactFontLoader, request, undefined, undefined, key);
};
useFont.clear = (input: LoadFontInput, technique: AnyRasterTechnique, ...options: readonly [unknown?]): void => {
  const { key, request } = reactFontRequest(input, technique, options);
  reactFontLoader().release(key);
  useReactFontLoader.clear(ReactFontLoader, request, key);
};

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

interface ReactFontRequest {
  readonly key: string;
  readonly request: ThreeFontLoadRequest<AnyRasterTechnique>;
}

interface ReactFontLoad {
  cancelled: boolean;
  readonly controller: AbortController;
  font: Font<AnyRasterTechnique> | undefined;
}

class ReactFontLoader extends ThreeFontLoader {
  readonly #loads = new Map<string, ReactFontLoad>();

  override load<Technique extends AnyRasterTechnique>(
    request: ThreeFontLoadRequest<Technique>,
    onLoad: (font: Font<Technique>) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ): void {
    const key = immutableFontRequestKey(request.input, request.raster);
    const load: ReactFontLoad = { cancelled: false, controller: new AbortController(), font: undefined };
    const loader = new ThreeFontLoader(this.manager);
    this.#loads.set(key, load);
    loader.load(
      { ...request, signal: load.controller.signal },
      (font) => {
        loader.dispose();
        if (load.cancelled || this.#loads.get(key) !== load) {
          font.dispose();
          onError?.(new DOMException('React font load was cleared', 'AbortError'));
          return;
        }
        load.font = font;
        onLoad(font);
      },
      onProgress,
      (error) => {
        loader.dispose();
        if (this.#loads.get(key) === load) this.#loads.delete(key);
        onError?.(error);
      },
    );
  }

  release(key: string): void {
    const load = this.#loads.get(key);
    if (load === undefined) return;
    this.#loads.delete(key);
    load.cancelled = true;
    load.controller.abort(new DOMException('React font load was cleared', 'AbortError'));
    load.font?.dispose();
    load.font = undefined;
  }
}

interface UseReactFontLoader {
  (
    loader: typeof ReactFontLoader,
    request: ThreeFontLoadRequest<AnyRasterTechnique>,
    extensions: undefined,
    onProgress: undefined,
    cacheKey: string,
  ): Font<AnyRasterTechnique>;
  preload(
    loader: typeof ReactFontLoader,
    request: ThreeFontLoadRequest<AnyRasterTechnique>,
    extensions: undefined,
    onProgress: undefined,
    cacheKey: string,
  ): void;
  clear(loader: typeof ReactFontLoader, request: ThreeFontLoadRequest<AnyRasterTechnique>, cacheKey: string): void;
}

const useReactFontLoader = useLoader as unknown as UseReactFontLoader;

function reactFontLoader(): ReactFontLoader {
  return useLoader.loader(ReactFontLoader as never) as unknown as ReactFontLoader;
}

function reactFontRequest(
  input: LoadFontInput,
  technique: AnyRasterTechnique,
  options: readonly [unknown?],
): ReactFontRequest {
  const request = {
    input,
    raster: options.length === 0 || options[0] === undefined ? { technique } : { technique, options: options[0] },
  } as ThreeFontLoadRequest<AnyRasterTechnique>;
  return { key: immutableFontRequestKey(request.input, request.raster), request };
}

interface MountedFontStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => Font<AnyRasterTechnique>;
}

function createMountedFontStore(source: Font<AnyRasterTechnique>): MountedFontStore {
  let current = source;
  let mounted: Font<AnyRasterTechnique> | undefined;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      if (mounted === undefined) {
        mounted = cloneImmutableFont(source);
        current = mounted;
        for (const subscriber of listeners) subscriber();
      }
      return () => {
        if (!listeners.delete(listener) || listeners.size !== 0 || mounted === undefined) return;
        const released = mounted;
        mounted = undefined;
        current = source;
        released.dispose();
      };
    },
    getSnapshot: () => current,
  };
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
  const spans: ThreeTextSpanRecord<Technique>[] = [];
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
    assertInlineTextProperties(child.props);
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

const INLINE_TEXT_PROPERTIES = new Set(['children', 'font', 'material', 'paint', 'style']);

function assertInlineTextProperties<Technique extends AnyRasterTechnique>(properties: R3fTextProps<Technique>): void {
  for (const key of Object.keys(properties)) {
    if (!INLINE_TEXT_PROPERTIES.has(key)) throw new TypeError(`nested R3F Text cannot use the box property ${key}`);
  }
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
