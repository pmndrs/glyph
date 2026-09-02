import { extend, useStore, useThree, type ThreeElement, type ThreeElements } from '@react-three/fiber/webgpu';
import {
  Component,
  Suspense,
  createElement,
  createContext,
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

import {
  fontFaceResourceKey,
  isFontFaceSelection,
  resolveFontFace,
  type AnyFontFace,
  type AnyFontFaceSelection,
  type FontFaceConfig,
  type FontFaceFormat,
  type FontFaceSource,
} from './font-face.js';
import { resolveRangesToClusters, type FormattedText, type TextInput } from './formatted-text.js';
import type { Font } from './font.js';
import { glyph } from './glyph.js';
import { FontLoadError } from './loader.js';
import { type FontSelection, type FontStack } from './loaded-font.js';
import { mergePropertyList } from './property-list.js';
import { type Constraints, type ParagraphLayout, type PropertyList, type TextStyle } from './text-properties.js';
import type { AnyRasterTechnique } from './raster-technique.js';
import {
  acquireThreeHandleFont,
  isThreeHandleFontLoaded,
  loadThreeHandleFont,
  threeHandleFontSource,
  threeHandleRoot,
  threeRootHandle,
} from './three/handle.js';
import {
  ThreeConfig,
  Text as ThreeText,
  TextGroup as ThreeTextGroup,
  type StandaloneTextProperties,
  type TextGroupOptions,
  type ThreeHandle,
  type ThreeRoot,
  type ThreeTextMaterial,
} from './three.js';
import { threeTextConstructionToken, type TextSpan as ThreeTextSpanRecord } from './three/text.js';

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

type R3fFontSelection<Technique extends AnyRasterTechnique> = FontSelection<Technique> | AnyFontFaceSelection | string;

type FontSelectionTechnique<Selection> =
  Selection extends Font<infer Technique>
    ? Technique
    : Selection extends FontStack<infer Technique>
      ? Technique
      : never;

export type R3fTextProps<Technique extends AnyRasterTechnique> = Object3DProps & {
  readonly font?: R3fFontSelection<Technique>;
  readonly children?: R3fTextChild<Technique>;
  /** Text shaping and presentation properties inherited by nested Text spans. */
  readonly style?: PropertyList<TextStyle>;
  /** Paragraph flow properties; nested Text spans cannot set this property. */
  readonly layout?: PropertyList<ParagraphLayout>;
  /** Bounds imposed on this root Text paragraph. */
  readonly constraints?: PropertyList<Constraints>;
  readonly rasterPixelRatio?: number;
  readonly material?: ThreeTextMaterial;
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
  readonly font?: R3fFontSelection<Technique>;
  readonly style?: TextStyle;
  readonly material?: ThreeTextMaterial;
}

type DesiredR3fTextProperties<Technique extends AnyRasterTechnique> = Partial<StandaloneTextProperties<Technique>> & {
  readonly font: FontSelection<Technique>;
  readonly text: TextInput<Technique>;
};

type DesiredR3fTextInput<Technique extends AnyRasterTechnique> = Omit<
  Partial<StandaloneTextProperties<Technique>>,
  'font'
> & {
  readonly font?: R3fFontSelection<Technique>;
  readonly text: TextInput<Technique>;
};

type HookFontConfig<Format extends FontFaceFormat = FontFaceFormat> = Omit<FontFaceConfig<Format>, 'family'>;

type TechniqueOfHookFormat<Format> = Format extends AnyRasterTechnique
  ? Format
  : Format extends { readonly technique: infer Technique extends AnyRasterTechnique }
    ? Technique
    : AnyRasterTechnique;

/** Generic R3F font hook over the selected Three handle's FontFace cache. */
export interface UseFont {
  /** Load one source's default or explicitly requested format and retain its mounted lease through React. */
  <const Format extends FontFaceFormat = FontFaceFormat>(
    input: FontFaceSource,
    config?: HookFontConfig<Format>,
  ): Font<TechniqueOfHookFormat<Format>>;
  /** Start the same default-handle load before a component requests it. */
  preload<const Format extends FontFaceFormat = FontFaceFormat>(
    input: FontFaceSource,
    config?: HookFontConfig<Format>,
  ): Promise<void>;
  /** Release the default-handle cache entry without invalidating mounted Font leases. */
  clear<const Format extends FontFaceFormat = FontFaceFormat>(
    input: FontFaceSource,
    config?: HookFontConfig<Format>,
  ): void;
}

const ThreeTextElement = extend(ThreeText);
const ThreeTextGroupElement = extend(ThreeTextGroup);
interface GlyphReactContext {
  readonly handle: ThreeHandle;
  readonly root: ThreeRoot;
  readonly fontFaces: ReadonlyMap<string, AnyFontFace>;
}

const GlyphHandleContext = createContext<GlyphReactContext | undefined>(undefined);
const defaultThreeHandleName = '@pmndrs/glyph/react:default';
const rootIds = new WeakMap<ThreeRoot, number>();
type R3fRootStore = ReturnType<typeof useStore>;
interface DefaultGlyphContextResource {
  readonly context: GlyphReactContext;
  retain(): () => void;
  dispose(): void;
}
const defaultContexts = new WeakMap<R3fRootStore, DefaultGlyphContextResource>();
const defaultRootNames = new WeakMap<R3fRootStore, string>();
const defaultRootFinalizer = new FinalizationRegistry<ThreeRoot>((root) => {
  try {
    root.dispose();
  } catch {
    // A finalizer is only an abandoned-render safety net; explicit React cleanup owns correctness.
  }
});
const emptyFontFaces: ReadonlyMap<string, AnyFontFace> = new Map();
let nextHandleId = 1;
let nextDefaultRootId = 1;
let defaultThreeHandleValue: ThreeHandle | undefined;
let defaultThreeHandlePromise: Promise<ThreeHandle> | undefined;

export type GlyphProviderFontFace =
  | FontFaceSource
  | AnyFontFace
  | Readonly<{ src: FontFaceSource; format?: FontFaceConfig['format'] }>;

export interface GlyphProviderProps {
  /** Select a Three handle's anonymous root or one named root returned by `handle(name)`. */
  readonly handle?: ThreeHandle | ThreeRoot;
  readonly fontFaces?: Readonly<Record<string, GlyphProviderFontFace>>;
  readonly fallback?: ReactNode;
  readonly errorFallback?: ReactNode | ((error: FontLoadError) => ReactNode);
  readonly children?: ReactNode;
}

interface ProviderFontFaces {
  readonly byName: ReadonlyMap<string, AnyFontFace>;
  dispose(): void;
}

/** Optional immutable handle override and scoped string-FontFace table for R3F descendants. */
export function GlyphProvider({
  handle,
  fontFaces,
  fallback,
  errorFallback,
  children,
}: GlyphProviderProps): ReactElement {
  const store = useStore();
  const [initial] = useState(() => ({ handle, fontFaces }));
  if (handle !== initial.handle || fontFaces !== initial.fontFaces) {
    throw new Error('GlyphProvider handle and fontFaces are immutable; remount the provider to replace them');
  }
  let selection: Readonly<{ handle: ThreeHandle; root: ThreeRoot }>;
  let defaultResource: DefaultGlyphContextResource | undefined;
  if (handle === undefined) {
    const defaultHandle = getInitializedDefaultThreeHandle() ?? use(defaultThreeHandle());
    defaultResource = defaultGlyphContext(store, defaultHandle);
    selection = defaultResource.context;
  } else {
    selection = selectReactRoot(handle);
  }
  assertUsableHandle(selection.handle);
  assertUsableRoot(selection.root);
  const [faces] = useState(() => createProviderFontFaces(fontFaces));
  const [context] = useState<GlyphReactContext>(() =>
    Object.freeze({ handle: selection.handle, root: selection.root, fontFaces: faces.byName }),
  );
  useLayoutEffect(
    () => () => {
      faces.dispose();
    },
    [faces],
  );
  useLayoutEffect(() => defaultResource?.retain(), [defaultResource]);

  let content: ReactNode = createElement(GlyphHandleContext.Provider, { value: context }, children);
  if (fontFaces !== undefined || fallback !== undefined) {
    content = createElement(Suspense, { fallback: fallback ?? null }, content);
  }
  if (errorFallback !== undefined) {
    content = createElement(GlyphFontErrorBoundary, { fallback: errorFallback }, content);
  }
  return content as ReactElement;
}

function useSelectedHandle(): ThreeHandle {
  return useSelectedGlyphContext().handle;
}

function useSelectedGlyphContext(): GlyphReactContext {
  const store = useStore();
  const provided = use(GlyphHandleContext);
  const handle = provided === undefined ? (getInitializedDefaultThreeHandle() ?? use(defaultThreeHandle())) : undefined;
  const resource = handle === undefined ? undefined : defaultGlyphContext(store, handle);
  useLayoutEffect(() => resource?.retain(), [resource]);
  if (provided !== undefined) return provided;
  if (resource === undefined) throw new Error('R3F default Glyph context was not created');
  return resource.context;
}

function defaultGlyphContext(store: R3fRootStore, handle: ThreeHandle): DefaultGlyphContextResource {
  assertUsableHandle(handle);
  const existing = defaultContexts.get(store);
  if (existing !== undefined && existing.context.handle === handle && !existing.context.root.disposed) return existing;
  let rootName = defaultRootNames.get(store);
  if (rootName === undefined) {
    rootName = `@pmndrs/glyph/react:root:${nextDefaultRootId}`;
    nextDefaultRootId += 1;
    defaultRootNames.set(store, rootName);
  }
  const context = Object.freeze({ handle, root: handle(rootName), fontFaces: emptyFontFaces });
  let references = 0;
  let releaseRevision = 0;
  let disposed = false;
  const resource: DefaultGlyphContextResource = Object.freeze({
    context,
    retain(): () => void {
      if (disposed) throw new Error('R3F cannot retain a disposed default Glyph root');
      references += 1;
      releaseRevision += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        references -= 1;
        if (references !== 0) return;
        const revision = ++releaseRevision;
        queueMicrotask(() => {
          if (references === 0 && releaseRevision === revision) resource.dispose();
        });
      };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      defaultRootFinalizer.unregister(resource);
      context.root.dispose();
    },
  });
  defaultRootFinalizer.register(store, context.root, resource);
  defaultContexts.set(store, resource);
  return resource;
}

function createProviderFontFaces(table: GlyphProviderProps['fontFaces']): ProviderFontFaces {
  const byName = new Map<string, AnyFontFace>();
  const owned: AnyFontFace[] = [];
  try {
    for (const [name, declaration] of Object.entries(table ?? {})) {
      if (name.trim().length === 0) throw new TypeError('GlyphProvider fontFaces keys must be nonempty strings');
      let face: AnyFontFace;
      if (isFontFaceSelection(declaration)) {
        face = declaration.face;
      } else if (isProviderFontFaceConfig(declaration)) {
        face = glyph.fontFace(declaration.src, declaration.format === undefined ? {} : { format: declaration.format });
        owned.push(face);
      } else {
        face = glyph.fontFace(declaration as FontFaceSource);
        owned.push(face);
      }
      byName.set(name, face);
    }
  } catch (error) {
    for (const face of owned) face.dispose();
    throw error;
  }
  let disposed = false;
  return Object.freeze({
    byName: byName as ReadonlyMap<string, AnyFontFace>,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const face of owned) face.dispose();
    },
  });
}

function isProviderFontFaceConfig(value: unknown): value is Readonly<{
  src: FontFaceSource;
  format?: FontFaceConfig['format'];
}> {
  return typeof value === 'object' && value !== null && Object.hasOwn(value, 'src');
}

interface GlyphFontErrorBoundaryProps {
  readonly fallback: ReactNode | ((error: FontLoadError) => ReactNode);
  readonly children?: ReactNode;
}

interface GlyphFontErrorBoundaryState {
  readonly error: unknown;
}

class GlyphFontErrorBoundary extends Component<GlyphFontErrorBoundaryProps, GlyphFontErrorBoundaryState> {
  override state: GlyphFontErrorBoundaryState = { error: undefined };

  static getDerivedStateFromError(error: unknown): GlyphFontErrorBoundaryState {
    return { error };
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === undefined) return this.props.children;
    if (!(error instanceof FontLoadError)) throw error;
    return typeof this.props.fallback === 'function' ? this.props.fallback(error) : this.props.fallback;
  }
}

function getInitializedDefaultThreeHandle(): ThreeHandle | undefined {
  if (defaultThreeHandleValue?.disposed === true) {
    defaultThreeHandleValue = undefined;
    defaultThreeHandlePromise = undefined;
    defaultFontPreloads.clear();
  }
  if (defaultThreeHandleValue !== undefined) return defaultThreeHandleValue;
  if (!glyph.initialized) return undefined;
  const handle = glyph.handle(defaultThreeHandleName, ThreeConfig);
  defaultThreeHandleValue = handle;
  return handle;
}

function defaultThreeHandle(): Promise<ThreeHandle> {
  const ready = getInitializedDefaultThreeHandle();
  if (ready !== undefined) {
    defaultThreeHandlePromise ??= Promise.resolve(ready);
    return defaultThreeHandlePromise;
  }
  if (defaultThreeHandlePromise !== undefined) return defaultThreeHandlePromise;
  const initialization = glyph.init().then(() => {
    const initialized = getInitializedDefaultThreeHandle();
    if (initialized === undefined) throw new Error('Glyph initialization completed without an engine');
    return initialized;
  });
  const retryable = initialization.catch((error: unknown) => {
    if (defaultThreeHandlePromise === retryable) defaultThreeHandlePromise = undefined;
    throw error;
  });
  defaultThreeHandlePromise = retryable;
  return retryable;
}

function assertUsableHandle(handle: ThreeHandle): void {
  if (handle.disposed) throw new Error('R3F cannot construct Text or TextGroup from a disposed Three handle');
}

function assertUsableRoot(root: ThreeRoot): void {
  if (root.disposed) throw new Error('R3F cannot construct Text or TextGroup from a disposed Three root');
}

function selectReactRoot(selection: ThreeHandle | ThreeRoot): Readonly<{ handle: ThreeHandle; root: ThreeRoot }> {
  if (typeof selection === 'function') return Object.freeze({ handle: selection, root: threeHandleRoot(selection) });
  return Object.freeze({ handle: threeRootHandle(selection), root: selection });
}

function rootId(root: ThreeRoot): number {
  const existing = rootIds.get(root);
  if (existing !== undefined) return existing;
  const id = nextHandleId;
  nextHandleId += 1;
  rootIds.set(root, id);
  return id;
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
  assertNoHandleProp(properties, 'Text');
  const context = useSelectedGlyphContext();
  const handle = context.handle;
  const root = context.root;
  const flattened = useMemo(() => flattenText<Technique>(properties.children), [properties.children]);
  const desired = textProperties(properties, flattened);
  const [object, publishObject] = useState<ThreeText<Technique> | null>(null);
  useLayoutEffect(() => assignRef(forwardedRef, object ?? undefined), [forwardedRef, object]);
  if (desired.font === undefined) throw new TypeError('an outer R3F Text requires a font');
  const selected = resolveReactTextFont(desired.font, context);
  const child = {
    key: `${rootId(root)}:${properties.pixelSnapping === true ? 'pixel-snapped' : 'unsnapped'}`,
    handle,
    root,
    desired: desired as DesiredR3fTextInput<AnyRasterTechnique>,
    object: objectProperties(properties),
    onError: properties.onError,
    publishObject: publishObject as (value: ThreeText<AnyRasterTechnique> | null) => void,
  };
  return isFontFaceSelection(selected)
    ? createElement(TextFontFaceObject, { ...child, selection: selected })
    : createElement(TextObject, { ...child, desired: bindDesiredFont(child.desired, selected) });
}) as TextComponent;

function TextFontFaceObject({
  selection,
  desired,
  ...properties
}: {
  readonly selection: AnyFontFaceSelection;
  readonly desired: DesiredR3fTextInput<AnyRasterTechnique>;
  readonly handle: ThreeHandle;
  readonly root: ThreeRoot;
  readonly object: TextElementProps;
  readonly onError: ((error: unknown) => void) | undefined;
  readonly publishObject: (value: ThreeText<AnyRasterTechnique> | null) => void;
}): ReactElement {
  const font = useHandleFontFace(properties.handle, selection);
  const { handle: _handle, ...renderedProperties } = properties;
  return createElement(TextObject, { ...renderedProperties, desired: bindDesiredFont(desired, font) });
}

function resolveReactTextFont(
  selection: R3fFontSelection<AnyRasterTechnique>,
  context: GlyphReactContext,
): FontSelection<AnyRasterTechnique> | AnyFontFaceSelection {
  if (typeof selection !== 'string') return selection;
  const face = context.fontFaces.get(selection) ?? resolveFontFace(selection);
  if (face === undefined) {
    throw new FontLoadError('FONT_FACE_NOT_FOUND', `FontFace ${JSON.stringify(selection)} is not defined`);
  }
  return face;
}

function bindDesiredFont(
  desired: DesiredR3fTextInput<AnyRasterTechnique>,
  font: FontSelection<AnyRasterTechnique>,
): DesiredR3fTextProperties<AnyRasterTechnique> {
  return Object.freeze({ ...desired, font });
}

function TextObject({
  desired,
  root,
  object: objectProps,
  onError,
  publishObject: publishCommittedObject,
}: {
  readonly desired: DesiredR3fTextProperties<AnyRasterTechnique>;
  readonly root: ThreeRoot;
  readonly object: TextElementProps;
  readonly onError: ((error: unknown) => void) | undefined;
  readonly publishObject: (value: ThreeText<AnyRasterTechnique> | null) => void;
}): ReactElement {
  const [constructorArguments] = useState<
    [typeof threeTextConstructionToken, StandaloneTextProperties<AnyRasterTechnique>, readonly [], ThreeRoot]
  >(() => [threeTextConstructionToken, desired as StandaloneTextProperties<AnyRasterTechnique>, [], root]);
  const appliedRef = useRef(desired);
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
    const { pixelSnapping: _pixelSnapping, ...update } = desired;
    if (!sameDesiredText(appliedRef.current, desired)) {
      object.set(update);
      appliedRef.current = desired;
    }
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
  assertNoHandleProp(properties, 'TextGroup');
  const context = useSelectedGlyphContext();
  const root = context.root;
  const [object, publishObject] = useState<ThreeTextGroup | null>(null);
  useLayoutEffect(() => assignRef(forwardedRef, object ?? undefined), [forwardedRef, object]);
  return createElement(TextGroupObject, {
    key: `${rootId(root)}:${properties.pixelSnapping === true ? 'pixel-snapped' : 'unsnapped'}`,
    root,
    object: groupObjectProperties(properties),
    options: properties,
    publishObject,
  });
}) as (input: R3fTextGroupProps) => ReactElement | null;

function TextGroupObject({
  object: objectProps,
  root,
  options,
  publishObject: publishCommittedObject,
}: {
  readonly object: TextGroupElementProps;
  readonly root: ThreeRoot;
  readonly options: Omit<R3fTextGroupProps, 'ref'>;
  readonly publishObject: (value: ThreeTextGroup | null) => void;
}): ReactElement {
  const [constructorArguments] = useState<[typeof threeTextConstructionToken, TextGroupOptions, ThreeRoot]>(() => [
    threeTextConstructionToken,
    {
      ...(options.renderOrder === undefined ? {} : { renderOrder: options.renderOrder }),
      ...(options.material === undefined ? {} : { material: options.material }),
      ...(options.pixelSnapping === undefined ? {} : { pixelSnapping: options.pixelSnapping }),
    },
    root,
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
    object.setMaterial(options.material);
    invalidate();
  }, [invalidate, object, options.material]);

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

interface ReactFontFaceResource {
  readonly face: AnyFontFace;
}

const reactFontFaces = new WeakMap<ThreeHandle, Map<string, ReactFontFaceResource>>();
const defaultFontPreloads = new Map<string, Promise<void>>();

/** Load through the selected handle; React owns only the mounted immutable Font lease. */
export const useFont = ((input: FontFaceSource, config: HookFontConfig = {}): Font<AnyRasterTechnique> => {
  const handle = useSelectedHandle();
  return useHandleFontFace(handle, reactFontFaceResource(handle, input, config).face);
}) as UseFont;
useFont.preload = (input: FontFaceSource, config: HookFontConfig = {}): Promise<void> => {
  const key = fontFaceResourceKey(input, config.format);
  const existing = defaultFontPreloads.get(key);
  if (existing !== undefined) return existing;
  const pending = defaultThreeHandle()
    .then((handle) => loadThreeHandleFont(handle, reactFontFaceResource(handle, input, config).face))
    .then(() => undefined)
    .catch((error: unknown) => {
      if (defaultFontPreloads.get(key) === pending) defaultFontPreloads.delete(key);
      throw error;
    });
  defaultFontPreloads.set(key, pending);
  return pending;
};
useFont.clear = (input: FontFaceSource, config: HookFontConfig = {}): void => {
  const key = fontFaceResourceKey(input, config.format);
  defaultFontPreloads.delete(key);
  void defaultThreeHandle().then((handle) => {
    const cache = reactFontFaces.get(handle);
    const resource = cache?.get(key);
    if (resource === undefined) return;
    cache?.delete(key);
    resource.face.dispose();
  });
};

function useHandleFontFace<Technique extends AnyRasterTechnique>(
  handle: ThreeHandle,
  selection: AnyFontFaceSelection,
): Font<Technique> {
  if (!isThreeHandleFontLoaded(handle, selection)) use(loadThreeHandleFont(handle, selection));
  const store = useMemo(() => createMountedFontStore(handle, selection), [handle, selection]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot) as Font<Technique>;
}

function reactFontFaceResource(
  handle: ThreeHandle,
  input: FontFaceSource,
  config: HookFontConfig,
): ReactFontFaceResource {
  let cache = reactFontFaces.get(handle);
  if (cache === undefined) {
    cache = new Map();
    reactFontFaces.set(handle, cache);
  }
  const key = fontFaceResourceKey(input, config.format);
  const existing = cache.get(key);
  if (existing !== undefined && !existing.face.disposed) return existing;
  const resource = Object.freeze({ face: glyph.fontFace(input, config) });
  cache.set(key, resource);
  return resource;
}

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

interface MountedFontStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => Font<AnyRasterTechnique>;
}

function createMountedFontStore(handle: ThreeHandle, selection: AnyFontFaceSelection): MountedFontStore {
  const source = threeHandleFontSource(handle, selection);
  let current = source;
  let mounted: Font<AnyRasterTechnique> | undefined;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      if (mounted === undefined) {
        mounted = acquireThreeHandleFont(handle, selection);
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
      spans.splice(spanIndex, 0, Object.freeze({ start, end: length, ...loadedInlineProperties(inline) }));
  };

  append(children ?? null, {});
  const text = chunks.join('');
  return Object.freeze({ text, spans: Object.freeze(resolveRangesToClusters(text, spans)) });
}

function loadedInlineProperties<Technique extends AnyRasterTechnique>(
  properties: InlineProperties<Technique>,
): Readonly<{ font?: FontSelection<Technique>; style?: TextStyle; material?: ThreeTextMaterial }> {
  const { font, ...rest } = properties;
  if (font === undefined) return rest;
  if (typeof font === 'string' || isFontFaceSelection(font)) {
    throw new TypeError('nested R3F Text font declarations must be loaded with useFont before use');
  }
  return { ...rest, font };
}

function inlineProperties<Technique extends AnyRasterTechnique>(
  properties: R3fTextProps<Technique>,
  inherited: InlineProperties<Technique>,
): InlineProperties<Technique> {
  const statedStyle = mergePropertyList(properties.style, 'nested Text style');
  const style =
    Object.keys(statedStyle).length === 0 ? inherited.style : Object.freeze({ ...inherited.style, ...statedStyle });
  return Object.freeze({
    ...((properties.font ?? inherited.font) === undefined ? {} : { font: properties.font ?? inherited.font }),
    ...(style === undefined ? {} : { style }),
    ...((properties.material ?? inherited.material) === undefined
      ? {}
      : { material: properties.material ?? inherited.material }),
  });
}

const INLINE_TEXT_PROPERTIES = new Set(['children', 'font', 'material', 'style']);

function assertInlineTextProperties<Technique extends AnyRasterTechnique>(properties: R3fTextProps<Technique>): void {
  for (const key of Object.keys(properties)) {
    if (!INLINE_TEXT_PROPERTIES.has(key)) throw new TypeError(`nested R3F Text cannot use the box property ${key}`);
  }
}

function textProperties<Technique extends AnyRasterTechnique>(
  properties: R3fTextProps<Technique>,
  flattened: FlattenedText<Technique>,
): DesiredR3fTextInput<Technique> {
  return Object.freeze({
    ...(properties.font === undefined ? {} : { font: properties.font }),
    text: Object.freeze({
      text: flattened.text,
      spans: flattened.spans,
    }) as FormattedText<Technique>,
    ...(properties.style === undefined ? {} : { style: properties.style }),
    ...(properties.layout === undefined ? {} : { layout: properties.layout }),
    ...(properties.constraints === undefined ? {} : { constraints: properties.constraints }),
    ...(properties.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: properties.rasterPixelRatio }),
    ...(properties.material === undefined ? {} : { material: properties.material }),
    ...(properties.pixelSnapping === undefined ? {} : { pixelSnapping: properties.pixelSnapping }),
  });
}

function objectProperties<Technique extends AnyRasterTechnique>(properties: R3fTextProps<Technique>): TextElementProps {
  const object = { ...properties } as Record<string, unknown>;
  for (const key of [
    'font',
    'children',
    'style',
    'layout',
    'constraints',
    'rasterPixelRatio',
    'material',
    'pixelSnapping',
    'onError',
    'ref',
  ])
    delete object[key];
  return object as TextElementProps;
}

function groupObjectProperties(properties: R3fTextGroupProps): TextGroupElementProps {
  const object = { ...properties } as Record<string, unknown>;
  for (const key of ['material', 'pixelSnapping', 'children', 'onError', 'ref']) delete object[key];
  return object as TextGroupElementProps;
}

function assertNoHandleProp(properties: object, owner: 'Text' | 'TextGroup'): void {
  if (Object.hasOwn(properties, 'handle')) {
    throw new TypeError(`R3F ${owner} does not accept a handle prop; select custom handles with GlyphProvider`);
  }
}

function sameDesiredText<Technique extends AnyRasterTechnique>(
  left: (Partial<StandaloneTextProperties<Technique>> & { readonly text: TextInput<Technique> }) | undefined,
  right: Partial<StandaloneTextProperties<Technique>> & { readonly text: TextInput<Technique> },
): boolean {
  if (
    left === undefined ||
    left.font !== right.font ||
    !sameSnapshot(left.text, right.text) ||
    left.rasterPixelRatio !== right.rasterPixelRatio ||
    left.material !== right.material ||
    !sameSnapshot(left.style, right.style) ||
    !sameSnapshot(left.layout, right.layout) ||
    !sameSnapshot(left.constraints, right.constraints)
  )
    return false;
  return true;
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
