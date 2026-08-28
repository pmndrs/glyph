import { extend, useThree, type ThreeElement, type ThreeElements } from '@react-three/fiber/webgpu';
import {
  createElement,
  createContext,
  forwardRef,
  isValidElement,
  use,
  useLayoutEffect,
  useContext,
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
import {
  assertFontLibrary,
  fontLibraryOwnedResource,
  type FontLibrary,
  type FontRequest,
  type FontTechniques,
  type Fonts,
  type MultiRasterFontRequest,
} from './loader.js';
import { cloneImmutableFont, type FontSelection, type FontStack } from './loaded-font.js';
import type { ParagraphContentBox, ParagraphStyle } from './text-properties.js';
import type { AnyRasterTechnique } from './raster-technique.js';
import {
  FontLoader as ThreeFontLoader,
  Text as ThreeText,
  TextGroup as ThreeTextGroup,
  type StandaloneTextProperties,
  type TextGroupOptions,
  type TextSpan as ThreeTextSpanRecord,
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
  | ReactElement<R3fTextSpanProps<Technique>>
  | readonly R3fTextChild<Technique>[];

/**
 * Props of an inline `<TextSpan>`: exactly what a styled run inside a paragraph can carry.
 *
 * A span is not an object in the scene. It has no transform, no capacity, no error boundary, and no
 * instance to hold a ref to, because the whole tree collapses into one string and one span array
 * before any object exists. Naming those props here as `never` is what turns
 * `<Text><TextSpan position={…}>` into a type error instead of a prop the compiler accepts and the
 * flattener discards.
 *
 * Flutter draws the same line between `RichText`, which is a box, and `TextSpan`, which is not.
 */
export type R3fTextSpanProps<Technique extends AnyRasterTechnique> = {
  readonly font?: R3fFontSelection<Technique>;
  readonly children?: R3fTextChild<Technique>;
  readonly style?: ParagraphStyle;
  readonly paint?: GlyphPaintInput;
  readonly material?: ThreeTextMaterial;
} & { readonly [Key in BoxOnlyPropKey]?: never };

/**
 * The props that belong to the paragraph box and have no meaning on a run inside it.
 *
 * Derived from `R3fTextProps` rather than listed, so a prop added to the outer element cannot
 * quietly become a silently-discarded inline prop.
 */
type BoxOnlyPropKey = Exclude<keyof R3fTextProps<AnyRasterTechnique>, keyof InlineProperties<never> | 'children'>;

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

interface FontHook {
  <Technique extends AnyRasterTechnique>(request: FontRequest<Technique>): Font<Technique>;
  <const Techniques extends FontTechniques>(request: MultiRasterFontRequest<Techniques>): Fonts<Techniques>;
}

/** A provider-scoped Suspense hook with explicit library-owned preload and cache-release operations. */
export interface UseFont extends FontHook {
  preload<Technique extends AnyRasterTechnique>(library: FontLibrary, request: FontRequest<Technique>): Promise<void>;
  preload<const Techniques extends FontTechniques>(
    library: FontLibrary,
    request: MultiRasterFontRequest<Techniques>,
  ): Promise<void>;
  clear<Technique extends AnyRasterTechnique>(library: FontLibrary, request: FontRequest<Technique>): void;
  clear<const Techniques extends FontTechniques>(
    library: FontLibrary,
    request: MultiRasterFontRequest<Techniques>,
  ): void;
}

/** A FontLibrary-bound Suspense hook with explicit preload and cache-release operations. */
export interface BoundUseFont extends FontHook {
  preload<Technique extends AnyRasterTechnique>(request: FontRequest<Technique>): Promise<void>;
  preload<const Techniques extends FontTechniques>(request: MultiRasterFontRequest<Techniques>): Promise<void>;
  clear<Technique extends AnyRasterTechnique>(request: FontRequest<Technique>): void;
  clear<const Techniques extends FontTechniques>(request: MultiRasterFontRequest<Techniques>): void;
}

type AnyFontResult = Font<AnyRasterTechnique> | readonly Font<AnyRasterTechnique>[];
const techniqueIds = new WeakMap<object, number>();
const inputIds = new WeakMap<object, number>();
let nextTechniqueId = 1;
let nextInputId = 1;
const ThreeTextElement = extend(ThreeText);
const ThreeTextGroupElement = extend(ThreeTextGroup);
const FontScopeContext = createContext<ReactFontScope | undefined>(undefined);
const reactFontScopeResource = Object.freeze({});

/** Props for publishing one application-owned FontLibrary to descendant glyph hooks. */
export interface GlyphProviderProps {
  readonly children?: ReactNode;
  readonly library: FontLibrary;
}

/** Publish one explicit FontLibrary's stable Suspense scope to descendant hooks. */
export function GlyphProvider({ children, library }: GlyphProviderProps): ReactElement {
  assertFontLibrary(library, 'GlyphProvider');
  const scope = fontScope(library);
  return createElement(FontScopeContext.Provider, { value: scope }, children);
}

/** Bind a hook and module-scope preload/clear lifecycle to one explicit FontLibrary. */
export function createUseFont(library: FontLibrary): BoundUseFont {
  assertFontLibrary(library, 'createUseFont');
  const scope = fontScope(library);
  const bound = ((request: FontRequest<AnyRasterTechnique> | MultiRasterFontRequest<FontTechniques>) =>
    useScopedFont(scope, request)) as BoundUseFont;
  bound.preload = (request: FontRequest<AnyRasterTechnique> | MultiRasterFontRequest<FontTechniques>) =>
    scope.load(request).then(() => undefined);
  bound.clear = (request: FontRequest<AnyRasterTechnique> | MultiRasterFontRequest<FontTechniques>) => {
    scope.clear(request);
  };
  return bound;
}

function fontScope(library: FontLibrary): ReactFontScope {
  return fontLibraryOwnedResource(library, reactFontScopeResource, () => {
    const scope = new ReactFontScope(library);
    return { value: scope, dispose: () => scope.dispose() };
  });
}

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

/**
 * A styled run inside a `<Text>`. It renders nothing on its own.
 *
 * `flattenText` reads this element's props and never mounts it, which is why it must not accept
 * anything that would imply an object: a transform, a capacity, an error handler, or a ref would all
 * be accepted and then dropped. `<Text>` remains the paragraph; this is the span.
 */
export const TextSpan: TextSpanComponent = function TextSpan(): null {
  throw new TypeError('TextSpan is an inline run of a Text paragraph and cannot be rendered on its own');
} as TextSpanComponent;

/**
 * A span infers its technique from its own `font` exactly as `Text` does, because a span routinely
 * switches font — an icon run inside a text paragraph is the ordinary case — and a span with no font
 * inherits the surrounding one.
 */
interface TextSpanComponent {
  <const Selection, Technique extends AnyRasterTechnique = FontSelectionTechnique<Selection>>(
    input: Omit<R3fTextSpanProps<Technique>, 'font'> & {
      readonly font: Selection & ([FontSelectionTechnique<Selection>] extends [never] ? never : unknown);
    },
  ): ReactElement | null;
  <Technique extends AnyRasterTechnique>(input: R3fTextSpanProps<Technique>): ReactElement | null;
}

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

/** Reads a Font through the nearest GlyphProvider Suspense scope. */
export const useFont = ((
  request: FontRequest<AnyRasterTechnique> | MultiRasterFontRequest<FontTechniques>,
): AnyFontResult => {
  const scope = useContext(FontScopeContext);
  if (scope === undefined) throw new Error('useFont requires a GlyphProvider or createUseFont(FontLibrary)');
  return useScopedFont(scope, request);
}) as UseFont;
useFont.preload = (
  library: FontLibrary,
  request: FontRequest<AnyRasterTechnique> | MultiRasterFontRequest<FontTechniques>,
) => {
  assertFontLibrary(library, 'useFont.preload');
  return fontScope(library)
    .load(request)
    .then(() => undefined);
};
useFont.clear = (
  library: FontLibrary,
  request: FontRequest<AnyRasterTechnique> | MultiRasterFontRequest<FontTechniques>,
) => {
  assertFontLibrary(library, 'useFont.clear');
  fontScope(library).clear(request);
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

class ReactFontScope {
  readonly #library: FontLibrary;
  readonly #loader: ThreeFontLoader;
  readonly #resources = new Map<string, ReactFontResource>();
  #disposed = false;

  constructor(library: FontLibrary) {
    this.#library = library;
    this.#loader = new ThreeFontLoader(undefined, { library });
  }

  load(request: FontRequest<AnyRasterTechnique> | MultiRasterFontRequest<FontTechniques>): Promise<AnyFontResult> {
    if (this.#disposed) throw new Error('React font scope has been disposed');
    const key = fontRequestKey(request);
    const cached = this.#resources.get(key);
    if (cached !== undefined) return cached.promise;
    const loading = 'rasters' in request ? this.#loader.loadFontsAsync(request) : this.#loader.loadAsync(request);
    const resource: ReactFontResource = { promise: undefined as never, value: undefined };
    resource.promise = loading.then(
      (font) => {
        if (!this.#disposed && this.#resources.get(key) === resource) {
          resource.value = font;
          return font;
        }
        disposeFontResult(font);
        throw new DOMException('React font scope was disposed while loading', 'AbortError');
      },
      (error: unknown) => {
        if (this.#resources.get(key) === resource) this.#resources.delete(key);
        throw error;
      },
    );
    this.#resources.set(key, resource);
    return resource.promise;
  }

  clear(request: FontRequest<AnyRasterTechnique> | MultiRasterFontRequest<FontTechniques>): void {
    if (this.#disposed) throw new Error('React font scope has been disposed');
    const key = fontRequestKey(request);
    const resource = this.#resources.get(key);
    this.#resources.delete(key);
    releaseReactFontResource(resource);
    if ('rasters' in request) this.#library.clear(request);
    else this.#library.clear(request);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const resources = [...this.#resources.values()];
    this.#resources.clear();
    for (const resource of resources) releaseReactFontResource(resource);
    this.#loader.dispose();
  }
}

interface ReactFontResource {
  promise: Promise<AnyFontResult>;
  value: AnyFontResult | undefined;
}

function releaseReactFontResource(resource: ReactFontResource | undefined): void {
  if (resource?.value !== undefined) disposeFontResult(resource.value);
  else
    void resource?.promise.then(
      () => undefined,
      () => undefined,
    );
}

function useScopedFont(
  scope: ReactFontScope,
  request: FontRequest<AnyRasterTechnique> | MultiRasterFontRequest<FontTechniques>,
): AnyFontResult {
  const retained = use(scope.load(request));
  const store = useMemo(() => createMountedFontStore(retained), [retained]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

interface MountedFontStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => AnyFontResult;
}

function createMountedFontStore(source: AnyFontResult): MountedFontStore {
  let current = source;
  let mounted: AnyFontResult | undefined;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      if (mounted === undefined) {
        mounted = cloneFontResult(source);
        current = mounted;
        for (const subscriber of listeners) subscriber();
      }
      return () => {
        if (!listeners.delete(listener) || listeners.size !== 0 || mounted === undefined) return;
        const released = mounted;
        mounted = undefined;
        current = source;
        disposeFontResult(released);
      };
    },
    getSnapshot: () => current,
  };
}

function fontRequestKey(request: FontRequest<AnyRasterTechnique> | MultiRasterFontRequest<FontTechniques>): string {
  const rasters = 'rasters' in request ? request.rasters : [request.raster];
  const rasterKeys = rasters.map((raster) => [techniqueKey(raster.technique), raster.options ?? null]);
  const input = fontInputKey(request.input);
  return JSON.stringify([input, rasterKeys]);
}

function fontInputKey(input: FontRequest<AnyRasterTechnique>['input']): readonly [string, string | number] {
  if (typeof input === 'string' || input instanceof URL) return ['location', String(input)];
  if ('bytes' in input) return ['bytes', inputIdentity(input)];
  if ('baked' in input && input.baked !== null) {
    return typeof input.baked === 'object' && !(input.baked instanceof URL)
      ? ['baked-bytes', inputIdentity(input.baked)]
      : ['baked', String(input.baked)];
  }
  return typeof input.source === 'object' && !(input.source instanceof URL)
    ? ['source-bytes', inputIdentity(input.source)]
    : ['source', String(input.source)];
}

function inputIdentity(value: object): number {
  let identity = inputIds.get(value);
  if (identity !== undefined) return identity;
  identity = nextInputId;
  nextInputId += 1;
  inputIds.set(value, identity);
  return identity;
}

function cloneFontResult(result: AnyFontResult): AnyFontResult {
  return 'dispose' in result
    ? cloneImmutableFont(result)
    : Object.freeze(result.map((font) => cloneImmutableFont(font)));
}

function disposeFontResult(result: AnyFontResult): void {
  if ('dispose' in result) {
    result.dispose();
  } else {
    for (const font of result) font.dispose();
  }
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
    if (!isValidElement<R3fTextSpanProps<Technique>>(child) || child.type !== TextSpan)
      throw new TypeError('R3F Text children must be text, numbers, arrays, or TextSpan elements');
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
  properties: R3fTextSpanProps<Technique>,
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
