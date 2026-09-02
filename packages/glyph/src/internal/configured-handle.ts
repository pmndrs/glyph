import type { Font } from '../font.js';
import { createGlyphHandleState, type GlyphEngine } from '../glyph-engine.js';
import { createFontStack, immutableFontSelectionFonts, type FontSelection, type FontStack } from '../loaded-font.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import {
  GlyphHandleState,
  type HandleMaterialBinding,
  type CodecRegistration,
  type HandleTransformBinding,
} from './handle-state.js';
import { createGlyphPlanTarget, type GlyphPlanTarget } from '../core/glyph-plan-target.js';
import type {
  AnyGlyphBindings,
  Codec,
  GlyphCommandLimits,
  GlyphConfig,
  GlyphCopy,
  GlyphCopyDestination,
  GlyphCopyRequest,
  GlyphFormattedText,
  GlyphHandle,
  GlyphHandleFonts,
  GlyphRoot,
  GlyphRootCreateOptions,
  GlyphRootServices,
  GlyphShapeOptions,
  GlyphRenderer,
  GlyphSchema,
  RendererContext,
  ResolveContext,
  ResourceLease,
  GlyphTextController,
  GlyphTextState,
} from '../core/glyph-config.js';
import type { HandleFontStackBinding } from './handle-state.js';
import type {
  RenderPlanner,
  RetainedFormattedText,
  RetainedText,
  RetainedTextOptions,
} from '../core/render-planner.js';

const DEFAULT_LIMITS: GlyphCommandLimits = Object.freeze({
  maxParagraphs: 4_096,
  maxClusters: 65_536,
  maxLines: 65_536,
  maxRegions: 65_536,
  maxExclusions: 65_536,
  maxInlineObjects: 65_536,
  maxSlotsPerBand: 32,
  maxOutputBytes: 64 * 1024 * 1024,
});

interface HandleInput {
  readonly name: string;
  readonly engine: GlyphEngine;
  readonly fonts: GlyphHandleFonts | undefined;
  readonly released: (handle: GlyphHandle) => void;
}

/** @internal Core-owned constructor installed by defineGlyphConfig. */
export function createConfiguredGlyphHandle<
  Root extends GlyphRoot,
  Bindings extends AnyGlyphBindings,
  RendererResult,
  PortableResource,
  FontTechniques extends { readonly [Key in keyof FontTechniques]: AnyRasterTechnique },
  Boundary,
  CodecValue extends Codec,
  ConfigExtension extends object,
>(
  input: HandleInput,
  config: GlyphConfig<
    Root,
    Bindings,
    RendererResult,
    PortableResource,
    FontTechniques,
    Boundary,
    CodecValue,
    ConfigExtension
  >,
): GlyphHandle<Root> {
  return new ConfiguredHandleDomain<
    Root,
    Bindings,
    RendererResult,
    PortableResource,
    FontTechniques,
    Boundary,
    CodecValue,
    ConfigExtension
  >(input, config).handle;
}

class ConfiguredHandleDomain<
  Root extends GlyphRoot,
  Bindings extends AnyGlyphBindings,
  RendererResult,
  PortableResource,
  FontTechniques extends { readonly [Key in keyof FontTechniques]: AnyRasterTechnique },
  Boundary,
  CodecValue extends Codec,
  ConfigExtension extends object,
> {
  readonly handle: GlyphHandle<Root>;
  readonly #input: HandleInput;
  readonly #config: GlyphConfig<
    Root,
    Bindings,
    RendererResult,
    PortableResource,
    FontTechniques,
    Boundary,
    CodecValue,
    ConfigExtension
  >;
  readonly #handleState: GlyphHandleState;
  readonly #codecRegistration;
  readonly #codec: CodecValue;
  readonly #roots = new Map<string | undefined, Root>();
  #copyLeases = 0;
  #infrastructureDisposed = false;
  #disposed = false;

  constructor(
    input: HandleInput,
    config: GlyphConfig<
      Root,
      Bindings,
      RendererResult,
      PortableResource,
      FontTechniques,
      Boundary,
      CodecValue,
      ConfigExtension
    >,
  ) {
    this.#input = input;
    this.#config = config;
    this.#handleState = createGlyphHandleState(input.engine, { integration: input.name });
    let codec: CodecValue | undefined;
    try {
      this.#codecRegistration = this.#handleState.installCodec((ids) => {
        const encoded = config.encode({ integration: input.name, ids });
        codec = encoded;
        return encoded.descriptor;
      });
    } catch (error) {
      this.#handleState.dispose();
      throw error;
    }
    if (codec === undefined) {
      this.#codecRegistration.dispose();
      this.#handleState.dispose();
      throw new Error('GlyphConfig.encode() did not produce a Codec');
    }
    this.#codec = codec;
    let anonymous: Root;
    try {
      anonymous = this.#root(undefined);
    } catch (error) {
      try {
        this.#codecRegistration.dispose();
      } catch {
        // Preserve the root-construction failure.
      }
      try {
        this.#codec.dispose?.();
      } catch {
        // Preserve the root-construction failure.
      }
      try {
        this.#handleState.dispose();
      } catch {
        // Preserve the root-construction failure.
      }
      throw error;
    }
    this.handle = this.#createHandleProxy(anonymous);
  }

  #root(name: string | undefined): Root {
    this.#assertActive();
    const existing = this.#roots.get(name);
    if (existing !== undefined) return existing;
    const services = new ConfiguredRootServices<Bindings, RendererResult, PortableResource, Boundary>(
      this.#handleState,
      this.#codecRegistration,
      this.#codec,
      this.#config,
      () => this.#retainCopy(),
    );
    let created: GlyphRoot | undefined;
    let finalized = false;
    const context = Object.freeze({
      name,
      codec: this.#codec,
      config: this.#config,
      fonts: this.#input.fonts,
      services,
      create: <Extension extends object>(
        extension: Extension,
        options: GlyphRootCreateOptions<Bindings, RendererResult, Boundary>,
      ): Extension & GlyphRoot => {
        if (finalized) throw new Error('Glyph root recipe may call context.create() only once');
        finalized = true;
        services.activate(options);
        const root = this.#createRootProxy(name, extension, services, options.dispose);
        created = root;
        return root;
      },
    });
    try {
      const selected = this.#config.root.create(context);
      if (!finalized || selected !== created || selected.name !== name || typeof selected.dispose !== 'function') {
        throw new TypeError('GlyphConfig.root.create() must return context.create(...)');
      }
      this.#roots.set(name, selected);
      return selected;
    } catch (error) {
      try {
        created?.dispose();
      } catch {
        // Preserve the root recipe failure.
      }
      services.dispose();
      throw error;
    }
  }

  #createRootProxy<Extension extends object>(
    name: string | undefined,
    extension: Extension,
    services: ConfiguredRootServices<Bindings, RendererResult, PortableResource, Boundary>,
    disposeHost: (() => void) | undefined,
  ): Extension & GlyphRoot {
    let disposed = false;
    const bound = new Map<PropertyKey, Function>();
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      this.#roots.delete(name);
      let failure: unknown;
      try {
        services.dispose();
      } catch (error) {
        failure = error;
      }
      try {
        disposeHost?.();
      } catch (error) {
        failure ??= error;
      }
      if (failure !== undefined) throw failure;
    };
    return new Proxy(extension, {
      has: (target, property) =>
        property === 'name' ||
        property === 'handle' ||
        property === 'disposed' ||
        property === 'dispose' ||
        Reflect.has(target, property),
      get: (target, property) => {
        if (property === 'name') return name;
        if (property === 'handle') return this.handle;
        if (property === 'disposed') return disposed;
        if (property === 'dispose') return dispose;
        const value = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        let method = bound.get(property);
        if (method === undefined) {
          const next = value.bind(target);
          bound.set(property, next);
          method = next;
        }
        return method;
      },
      set: (target, property, value) => {
        if (property === 'name' || property === 'handle' || property === 'disposed' || property === 'dispose') {
          return false;
        }
        return Reflect.set(target, property, value, target);
      },
    }) as Extension & GlyphRoot;
  }

  #createHandleProxy(anonymous: Root): GlyphHandle<Root> {
    const select = (name: string): Root => {
      if (typeof name !== 'string' || name.trim().length === 0) {
        throw new TypeError('Glyph named-root selection requires a nonempty string');
      }
      return this.#root(name);
    };
    const bound = new Map<PropertyKey, Function>();
    const dispose = (): void => this.#dispose();
    return new Proxy(select, {
      has: (_target, property) =>
        property === 'name' ||
        property === 'handle' ||
        property === 'disposed' ||
        property === 'dispose' ||
        Reflect.has(anonymous, property),
      get: (_target, property) => {
        if (property === 'name') return undefined;
        if (property === 'handle') return this.handle;
        if (property === 'disposed') return this.#disposed;
        if (property === 'dispose') return dispose;
        const value = Reflect.get(anonymous, property, anonymous);
        if (typeof value !== 'function') return value;
        let method = bound.get(property);
        if (method === undefined) {
          const next = value.bind(anonymous);
          bound.set(property, next);
          method = next;
        }
        return method;
      },
      set: (_target, property, value) => {
        if (property === 'name' || property === 'handle' || property === 'disposed' || property === 'dispose') {
          return false;
        }
        return Reflect.set(anonymous, property, value, anonymous);
      },
    }) as GlyphHandle<Root>;
  }

  #dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    let failure: unknown;
    for (const root of [...this.#roots.values()]) {
      try {
        root.dispose();
      } catch (error) {
        failure ??= error;
      }
    }
    this.#roots.clear();
    try {
      this.#input.released(this.handle);
    } catch (error) {
      failure ??= error;
    }
    if (this.#copyLeases === 0) {
      try {
        this.#disposeInfrastructure();
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure !== undefined) throw failure;
  }

  #retainCopy(): () => void {
    this.#assertActive();
    this.#copyLeases += 1;
    let released = false;
    return (): void => {
      if (released) return;
      released = true;
      if (this.#copyLeases <= 0) throw new Error('Glyph handle copy lease underflow');
      this.#copyLeases -= 1;
      if (this.#disposed && this.#copyLeases === 0) this.#disposeInfrastructure();
    };
  }

  #disposeInfrastructure(): void {
    if (this.#infrastructureDisposed) return;
    this.#infrastructureDisposed = true;
    let failure: unknown;
    try {
      this.#codecRegistration.dispose();
    } catch (error) {
      failure = error;
    }
    try {
      this.#codec.dispose?.();
    } catch (error) {
      failure ??= error;
    }
    try {
      this.#handleState.dispose();
    } catch (error) {
      failure ??= error;
    }
    if (failure !== undefined) throw failure;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error(`Glyph handle ${JSON.stringify(this.#input.name)} has been disposed`);
  }
}

interface RootRuntimeConfig<Bindings extends AnyGlyphBindings, RendererResult, PortableResource, Boundary> {
  readonly schema: GlyphSchema<Bindings, Boundary>;
  readonly commands?: Partial<import('../core/glyph-config.js').GlyphCommandCapacity>;
  resolve(context: ResolveContext<PortableResource, Bindings['resource']>): ResourceLease<Bindings['resource']>;
  renderer(context: RendererContext<Bindings, RendererResult>): GlyphRenderer<Bindings, RendererResult>;
}

class ConfiguredRootServices<
  Bindings extends AnyGlyphBindings,
  RendererResult,
  PortableResource,
  Boundary,
> implements GlyphRootServices<Bindings, RendererResult, Boundary> {
  readonly #handleState: GlyphHandleState;
  readonly #codecRegistration: CodecRegistration;
  readonly #codec: Codec;
  readonly #config: RootRuntimeConfig<Bindings, RendererResult, PortableResource, Boundary>;
  readonly #retainCopy: () => () => void;
  readonly #singleFontStacks = new WeakMap<
    Font<AnyRasterTechnique>,
    FontStack<AnyRasterTechnique, Font<AnyRasterTechnique>>
  >();
  readonly #materials = new WeakMap<HandleMaterialBinding, Bindings['materialInput']>();
  readonly #materialBindings = new Map<
    Bindings['materialInput'],
    { readonly canonical: HandleMaterialBinding; references: number }
  >();
  readonly #transforms = new WeakMap<HandleTransformBinding, Bindings['transformInput']>();
  readonly #transformBindings = new Map<
    Bindings['transformInput'],
    { readonly canonical: HandleTransformBinding; references: number }
  >();
  #planner: RenderPlanner | undefined;
  #target: GlyphPlanTarget<Bindings, RendererResult> | undefined;
  #disposed = false;
  #publishing = false;

  constructor(
    handleState: GlyphHandleState,
    codecRegistration: CodecRegistration,
    codec: Codec,
    config: RootRuntimeConfig<Bindings, RendererResult, PortableResource, Boundary>,
    retainCopy: () => () => void,
  ) {
    this.#handleState = handleState;
    this.#codecRegistration = codecRegistration;
    this.#codec = codec;
    this.#config = config;
    this.#retainCopy = retainCopy;
  }

  activate(options: GlyphRootCreateOptions<Bindings, RendererResult, Boundary>): void {
    if (this.#planner !== undefined) throw new Error('Glyph root services are already active');
    const target = createGlyphPlanTarget({
      config: this.#config,
      codec: this.#codec,
      root: options.boundary,
      ...(options.defaultRenderer === undefined ? {} : { defaultRenderer: options.defaultRenderer }),
      materialInput: (binding) => this.#requiredMaterial(binding),
      transformInput: (binding) => this.#requiredTransform(binding),
    });
    try {
      const commands = this.#config.commands;
      const capabilitySet = this.#codec.descriptor.capabilitySets[this.#codec.capabilitySet ?? 0];
      this.#planner = this.#handleState.createRootPlanner({
        codec: this.#codecRegistration,
        ...(capabilitySet === undefined ? {} : { capabilitySet }),
        target: () => target,
        limits: commands?.limits ?? DEFAULT_LIMITS,
        requestCapacity: commands?.requestBytes ?? 64 * 1024,
        resultCapacity: commands?.resultBytes ?? 256 * 1024,
        textCapacity: commands?.textUnits ?? 256,
      });
      this.#target = target;
    } catch (error) {
      target.dispose();
      throw error;
    }
  }

  createText<Technique extends AnyRasterTechnique>(
    state: GlyphTextState<Technique, Bindings['materialInput'], Bindings['transformInput']>,
  ): GlyphTextController<Technique, Bindings['materialInput'], Bindings['transformInput']> {
    const planner = this.#requiredPlanner();
    return new ConfiguredTextController(planner, this, state);
  }

  shape(options?: GlyphShapeOptions): RendererResult {
    const planner = this.#requiredPlanner();
    if (this.#publishing) throw new Error('Glyph root publication cannot be reentered');
    this.#publishing = true;
    try {
      const result = planner.publish(options);
      if (!result.accepted) throw result.error;
      return this.#target!.lastResult;
    } finally {
      this.#publishing = false;
    }
  }

  syncTransforms(): void {
    this.#requiredPlanner();
    this.#target!.syncTransforms();
  }

  copy(
    text: GlyphTextController<AnyRasterTechnique, Bindings['materialInput'], Bindings['transformInput']>,
    request: GlyphCopyRequest,
    destination: GlyphCopyDestination<Bindings, RendererResult, Boundary>,
  ): GlyphCopy<RendererResult> {
    this.#requiredPlanner();
    if (!(text instanceof ConfiguredTextController) || !text.belongsTo(this)) {
      throw new TypeError('Glyph copy source must be a live Text controller from this root');
    }
    const releaseCopy = this.#retainCopy();
    let target: GlyphPlanTarget<Bindings, RendererResult>;
    try {
      target = createGlyphPlanTarget({
        config: this.#config,
        codec: this.#codec,
        root: destination.boundary,
        defaultRenderer: destination.renderer,
        materialInput: (binding) => this.#requiredMaterial(binding),
        transformInput: (binding) => this.#requiredTransform(binding),
      });
    } catch (error) {
      releaseCopy();
      throw error;
    }
    let accepted;
    try {
      accepted = request.kind === 'glyphs' ? text.copyGlyphs(request.stableIds, target) : text.copyDecorations(target);
    } catch (error) {
      try {
        target.dispose();
      } finally {
        releaseCopy();
      }
      throw error;
    }
    if (!accepted.accepted) {
      try {
        target.dispose();
      } finally {
        releaseCopy();
      }
      throw accepted.error;
    }
    let disposed = false;
    return Object.freeze({
      result: target.lastResult,
      syncTransforms: () => target.syncTransforms(),
      dispose: () => {
        if (disposed) return;
        disposed = true;
        try {
          target.dispose();
        } finally {
          releaseCopy();
        }
      },
    });
  }

  bind<Technique extends AnyRasterTechnique>(
    state: GlyphTextState<Technique, Bindings['materialInput'], Bindings['transformInput']>,
  ): BoundTextState {
    const leases: Array<{ dispose(): void }> = [];
    try {
      const font = this.#bindFontSelection(state.font);
      leases.push(font);
      const transform = this.#bindTransform(state.transform, leases);
      const material = state.material === undefined ? undefined : this.#bindMaterial(state.material, leases);
      const text = typeof state.text === 'string' ? state.text : this.#bindFormattedText(state.text, leases);
      return {
        options: Object.freeze({
          font,
          text,
          transform,
          ...(material === undefined ? {} : { material }),
          ...(state.order === undefined ? {} : { order: state.order }),
          ...(state.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: state.rasterPixelRatio }),
          ...(state.style === undefined ? {} : { style: state.style }),
          ...(state.layout === undefined ? {} : { layout: state.layout }),
          ...(state.constraints === undefined ? {} : { constraints: state.constraints }),
        }),
        leases,
      };
    } catch (error) {
      for (const lease of leases.reverse()) lease.dispose();
      throw error;
    }
  }

  assertTextCall(): void {
    this.#requiredPlanner();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#planner?.dispose();
    this.#planner = undefined;
    this.#target = undefined;
    for (const binding of this.#materialBindings.values()) binding.canonical.dispose();
    this.#materialBindings.clear();
    for (const binding of this.#transformBindings.values()) binding.canonical.dispose();
    this.#transformBindings.clear();
  }

  #bindFormattedText<Technique extends AnyRasterTechnique>(
    input: GlyphFormattedText<Technique, Bindings['materialInput']>,
    leases: Array<{ dispose(): void }>,
  ): RetainedFormattedText {
    return Object.freeze({
      text: input.text,
      spans: Object.freeze(
        input.spans.map((span) => {
          const font = span.font === undefined ? undefined : this.#bindFontSelection(span.font);
          if (font !== undefined) leases.push(font);
          const material = span.material === undefined ? undefined : this.#bindMaterial(span.material, leases);
          return Object.freeze({
            start: span.start,
            end: span.end,
            ...(font === undefined ? {} : { font }),
            ...(material === undefined ? {} : { material }),
            ...(span.style === undefined ? {} : { style: span.style }),
          });
        }),
      ),
    });
  }

  #bindFontSelection(selection: FontSelection<AnyRasterTechnique>): HandleFontStackBinding {
    const fonts = immutableFontSelectionFonts(selection);
    let stack: FontStack<AnyRasterTechnique, Font<AnyRasterTechnique>>;
    if ('fonts' in selection) {
      stack = selection;
    } else {
      const font = fonts[0]!;
      stack = this.#singleFontStacks.get(font) ?? createFontStack(font);
      this.#singleFontStacks.set(font, stack);
    }
    return this.#handleState.bindFontStack(stack);
  }

  #bindMaterial(input: Bindings['materialInput'], leases: Array<{ dispose(): void }>): HandleMaterialBinding {
    let shared = this.#materialBindings.get(input);
    if (shared === undefined || shared.canonical.disposed) {
      const canonical = this.#handleState.createMaterialBinding();
      shared = { canonical, references: 0 };
      this.#materialBindings.set(input, shared);
      this.#materials.set(canonical, input);
    }
    const lease = this.#handleState._retainOpaqueBinding(shared.canonical, 'material');
    shared.references += 1;
    leases.push(this.#sharedMaterialLease(input, shared, lease));
    return lease.binding;
  }

  #requiredMaterial(binding: HandleMaterialBinding): Bindings['materialInput'] {
    const input = this.#materials.get(binding);
    if (input === undefined) throw new Error('command references an unknown adapter material');
    return input;
  }

  #requiredTransform(binding: HandleTransformBinding): Bindings['transformInput'] {
    const input = this.#transforms.get(binding);
    if (input === undefined) throw new Error('command references an unknown adapter transform');
    return input;
  }

  #bindTransform(input: Bindings['transformInput'], leases: Array<{ dispose(): void }>): HandleTransformBinding {
    let shared = this.#transformBindings.get(input);
    if (shared === undefined || shared.canonical.disposed) {
      const canonical = this.#handleState.createTransformBinding();
      shared = { canonical, references: 0 };
      this.#transformBindings.set(input, shared);
      this.#transforms.set(canonical, input);
    }
    const lease = this.#handleState._retainOpaqueBinding(shared.canonical, 'transform');
    shared.references += 1;
    leases.push(this.#sharedTransformLease(input, shared, lease));
    return lease.binding;
  }

  #sharedMaterialLease(
    input: Bindings['materialInput'],
    shared: { readonly canonical: HandleMaterialBinding; references: number },
    lease: { dispose(): void },
  ): { dispose(): void } {
    let disposed = false;
    return {
      dispose: (): void => {
        if (disposed) return;
        disposed = true;
        lease.dispose();
        shared.references -= 1;
        if (shared.references !== 0 || this.#materialBindings.get(input) !== shared) return;
        this.#materialBindings.delete(input);
        shared.canonical.dispose();
      },
    };
  }

  #sharedTransformLease(
    input: Bindings['transformInput'],
    shared: { readonly canonical: HandleTransformBinding; references: number },
    lease: { dispose(): void },
  ): { dispose(): void } {
    let disposed = false;
    return {
      dispose: (): void => {
        if (disposed) return;
        disposed = true;
        lease.dispose();
        shared.references -= 1;
        if (shared.references !== 0 || this.#transformBindings.get(input) !== shared) return;
        this.#transformBindings.delete(input);
        shared.canonical.dispose();
      },
    };
  }

  #requiredPlanner(): RenderPlanner {
    if (this.#disposed) throw new Error('Glyph root services have been disposed');
    if (this.#publishing) throw new Error('Glyph text updates and queries cannot reenter publication');
    if (this.#planner === undefined) throw new Error('Glyph root services were used before context.create()');
    return this.#planner;
  }
}

interface BoundTextState {
  readonly options: RetainedTextOptions;
  readonly leases: readonly { dispose(): void }[];
}

class ConfiguredTextController<
  Technique extends AnyRasterTechnique,
  Bindings extends AnyGlyphBindings,
  RendererResult,
  PortableResource,
  Boundary,
> implements GlyphTextController<Technique, Bindings['materialInput'], Bindings['transformInput']> {
  readonly #services: ConfiguredRootServices<Bindings, RendererResult, PortableResource, Boundary>;
  readonly #text: RetainedText;
  #bound: BoundTextState;
  #disposed = false;

  constructor(
    planner: RenderPlanner,
    services: ConfiguredRootServices<Bindings, RendererResult, PortableResource, Boundary>,
    state: GlyphTextState<Technique, Bindings['materialInput'], Bindings['transformInput']>,
  ) {
    this.#services = services;
    this.#bound = services.bind(state);
    try {
      this.#text = planner.createText(this.#bound.options);
    } catch (error) {
      this.#disposeLeases(this.#bound.leases);
      throw error;
    }
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  update(state: GlyphTextState<Technique, Bindings['materialInput'], Bindings['transformInput']>): void {
    this.#assertActive();
    this.#services.assertTextCall();
    const next = this.#services.bind(state);
    try {
      this.#text.update(next.options);
    } catch (error) {
      this.#disposeLeases(next.leases);
      throw error;
    }
    const previous = this.#bound;
    this.#bound = next;
    this.#disposeLeases(previous.leases);
  }

  measure() {
    this.#assertActive();
    this.#services.assertTextCall();
    return this.#text.measure();
  }

  inspect() {
    this.#assertActive();
    this.#services.assertTextCall();
    return this.#text.glyphs();
  }

  belongsTo(services: object): boolean {
    return !this.#disposed && services === this.#services;
  }

  copyGlyphs(stableIds: ArrayLike<number>, target: Parameters<RetainedText['copyGlyphs']>[1]) {
    this.#assertActive();
    return this.#text.copyGlyphs(stableIds, target);
  }

  copyDecorations(target: Parameters<RetainedText['copyDecorations']>[0]) {
    this.#assertActive();
    return this.#text.copyDecorations(target);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    try {
      this.#text.dispose();
    } finally {
      this.#disposeLeases(this.#bound.leases);
    }
  }

  #disposeLeases(leases: readonly { dispose(): void }[]): void {
    for (const lease of [...leases].reverse()) lease.dispose();
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('Glyph Text controller has been disposed');
  }
}
