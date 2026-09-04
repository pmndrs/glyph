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
import { clear as clearSuspense, preload as preloadSuspense, suspend } from 'suspend-react';

import {
  isFontFaceSelection,
  resolveFontFace,
  type FontFace,
  type FontFaceConfig,
  type FontFaceSelection,
  type FontFaceFormat,
  type FontFaceFormatInput,
  type FontFaceRasterOf,
  type FontFaceSource,
} from './font-face.js';
import { resolveRangesToClusters, type FormattedText, type TextInput } from './formatted-text.js';
import type { Font } from './font.js';
import { glyph } from './glyph.js';
import { GlyphFontError } from './loader.js';
import { type FontSelection, type FontStack } from './loaded-font.js';
import { mergePropertyList } from './property-list.js';
import { reactFontResourceKey } from './internal/react-font-resource-key.js';
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

type SelectedHookFontConfig<Format> = Readonly<{ format: FontFaceFormatInput<Format> }>;
type DefaultHookFontConfig = Readonly<{ format?: FontFaceFormat }>;

type TechniqueOfHookFormat<Format> = Format extends RasterFormatMetadata
  ? Format
  : Format extends { readonly raster: infer Technique extends RasterFormatMetadata }
    ? Technique
    : RasterFormatMetadata;

/** Generic R3F hook for one source and optional raster-format declaration. */
export interface UseFont {
  /** Load and retain one immutable mounted Font lease through the selected R3F handle. */
  (input: FontFaceSource): Font<RasterFormatMetadata>;
  <const Format>(input: FontFaceSource, config: SelectedHookFontConfig<Format>): Font<TechniqueOfHookFormat<Format>>;
  /** Start the same stable default-handle Suspense load before a component requests it. */
  preload(input: FontFaceSource): Promise<void>;
  preload<const Format>(input: FontFaceSource, config: SelectedHookFontConfig<Format>): Promise<void>;
  /** Release a preloaded default-handle resource without invalidating mounted Font leases. */
  clear(input: FontFaceSource): void;
  clear<const Format>(input: FontFaceSource, config: SelectedHookFontConfig<Format>): void;
}

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

export type GlyphProviderFontFace =
  | FontFaceSource
  | FontFace
  | Readonly<{ src: FontFaceSource; format?: FontFaceConfig['format'] }>;

export interface GlyphProviderProps {
  /** Select a Three handle/root, or a named root on R3F's built-in default handle. */
  readonly handle?: ThreeHandle | ThreeRoot | string;
  /** Add immutable scoped family aliases from sources, source configs, or existing FontFace declarations. */
  readonly fontFaces?: Readonly<Record<string, GlyphProviderFontFace>>;
  readonly fallback?: ReactNode;
  /** Render recoverable Glyph font failures. Call dismiss only after repairing the underlying failure. */
  readonly errorFallback?: ReactNode | ((error: GlyphFontError, dismiss: () => void) => ReactNode);
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
  if (handle !== initial.handle || !sameProviderFontFaceTable(fontFaces, initial.fontFaces)) {
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
  const [faces] = useState(() => providerFontFaces(fontFaces));
  const [context] = useState<GlyphReactContext>(() =>
    Object.freeze({ handle: selection.handle, root: selection.root, fontFaces: faces.byName }),
  );
  useLayoutEffect(() => faces.retain(), [faces]);
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

interface ProviderFontFaces {
  readonly byName: ReadonlyMap<string, FontFace>;
  readonly disposed: boolean;
  retain(): () => void;
  dispose(): void;
}

const emptyProviderFontFaces: ProviderFontFaces = {
  byName: emptyFontFaces,
  disposed: false,
  retain: () => () => undefined,
  dispose: () => undefined,
};
const providerFontFaceCache = new WeakMap<Readonly<Record<string, GlyphProviderFontFace>>, ProviderFontFaces>();
const providerFontFaceFinalizer = new FinalizationRegistry<readonly FontFace[]>((owned) => {
  for (const face of owned) face.dispose();
});

function providerFontFaces(table: GlyphProviderProps['fontFaces']): ProviderFontFaces {
  if (table === undefined) return emptyProviderFontFaces;
  const existing = providerFontFaceCache.get(table);
  if (existing !== undefined && !existing.disposed) return existing;
  const resource = createProviderFontFaces(table);
  providerFontFaceCache.set(table, resource);
  return resource;
}

function createProviderFontFaces(table: Readonly<Record<string, GlyphProviderFontFace>>): ProviderFontFaces {
  const byName = new Map<string, FontFace>();
  const owned: FontFace[] = [];
  try {
    for (const [name, declaration] of Object.entries(table)) {
      if (name.trim().length === 0) throw new TypeError('GlyphProvider fontFaces keys must be nonempty strings');
      let face: FontFace;
      if (isFontFaceSelection(declaration)) {
        face = declaration.face;
      } else if (isProviderFontFaceConfig(declaration)) {
        face =
          declaration.format === undefined
            ? glyph.fontFace(declaration.src)
            : glyph.fontFace(declaration.src, { format: declaration.format });
        owned.push(face);
      } else {
        face = glyph.fontFace(declaration);
        owned.push(face);
      }
      byName.set(name, face);
    }
  } catch (error) {
    for (const face of owned) face.dispose();
    throw error;
  }
  let references = 0;
  let releaseRevision = 0;
  let disposed = false;
  providerFontFaceFinalizer.register(table, owned, byName);
  const resource: ProviderFontFaces = Object.freeze({
    byName,
    get disposed(): boolean {
      return disposed;
    },
    retain(): () => void {
      if (disposed) throw new Error('GlyphProvider cannot retain disposed fontFaces');
      references += 1;
      releaseRevision += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        references -= 1;
        const revision = ++releaseRevision;
        queueMicrotask(() => {
          if (references === 0 && releaseRevision === revision) resource.dispose();
        });
      };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      providerFontFaceFinalizer.unregister(byName);
      for (const face of owned) face.dispose();
    },
  });
  return resource;
}

function isProviderFontFaceConfig(value: unknown): value is Readonly<{
  src: FontFaceSource;
  format?: FontFaceConfig['format'];
}> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof URL) &&
    !(typeof Blob !== 'undefined' && value instanceof Blob) &&
    Object.hasOwn(value, 'src') &&
    Object.keys(value).every((key) => key === 'src' || key === 'format')
  );
}

function sameProviderFontFaceTable(
  left: GlyphProviderProps['fontFaces'],
  right: GlyphProviderProps['fontFaces'],
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  const leftNames = Object.keys(left);
  const rightNames = Object.keys(right);
  if (leftNames.length !== rightNames.length) return false;
  return leftNames.every((name) => {
    if (!Object.hasOwn(right, name)) return false;
    return sameProviderFontFaceDeclaration(left[name]!, right[name]!);
  });
}

function sameProviderFontFaceDeclaration(left: GlyphProviderFontFace, right: GlyphProviderFontFace): boolean {
  if (left === right) return true;
  if (isFontFaceSelection(left) || isFontFaceSelection(right)) return false;
  const leftKey = isProviderFontFaceConfig(left)
    ? reactFontResourceKey(left.src, left.format)
    : reactFontResourceKey(left, undefined);
  const rightKey = isProviderFontFaceConfig(right)
    ? reactFontResourceKey(right.src, right.format)
    : reactFontResourceKey(right, undefined);
  return leftKey === rightKey;
}

interface GlyphFontErrorBoundaryProps {
  readonly fallback: ReactNode | ((error: GlyphFontError, dismiss: () => void) => ReactNode);
  readonly children?: ReactNode;
}

interface GlyphFontErrorBoundaryState {
  readonly error: unknown;
}

class GlyphFontErrorBoundary extends Component<GlyphFontErrorBoundaryProps, GlyphFontErrorBoundaryState> {
  override state: GlyphFontErrorBoundaryState = { error: undefined };

  readonly #dismiss = (): void => {
    this.setState({ error: undefined });
  };

  static getDerivedStateFromError(error: unknown): GlyphFontErrorBoundaryState {
    return { error };
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === undefined) return this.props.children;
    if (!(error instanceof GlyphFontError)) throw error;
    return typeof this.props.fallback === 'function' ? this.props.fallback(error, this.#dismiss) : this.props.fallback;
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
    throw new GlyphFontError('FONT_FACE_NOT_FOUND', `FontFace ${JSON.stringify(selection)} is not defined`);
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

interface ReactFontFaceResource {
  readonly handle: ThreeHandle;
  readonly face: FontFace;
  readonly ready: Promise<void>;
  readonly suspenseKey: ReactFontSuspenseKey;
  readonly status: 'pending' | 'fulfilled' | 'rejected';
  markPendingMount(): void;
  pinPreload(): void;
  retain(): () => void;
  clear(): void;
}

interface DefaultFontPreload {
  promise: Promise<void>;
  resource: ReactFontFaceResource | undefined;
}

const reactFontFaces = new WeakMap<ThreeHandle, Map<string, ReactFontFaceResource>>();
const defaultFontPreloads = new Map<string, DefaultFontPreload>();
const reactFontSuspenseNamespace = '@pmndrs/glyph/react:use-font';
type ReactFontSuspenseKey = [typeof reactFontSuspenseNamespace, ThreeHandle, Promise<void>];

/** Load through the selected handle while React owns the declaration and mounted immutable Font lease. */
function useFontHook(input: FontFaceSource): Font<RasterFormatMetadata>;
function useFontHook<const Format>(
  input: FontFaceSource,
  config: SelectedHookFontConfig<Format>,
): Font<TechniqueOfHookFormat<Format>>;
function useFontHook(input: FontFaceSource, config: DefaultHookFontConfig = {}): Font<RasterFormatMetadata> {
  const handle = useSelectedGlyphContext().handle;
  const resource = reactFontFaceResource(handle, input, config);
  resource.markPendingMount();
  if (resource.status !== 'fulfilled') suspend(loadReactFontResource, resource.suspenseKey);
  const store = useMemo(() => createMountedHookFontStore(resource), [resource]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

function preloadFont(input: FontFaceSource): Promise<void>;
function preloadFont<const Format>(input: FontFaceSource, config: SelectedHookFontConfig<Format>): Promise<void>;
function preloadFont(input: FontFaceSource, config: DefaultHookFontConfig = {}): Promise<void> {
  const key = reactFontResourceKey(input, config.format);
  const existing = defaultFontPreloads.get(key);
  if (existing !== undefined) return existing.promise;
  const preload: DefaultFontPreload = { promise: Promise.resolve(), resource: undefined };
  preload.promise = defaultThreeHandle()
    .then((handle) => {
      if (defaultFontPreloads.get(key) !== preload) return;
      const rejected = reactFontFaces.get(handle)?.get(key);
      if (rejected?.status === 'rejected') rejected.clear();
      const resource = reactFontFaceResource(handle, input, config);
      preload.resource = resource;
      resource.pinPreload();
      preloadSuspense(loadReactFontResource, resource.suspenseKey);
      return resource.ready;
    })
    .catch((error: unknown) => {
      if (defaultFontPreloads.get(key) === preload) defaultFontPreloads.delete(key);
      throw error;
    });
  defaultFontPreloads.set(key, preload);
  return preload.promise;
}

function clearFont(input: FontFaceSource): void;
function clearFont<const Format>(input: FontFaceSource, config: SelectedHookFontConfig<Format>): void;
function clearFont(input: FontFaceSource, config: DefaultHookFontConfig = {}): void {
  const key = reactFontResourceKey(input, config.format);
  const preload = defaultFontPreloads.get(key);
  defaultFontPreloads.delete(key);
  preload?.resource?.clear();
  const handle = getInitializedDefaultThreeHandle();
  if (handle !== undefined) reactFontFaces.get(handle)?.get(key)?.clear();
}

export const useFont: UseFont = Object.assign(useFontHook, { preload: preloadFont, clear: clearFont });

function loadReactFontResource(
  _namespace: typeof reactFontSuspenseNamespace,
  _handle: ThreeHandle,
  ready: Promise<void>,
): Promise<void> {
  return ready;
}

function reactFontFaceResource(
  handle: ThreeHandle,
  input: FontFaceSource,
  config: DefaultHookFontConfig,
): ReactFontFaceResource {
  let cache = reactFontFaces.get(handle);
  if (cache === undefined) {
    cache = new Map();
    reactFontFaces.set(handle, cache);
  }
  const key = reactFontResourceKey(input, config.format);
  const existing = cache.get(key);
  if (existing !== undefined && (!existing.face.disposed || existing.status === 'rejected')) return existing;
  const face = hookFontFace(input, config);
  let references = 0;
  let releaseRevision = 0;
  let pendingMount = false;
  let preloadPinned = false;
  let disposed = false;
  let status: ReactFontFaceResource['status'] = 'pending';
  const releaseFace = (): void => {
    if (!face.disposed) face.dispose();
  };
  const ready = loadThreeHandleFont(handle, face).then(
    () => {
      status = 'fulfilled';
    },
    (error: unknown) => {
      status = 'rejected';
      pendingMount = false;
      preloadPinned = false;
      const preload = defaultFontPreloads.get(key);
      if (preload?.resource?.face === face) defaultFontPreloads.delete(key);
      releaseFace();
      throw error;
    },
  );
  const suspenseKey: ReactFontSuspenseKey = [reactFontSuspenseNamespace, handle, ready];
  const disposeIfUnused = (): void => {
    if (references !== 0 || pendingMount || preloadPinned || disposed) return;
    disposed = true;
    if (cache.get(key)?.face === face) cache.delete(key);
    clearSuspense(suspenseKey);
    releaseFace();
  };
  const resource: ReactFontFaceResource = Object.freeze({
    handle,
    face,
    ready,
    suspenseKey,
    get status(): ReactFontFaceResource['status'] {
      return status;
    },
    markPendingMount(): void {
      if (references === 0 && status !== 'rejected') pendingMount = true;
    },
    pinPreload(): void {
      preloadPinned = true;
    },
    retain(): () => void {
      if (disposed) throw new Error('React cannot retain a disposed font resource');
      references += 1;
      releaseRevision += 1;
      pendingMount = false;
      preloadPinned = false;
      const preload = defaultFontPreloads.get(key);
      if (preload?.resource === resource) defaultFontPreloads.delete(key);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        references -= 1;
        const revision = ++releaseRevision;
        queueMicrotask(() => {
          if (references === 0 && releaseRevision === revision) disposeIfUnused();
        });
      };
    },
    clear(): void {
      pendingMount = false;
      preloadPinned = false;
      if (cache.get(key)?.face === face) cache.delete(key);
      clearSuspense(suspenseKey);
      disposeIfUnused();
    },
  });
  cache.set(key, resource);
  return resource;
}

function hookFontFace(input: FontFaceSource, config: DefaultHookFontConfig): FontFace {
  return config.format === undefined ? glyph.fontFace(input) : glyph.fontFace(input, { format: config.format });
}

const fontSuspenseNamespace = '@pmndrs/glyph/react:font';
type FontSuspenseKey = [typeof fontSuspenseNamespace, ThreeHandle, FontFaceSelection];
const fontSuspenseKeys = new WeakMap<ThreeHandle, WeakMap<object, FontSuspenseKey>>();

function useHandleFontFaces(
  handle: ThreeHandle,
  selections: readonly FontFaceSelection[],
): ReadonlyMap<FontFaceSelection, Font<RasterFormatMetadata>> {
  for (const selection of selections) {
    if (!isThreeHandleFontLoaded(handle, selection)) {
      void loadThreeHandleFont(handle, selection).catch(() => undefined);
    }
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

interface MountedHookFontStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => Font<RasterFormatMetadata>;
}

function createMountedHookFontStore(resource: ReactFontFaceResource): MountedHookFontStore {
  const source = threeHandleFontSource(resource.handle, resource.face);
  let current = source;
  let mounted: Font<RasterFormatMetadata> | undefined;
  let releaseResource: (() => void) | undefined;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      if (mounted === undefined) {
        releaseResource = resource.retain();
        try {
          mounted = acquireThreeHandleFont(resource.handle, resource.face);
          current = mounted;
        } catch (error) {
          releaseResource();
          releaseResource = undefined;
          throw error;
        }
        for (const subscriber of listeners) subscriber();
      }
      return () => {
        if (!listeners.delete(listener) || listeners.size !== 0 || mounted === undefined) return;
        const releasedFont = mounted;
        const releasedResource = releaseResource;
        mounted = undefined;
        releaseResource = undefined;
        current = source;
        releasedFont.dispose();
        releasedResource?.();
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
