import { catalogue, extend, useTresContext, type TresContext } from '@tresjs/core';
import {
  defineComponent,
  h,
  inject,
  onScopeDispose,
  onMounted,
  onUpdated,
  provide,
  shallowRef,
  shallowReadonly,
  watch,
  type ComponentPublicInstance,
  type InjectionKey,
  type PropType,
  type ShallowRef,
  type VNode,
  type VNodeArrayChildren,
} from 'vue';

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
import type { FormattedText } from './formatted-text.js';
import type { Font } from './font.js';
import { glyph } from './glyph.js';
import { GlyphFontError } from './loader.js';
import type { FontSelection, FontStack } from './loaded-font.js';
import { sameDesiredText } from './internal/desired-text.js';
import { fontResourceKey } from './internal/font-resource-key.js';
import type { Constraints, ParagraphLayout, PropertyList, TextStyle } from './text-properties.js';
import type { RasterFormatMetadata } from './config/raster-format.js';
import {
  acquireThreeHandleFont,
  isThreeHandleFontLoaded,
  loadThreeHandleFont,
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
import {
  flattenVueText,
  type PendingFlattenedVueText,
  type VueFontSelectionInput,
} from './vue/internal/flatten-slots.js';

// Tres constructs catalogue entries with `new target(...args)` and disposes them through `remove()`. These private
// names exist only so the custom renderer can do that for the retained Three classes; applications use the
// wrapper components, never the tags.
const textTag = 'PmndrsGlyphText';
const textGroupTag = 'PmndrsGlyphTextGroup';
registerCatalogue();

function registerCatalogue(): void {
  const entries = catalogue.value as Record<string, unknown>;
  for (const [name, target] of [
    [textTag, ThreeText],
    [textGroupTag, ThreeTextGroup],
  ] as const) {
    if (entries[name] !== undefined && entries[name] !== target) {
      throw new Error(`the Tres catalogue already defines ${name} with another class`);
    }
  }
  extend({ [textTag]: ThreeText, [textGroupTag]: ThreeTextGroup });
}

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

type VueFontSelection<Technique extends RasterFormatMetadata> =
  | FontSelection<Technique>
  | FontFaceSelection<FontFaceFormat<Technique> | undefined>
  | (RasterFormatMetadata extends Technique ? string : never);

/** Props of the Vue `Text` component. Ordinary Object3D props pass through to the retained Three object. */
export interface VueTextProps<Technique extends RasterFormatMetadata> {
  readonly font?: VueFontSelection<Technique>;
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
  readonly [passThrough: string]: unknown;
}

export interface VueTextGroupProps extends TextGroupOptions {
  readonly onError?: ((error: unknown) => void) | undefined;
  readonly [passThrough: string]: unknown;
}

/** The public instance a template ref to `Text` resolves to. */
export interface VueTextInstance<Technique extends RasterFormatMetadata> extends ComponentPublicInstance {
  /** The retained Three `Text`, or `undefined` until every font selection has loaded. */
  readonly instance: ThreeText<Technique> | undefined;
}

export interface VueTextGroupInstance extends ComponentPublicInstance {
  readonly instance: ThreeTextGroup | undefined;
}

/** Generic constructor typing so `font` infers the raster technique in TSX and Volar templates. */
export interface TextComponent {
  new <const Selection = undefined>(
    props: Omit<VueTextProps<InferredTextTechnique<Selection>>, 'font'> & {
      readonly font?: Selection & ([InferredTextTechnique<Selection>] extends [never] ? never : unknown);
    },
  ): VueTextInstance<InferredTextTechnique<Selection>> & {
    $props: Omit<VueTextProps<InferredTextTechnique<Selection>>, 'font'> & { readonly font?: Selection };
  };
}

export interface TextGroupComponent {
  new (props: VueTextGroupProps): VueTextGroupInstance & { $props: VueTextGroupProps };
}

export type GlyphProviderFontFace =
  | FontFaceSource
  | FontFace
  | Readonly<{ src: FontFaceSource; format?: FontFaceConfig['format'] }>;

export interface GlyphProviderProps {
  /** Select a Three handle/root, or a named root on the built-in default handle. */
  readonly handle?: ThreeHandle | ThreeRoot | string;
  /** Add immutable scoped family aliases from sources, source configs, or existing FontFace declarations. */
  readonly fontFaces?: Readonly<Record<string, GlyphProviderFontFace>>;
}

export interface GlyphProviderComponent {
  new (props: GlyphProviderProps): ComponentPublicInstance & { $props: GlyphProviderProps };
}

interface GlyphVueContext {
  readonly handle: ThreeHandle;
  readonly root: ThreeRoot;
  readonly fontFaces: ReadonlyMap<string, FontFace>;
}

/** Providers publish a ref because the built-in default handle may still be initializing when descendants mount. */
type GlyphContextRef = Readonly<ShallowRef<GlyphVueContext | undefined>>;

const glyphContextKey: InjectionKey<GlyphContextRef> = Symbol('pmndrs.glyph.vue.context');
const defaultThreeHandleName = '@pmndrs/glyph/vue:default';
const emptyFontFaces: ReadonlyMap<string, FontFace> = new Map();
const rootIds = new WeakMap<ThreeRoot, number>();
let nextRootId = 1;
let nextDefaultRootId = 1;
let defaultThreeHandleValue: ThreeHandle | undefined;
let defaultThreeHandlePromise: Promise<ThreeHandle> | undefined;

// ---------------------------------------------------------------------------------------------------------------
// Default handle and per-canvas default root

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

/** A shallowRef that settles to the default handle; synchronous when Glyph already initialized. */
function useDefaultThreeHandle(): Readonly<ShallowRef<ThreeHandle | undefined>> {
  const handle = shallowRef<ThreeHandle | undefined>(getInitializedDefaultThreeHandle());
  if (handle.value === undefined) {
    let active = true;
    onScopeDispose(() => {
      active = false;
    });
    void defaultThreeHandle().then(
      (value) => {
        if (active) handle.value = value;
      },
      () => undefined,
    );
  }
  return handle;
}

interface RetainedResource<Value> {
  readonly value: Value;
  retain(): () => void;
  dispose(): void;
}

/** Reference counting with a one-microtask grace period so sibling remounts coalesce instead of thrashing. */
function createRetainedResource<Value>(
  value: Value,
  dispose: () => void,
  disposedMessage: string,
): RetainedResource<Value> & { readonly disposed: boolean } {
  let references = 0;
  let releaseRevision = 0;
  let disposed = false;
  const resource = Object.freeze({
    value,
    get disposed(): boolean {
      return disposed;
    },
    retain(): () => void {
      if (disposed) throw new Error(disposedMessage);
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
      dispose();
    },
  });
  return resource;
}

type DefaultGlyphContextResource = RetainedResource<GlyphVueContext> & { readonly disposed: boolean };
const defaultContexts = new WeakMap<TresContext, DefaultGlyphContextResource>();
const defaultRootNames = new WeakMap<TresContext, string>();
const defaultRootFinalizer = new FinalizationRegistry<ThreeRoot>((root) => {
  try {
    root.dispose();
  } catch {
    // A finalizer is only an abandoned-canvas safety net; explicit scope disposal owns correctness.
  }
});

/** One default root per TresCanvas: a Glyph root may not span two Scenes, and every canvas owns one Scene. */
function defaultGlyphContext(tres: TresContext, handle: ThreeHandle): DefaultGlyphContextResource {
  assertUsableHandle(handle);
  const existing = defaultContexts.get(tres);
  if (existing !== undefined && existing.value.handle === handle && !existing.value.root.disposed) return existing;
  let rootName = defaultRootNames.get(tres);
  if (rootName === undefined) {
    rootName = `@pmndrs/glyph/vue:root:${nextDefaultRootId}`;
    nextDefaultRootId += 1;
    defaultRootNames.set(tres, rootName);
  }
  const context: GlyphVueContext = Object.freeze({ handle, root: handle(rootName), fontFaces: emptyFontFaces });
  const resource = createRetainedResource(
    context,
    () => {
      defaultRootFinalizer.unregister(resource);
      context.root.dispose();
    },
    'Vue cannot retain a disposed default Glyph root',
  );
  defaultRootFinalizer.register(tres, context.root, resource);
  defaultContexts.set(tres, resource);
  return resource;
}

/**
 * Resolve the Glyph context a Text, TextGroup, or composable uses: the nearest provider, otherwise the
 * canvas-local default root. Retention follows the calling component's scope.
 */
function useSelectedGlyphContext(): GlyphContextRef {
  const provided = inject(glyphContextKey, undefined);
  if (provided !== undefined) return provided;
  const tres = useTresContext();
  const handle = useDefaultThreeHandle();
  const context = shallowRef<GlyphVueContext | undefined>();
  watch(
    handle,
    (value, _previous, onCleanup) => {
      if (value === undefined) return;
      const resource = defaultGlyphContext(tres, value);
      const release = resource.retain();
      context.value = resource.value;
      onCleanup(() => {
        release();
        if (context.value === resource.value) context.value = undefined;
      });
    },
    { immediate: true, flush: 'sync' },
  );
  return shallowReadonly(context);
}

function assertUsableHandle(handle: ThreeHandle): void {
  if (handle.disposed) throw new Error('Vue cannot construct Text or TextGroup from a disposed Three handle');
}

function assertUsableRoot(root: ThreeRoot): void {
  if (root.disposed) throw new Error('Vue cannot construct Text or TextGroup from a disposed Three root');
}

function selectRoot(selection: ThreeHandle | ThreeRoot): Readonly<{ handle: ThreeHandle; root: ThreeRoot }> {
  if (typeof selection === 'function') return Object.freeze({ handle: selection, root: threeHandleRoot(selection) });
  return Object.freeze({ handle: threeRootHandle(selection), root: selection });
}

function rootId(root: ThreeRoot): number {
  const existing = rootIds.get(root);
  if (existing !== undefined) return existing;
  const id = nextRootId;
  nextRootId += 1;
  rootIds.set(root, id);
  return id;
}

function assertNoHandleAttribute(attrs: Record<string, unknown>, owner: 'Text' | 'TextGroup'): void {
  if (Object.hasOwn(attrs, 'handle')) {
    throw new TypeError(`Vue ${owner} does not accept a handle prop; select custom handles with GlyphProvider`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// GlyphProvider

interface ProviderFontFaces {
  readonly byName: ReadonlyMap<string, FontFace>;
  readonly disposed: boolean;
  retain(): () => void;
}

const emptyProviderFontFaces: ProviderFontFaces = {
  byName: emptyFontFaces,
  disposed: false,
  retain: () => () => undefined,
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
  providerFontFaceFinalizer.register(table, owned, byName);
  const resource = createRetainedResource(
    byName,
    () => {
      providerFontFaceFinalizer.unregister(byName);
      for (const face of owned) face.dispose();
    },
    'GlyphProvider cannot retain disposed fontFaces',
  );
  return {
    byName,
    get disposed(): boolean {
      return resource.disposed;
    },
    retain: () => resource.retain(),
  };
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
    ? fontResourceKey(left.src, left.format)
    : fontResourceKey(left, undefined);
  const rightKey = isProviderFontFaceConfig(right)
    ? fontResourceKey(right.src, right.format)
    : fontResourceKey(right, undefined);
  return leftKey === rightKey;
}

/** Optional immutable handle override and scoped string-FontFace table for Tres descendants. */
export const GlyphProvider: GlyphProviderComponent = defineComponent({
  name: 'GlyphProvider',
  props: {
    handle: { type: null as unknown as PropType<ThreeHandle | ThreeRoot | string>, required: false },
    fontFaces: {
      type: null as unknown as PropType<Readonly<Record<string, GlyphProviderFontFace>>>,
      required: false,
    },
  },
  setup(props, { slots }) {
    const initial = Object.freeze({ handle: props.handle, fontFaces: props.fontFaces });
    watch(
      () => [props.handle, props.fontFaces] as const,
      ([handle, fontFaces]) => {
        if (handle !== initial.handle || !sameProviderFontFaceTable(fontFaces, initial.fontFaces)) {
          throw new Error('GlyphProvider handle and fontFaces are immutable; remount the provider to replace them');
        }
      },
    );
    const faces = providerFontFaces(initial.fontFaces);
    onScopeDispose(faces.retain());
    const context = shallowRef<GlyphVueContext | undefined>();
    const publish = (selection: Readonly<{ handle: ThreeHandle; root: ThreeRoot }>): void => {
      assertUsableHandle(selection.handle);
      assertUsableRoot(selection.root);
      context.value = Object.freeze({ handle: selection.handle, root: selection.root, fontFaces: faces.byName });
    };
    if (initial.handle === undefined) {
      const tres = useTresContext();
      const handle = useDefaultThreeHandle();
      watch(
        handle,
        (value, _previous, onCleanup) => {
          if (value === undefined) return;
          const resource = defaultGlyphContext(tres, value);
          const release = resource.retain();
          publish(resource.value);
          onCleanup(release);
        },
        { immediate: true, flush: 'sync' },
      );
    } else if (typeof initial.handle === 'string') {
      const name = initial.handle;
      const handle = useDefaultThreeHandle();
      watch(
        handle,
        (value) => {
          if (value !== undefined) publish(Object.freeze({ handle: value, root: value(name) }));
        },
        { immediate: true, flush: 'sync' },
      );
    } else {
      publish(selectRoot(initial.handle));
    }
    provide(glyphContextKey, shallowReadonly(context));
    return () => slots.default?.() ?? null;
  },
}) as unknown as GlyphProviderComponent;

// ---------------------------------------------------------------------------------------------------------------
// Font resolution shared by Text and the flattener

function resolveVueTextFont(
  selection: VueFontSelectionInput,
  context: GlyphVueContext,
): FontSelection<RasterFormatMetadata> | FontFaceSelection {
  if (typeof selection !== 'string') return selection;
  const face = context.fontFaces.get(selection) ?? resolveFontFace(selection);
  if (face === undefined) {
    throw new GlyphFontError('FONT_FACE_NOT_FOUND', `FontFace ${JSON.stringify(selection)} is not defined`);
  }
  return face;
}

/**
 * Loaded-state tracker for the FontFace selections one paragraph depends on. Missing loads start together so
 * nested fonts never form a waterfall; each settlement bumps a revision the render function reads.
 */
function createFontLoadTracker(reportError: (error: unknown) => void) {
  const revision = shallowRef(0);
  const requested = new WeakSet<FontFaceSelection>();
  let active = true;
  onScopeDispose(() => {
    active = false;
  });
  return {
    /** Start every missing load, then report whether all selections are loaded right now. */
    ensureLoaded(handle: ThreeHandle, selections: readonly FontFaceSelection[]): boolean {
      void revision.value;
      let ready = true;
      for (const selection of selections) {
        if (isThreeHandleFontLoaded(handle, selection)) continue;
        ready = false;
        if (requested.has(selection)) continue;
        requested.add(selection);
        loadThreeHandleFont(handle, selection).then(
          () => {
            requested.delete(selection);
            if (active) revision.value += 1;
          },
          (error: unknown) => {
            requested.delete(selection);
            if (active) reportError(error);
          },
        );
      }
      return ready;
    },
  };
}

/** Mounted immutable Font leases for FontFace selections, acquired per paragraph and released with its scope. */
function createFontLeases() {
  const leases = new Map<FontFaceSelection, Font<RasterFormatMetadata>>();
  const release = (keep?: ReadonlySet<FontFaceSelection>): void => {
    for (const [selection, font] of leases) {
      if (keep?.has(selection) === true) continue;
      leases.delete(selection);
      font.dispose();
    }
  };
  onScopeDispose(() => release());
  return {
    acquire(handle: ThreeHandle, selection: FontFaceSelection): Font<RasterFormatMetadata> {
      const existing = leases.get(selection);
      if (existing !== undefined && !existing.disposed) return existing;
      const font = acquireThreeHandleFont(handle, selection);
      leases.set(selection, font);
      return font;
    },
    /** Drop leases the current paragraph no longer references; call only after the object applied the new state. */
    prune(keep: ReadonlySet<FontFaceSelection>): void {
      release(keep);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Text

type DesiredVueText = Partial<StandaloneTextProperties<RasterFormatMetadata>> & {
  readonly font: FontSelection<RasterFormatMetadata>;
  readonly text: FormattedText<RasterFormatMetadata>;
};

type TextConstructorArguments = readonly [
  typeof threeTextConstructionToken,
  StandaloneTextProperties<RasterFormatMetadata>,
  readonly [],
  ThreeRootHost,
];

interface TextPublication {
  readonly key: string;
  readonly args: TextConstructorArguments;
  /** The state the retained object currently holds, starting with what its constructor received. */
  applied: DesiredVueText;
}

const textPropDefinitions = {
  font: { type: null as unknown as PropType<VueFontSelectionInput>, required: false },
  style: { type: null as unknown as PropType<PropertyList<TextStyle>>, required: false },
  layout: { type: null as unknown as PropType<PropertyList<ParagraphLayout>>, required: false },
  constraints: { type: null as unknown as PropType<PropertyList<Constraints>>, required: false },
  rasterPixelRatio: { type: Number, required: false },
  material: { type: null as unknown as PropType<ThreeTextMaterial>, required: false },
  // A Boolean-typed prop coerces absence to `false`; an untyped prop keeps `undefined` so Three's default rules.
  pixelSnapping: { type: null as unknown as PropType<boolean>, required: false },
} as const;

/** Vue paragraph component backed by one retained Three text instance. Nested `Text` children are inline runs. */
export const Text: TextComponent = defineComponent({
  name: 'GlyphText',
  inheritAttrs: false,
  props: textPropDefinitions,
  emits: {
    error: (_error: unknown) => true,
  },
  setup(props, { slots, attrs, emit, expose }) {
    const context = useSelectedGlyphContext();
    const instance = shallowRef<ThreeText<RasterFormatMetadata> | undefined>();
    const reportError = (error: unknown): void => emit('error', error);
    const loads = createFontLoadTracker(reportError);
    const leases = createFontLeases();
    let publication: TextPublication | undefined;
    let desired: DesiredVueText | undefined;
    let desiredSelections: ReadonlySet<FontFaceSelection> = new Set();
    expose({ instance });

    const apply = (): void => {
      const object = instance.value;
      if (object === undefined || publication === undefined || desired === undefined) return;
      if (!sameDesiredText(publication.applied, desired)) {
        const { pixelSnapping: _pixelSnapping, ...update } = desired;
        object.set(update);
        publication.applied = desired;
      }
      leases.prune(desiredSelections);
    };
    onMounted(apply);
    onUpdated(apply);

    return (): VNode | null => {
      assertNoHandleAttribute(attrs, 'Text');
      const selected = context.value;
      if (selected === undefined) return null;
      const { handle, root } = selected;
      assertUsableHandle(handle);
      assertUsableRoot(root);
      if (props.font === undefined) throw new TypeError('an outer Vue Text requires a font');
      const outerFont = resolveVueTextFont(props.font, selected);
      const flattened = flattenVueText(slots.default?.() as VNodeArrayChildren | undefined, {
        isText: (type) => type === Text,
        resolveFont: (selection) => resolveVueTextFont(selection, selected),
        isFontFaceSelection,
      });
      const selections = collectFontFaceSelections(outerFont, flattened.fontFaces);
      if (!loads.ensureLoaded(handle, selections)) return null;

      const loaded = new Map<FontFaceSelection, Font<RasterFormatMetadata>>();
      for (const selection of selections) loaded.set(selection, leases.acquire(handle, selection));
      desiredSelections = new Set(selections);
      desired = desiredText(props, outerFont, flattened, loaded);

      const key = `${rootId(root)}:${props.pixelSnapping === true ? 'pixel-snapped' : 'unsnapped'}`;
      if (publication?.key !== key) {
        // Tres rebuilds an instance when `args` change, so the array is created once per key and never replaced;
        // a root or snapping change remounts through the key instead.
        publication = {
          key,
          args: [threeTextConstructionToken, desired, [], threeRootHost(root)],
          applied: desired,
        };
      }
      const { key: _key, ref: _ref, ...passThrough } = attrs;
      return h(`Tres${textTag}`, {
        ...passThrough,
        key,
        args: publication.args,
        ref: (node: unknown) => {
          const object = node instanceof ThreeText ? (node as ThreeText<RasterFormatMetadata>) : undefined;
          if (object !== undefined) object.onError = reportError;
          instance.value = object;
        },
      });
    };
  },
}) as unknown as TextComponent;

function collectFontFaceSelections(
  outer: FontSelection<RasterFormatMetadata> | FontFaceSelection,
  nested: readonly FontFaceSelection[],
): readonly FontFaceSelection[] {
  if (!isFontFaceSelection(outer) || nested.includes(outer)) return nested;
  return Object.freeze([outer, ...nested]);
}

function loadedFont(
  selection: FontSelection<RasterFormatMetadata> | FontFaceSelection,
  loaded: ReadonlyMap<FontFaceSelection, Font<RasterFormatMetadata>>,
): FontSelection<RasterFormatMetadata> {
  return isFontFaceSelection(selection) ? loaded.get(selection)! : selection;
}

function desiredText(
  props: Readonly<{
    style?: PropertyList<TextStyle> | undefined;
    layout?: PropertyList<ParagraphLayout> | undefined;
    constraints?: PropertyList<Constraints> | undefined;
    rasterPixelRatio?: number | undefined;
    material?: ThreeTextMaterial | undefined;
    pixelSnapping?: boolean | undefined;
  }>,
  outerFont: FontSelection<RasterFormatMetadata> | FontFaceSelection,
  flattened: PendingFlattenedVueText,
  loaded: ReadonlyMap<FontFaceSelection, Font<RasterFormatMetadata>>,
): DesiredVueText {
  const spans = flattened.spans.map((span): ThreeTextSpanRecord<RasterFormatMetadata> => {
    const { font, ...properties } = span;
    return font === undefined ? properties : Object.freeze({ ...properties, font: loadedFont(font, loaded) });
  });
  return Object.freeze({
    font: loadedFont(outerFont, loaded),
    text: Object.freeze({ text: flattened.text, spans: Object.freeze(spans) }) as FormattedText<RasterFormatMetadata>,
    ...(props.style === undefined ? {} : { style: props.style }),
    ...(props.layout === undefined ? {} : { layout: props.layout }),
    ...(props.constraints === undefined ? {} : { constraints: props.constraints }),
    ...(props.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: props.rasterPixelRatio }),
    ...(props.material === undefined ? {} : { material: props.material }),
    ...(props.pixelSnapping === undefined ? {} : { pixelSnapping: props.pixelSnapping }),
  });
}

// ---------------------------------------------------------------------------------------------------------------
// TextGroup

type TextGroupConstructorArguments = readonly [typeof threeTextConstructionToken, TextGroupOptions, ThreeRootHost];

/** Vue retained batching boundary for descendant Text components. */
export const TextGroup: TextGroupComponent = defineComponent({
  name: 'GlyphTextGroup',
  inheritAttrs: false,
  props: {
    renderOrder: { type: Number, required: false },
    material: { type: null as unknown as PropType<ThreeTextMaterial>, required: false },
    pixelSnapping: { type: null as unknown as PropType<boolean>, required: false },
  },
  emits: {
    error: (_error: unknown) => true,
  },
  setup(props, { slots, attrs, emit, expose }) {
    const context = useSelectedGlyphContext();
    const instance = shallowRef<ThreeTextGroup | undefined>();
    const reportError = (error: unknown): void => emit('error', error);
    let publication: Readonly<{ key: string; args: TextGroupConstructorArguments }> | undefined;
    expose({ instance });

    const apply = (): void => {
      const object = instance.value;
      if (object === undefined) return;
      if (object.material !== props.material) object.material = props.material;
      if (props.renderOrder !== undefined && object.renderOrder !== props.renderOrder) {
        object.renderOrder = props.renderOrder;
      }
    };
    onMounted(apply);
    onUpdated(apply);

    return (): VNode | null => {
      assertNoHandleAttribute(attrs, 'TextGroup');
      const selected = context.value;
      if (selected === undefined) return null;
      const { handle, root } = selected;
      assertUsableHandle(handle);
      assertUsableRoot(root);
      const key = `${rootId(root)}:${props.pixelSnapping === true ? 'pixel-snapped' : 'unsnapped'}`;
      if (publication?.key !== key) {
        publication = Object.freeze({
          key,
          args: [
            threeTextConstructionToken,
            {
              ...(props.renderOrder === undefined ? {} : { renderOrder: props.renderOrder }),
              ...(props.material === undefined ? {} : { material: props.material }),
              ...(props.pixelSnapping === undefined ? {} : { pixelSnapping: props.pixelSnapping }),
            },
            threeRootHost(root),
          ] as const,
        });
      }
      const { key: _key, ref: _ref, ...passThrough } = attrs;
      return h(
        `Tres${textGroupTag}`,
        {
          ...passThrough,
          key,
          args: publication.args,
          ref: (node: unknown) => {
            const object = node instanceof ThreeTextGroup ? node : undefined;
            if (object !== undefined) object.onError = reportError;
            instance.value = object;
          },
        },
        slots.default?.(),
      );
    };
  },
}) as unknown as TextGroupComponent;

// ---------------------------------------------------------------------------------------------------------------
// useFont

type SelectedHookFontConfig<Format> = Readonly<{ format: FontFaceFormatInput<Format> }>;
type DefaultHookFontConfig = Readonly<{ format?: FontFaceFormat }>;

type TechniqueOfHookFormat<Format> = Format extends RasterFormatMetadata
  ? Format
  : Format extends { readonly raster: infer Technique extends RasterFormatMetadata }
    ? Technique
    : RasterFormatMetadata;

/** Reactive result of `useFont`: the mounted lease once loaded, the failure if any, and an awaitable for Suspense. */
export interface UseFontResult<Technique extends RasterFormatMetadata> {
  readonly font: Readonly<ShallowRef<Font<Technique> | undefined>>;
  readonly error: Readonly<ShallowRef<unknown>>;
  /** Resolves with the mounted lease; `await` it in an async setup to integrate with `<Suspense>`. */
  readonly ready: Promise<Font<Technique>>;
}

interface VueFontFaceResource {
  readonly handle: ThreeHandle;
  readonly face: FontFace;
  readonly ready: Promise<void>;
  readonly status: 'pending' | 'fulfilled' | 'rejected';
  pinPreload(): void;
  retain(): () => void;
  clear(): void;
}

interface DefaultFontPreload {
  promise: Promise<void>;
  resource: VueFontFaceResource | undefined;
}

const vueFontFaces = new WeakMap<ThreeHandle, Map<string, VueFontFaceResource>>();
const defaultFontPreloads = new Map<string, DefaultFontPreload>();

/** Load and retain one immutable mounted Font lease through the selected handle for the component scope. */
export function useFont(input: FontFaceSource): UseFontResult<RasterFormatMetadata>;
export function useFont<const Format>(
  input: FontFaceSource,
  config: SelectedHookFontConfig<Format>,
): UseFontResult<TechniqueOfHookFormat<Format>>;
export function useFont(
  input: FontFaceSource,
  config: DefaultHookFontConfig = {},
): UseFontResult<RasterFormatMetadata> {
  const context = useSelectedGlyphContext();
  const font = shallowRef<Font<RasterFormatMetadata> | undefined>();
  const error = shallowRef<unknown>();
  const settled = Promise.withResolvers<Font<RasterFormatMetadata>>();
  // A consumer that never awaits `ready` must not surface an unhandled rejection; `error` still carries it.
  settled.promise.catch(() => undefined);
  watch(
    () => context.value?.handle,
    (handle, _previous, onCleanup) => {
      if (handle === undefined) return;
      const resource = vueFontFaceResource(handle, input, config);
      const releaseResource = resource.retain();
      let mounted: Font<RasterFormatMetadata> | undefined;
      let active = true;
      resource.ready.then(
        () => {
          if (!active) return;
          mounted = acquireThreeHandleFont(handle, resource.face);
          font.value = mounted;
          settled.resolve(mounted);
        },
        (failure: unknown) => {
          if (!active) return;
          error.value = failure;
          settled.reject(failure);
        },
      );
      onCleanup(() => {
        active = false;
        font.value = undefined;
        mounted?.dispose();
        mounted = undefined;
        releaseResource();
      });
    },
    { immediate: true, flush: 'sync' },
  );
  return Object.freeze({ font: shallowReadonly(font), error: shallowReadonly(error), ready: settled.promise });
}

/** Start the same default-handle load before a component requests it. */
export function preloadFont(input: FontFaceSource): Promise<void>;
export function preloadFont<const Format>(input: FontFaceSource, config: SelectedHookFontConfig<Format>): Promise<void>;
export function preloadFont(input: FontFaceSource, config: DefaultHookFontConfig = {}): Promise<void> {
  const key = fontResourceKey(input, config.format);
  const existing = defaultFontPreloads.get(key);
  if (existing !== undefined) return existing.promise;
  const preload: DefaultFontPreload = { promise: Promise.resolve(), resource: undefined };
  preload.promise = defaultThreeHandle()
    .then((handle) => {
      if (defaultFontPreloads.get(key) !== preload) return;
      const rejected = vueFontFaces.get(handle)?.get(key);
      if (rejected?.status === 'rejected') rejected.clear();
      const resource = vueFontFaceResource(handle, input, config);
      preload.resource = resource;
      resource.pinPreload();
      return resource.ready;
    })
    .catch((error: unknown) => {
      if (defaultFontPreloads.get(key) === preload) defaultFontPreloads.delete(key);
      throw error;
    });
  defaultFontPreloads.set(key, preload);
  return preload.promise;
}

/** Release a preloaded default-handle resource without invalidating mounted Font leases. */
export function clearFont(input: FontFaceSource): void;
export function clearFont<const Format>(input: FontFaceSource, config: SelectedHookFontConfig<Format>): void;
export function clearFont(input: FontFaceSource, config: DefaultHookFontConfig = {}): void {
  const key = fontResourceKey(input, config.format);
  const preload = defaultFontPreloads.get(key);
  defaultFontPreloads.delete(key);
  preload?.resource?.clear();
  const handle = getInitializedDefaultThreeHandle();
  if (handle !== undefined) vueFontFaces.get(handle)?.get(key)?.clear();
}

function vueFontFaceResource(
  handle: ThreeHandle,
  input: FontFaceSource,
  config: DefaultHookFontConfig,
): VueFontFaceResource {
  let cache = vueFontFaces.get(handle);
  if (cache === undefined) {
    cache = new Map();
    vueFontFaces.set(handle, cache);
  }
  const key = fontResourceKey(input, config.format);
  const existing = cache.get(key);
  if (existing !== undefined && (!existing.face.disposed || existing.status === 'rejected')) return existing;
  const face = config.format === undefined ? glyph.fontFace(input) : glyph.fontFace(input, { format: config.format });
  let references = 0;
  let releaseRevision = 0;
  let preloadPinned = false;
  let disposed = false;
  let status: VueFontFaceResource['status'] = 'pending';
  const releaseFace = (): void => {
    if (!face.disposed) face.dispose();
  };
  const ready = loadThreeHandleFont(handle, face).then(
    () => {
      status = 'fulfilled';
    },
    (error: unknown) => {
      status = 'rejected';
      preloadPinned = false;
      const preload = defaultFontPreloads.get(key);
      if (preload?.resource?.face === face) defaultFontPreloads.delete(key);
      releaseFace();
      throw error;
    },
  );
  const disposeIfUnused = (): void => {
    if (references !== 0 || preloadPinned || disposed) return;
    disposed = true;
    if (cache.get(key)?.face === face) cache.delete(key);
    releaseFace();
  };
  const resource: VueFontFaceResource = Object.freeze({
    handle,
    face,
    ready,
    get status(): VueFontFaceResource['status'] {
      return status;
    },
    pinPreload(): void {
      preloadPinned = true;
    },
    retain(): () => void {
      if (disposed) throw new Error('Vue cannot retain a disposed font resource');
      references += 1;
      releaseRevision += 1;
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
      preloadPinned = false;
      if (cache.get(key)?.face === face) cache.delete(key);
      disposeIfUnused();
    },
  });
  cache.set(key, resource);
  return resource;
}
