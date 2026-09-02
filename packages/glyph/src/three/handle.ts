import * as THREE from 'three/webgpu';

import {
  defaultDecoder,
  createGlyphRootRegistry,
  defineGlyphConfig,
  defineGlyphSchema,
  resourceLease,
  type AnyGlyphConfig,
  type BackendMaterialBinding,
  type BackendTransformBinding,
  type GlyphBindings,
  type GlyphBatchBindingInput,
  type GlyphBufferBindingInput,
  type GlyphConfig,
  type GlyphHandle,
  type GlyphRootRegistry,
  type GlyphInstanceSpanBindingInput,
  type GlyphRenderer,
  type GlyphRootInstanceBindingInput,
  type GlyphSchema,
  type PolicyProgram,
  type RendererContext,
} from '../core.js';
import type { GlyphEngine } from '../glyph-engine.js';
import {
  FontFaceHandleStore,
  isFontFaceSelection,
  registerFontFaceHandleStore,
  resolveFontFace,
  unregisterFontFaceHandleStore,
  type AnyFontFaceSelection,
  type FontFaceTechniqueOf,
} from '../font-face.js';
import type { Font } from '../font.js';
import { glyphFontLibrary } from '../glyph.js';
import { FontLoadError } from '../loader.js';
import type { FontSelection } from '../loaded-font.js';
import { bitmap } from '../raster/bitmap-technique.js';
import { msdf } from '../raster/msdf.js';
import { slug } from '../raster/slug-technique.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import { normalizeGlyphBufferCapacity, type GlyphBufferCapacity } from '../text-properties.js';
import { registerDefaultThreeConfig, ThreeTextEngineCoordinator } from './engine-coordinator.js';
import type { PortableResource } from '../core.js';
import type { ThreeEngineDomainLease } from './engine-domain.js';
import { threePolicyCapabilitySet, threeRenderPolicyDescriptor } from './render-policy.js';
import type { ThreeAllocationMode, ThreeTransformMode } from './render-policy.js';
import type { ThreeRootContext, ThreeTextMaterial } from './material.js';
import {
  Text,
  TextGroup,
  ThreeRoot,
  normalizeThreeRootCompositing,
  threeTextConstructionToken,
  type StandaloneTextProperties,
  type TextGroupOptions,
  type ThreeRootOptions,
  type ThreeRootDomainProvider,
} from './text.js';

export interface ThreeProgramBinding {
  readonly kind: 'three-program';
  readonly program: PolicyProgram;
}

export interface ThreeBufferBinding {
  readonly kind: 'three-buffer';
  readonly input: GlyphBufferBindingInput<ThreeBindings>;
}

export interface ThreeInstanceSpanBinding {
  readonly kind: 'three-instance-span';
  readonly input: GlyphInstanceSpanBindingInput<ThreeBindings>;
}

export interface ThreeBatchBinding {
  readonly kind: 'three-batch';
  readonly input: GlyphBatchBindingInput<ThreeBindings>;
}

export interface ThreeInstanceBinding {
  readonly kind: 'three-instance';
  readonly input: GlyphRootInstanceBindingInput<ThreeBindings>;
}

export interface ThreePortableResource {
  readonly technique: string;
  readonly resourceName: string;
  readonly resources: ReadonlyMap<string, PortableResource>;
}

export interface ThreeResolvedResourceBinding extends ThreePortableResource {}

/** Renderer-facing material selection after Text/TextGroup scene properties have been resolved. */
export interface ThreeMaterialBinding {
  readonly material: ThreeTextMaterial | undefined;
  readonly pixelSnapping: boolean;
  readonly renderOrder: number;
}

export interface ThreeResolvedMaterialBinding extends ThreeMaterialBinding {
  readonly root: ThreeRootContext;
}

export type ThreeBindings = GlyphBindings<
  ThreeResolvedResourceBinding,
  ThreeBufferBinding,
  ThreeProgramBinding,
  ThreeResolvedMaterialBinding,
  THREE.Object3D,
  ThreeBatchBinding,
  ThreeInstanceBinding,
  ThreeInstanceSpanBinding
>;

interface ThreeTextFactory {
  createText<Technique extends AnyRasterTechnique>(properties: StandaloneTextProperties<Technique>): Text<Technique>;
  createText<const Selection extends AnyFontFaceSelection | string>(
    properties: Omit<StandaloneTextProperties<FontFaceTechniqueOf<Selection>>, 'font'> & { readonly font: Selection },
  ): Text<FontFaceTechniqueOf<Selection>>;
  createTextGroup(options?: TextGroupOptions): TextGroup;
}

interface ThreeRootApi extends ThreeTextFactory {
  readonly textCount: number;
  readonly gpuBytes: number;
  readonly capacity: GlyphBufferCapacity;
  readonly compositing: 'ordered' | 'independent';
  material: ThreeTextMaterial | undefined;
  setCapacity(value: GlyphBufferCapacity): void;
  setCompositing(value: 'ordered' | 'independent'): void;
  setMaterial(value: ThreeTextMaterial | undefined): void;
  shape(): void;
}

/** Callable Three handle. Its direct factories delegate to the one anonymous root. */
export interface ThreeHandle extends GlyphHandle<ThreeRoot>, ThreeRootApi {}

export interface ThreeConfigOptions extends ThreeRootOptions {
  readonly transformMode?: ThreeTransformMode;
  readonly allocationMode?: ThreeAllocationMode;
  readonly defaultFontFormat?: keyof ThreeFontTechniques;
  /** Renderer-wide fallback after span, Text, TextGroup, and root material selection. */
  readonly material?: ThreeTextMaterial;
}

export interface ThreeFontTechniques {
  readonly bitmap: typeof bitmap;
  readonly msdf: typeof msdf;
  readonly slug: typeof slug;
}

export const ThreeFontTechniques: ThreeFontTechniques = Object.freeze({ bitmap, msdf, slug });

/** Config-facing binding for one Three publication root. */
export interface ThreeRootBinding {
  readonly drawRoot: THREE.Object3D;
  resolveMaterial(binding: BackendMaterialBinding): ThreeResolvedMaterialBinding;
  resolveTransform(binding: BackendTransformBinding, recordIndex: number): THREE.Object3D;
}

export const ThreeSchema: GlyphSchema<ThreeBindings, ThreeRootBinding> = defineGlyphSchema<ThreeBindings>()({
  drawRoot: (root: ThreeRootBinding) => root.drawRoot,
  program: (_root, program) => Object.freeze({ kind: 'three-program', program }),
  buffer: (_root, input) => Object.freeze({ kind: 'three-buffer', input }),
  material: (root, binding) => root.resolveMaterial(binding),
  transform: (root, binding, recordIndex) => root.resolveTransform(binding, recordIndex),
  batch: (_root, input) => Object.freeze({ kind: 'three-batch', input }),
  instance: (_root, input) => Object.freeze({ kind: 'three-instance', input }),
  instanceSpan: (_root, input) => Object.freeze({ kind: 'three-instance-span', input }),
});

export type ThreeGlyphConfig = GlyphConfig<
  ThreeHandle,
  ThreeBindings,
  void,
  PortableResource,
  unknown,
  ThreeFontTechniques,
  ThreeRootBinding
> &
  Readonly<ThreeRootOptions & { material?: ThreeTextMaterial }>;
const handleDomains = new WeakMap<ThreeHandle, ThreeHandleDomain>();
const rootDomains = new WeakMap<ThreeRoot, ThreeHandleDomain>();

export interface ThreeRendererContext extends RendererContext<ThreeBindings> {
  readonly defaultRenderer: GlyphRenderer<ThreeBindings, void>;
}

/** @internal Resolve the construction binding without adding it to the public handle surface. */
export function threeHandleDomain(handle: ThreeHandle): ThreeRootDomainProvider {
  const domain = handleDomains.get(handle);
  if (domain === undefined) throw new TypeError('Three handle was not created by glyph.handle() with ThreeConfig');
  return domain;
}

/** @internal Resolve the anonymous root fronted by a Three handle. */
export function threeHandleRoot(handle: ThreeHandle): ThreeRoot {
  const domain = handleDomains.get(handle);
  if (domain === undefined) throw new TypeError('Three handle was not created by glyph.handle() with ThreeConfig');
  return domain.roots.anonymous;
}

/** @internal Resolve the owning handle for a root selected from a callable Three handle. */
export function threeRootHandle(root: ThreeRoot): ThreeHandle {
  const handle = rootDomains.get(root)?.handle;
  if (handle === undefined) throw new TypeError('Three root was not selected from a Glyph Three handle');
  return handle;
}

/** @internal Acquire an independent mounted Font lease from one loaded handle selection. */
export function acquireThreeHandleFont<const Selection extends AnyFontFaceSelection>(
  handle: ThreeHandle,
  selection: Selection,
): Font<FontFaceTechniqueOf<Selection>> {
  const domain = handleDomains.get(handle);
  if (domain === undefined) throw new TypeError('Three handle was not created by glyph.handle() with ThreeConfig');
  return domain.acquireFont(selection);
}

/** @internal Borrow the handle store's immutable source for a render-phase snapshot. */
export function threeHandleFontSource(handle: ThreeHandle, selection: AnyFontFaceSelection): Font<AnyRasterTechnique> {
  const domain = handleDomains.get(handle);
  if (domain === undefined) throw new TypeError('Three handle was not created by glyph.handle() with ThreeConfig');
  return domain.fonts.peek(selection);
}

/** Creates a pure Three config descriptor; every handle still owns independent mutable state. */
export function defineThreeConfig(options: ThreeConfigOptions = {}): ThreeGlyphConfig {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError('ThreeConfig options must be an object');
  }
  const transformMode = options.transformMode ?? 'indexed';
  const allocationMode = options.allocationMode ?? 'ordered';
  const defaultFontFormat = options.defaultFontFormat ?? 'msdf';
  return defineGlyphConfig<
    ThreeHandle,
    ThreeBindings,
    void,
    PortableResource,
    unknown,
    ThreeFontTechniques,
    ThreeRootBinding
  >({
    capabilities: threePolicyCapabilitySet(),
    schema: ThreeSchema,
    fonts: { default: defaultFontFormat, techniques: ThreeFontTechniques },
    encode: ({ ids }) => ({ descriptor: threeRenderPolicyDescriptor(ids, transformMode, [], allocationMode) }),
    decode: defaultDecoder,
    resolve: ({ technique, resourceName, resources }) =>
      resourceLease(
        Object.freeze({
          technique,
          resourceName,
          resources: resources as ReadonlyMap<string, PortableResource>,
        }),
        () => undefined,
      ),
    renderer: (context) => {
      const configured = context as ThreeRendererContext;
      if (configured.defaultRenderer === undefined) {
        throw new TypeError('ThreeConfig.renderer() must be constructed by a Three publication boundary');
      }
      return configured.defaultRenderer;
    },
    createHandle: (context) => {
      const domain = new ThreeHandleDomain(context.engine, context.config);
      const anonymous = domain.roots.anonymous;
      const selectRoot = (name: string): ThreeRoot => domain.roots.get(name);
      Object.defineProperties(selectRoot, {
        createText: { enumerable: true, value: anonymous.createText.bind(anonymous) },
        createTextGroup: { enumerable: true, value: anonymous.createTextGroup.bind(anonymous) },
        textCount: { enumerable: true, get: () => anonymous.textCount },
        gpuBytes: { enumerable: true, get: () => anonymous.gpuBytes },
        capacity: { enumerable: true, get: () => anonymous.capacity },
        compositing: { enumerable: true, get: () => anonymous.compositing },
        material: {
          enumerable: true,
          get: () => anonymous.material,
          set: (value: ThreeTextMaterial | undefined) => {
            anonymous.material = value;
          },
        },
        setCapacity: { enumerable: true, value: anonymous.setCapacity.bind(anonymous) },
        setCompositing: { enumerable: true, value: anonymous.setCompositing.bind(anonymous) },
        setMaterial: { enumerable: true, value: anonymous.setMaterial.bind(anonymous) },
        shape: { enumerable: true, value: anonymous.shape.bind(anonymous) },
      });
      let handle!: ThreeHandle;
      handle = context.create(selectRoot, () => {
        unregisterFontFaceHandleStore(handle);
        domain.releaseHandle();
      }) as ThreeHandle;
      handleDomains.set(handle, domain);
      domain.attachHandle(handle);
      registerFontFaceHandleStore(handle, domain.fonts);
      return handle;
    },
    ...(options.capacity === undefined
      ? {}
      : { capacity: normalizeGlyphBufferCapacity(options.capacity, 'ThreeConfig capacity') }),
    ...(options.compositing === undefined
      ? {}
      : { compositing: normalizeThreeRootCompositing(options.compositing, 'ThreeConfig compositing') }),
    ...(options.material === undefined ? {} : { material: options.material }),
  }) as ThreeGlyphConfig;
}

/** Built-in indexed/ordered Three adapter. Spreading it preserves hooks without shared handle state. */
export const ThreeConfig: ThreeGlyphConfig = defineThreeConfig();
registerDefaultThreeConfig(ThreeConfig);

class ThreeHandleDomain implements ThreeRootDomainProvider {
  readonly coordinator: ThreeTextEngineCoordinator;
  readonly fonts: FontFaceHandleStore;
  readonly roots: GlyphRootRegistry<ThreeRoot>;
  readonly #config: ThreeGlyphConfig;
  readonly #rootOptions: ThreeRootOptions;
  #leases = 0;
  #handleReleased = false;
  #disposed = false;
  #handle: ThreeHandle | undefined;

  constructor(engine: GlyphEngine, config: AnyGlyphConfig) {
    this.#config = config as ThreeGlyphConfig;
    this.#rootOptions = Object.freeze({
      ...(this.#config.capacity === undefined ? {} : { capacity: this.#config.capacity }),
      ...(this.#config.compositing === undefined ? {} : { compositing: this.#config.compositing }),
    });
    const fonts = this.#config.fonts;
    if (fonts === undefined) throw new TypeError('Three GlyphConfig must declare its font techniques');
    this.fonts = new FontFaceHandleStore(glyphFontLibrary(), fonts.techniques, fonts.default);
    this.coordinator = new ThreeTextEngineCoordinator(engine, {}, this.#config);
    this.roots = createGlyphRootRegistry((name, release) => {
      const root = new ThreeRoot(threeTextConstructionToken, name, this, release, this.#rootOptions);
      rootDomains.set(root, this);
      return root;
    });
  }

  get handle(): ThreeHandle | undefined {
    return this.#handle;
  }

  attachHandle(handle: ThreeHandle): void {
    if (this.#handle !== undefined && this.#handle !== handle)
      throw new Error('Three handle domain is already attached');
    this.#handle = handle;
  }

  acquireFont<const Selection extends AnyFontFaceSelection>(
    selection: Selection,
  ): Font<FontFaceTechniqueOf<Selection>> {
    this.assertActive();
    return this.fonts.acquire<FontFaceTechniqueOf<Selection>>(selection);
  }

  createTextForRoot<Technique extends AnyRasterTechnique>(
    root: ThreeRoot,
    properties:
      | StandaloneTextProperties<Technique>
      | (Omit<StandaloneTextProperties<Technique>, 'font'> & {
          readonly font: AnyFontFaceSelection | string;
        }),
  ): Text<Technique> {
    this.assertActive();
    const selection = this.#resolveFontSelection(properties.font);
    if (!isFontFaceSelection(selection)) {
      return new Text(threeTextConstructionToken, properties as StandaloneTextProperties<Technique>, this, [], root);
    }
    if (!this.fonts.isLoaded(selection)) {
      throw new FontLoadError(
        'FONT_FACE_NOT_LOADED',
        `FontFace ${JSON.stringify(selection.family)} must be loaded before creating Three Text`,
      );
    }
    const font = this.fonts.acquire<Technique>(selection);
    try {
      return new Text(
        threeTextConstructionToken,
        { ...properties, font } as StandaloneTextProperties<Technique>,
        this,
        [font],
        root,
      );
    } catch (error) {
      font.dispose();
      throw error;
    }
  }

  acquire(): ThreeEngineDomainLease {
    this.assertActive();
    return this.#retain();
  }

  assertActive(): void {
    if (this.#handleReleased || this.#disposed) throw new Error('Three Glyph handle has been disposed');
  }

  releaseHandle(): void {
    if (this.#handleReleased) return;
    this.#handleReleased = true;
    this.roots.dispose();
    this.fonts.dispose();
    this.#maybeDispose();
  }

  #retain(): ThreeEngineDomainLease {
    if (this.#disposed) throw new Error('Three Glyph handle domain has been disposed');
    this.#leases += 1;
    let disposed = false;
    return Object.freeze({
      coordinator: this.coordinator,
      retain: () => {
        if (disposed) throw new Error('Three Glyph handle domain lease has been disposed');
        return this.#retain();
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.#leases -= 1;
        this.#maybeDispose();
      },
    });
  }

  #resolveFontSelection(
    selection: FontSelection<AnyRasterTechnique> | AnyFontFaceSelection | string,
  ): FontSelection<AnyRasterTechnique> | AnyFontFaceSelection {
    if (typeof selection !== 'string') return selection;
    const face = resolveFontFace(selection);
    if (face === undefined) {
      throw new FontLoadError('FONT_FACE_NOT_FOUND', `FontFace ${JSON.stringify(selection)} is not defined`);
    }
    return face;
  }

  #maybeDispose(): void {
    if (!this.#handleReleased || this.#leases !== 0 || this.#disposed) return;
    this.#disposed = true;
    this.coordinator.dispose();
    void this.#config;
  }
}
