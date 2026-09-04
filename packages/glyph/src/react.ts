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
import { suspend } from 'suspend-react';

import {
  isFontFaceSelection,
  resolveFontFace,
  type FontFace,
  type FontFaceSelection,
  type FontFaceFormat,
  type FontFaceRasterOf,
} from './font-face.js';
import { resolveRangesToClusters, type FormattedText, type TextInput } from './formatted-text.js';
import type { Font } from './font.js';
import { glyph } from './glyph.js';
import { FontLoadError } from './loader.js';
import { type FontSelection, type FontStack } from './loaded-font.js';
import { mergePropertyList } from './property-list.js';
import { type Constraints, type ParagraphLayout, type PropertyList, type TextStyle } from './text-properties.js';
import type { RasterFormatMetadata } from './config/raster-format.js';
import {
  acquireThreeHandleFont,
  isThreeHandleFontLoaded,
  loadThreeHandleFont,
  threeHandleFontSource,
  threeHandleRoot,
  threeRootHandle,
} from './three/internal/handle-access.js';
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
import {
  threeRootHost,
  threeTextConstructionToken,
  type TextSpan as ThreeTextSpanRecord,
  type ThreeRootHost,
} from './three/text.js';

type Object3DProps = Omit<ThreeElements['object3D'], 'children' | 'ref'>;

// Pass-through props are forwarded to a `Text`/`TextGroup` element, not a bare `Object3D`. R3F keeps method
// signatures in element props, so props typed for the base class do not satisfy the subclass element.
type TextElementProps = Omit<ThreeElement<typeof ThreeText>, 'children' | 'ref'>;
type TextGroupElementProps = Omit<ThreeElement<typeof ThreeTextGroup>, 'children' | 'ref'>;

export type R3fTextChild<Technique extends RasterFormatMetadata> =
  | string
  | number
  | null
  | false
  | ReactElement<R3fTextProps<Technique>>
  | readonly R3fTextChild<Technique>[];

type R3fFontSelection<Technique extends RasterFormatMetadata> =
  | FontSelection<Technique>
  | FontFaceSelection<FontFaceFormat<Technique> | undefined>
  | (RasterFormatMetadata extends Technique ? string : never);

type FontSelectionTechnique<Selection> = Selection extends string
  ? RasterFormatMetadata
  : Selection extends Font<infer Technique>
    ? Technique
    : Selection extends FontStack<infer Technique>
      ? Technique
      : Selection extends FontFaceSelection
        ? FontFaceRasterOf<Selection>
        : never;

type InferredTextTechnique<Selection> = [Selection] extends [undefined]
  ? RasterFormatMetadata
  : FontSelectionTechnique<Selection>;

export type R3fTextProps<Technique extends RasterFormatMetadata> = Object3DProps & {
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

type PendingTextSpan = Omit<ThreeTextSpanRecord<RasterFormatMetadata>, 'font'> &
  Readonly<{ font?: FontSelection<RasterFormatMetadata> | FontFaceSelection }>;

interface PendingFlattenedText {
  readonly text: string;
  readonly spans: readonly PendingTextSpan[];
  readonly fontFaces: readonly FontFaceSelection[];
}

interface FlattenedText<Technique extends RasterFormatMetadata> {
  readonly text: string;
  readonly spans: readonly ThreeTextSpanRecord<Technique>[];
}

interface InlineProperties<Technique extends RasterFormatMetadata> {
  readonly font?: R3fFontSelection<Technique>;
  readonly style?: TextStyle;
  readonly material?: ThreeTextMaterial;
}

type DesiredR3fTextProperties<Technique extends RasterFormatMetadata> = Partial<StandaloneTextProperties<Technique>> & {
  readonly font: FontSelection<Technique>;
  readonly text: TextInput<Technique>;
};

type DesiredR3fTextInput<Technique extends RasterFormatMetadata> = Omit<
  Partial<StandaloneTextProperties<Technique>>,
  'font'
> & {
  readonly font?: R3fFontSelection<Technique>;
  readonly text: TextInput<Technique>;
};

const ThreeTextElement = extend(ThreeText);
const ThreeTextGroupElement = extend(ThreeTextGroup);
interface GlyphReactContext {
  readonly handle: ThreeHandle;
  readonly root: ThreeRoot;
  readonly fontFaces: ReadonlyMap<string, FontFace>;
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
const emptyFontFaces: ReadonlyMap<string, FontFace> = new Map();
let nextHandleId = 1;
let nextDefaultRootId = 1;
let defaultThreeHandleValue: ThreeHandle | undefined;
let defaultThreeHandlePromise: Promise<ThreeHandle> | undefined;

export interface GlyphProviderProps {
  /** Select a Three handle/root, or a named root on R3F's built-in default handle. */
  readonly handle?: ThreeHandle | ThreeRoot | string;
  /** Add scoped family aliases for existing declarations created by `glyph.fontFace()`. */
  readonly fontFaces?: Readonly<Record<string, FontFace>>;
  readonly fallback?: ReactNode;
  readonly errorFallback?: ReactNode | ((error: FontLoadError) => ReactNode);
  readonly children?: ReactNode;
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
  } else if (typeof handle === 'string') {
    const defaultHandle = getInitializedDefaultThreeHandle() ?? use(defaultThreeHandle());
    selection = Object.freeze({ handle: defaultHandle, root: defaultHandle(handle) });
  } else {
    selection = selectReactRoot(handle);
  }
  assertUsableHandle(selection.handle);
  assertUsableRoot(selection.root);
  const [faces] = useState(() => createProviderFontFaces(fontFaces));
  const [context] = useState<GlyphReactContext>(() =>
    Object.freeze({ handle: selection.handle, root: selection.root, fontFaces: faces }),
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

function createProviderFontFaces(table: GlyphProviderProps['fontFaces']): ReadonlyMap<string, FontFace> {
  const byName = new Map<string, FontFace>();
  for (const [name, face] of Object.entries(table ?? {})) {
    if (name.trim().length === 0) throw new TypeError('GlyphProvider fontFaces keys must be nonempty strings');
    if (!isFontFaceSelection(face) || face.face !== face) {
      throw new TypeError('GlyphProvider fontFaces values must be declarations created by glyph.fontFace()');
    }
    byName.set(name, face);
  }
  return byName;
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
  defaultThreeHandlePromise = initialization;
  return initialization;
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
  <const Selection = undefined>(
    input: Omit<R3fTextProps<InferredTextTechnique<Selection>>, 'font'> & {
      readonly font?: Selection & ([InferredTextTechnique<Selection>] extends [never] ? never : unknown);
    },
  ): ReactElement | null;
  <Technique extends RasterFormatMetadata>(input: R3fTextProps<Technique>): ReactElement | null;
}

/** R3F paragraph component backed by one retained Three text instance. */
export const Text = forwardRef(function Text(
  properties: Omit<R3fTextProps<RasterFormatMetadata>, 'ref'>,
  forwardedRef: Ref<ThreeText<RasterFormatMetadata>>,
): ReactElement | null {
  assertNoHandleProp(properties, 'Text');
  const context = useSelectedGlyphContext();
  const handle = context.handle;
  const root = context.root;
  const selected = resolveReactTextFont(properties.font, context);
  const flattened = useMemo(() => flattenText(properties.children, context), [context, properties.children]);
  const fontFaces = useMemo(() => collectTextFontFaces(selected, flattened.fontFaces), [flattened.fontFaces, selected]);
  const [object, publishObject] = useState<ThreeText<RasterFormatMetadata> | null>(null);
  useLayoutEffect(() => assignRef(forwardedRef, object ?? undefined), [forwardedRef, object]);
  return createElement(ResolvedTextObject, {
    key: `${rootId(root)}:${properties.pixelSnapping === true ? 'pixel-snapped' : 'unsnapped'}`,
    handle,
    root,
    properties,
    selected,
    flattened,
    fontFaces,
    object: objectProperties(properties),
    onError: properties.onError,
    publishObject,
  });
}) as TextComponent;

function ResolvedTextObject({
  handle,
  properties: input,
  selected,
  flattened,
  fontFaces,
  ...renderedProperties
}: {
  readonly properties: Omit<R3fTextProps<RasterFormatMetadata>, 'ref'>;
  readonly selected: FontSelection<RasterFormatMetadata> | FontFaceSelection;
  readonly flattened: PendingFlattenedText;
  readonly fontFaces: readonly FontFaceSelection[];
  readonly handle: ThreeHandle;
  readonly root: ThreeRoot;
  readonly object: TextElementProps;
  readonly onError: ((error: unknown) => void) | undefined;
  readonly publishObject: (value: ThreeText<RasterFormatMetadata> | null) => void;
}): ReactElement {
  const loadedFonts = useHandleFontFaces(handle, fontFaces);
  const desired = useMemo(
    () =>
      bindDesiredFont(
        textProperties(input, bindFlattenedTextFonts(flattened, loadedFonts)),
        loadedTextFont(selected, loadedFonts),
      ),
    [flattened, input, loadedFonts, selected],
  );
  return createElement(TextObject, { ...renderedProperties, desired });
}

function resolveReactTextFont(
  selection: R3fFontSelection<RasterFormatMetadata> | undefined,
  context: GlyphReactContext,
): FontSelection<RasterFormatMetadata> | FontFaceSelection {
  if (selection === undefined) throw new TypeError('an outer R3F Text requires a font');
  if (typeof selection !== 'string') return selection;
  const face = context.fontFaces.get(selection) ?? resolveFontFace(selection);
  if (face === undefined) {
    throw new FontLoadError('FONT_FACE_NOT_FOUND', `FontFace ${JSON.stringify(selection)} is not defined`);
  }
  return face;
}

function collectTextFontFaces(
  selected: FontSelection<RasterFormatMetadata> | FontFaceSelection,
  nested: readonly FontFaceSelection[],
): readonly FontFaceSelection[] {
  if (!isFontFaceSelection(selected) || nested.includes(selected)) return nested;
  return Object.freeze([selected, ...nested]);
}

function loadedTextFont(
  selection: FontSelection<RasterFormatMetadata> | FontFaceSelection,
  loaded: ReadonlyMap<FontFaceSelection, Font<RasterFormatMetadata>>,
): FontSelection<RasterFormatMetadata> {
  return isFontFaceSelection(selection) ? loaded.get(selection)! : selection;
}

function bindFlattenedTextFonts(
  flattened: PendingFlattenedText,
  loaded: ReadonlyMap<FontFaceSelection, Font<RasterFormatMetadata>>,
): FlattenedText<RasterFormatMetadata> {
  const spans = flattened.spans.map((span): ThreeTextSpanRecord<RasterFormatMetadata> => {
    const { font, ...properties } = span;
    return font === undefined ? properties : Object.freeze({ ...properties, font: loadedTextFont(font, loaded) });
  });
  return Object.freeze({ text: flattened.text, spans: Object.freeze(spans) });
}

function bindDesiredFont(
  desired: DesiredR3fTextInput<RasterFormatMetadata>,
  font: FontSelection<RasterFormatMetadata>,
): DesiredR3fTextProperties<RasterFormatMetadata> {
  return Object.freeze({ ...desired, font });
}

function TextObject({
  desired,
  root,
  object: objectProps,
  onError,
  publishObject: publishCommittedObject,
}: {
  readonly desired: DesiredR3fTextProperties<RasterFormatMetadata>;
  readonly root: ThreeRoot;
  readonly object: TextElementProps;
  readonly onError: ((error: unknown) => void) | undefined;
  readonly publishObject: (value: ThreeText<RasterFormatMetadata> | null) => void;
}): ReactElement {
  const [constructorArguments] = useState<
    [typeof threeTextConstructionToken, StandaloneTextProperties<RasterFormatMetadata>, readonly [], ThreeRootHost]
  >(() => [threeTextConstructionToken, desired, [], threeRootHost(root)]);
  const appliedRef = useRef(desired);
  const [store] = useState(() => createObjectStore<ThreeText<RasterFormatMetadata>>());
  const object = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const invalidate = useThree((state) => state.invalidate);
  const publishObject = useMemo(
    () => (value: ThreeText<RasterFormatMetadata> | null) => {
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
  const [constructorArguments] = useState<[typeof threeTextConstructionToken, TextGroupOptions, ThreeRootHost]>(() => [
    threeTextConstructionToken,
    {
      ...(options.renderOrder === undefined ? {} : { renderOrder: options.renderOrder }),
      ...(options.material === undefined ? {} : { material: options.material }),
      ...(options.pixelSnapping === undefined ? {} : { pixelSnapping: options.pixelSnapping }),
    },
    threeRootHost(root),
  ]);
  const publishObject = useMemo(
    () => (value: ThreeTextGroup | null) => {
      publishCommittedObject(value);
    },
    [publishCommittedObject],
  );

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

const fontSuspenseNamespace = '@pmndrs/glyph/react:font';
type FontSuspenseKey = [typeof fontSuspenseNamespace, ThreeHandle, FontFaceSelection];
const fontSuspenseKeys = new WeakMap<ThreeHandle, WeakMap<object, FontSuspenseKey>>();

function useHandleFontFaces(
  handle: ThreeHandle,
  selections: readonly FontFaceSelection[],
): ReadonlyMap<FontFaceSelection, Font<RasterFormatMetadata>> {
  for (const selection of selections) {
    if (!isThreeHandleFontLoaded(handle, selection)) void loadThreeHandleFont(handle, selection);
  }
  for (const selection of selections) {
    if (!isThreeHandleFontLoaded(handle, selection)) suspend(loadSuspenseFont, fontSuspenseKey(handle, selection));
  }
  const store = useMemo(() => createMountedFontStore(handle, selections), [handle, selections]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

function loadSuspenseFont(
  _namespace: typeof fontSuspenseNamespace,
  handle: ThreeHandle,
  selection: FontFaceSelection,
): Promise<FontFaceSelection> {
  return loadThreeHandleFont(handle, selection);
}

function fontSuspenseKey(handle: ThreeHandle, selection: FontFaceSelection): FontSuspenseKey {
  let selections = fontSuspenseKeys.get(handle);
  if (selections === undefined) {
    selections = new WeakMap();
    fontSuspenseKeys.set(handle, selections);
  }
  const existing = selections.get(selection);
  if (existing !== undefined) return existing;
  const key: FontSuspenseKey = [fontSuspenseNamespace, handle, selection];
  selections.set(selection, key);
  return key;
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
  readonly getSnapshot: () => ReadonlyMap<FontFaceSelection, Font<RasterFormatMetadata>>;
}

const emptyLoadedFonts: ReadonlyMap<FontFaceSelection, Font<RasterFormatMetadata>> = new Map();
const emptyMountedFontStore: MountedFontStore = {
  subscribe: () => () => undefined,
  getSnapshot: () => emptyLoadedFonts,
};

function createMountedFontStore(handle: ThreeHandle, selections: readonly FontFaceSelection[]): MountedFontStore {
  if (selections.length === 0) return emptyMountedFontStore;
  const source = new Map(selections.map((selection) => [selection, threeHandleFontSource(handle, selection)]));
  let current = source;
  let mounted: readonly Font<RasterFormatMetadata>[] | undefined;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      if (mounted === undefined) {
        const acquired = new Map<FontFaceSelection, Font<RasterFormatMetadata>>();
        for (const selection of selections) acquired.set(selection, acquireThreeHandleFont(handle, selection));
        mounted = [...acquired.values()];
        current = acquired;
        for (const subscriber of listeners) subscriber();
      }
      return () => {
        if (!listeners.delete(listener) || listeners.size !== 0 || mounted === undefined) return;
        const released = mounted;
        mounted = undefined;
        current = source;
        for (const font of released) font.dispose();
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
function flattenText(
  children: R3fTextChild<RasterFormatMetadata> | undefined,
  context: GlyphReactContext,
): PendingFlattenedText {
  const chunks: string[] = [];
  const spans: PendingTextSpan[] = [];
  const fontFaces: FontFaceSelection[] = [];
  let length = 0;

  const append = (
    child: R3fTextChild<RasterFormatMetadata>,
    inherited: InlineProperties<RasterFormatMetadata>,
  ): void => {
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
    if (!isValidElement<R3fTextProps<RasterFormatMetadata>>(child) || child.type !== Text)
      throw new TypeError('R3F Text children must be text, numbers, arrays, or nested Text elements');
    assertInlineTextProperties(child.props);
    const inline = inlineProperties(child.props, inherited);
    const start = length;
    const spanIndex = spans.length;
    append(child.props.children ?? null, inline);
    if (start < length && Object.keys(inline).length !== 0)
      spans.splice(spanIndex, 0, Object.freeze({ start, end: length, ...pendingInlineProperties(inline) }));
  };

  const pendingInlineProperties = (
    properties: InlineProperties<RasterFormatMetadata>,
  ): Readonly<{
    font?: FontSelection<RasterFormatMetadata> | FontFaceSelection;
    style?: TextStyle;
    material?: ThreeTextMaterial;
  }> => {
    const { font, ...rest } = properties;
    if (font === undefined) return rest;
    const resolved = resolveReactTextFont(font, context);
    if (isFontFaceSelection(resolved) && !fontFaces.includes(resolved)) fontFaces.push(resolved);
    return { ...rest, font: resolved };
  };

  append(children ?? null, {});
  const text = chunks.join('');
  return Object.freeze({
    text,
    spans: Object.freeze(resolveRangesToClusters(text, spans)),
    fontFaces: Object.freeze(fontFaces),
  });
}

function inlineProperties<Technique extends RasterFormatMetadata>(
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

function assertInlineTextProperties<Technique extends RasterFormatMetadata>(properties: R3fTextProps<Technique>): void {
  for (const key of Object.keys(properties)) {
    if (!INLINE_TEXT_PROPERTIES.has(key)) throw new TypeError(`nested R3F Text cannot use the box property ${key}`);
  }
}

function textProperties<Technique extends RasterFormatMetadata>(
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

function objectProperties<Technique extends RasterFormatMetadata>(
  properties: R3fTextProps<Technique>,
): TextElementProps {
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
  for (const key of ['pixelSnapping', 'children', 'onError', 'ref']) delete object[key];
  return object as TextGroupElementProps;
}

function assertNoHandleProp(properties: object, owner: 'Text' | 'TextGroup'): void {
  if (Object.hasOwn(properties, 'handle')) {
    throw new TypeError(`R3F ${owner} does not accept a handle prop; select custom handles with GlyphProvider`);
  }
}

function sameDesiredText<Technique extends RasterFormatMetadata>(
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
