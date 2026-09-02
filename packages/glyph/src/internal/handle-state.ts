import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type { Font } from '../font.js';
import type { FontHandle } from '../identity.js';
import { immutableFontStackFonts, type FontStack } from '../loaded-font.js';
import type { AnyRasterFormat } from '../raster-format.js';
import { runtimeShaperEngineExports, type RuntimeShaper } from '../shaper.js';
import { compileRasterFont, resolveRasterPlanProgram, type CompiledRasterFont } from '../core/raster-plan-program.js';
import { portableResourceIdentity, type PortableResource } from '../core/portable-resources.js';
import {
  createRenderPlanner,
  type RenderPlannerFor,
  type RenderPlannerOptions,
  type RenderPlanTarget,
} from '../core/render-planner.js';
import { markOwnedPlanPublication, PlanPublicationExpiredError, type OwnedPlanPublication } from '../core/retention.js';
import {
  assertGlyphId,
  compileRenderPolicy,
  createHandleIdFactory,
  GlyphIdScope,
  RenderIdScope,
  type FontBindingHandle,
  type FontStackHandle,
  type HandleIdFactory,
  type ParagraphId,
  type PolicyDescriptor,
  type PolicyHandle,
  type RenderIdFactory,
  type StyleId,
  type PlannerHandle,
} from '../core/render-policy.js';

const MAX_U32 = 0xffff_ffff;

/** @internal Raw wire transport construction used only by the render-planner implementation. */
interface PlanTransportOptions {
  readonly handle: PlannerHandle;
  readonly requestCapacity: number;
  readonly resultCapacity: number;
  readonly textCapacity?: number;
}

/** Names one renderer integration handle state. */
export interface GlyphHandleStateOptions {
  /** Stable diagnostic namespace; never a wire ID or lookup key. */
  readonly integration: string;
}

/** A counted handle-local render-policy installation. */
export interface CodecRegistration {
  readonly [codecRegistrationBrand]: true;
  readonly disposed: boolean;
  dispose(): void;
}

/** Builds one policy descriptor using the handle's collision-checked wire identities. */
export type CodecFactory = (ids: RenderIdFactory) => PolicyDescriptor;

/** A counted handle-local binding of one immutable font. */
export interface HandleFontBinding<Format extends AnyRasterFormat = AnyRasterFormat> {
  readonly [handleFontBindingBrand]: true;
  readonly raster: Format;
  readonly disposed: boolean;
  dispose(): void;
}

/** A counted handle-local ordered font-stack binding. */
export interface HandleFontStackBinding {
  readonly [handleFontStackBindingBrand]: true;
  readonly disposed: boolean;
  dispose(): void;
}

/** A handle-local renderer material identity. */
export interface HandleMaterialBinding {
  readonly [handleMaterialBindingBrand]: true;
  readonly disposed: boolean;
  dispose(): void;
}

/** A handle-local renderer resource identity. */
export interface HandleResourceBinding {
  readonly [handleResourceBindingBrand]: true;
  readonly disposed: boolean;
  dispose(): void;
}

/** A handle-local renderer transform identity. */
export interface HandleTransformBinding {
  readonly [handleTransformBindingBrand]: true;
  readonly disposed: boolean;
  dispose(): void;
}

declare const codecRegistrationBrand: unique symbol;
declare const handleFontBindingBrand: unique symbol;
declare const handleFontStackBindingBrand: unique symbol;
declare const handleMaterialBindingBrand: unique symbol;
declare const handleResourceBindingBrand: unique symbol;
declare const handleTransformBindingBrand: unique symbol;

/** @internal Runtime-owned shaping registration supplied only by GlyphEngine. */
export interface HandleEngineFontBinding<Format extends AnyRasterFormat = AnyRasterFormat> {
  readonly raster: Format;
  readonly handle: FontHandle;
  readonly identity: object;
  readonly disposed: boolean;
  dispose(): void;
}

/** @internal Engine callback installed when it constructs handle state. */
export type HandleEngineFontBinder = <Technique extends AnyRasterFormat>(
  font: Font<Technique>,
) => HandleEngineFontBinding<Technique>;

/**
 * One borrowed A/B render-plan publication. Its bytes point into Wasm memory and expire when
 * this transport answers any later call; see `core/retention.ts` for the protocol.
 * `copyPublication` validates and owns bytes that must survive the borrow.
 */
export interface PlanPublication {
  readonly bytes: Uint8Array;
  readonly memoryBuffer: ArrayBuffer;
  readonly memoryGrew: boolean;
  readonly engineRevision: number;
  readonly planRevision: number;
  readonly requiredBaseRevision: number;
  readonly publicationGeneration: number;
  readonly outputSlot: number;
  readonly flags: number;
  readonly policyHandle: PolicyHandle | 0;
  readonly capabilitySet: number;
  readonly semanticViewCount: number;
  readonly primitiveCount: number;
  readonly patchCount: number;
  readonly drawCount: number;
}

/**
 * The paragraph and style a rejected frame names, read out of the result header.
 *
 * Both are the identifiers the request used, so a handle maps them to what it authored.
 * Zero means the status names none: an engine-internal invariant, a capacity watermark, or a
 * planner-level conflict attributes nothing.
 */
/** Request identities used by an integration to map a rejected frame back to authored state. */
export interface GlyphEngineFault {
  readonly paragraphId: ParagraphId | 0;
  readonly styleId: StyleId | 0;
}

const NO_FAULT: GlyphEngineFault = Object.freeze({ paragraphId: 0, styleId: 0 });

interface EngineRegistrationOwners {
  readonly codecs: Map<number, GlyphHandleState>;
  readonly fontBindings: Map<number, GlyphHandleState>;
  readonly fontStacks: Map<number, GlyphHandleState>;
  readonly planners: Map<number, GlyphHandleState>;
}

const registrationOwners = new WeakMap<object, EngineRegistrationOwners>();

function ownersFor(exports: object): EngineRegistrationOwners {
  let owners = registrationOwners.get(exports);
  if (owners === undefined) {
    owners = {
      codecs: new Map(),
      fontBindings: new Map(),
      fontStacks: new Map(),
      planners: new Map(),
    };
    registrationOwners.set(exports, owners);
  }
  return owners;
}

/** Stable semantic classification of a glyph-engine status. */
export type GlyphEngineStatusCode =
  | 'invalid-handle'
  | 'invalid-font'
  | 'invalid-extents'
  | 'handle-conflict'
  | 'font-missing'
  | 'invalid-request'
  | 'result-too-large'
  | 'policy-conflict'
  | 'policy-missing'
  | 'planner-conflict'
  | 'planner-missing'
  | 'revision-conflict'
  | 'font-stack-missing'
  | 'font-in-use'
  | 'style-range-invalid'
  | 'style-splits-cluster'
  | 'style-nesting-invalid'
  | 'style-root-invalid'
  | 'font-metrics-missing'
  | 'registration-in-use'
  | 'unknown';

const GLYPH_ENGINE_STATUS_CODES: ReadonlyMap<number, GlyphEngineStatusCode> = new Map<number, GlyphEngineStatusCode>([
  [textShaperAbi.status.invalidHandle, 'invalid-handle'],
  [textShaperAbi.status.invalidFont, 'invalid-font'],
  [textShaperAbi.status.invalidExtents, 'invalid-extents'],
  [textShaperAbi.status.handleConflict, 'handle-conflict'],
  [textShaperAbi.status.fontMissing, 'font-missing'],
  [textShaperAbi.status.invalidRequest, 'invalid-request'],
  [textShaperAbi.status.resultTooLarge, 'result-too-large'],
  [textShaperAbi.status.policyConflict, 'policy-conflict'],
  [textShaperAbi.status.policyMissing, 'policy-missing'],
  [textShaperAbi.status.plannerConflict, 'planner-conflict'],
  [textShaperAbi.status.plannerMissing, 'planner-missing'],
  [textShaperAbi.status.revisionConflict, 'revision-conflict'],
  [textShaperAbi.status.fontStackMissing, 'font-stack-missing'],
  [textShaperAbi.status.fontInUse, 'font-in-use'],
  [textShaperAbi.status.styleRangeInvalid, 'style-range-invalid'],
  [textShaperAbi.status.styleSplitsCluster, 'style-splits-cluster'],
  [textShaperAbi.status.styleNestingInvalid, 'style-nesting-invalid'],
  [textShaperAbi.status.styleRootInvalid, 'style-root-invalid'],
  [textShaperAbi.status.fontMetricsMissing, 'font-metrics-missing'],
  [textShaperAbi.status.registrationInUse, 'registration-in-use'],
]);

/** A synchronous engine call rejected with a stable code and its raw diagnostic status. */
export class GlyphEngineStatusError extends Error {
  readonly code: GlyphEngineStatusCode;
  readonly status: number;

  constructor(operation: string, status: number) {
    super(`${operation} failed with glyph-engine status ${status}`);
    this.name = 'GlyphEngineStatusError';
    this.code = glyphEngineStatusCode(status);
    this.status = status;
  }
}

function glyphEngineStatusCode(status: number): GlyphEngineStatusCode {
  return GLYPH_ENGINE_STATUS_CODES.get(status) ?? 'unknown';
}

/** Stable diagnostic details associated with a {@link GlyphEngineStatusError}. */
export interface GlyphEngineStatusDetails {
  readonly requiredRequestCapacity: number;
  readonly requiredResultCapacity: number;
  readonly fault: GlyphEngineFault;
}

const glyphEngineStatusDetails = new WeakMap<GlyphEngineStatusError, GlyphEngineStatusDetails>();

/** Reads semantic diagnostic details retained on an engine status error. */
export function glyphEngineStatusErrorDetails(error: GlyphEngineStatusError): GlyphEngineStatusDetails {
  return (
    glyphEngineStatusDetails.get(error) ?? {
      requiredRequestCapacity: 0,
      requiredResultCapacity: 0,
      fault: NO_FAULT,
    }
  );
}

function engineStatusError(
  operation: string,
  status: number,
  requiredRequestCapacity = 0,
  requiredResultCapacity = 0,
  fault: GlyphEngineFault = NO_FAULT,
): GlyphEngineStatusError {
  const error = new GlyphEngineStatusError(operation, status);
  error.message +=
    (fault.paragraphId === 0 ? '' : ` (paragraph ${fault.paragraphId}`) +
    (fault.paragraphId === 0 ? '' : fault.styleId === 0 ? ')' : `, style ${fault.styleId})`) +
    (requiredRequestCapacity === 0 && requiredResultCapacity === 0
      ? ''
      : ` (required request=${requiredRequestCapacity}, result=${requiredResultCapacity})`);
  glyphEngineStatusDetails.set(error, { requiredRequestCapacity, requiredResultCapacity, fault });
  return error;
}

function headerFault(header: DataView): GlyphEngineFault {
  const layout = textShaperAbi.layouts.engineResult;
  const paragraphId = header.getUint32(layout.faultParagraphId, true);
  const styleId = header.getUint32(layout.faultStyleId, true);
  return paragraphId === 0 && styleId === 0
    ? NO_FAULT
    : Object.freeze({ paragraphId: paragraphId as ParagraphId | 0, styleId: styleId as StyleId | 0 });
}

interface InstalledCodecRegistration {
  readonly handle: PolicyHandle;
  readonly descriptor: PolicyDescriptor;
  readonly techniqueIds: ReadonlySet<number>;
  leases: number;
  disposed: boolean;
}

interface RetainedHandleFontBinding {
  readonly identity: object;
  readonly raster: AnyRasterFormat;
  readonly handle: FontBindingHandle;
  readonly engineBinding: HandleEngineFontBinding;
  readonly payloads: ReadonlyMap<number, RetainedPortablePayload>;
  leases: number;
  disposed: boolean;
}

interface RetainedPortablePayload {
  readonly referenceId: number;
  readonly identity: object;
  readonly techniqueId: string;
  readonly resourceName: string;
  readonly payload: PortableResource;
  group: readonly RetainedPortablePayload[] | undefined;
  owners: number;
  leases: number;
}

interface RetainedHandleFontStackBinding {
  readonly identity: object;
  readonly handle: FontStackHandle;
  readonly bindings: readonly HandleFontBindingImpl[];
  leases: number;
  disposed: boolean;
}

interface RetainedOpaqueBinding {
  readonly kind: 'material' | 'resource' | 'transform';
  readonly handle: number;
  binding: HandleMaterialBinding | HandleResourceBinding | HandleTransformBinding;
  leases: number;
  disposed: boolean;
}

/** Counted lease over one handle-local renderer binding. */
export interface HandleBindingLease<
  Binding extends HandleMaterialBinding | HandleResourceBinding | HandleTransformBinding =
    | HandleMaterialBinding
    | HandleResourceBinding
    | HandleTransformBinding,
> {
  readonly handle: number;
  readonly binding: Binding;
  dispose(): void;
}

const handleCodecs = new WeakMap<
  object,
  Readonly<{ handleState: GlyphHandleState; state: InstalledCodecRegistration }>
>();
const handleFontStacks = new WeakMap<
  object,
  Readonly<{ handleState: GlyphHandleState; state: RetainedHandleFontStackBinding }>
>();
const handleOpaqueBindings = new WeakMap<
  object,
  Readonly<{ handleState: GlyphHandleState; state: RetainedOpaqueBinding }>
>();

/** Owns one renderer integration's policies, bindings, render planners, and transports. */
export class GlyphHandleState {
  readonly integration: string;
  readonly #identityNamespace: string;
  readonly #wireIdentities = new RenderIdScope();
  readonly #ids = new GlyphIdScope();
  readonly #exports;
  readonly #owners: EngineRegistrationOwners;
  readonly #planners = new Set<{ dispose(): void }>();
  readonly #transports = new Set<PlanTransport>();
  readonly #codecs = new Set<PolicyHandle>();
  readonly #fontStacks = new Map<FontStackHandle, readonly FontBindingHandle[]>();
  readonly #fontBindings = new Set<FontBindingHandle>();
  readonly #installedCodecs = new Set<InstalledCodecRegistration>();
  readonly #retainedFontBindings = new WeakMap<object, RetainedHandleFontBinding>();
  readonly #liveRetainedFontBindings = new Set<RetainedHandleFontBinding>();
  readonly #retainedFontStacks = new WeakMap<object, RetainedHandleFontStackBinding>();
  readonly #liveRetainedFontStacks = new Set<RetainedHandleFontStackBinding>();
  readonly #portablePayloads = new Map<number, RetainedPortablePayload>();
  readonly #opaqueBindings = new Set<RetainedOpaqueBinding>();
  readonly #opaqueBindingsByKind = {
    material: new Map<number, RetainedOpaqueBinding>(),
    resource: new Map<number, RetainedOpaqueBinding>(),
    transform: new Map<number, RetainedOpaqueBinding>(),
  };
  readonly #onDispose: (() => void) | undefined;
  readonly #bindEngineFont: HandleEngineFontBinder | undefined;
  readonly #assertEngineAvailable: (() => void) | undefined;
  readonly #enterEngineBorrow: (() => () => void) | undefined;
  #nextCodecOrdinal = 1;
  #nextFontBindingOrdinal = 1;
  #nextFontStackOrdinal = 1;
  #nextMaterialOrdinal = 1;
  #nextResourceOrdinal = 1;
  #nextTransformOrdinal = 1;
  readonly #freeTransformOrdinals: number[] = [];
  #nextPlannerOrdinal = 1;
  #disposed = false;

  /** @internal Handle states are owned and normally created by GlyphEngine. */
  constructor(
    shaper: RuntimeShaper,
    options: GlyphHandleStateOptions = { integration: 'internal' },
    onDispose?: () => void,
    bindEngineFont?: HandleEngineFontBinder,
    assertEngineAvailable?: () => void,
    enterEngineBorrow?: () => () => void,
    identityNamespace?: string,
  ) {
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      throw new TypeError('Glyph handle state options must be an object');
    }
    if (typeof options.integration !== 'string' || options.integration.length === 0) {
      throw new TypeError('Glyph handle state integration must be a nonempty string');
    }
    this.integration = options.integration;
    this.#identityNamespace = identityNamespace ?? options.integration;
    this.#exports = runtimeShaperEngineExports(shaper);
    this.#owners = ownersFor(this.#exports);
    this.#onDispose = onDispose;
    this.#bindEngineFont = bindEngineFont;
    this.#assertEngineAvailable = assertEngineAvailable;
    this.#enterEngineBorrow = enterEngineBorrow;
  }

  /** @internal Derive one branded ID retained until its registration or this handle is disposed. */
  readonly id: HandleIdFactory = createHandleIdFactory(this.#ids, () => this.#assertActive());

  /** Installs one renderer policy for this handle and returns its counted lease. */
  installCodec(factory: CodecFactory): CodecRegistration {
    this.#assertActive();
    if (typeof factory !== 'function') throw new TypeError('text engine policy must be a factory');
    const snapshot = snapshotPolicyDescriptor(factory(this.#wireIdentities));
    const bytes = compileRenderPolicy(snapshot);
    const ordinal = this.#nextCodecOrdinal;
    const handle = this.id('policy', `${this.#identityNamespace}/policy/${ordinal}`);
    this.registerCodec(handle, bytes);
    this.#nextCodecOrdinal = ordinal + 1;
    const state: InstalledCodecRegistration = {
      handle,
      descriptor: snapshot,
      techniqueIds: new Set(snapshot.programs.map((program) => program.techniqueId)),
      leases: 1,
      disposed: false,
    };
    this.#installedCodecs.add(state);
    const policy = new CodecRegistrationImpl(this, state) as CodecRegistration;
    handleCodecs.set(policy, { handleState: this, state });
    return policy;
  }

  /** Binds one immutable font's shaping and portable raster resources to this handle. */
  bindFont<Technique extends AnyRasterFormat>(font: Font<Technique>): HandleFontBinding<Technique> {
    this.#assertActive();
    if (this.#bindEngineFont === undefined) {
      throw new Error('Glyph handle state was not created by a glyph engine');
    }
    const engineBinding = this.#bindEngineFont(font);
    try {
      const techniqueId = this.#wireIdentities.technique(font.raster);
      if (![...this.#installedCodecs].some((policy) => !policy.disposed && policy.techniqueIds.has(techniqueId))) {
        throw new TypeError(`Glyph handle state has no installed policy for "${font.raster.id}"`);
      }
      const existing = this.#retainedFontBindings.get(engineBinding.identity);
      if (existing !== undefined && !existing.disposed) {
        if (existing.raster !== font.raster) throw new Error('engine font identity changed raster format');
        engineBinding.dispose();
        existing.leases += 1;
        return new HandleFontBindingImpl(this, existing) as unknown as HandleFontBinding<Technique>;
      }
      const compiled = compileRasterFont(font, this.#wireIdentities);
      if (compiled === undefined) {
        throw new TypeError(`no portable raster plan program is registered for "${font.raster.id}"`);
      }
      const ordinal = this.#nextFontBindingOrdinal;
      const handle = this.id('font-binding', `${this.#identityNamespace}/font/${ordinal}`);
      const payloads = this.#retainPortablePayloads(font.raster, compiled);
      try {
        this.registerFontBinding(handle, engineBinding.handle, compiled.binding);
      } catch (error) {
        this.#releasePortablePayloadOwners(payloads);
        throw error;
      }
      this.#nextFontBindingOrdinal = ordinal + 1;
      const state: RetainedHandleFontBinding = {
        identity: engineBinding.identity,
        raster: font.raster,
        handle,
        engineBinding,
        payloads,
        leases: 1,
        disposed: false,
      };
      this.#retainedFontBindings.set(engineBinding.identity, state);
      this.#liveRetainedFontBindings.add(state);
      return new HandleFontBindingImpl(this, state) as unknown as HandleFontBinding<Technique>;
    } catch (error) {
      engineBinding.dispose();
      throw error;
    }
  }

  /** Binds an ordered immutable font stack to this handle. */
  bindFontStack<Technique extends AnyRasterFormat>(
    stack: FontStack<Technique, Font<Technique>>,
  ): HandleFontStackBinding {
    this.#assertActive();
    const fonts = immutableFontStackFonts(stack as FontStack<AnyRasterFormat, Font<AnyRasterFormat>>);
    for (const font of fonts) {
      const techniqueId = this.#wireIdentities.technique(font.raster);
      if (![...this.#installedCodecs].some((policy) => !policy.disposed && policy.techniqueIds.has(techniqueId))) {
        throw new TypeError(`Glyph handle state has no installed policy for "${font.raster.id}"`);
      }
    }
    const existing = this.#retainedFontStacks.get(stack);
    if (existing !== undefined && !existing.disposed) {
      existing.leases += 1;
      const binding = new HandleFontStackBindingImpl(this, existing) as HandleFontStackBinding;
      handleFontStacks.set(binding, { handleState: this, state: existing });
      return binding;
    }
    const bindings: HandleFontBindingImpl[] = [];
    try {
      for (const font of fonts) {
        bindings.push(this.bindFont(font) as unknown as HandleFontBindingImpl);
      }
      const ordinal = this.#nextFontStackOrdinal;
      const handle = this.id('font-stack', `${this.#identityNamespace}/font-stack/${ordinal}`);
      this.registerFontStack(
        handle,
        bindings.map((binding) => binding._state().handle),
      );
      this.#nextFontStackOrdinal = ordinal + 1;
      const state: RetainedHandleFontStackBinding = {
        identity: stack,
        handle,
        bindings: Object.freeze(bindings),
        leases: 1,
        disposed: false,
      };
      this.#retainedFontStacks.set(stack, state);
      this.#liveRetainedFontStacks.add(state);
      const binding = new HandleFontStackBindingImpl(this, state) as HandleFontStackBinding;
      handleFontStacks.set(binding, { handleState: this, state });
      return binding;
    } catch (error) {
      for (const binding of bindings.reverse()) binding.dispose();
      throw error;
    }
  }

  /** @internal */
  _disposeInstalledCodec(state: InstalledCodecRegistration): void {
    if (state.disposed) return;
    if (state.leases <= 0) throw new Error('codec lease underflow');
    state.leases -= 1;
    if (state.leases === 0) this.#disposeInstalledCodec(state);
  }

  /** @internal */
  _retainInstalledCodec(
    policy: CodecRegistration,
  ): Readonly<{ handle: PolicyHandle; descriptor: PolicyDescriptor; dispose(): void }> {
    this.#assertActive();
    const entry = handleCodecs.get(policy as object);
    if (entry === undefined || entry.handleState !== this || entry.state.disposed || policy.disposed) {
      throw new TypeError('codec must be a live policy installed by this Glyph handle state');
    }
    entry.state.leases += 1;
    let disposed = false;
    return Object.freeze({
      handle: entry.state.handle,
      descriptor: entry.state.descriptor,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this._disposeInstalledCodec(entry.state);
      },
    });
  }

  /** @internal */
  _retainFontStackBinding(binding: HandleFontStackBinding): Readonly<{
    handle: FontStackHandle;
    binding: HandleFontStackBinding;
    techniques: readonly AnyRasterFormat[];
    dispose(): void;
  }> {
    this.#assertActive();
    const entry = handleFontStacks.get(binding as object);
    if (entry === undefined || entry.handleState !== this || entry.state.disposed || binding.disposed) {
      throw new TypeError('font stack binding must be live and owned by this Glyph handle state');
    }
    entry.state.leases += 1;
    const retained = new HandleFontStackBindingImpl(this, entry.state) as HandleFontStackBinding;
    handleFontStacks.set(retained, { handleState: this, state: entry.state });
    return Object.freeze({
      handle: entry.state.handle,
      binding: retained,
      techniques: Object.freeze(entry.state.bindings.map((fontBinding) => fontBinding.raster)),
      dispose: () => retained.dispose(),
    });
  }

  /** Allocates a handle-local identity for renderer-owned material state. */
  createMaterialBinding(): HandleMaterialBinding {
    return this.#createOpaqueBinding('material') as HandleMaterialBinding;
  }

  /** Allocates a handle-local identity for renderer-owned resource state. */
  createResourceBinding(): HandleResourceBinding {
    return this.#createOpaqueBinding('resource') as HandleResourceBinding;
  }

  /** Allocates a handle-local identity for renderer-owned transform state. */
  createTransformBinding(): HandleTransformBinding {
    return this.#createOpaqueBinding('transform') as HandleTransformBinding;
  }

  /** @internal */
  _retainOpaqueBinding(binding: HandleMaterialBinding, kind: 'material'): HandleBindingLease<HandleMaterialBinding>;
  _retainOpaqueBinding(binding: HandleResourceBinding, kind: 'resource'): HandleBindingLease<HandleResourceBinding>;
  _retainOpaqueBinding(binding: HandleTransformBinding, kind: 'transform'): HandleBindingLease<HandleTransformBinding>;
  _retainOpaqueBinding(
    binding: HandleMaterialBinding | HandleResourceBinding | HandleTransformBinding,
    kind: RetainedOpaqueBinding['kind'],
  ): HandleBindingLease<HandleMaterialBinding | HandleResourceBinding | HandleTransformBinding> {
    this.#assertActive();
    const entry = handleOpaqueBindings.get(binding as object);
    if (
      entry === undefined ||
      entry.handleState !== this ||
      entry.state.kind !== kind ||
      entry.state.disposed ||
      binding.disposed
    ) {
      throw new TypeError(`${kind} binding must be live and owned by this Glyph handle state`);
    }
    entry.state.leases += 1;
    const retained = new HandleOpaqueBindingImpl(this, entry.state) as HandleMaterialBinding &
      HandleResourceBinding &
      HandleTransformBinding;
    handleOpaqueBindings.set(retained, { handleState: this, state: entry.state });
    return Object.freeze({
      handle: entry.state.handle,
      binding: retained,
      dispose: () => retained.dispose(),
    });
  }

  /** @internal */
  _acquirePortablePayload(referenceId: number): Readonly<{
    identity: object;
    techniqueId: string;
    resourceName: string;
    payload: PortableResource;
    resources: readonly Readonly<{
      referenceId: number;
      identity: object;
      resourceName: string;
      payload: PortableResource;
    }>[];
    dispose(): void;
  }> {
    if (this.#disposed) throw new Error('Glyph handle state is disposed');
    uint32Handle(referenceId, 'portable payload reference');
    const resolved = this.#portablePayloads.get(referenceId);
    if (resolved === undefined || resolved.owners === 0 || resolved.group === undefined) {
      throw new Error(`text render plan references unknown portable payload ${referenceId}`);
    }
    const resources = resolved.group;
    for (const resource of resources) resource.leases += 1;
    let disposed = false;
    return Object.freeze({
      identity: resolved.identity,
      techniqueId: resolved.techniqueId,
      resourceName: resolved.resourceName,
      payload: resolved.payload,
      resources: Object.freeze(
        resources.map((resource) =>
          Object.freeze({
            referenceId: resource.referenceId,
            identity: resource.identity,
            resourceName: resource.resourceName,
            payload: resource.payload,
          }),
        ),
      ),
      dispose: () => {
        if (disposed) return;
        disposed = true;
        for (const resource of resources) this.#releasePortablePayloadLease(resource);
      },
    });
  }

  /** @internal */
  _resolveOpaqueBinding(kind: 'material', handle: number): HandleMaterialBinding;
  _resolveOpaqueBinding(kind: 'resource', handle: number): HandleResourceBinding;
  _resolveOpaqueBinding(kind: 'transform', handle: number): HandleTransformBinding;
  _resolveOpaqueBinding(
    kind: RetainedOpaqueBinding['kind'],
    handle: number,
  ): HandleMaterialBinding | HandleResourceBinding | HandleTransformBinding {
    if (this.#disposed) throw new Error('Glyph handle state is disposed');
    const state = this.#opaqueBindingsByKind[kind].get(handle);
    if (state !== undefined && !state.disposed) return state.binding;
    throw new Error(`text render plan references unknown ${kind} binding ${handle}`);
  }

  /** @internal */
  _disposeRetainedFontBinding(state: RetainedHandleFontBinding): void {
    if (state.disposed) return;
    if (state.leases <= 0) throw new Error('handle font binding lease underflow');
    if (state.leases > 1) {
      state.leases -= 1;
      return;
    }
    this.#disposeRetainedFontBinding(state);
  }

  /** @internal */
  _disposeRetainedFontStack(state: RetainedHandleFontStackBinding): void {
    if (state.disposed) return;
    if (state.leases <= 0) throw new Error('handle font stack lease underflow');
    if (state.leases > 1) {
      state.leases -= 1;
      return;
    }
    this.#disposeRetainedFontStack(state);
  }

  /** @internal */
  registerFontBinding(bindingHandle: FontBindingHandle, shapingFontHandle: FontHandle, bytes: Uint8Array): void {
    this.#assertActive();
    bindingHandle = assertGlyphId(bindingHandle, 'font-binding', 'font binding handle');
    uint32Handle(shapingFontHandle, 'shaping font handle');
    const adopted = this.#ids.retain(bindingHandle, 'font-binding', 'font binding handle');
    let claimed = false;
    try {
      claimed = this.#claim(this.#owners.fontBindings, bindingHandle, 'font binding');
      this.#withBytes(bytes, (pointer, length) =>
        requireStatus(
          this.#exports.registerFontBinding(bindingHandle, shapingFontHandle, pointer, length),
          'register font binding',
        ),
      );
      this.#fontBindings.add(bindingHandle);
    } catch (error) {
      this.#rollbackClaim(this.#owners.fontBindings, bindingHandle, claimed);
      if (adopted) this.#ids.release(bindingHandle, 'font-binding');
      throw error;
    }
  }

  /** @internal */
  disposeFontBinding(bindingHandle: FontBindingHandle): void {
    this.#assertActive();
    assertGlyphId(bindingHandle, 'font-binding', 'font binding handle');
    if (!this.#fontBindings.has(bindingHandle)) {
      throw new Error(`font binding ${bindingHandle} is not owned by this Glyph handle state`);
    }
    for (const [stackHandle, fontHandles] of this.#fontStacks) {
      if (fontHandles.includes(bindingHandle)) {
        throw new Error(`font binding ${bindingHandle} is still used by font stack ${stackHandle}`);
      }
    }
    requireStatus(this.#exports.disposeFontBinding(bindingHandle), 'dispose font binding');
    this.#fontBindings.delete(bindingHandle);
    this.#releaseClaim(this.#owners.fontBindings, bindingHandle);
    this.#ids.release(bindingHandle, 'font-binding');
  }

  /** @internal */
  registerFontStack(handle: FontStackHandle, fontHandles: readonly FontBindingHandle[]): void {
    this.#assertActive();
    handle = assertGlyphId(handle, 'font-stack', 'font stack handle');
    if (fontHandles.length === 0) throw new RangeError('font stack must contain at least one font');
    const bytes = new Uint8Array(checkedProduct(fontHandles.length, 4, 'font stack bytes'));
    const view = new DataView(bytes.buffer);
    for (const [index, fontHandle] of fontHandles.entries()) {
      const checkedHandle = assertGlyphId(fontHandle, 'font-binding', 'font binding handle');
      if (!this.#fontBindings.has(checkedHandle)) {
        throw new Error(`font binding ${checkedHandle} is not owned by this Glyph handle state`);
      }
      view.setUint32(index * 4, checkedHandle, true);
    }
    const adopted = this.#ids.retain(handle, 'font-stack', 'font stack handle');
    let claimed = false;
    try {
      claimed = this.#claim(this.#owners.fontStacks, handle, 'font stack');
      this.#withBytes(bytes, (pointer) =>
        requireStatus(this.#exports.registerFontStack(handle, pointer, fontHandles.length), 'register font stack'),
      );
      this.#fontStacks.set(handle, Object.freeze([...fontHandles]));
    } catch (error) {
      this.#rollbackClaim(this.#owners.fontStacks, handle, claimed);
      if (adopted) this.#ids.release(handle, 'font-stack');
      throw error;
    }
  }

  /** @internal */
  disposeFontStack(handle: FontStackHandle): void {
    this.#assertActive();
    assertGlyphId(handle, 'font-stack', 'font stack handle');
    if (!this.#fontStacks.has(handle)) throw new Error(`font stack ${handle} is not owned by this Glyph handle state`);
    requireStatus(this.#exports.disposeFontStack(handle), 'dispose font stack');
    this.#fontStacks.delete(handle);
    this.#releaseClaim(this.#owners.fontStacks, handle);
    this.#ids.release(handle, 'font-stack');
  }

  /** @internal */
  registerCodec(handle: PolicyHandle, bytes: Uint8Array): void {
    this.#assertActive();
    handle = assertGlyphId(handle, 'policy', 'policy handle');
    const adopted = this.#ids.retain(handle, 'policy', 'policy handle');
    let claimed = false;
    try {
      claimed = this.#claim(this.#owners.codecs, handle, 'render policy');
      this.#withBytes(bytes, (pointer, length) =>
        requireStatus(this.#exports.registerPolicy(handle, pointer, length), 'register render policy'),
      );
      this.#codecs.add(handle);
    } catch (error) {
      this.#rollbackClaim(this.#owners.codecs, handle, claimed);
      if (adopted) this.#ids.release(handle, 'policy');
      throw error;
    }
  }

  /** @internal */
  disposeCodec(handle: PolicyHandle): void {
    this.#assertActive();
    handle = assertGlyphId(handle, 'policy', 'policy handle');
    if (!this.#codecs.has(handle)) throw new Error(`render policy ${handle} is not owned by this Glyph handle state`);
    requireStatus(this.#exports.disposePolicy(handle), 'dispose render policy');
    this.#codecs.delete(handle);
    this.#releaseClaim(this.#owners.codecs, handle);
    this.#ids.release(handle, 'policy');
  }

  /** Creates a render planner whose delivery mode is selected by its target. */
  createRootPlanner<Target extends RenderPlanTarget>(options: RenderPlannerOptions<Target>): RenderPlannerFor<Target> {
    const planner = createRenderPlanner(this, options);
    this.#planners.add(planner);
    return planner;
  }

  /** @internal */
  _detachPlanner(planner: { dispose(): void }): void {
    this.#planners.delete(planner);
  }

  /** @internal */
  _createPlanTransport(options: PlanTransportOptions): PlanTransport {
    this.#assertActive();
    const handle = assertGlyphId(options.handle, 'planner', 'planner handle');
    const requestCapacity = uint32(options.requestCapacity, 'request capacity');
    const resultCapacity = uint32(options.resultCapacity, 'result capacity');
    const textCapacity = uint32(options.textCapacity ?? 0, 'text capacity');
    const adopted = this.#ids.retain(handle, 'planner', 'planner handle');
    let claimed = false;
    try {
      claimed = this.#claim(this.#owners.planners, handle, 'render planner');
      requireStatus(
        this.#exports.createPlanner(handle, requestCapacity, resultCapacity, textCapacity),
        'create render planner',
      );
      const transport = new PlanTransport(
        this.#exports,
        handle,
        requestCapacity,
        resultCapacity,
        textCapacity,
        (request) => this.#assertFrameOwnership(handle, request),
        () => this.#assertEngineAvailable?.(),
        () => {
          this.#transports.delete(transport);
          this.#releaseClaim(this.#owners.planners, handle);
          this.#ids.release(handle, 'planner');
        },
      );
      this.#transports.add(transport);
      return transport;
    } catch (error) {
      this.#rollbackClaim(this.#owners.planners, handle, claimed);
      if (adopted) this.#ids.release(handle, 'planner');
      throw error;
    }
  }

  /** @internal */
  _allocatePlannerHandle(): PlannerHandle {
    this.#assertActive();
    const ordinal = this.#nextPlannerOrdinal;
    if (!Number.isSafeInteger(ordinal) || ordinal <= 0 || ordinal > MAX_U32) {
      throw new RangeError('planner handles are exhausted');
    }
    this.#nextPlannerOrdinal = ordinal + 1;
    return this.id('planner', `${this.#identityNamespace}/planner/${ordinal}`);
  }

  /** @internal */
  _enterBorrowedPlan(): () => void {
    this.#assertActive();
    return this.#enterEngineBorrow?.() ?? (() => {});
  }

  /** @internal */
  _assertEngineMutationAllowed(): void {
    this.#assertActive();
  }

  /** Disposes this handle and every policy, binding, planner, and transport it owns. */
  dispose(): void {
    if (this.#disposed) return;
    this.#assertEngineAvailable?.();
    let failure: unknown;
    const attempt = (dispose: () => void): void => {
      try {
        dispose();
      } catch (error) {
        failure ??= error;
      }
    };
    for (const planner of [...this.#planners]) attempt(() => planner.dispose());
    for (const transport of [...this.#transports]) attempt(() => transport.dispose());
    for (const binding of [...this.#opaqueBindings]) attempt(() => this.#forceDisposeOpaqueBinding(binding));
    const retainedStackHandles = new Set([...this.#liveRetainedFontStacks].map((stack) => stack.handle));
    for (const stack of [...this.#liveRetainedFontStacks]) attempt(() => this.#disposeRetainedFontStack(stack));
    for (const handle of [...this.#fontStacks.keys()]) {
      if (!retainedStackHandles.has(handle)) attempt(() => this.disposeFontStack(handle));
    }
    const retainedFontHandles = new Set([...this.#liveRetainedFontBindings].map((binding) => binding.handle));
    for (const binding of [...this.#liveRetainedFontBindings]) attempt(() => this.#disposeRetainedFontBinding(binding));
    for (const handle of [...this.#fontBindings]) {
      if (!retainedFontHandles.has(handle)) attempt(() => this.disposeFontBinding(handle));
    }
    const installedPolicyHandles = new Set([...this.#installedCodecs].map((policy) => policy.handle));
    for (const policy of [...this.#installedCodecs]) attempt(() => this.#disposeInstalledCodec(policy));
    for (const handle of [...this.#codecs]) {
      if (!installedPolicyHandles.has(handle)) attempt(() => this.disposeCodec(handle));
    }
    if (
      this.#transports.size !== 0 ||
      this.#fontStacks.size !== 0 ||
      this.#fontBindings.size !== 0 ||
      this.#codecs.size !== 0 ||
      this.#portablePayloads.size !== 0
    ) {
      failure ??= new Error('Glyph handle state disposal left live registrations or payload leases');
    } else {
      try {
        this.#ids.dispose();
      } catch (error) {
        failure ??= error;
      } finally {
        this.#disposed = true;
        this.#onDispose?.();
      }
    }
    if (failure !== undefined) throw failure;
  }

  #assertFrameOwnership(plannerHandle: PlannerHandle, request: Uint8Array): void {
    const references = frameRegistrationReferences(request);
    if (references.plannerHandle !== plannerHandle) {
      throw new TypeError(`text update belongs to planner ${references.plannerHandle}, not ${plannerHandle}`);
    }
    if (this.#owners.codecs.get(references.policyHandle) !== this) {
      throw new TypeError(`render policy ${references.policyHandle} is not owned by this Glyph handle state`);
    }
    for (const handle of references.fontStackHandles) {
      if (this.#owners.fontStacks.get(handle) !== this) {
        throw new TypeError(`font stack ${handle} is not owned by this Glyph handle state`);
      }
    }
  }

  #disposeRetainedFontBinding(state: RetainedHandleFontBinding): void {
    if (state.disposed) return;
    this.disposeFontBinding(state.handle);
    state.leases = 0;
    state.disposed = true;
    this.#retainedFontBindings.delete(state.identity);
    this.#liveRetainedFontBindings.delete(state);
    this.#releasePortablePayloadOwners(state.payloads);
    state.engineBinding.dispose();
  }

  #retainPortablePayloads(
    raster: AnyRasterFormat,
    compiled: CompiledRasterFont,
  ): ReadonlyMap<number, RetainedPortablePayload> {
    const resourceNames = new Map<string, string>();
    for (const [name, keys] of compiled.declaredResources) {
      for (const key of keys) resourceNames.set(key, name);
    }
    const payloads = new Map<number, RetainedPortablePayload>();
    try {
      for (const [key, payload] of compiled.resources) {
        const resourceName = resourceNames.get(key);
        if (resourceName === undefined) throw new Error(`compiled font retained an unnamed resource "${key}"`);
        const referenceId = this.#wireIdentities.resource(key);
        let retained = this.#portablePayloads.get(referenceId);
        if (retained === undefined) {
          retained = {
            referenceId,
            identity: portableResourceIdentity(payload),
            techniqueId: raster.id,
            resourceName,
            payload,
            group: undefined,
            owners: 0,
            leases: 0,
          };
          this.#portablePayloads.set(referenceId, retained);
        } else if (
          retained.techniqueId !== raster.id ||
          retained.resourceName !== resourceName ||
          !samePortableResource(retained.payload, payload)
        ) {
          throw new TypeError(`portable payload reference ${referenceId} resolves to different content`);
        }
        retained.owners += 1;
        payloads.set(referenceId, retained);
      }
      this.#bindPortablePayloadGroups(raster, compiled, payloads);
      return payloads;
    } catch (error) {
      this.#releasePortablePayloadOwners(payloads);
      throw error;
    }
  }

  #bindPortablePayloadGroups(
    raster: AnyRasterFormat,
    compiled: CompiledRasterFont,
    payloads: ReadonlyMap<number, RetainedPortablePayload>,
  ): void {
    const program = resolveRasterPlanProgram(raster.id);
    if (program === undefined) throw new Error(`portable plan program "${raster.id}" is no longer registered`);
    const selectedName = program.schema.render.resource;
    if (selectedName === undefined) throw new Error(`portable plan program "${raster.id}" has no render resource`);
    const companions: RetainedPortablePayload[] = [];
    for (const [name, keys] of compiled.declaredResources) {
      if (name === selectedName || program.schema.resources[name]?.cardinality === 'many') continue;
      if (keys.length !== 1) throw new Error(`singleton resource "${name}" does not have exactly one payload`);
      const companion = payloads.get(this.#wireIdentities.resource(keys[0]!));
      if (companion === undefined) throw new Error(`compiled font does not own companion resource "${name}"`);
      companions.push(companion);
    }
    for (const key of compiled.declaredResources.get(selectedName) ?? []) {
      const selected = payloads.get(this.#wireIdentities.resource(key));
      if (selected === undefined) throw new Error(`compiled font does not own selected resource "${key}"`);
      const group = Object.freeze([selected, ...companions]);
      if (selected.group !== undefined && !samePortablePayloadGroup(selected.group, group)) {
        throw new TypeError(
          `portable payload reference ${selected.referenceId} resolves to different companion resources`,
        );
      }
      selected.group ??= group;
    }
  }

  #releasePortablePayloadOwners(payloads: ReadonlyMap<number, RetainedPortablePayload>): void {
    for (const payload of payloads.values()) {
      if (payload.owners <= 0) throw new Error('portable payload owner underflow');
      payload.owners -= 1;
      this.#deletePortablePayloadIfUnused(payload);
    }
  }

  #releasePortablePayloadLease(payload: RetainedPortablePayload): void {
    if (payload.leases <= 0) throw new Error('portable payload lease underflow');
    payload.leases -= 1;
    this.#deletePortablePayloadIfUnused(payload);
  }

  #deletePortablePayloadIfUnused(payload: RetainedPortablePayload): void {
    if (payload.owners === 0 && payload.leases === 0 && this.#portablePayloads.get(payload.referenceId) === payload) {
      this.#portablePayloads.delete(payload.referenceId);
    }
  }

  #disposeInstalledCodec(state: InstalledCodecRegistration): void {
    if (state.disposed) return;
    this.disposeCodec(state.handle);
    state.leases = 0;
    state.disposed = true;
    this.#installedCodecs.delete(state);
  }

  #createOpaqueBinding(kind: RetainedOpaqueBinding['kind']): HandleOpaqueBindingImpl {
    this.#assertActive();
    const recycledTransformOrdinal = kind === 'transform' ? this.#freeTransformOrdinals.pop() : undefined;
    const ordinal =
      recycledTransformOrdinal ??
      (kind === 'material'
        ? this.#nextMaterialOrdinal
        : kind === 'resource'
          ? this.#nextResourceOrdinal
          : this.#nextTransformOrdinal);
    const next = recycledTransformOrdinal === undefined ? nextHandleOrdinal(ordinal, `${kind} binding`) : undefined;
    const handle = kind === 'transform' ? ordinal : this.id(kind, `${this.#identityNamespace}/${kind}/${ordinal}`);
    const state: RetainedOpaqueBinding = {
      kind,
      handle,
      binding: undefined as unknown as HandleOpaqueBindingImpl,
      leases: 1,
      disposed: false,
    };
    const binding = new HandleOpaqueBindingImpl(this, state);
    state.binding = binding;
    this.#opaqueBindings.add(state);
    this.#opaqueBindingsByKind[kind].set(handle, state);
    handleOpaqueBindings.set(binding, { handleState: this, state });
    if (kind === 'material') this.#nextMaterialOrdinal = next!;
    else if (kind === 'resource') this.#nextResourceOrdinal = next!;
    else if (next !== undefined) this.#nextTransformOrdinal = next;
    return binding;
  }

  #releaseOpaqueBinding(state: RetainedOpaqueBinding): void {
    if (state.disposed) return;
    if (state.leases <= 0) throw new Error(`handle ${state.kind} binding lease underflow`);
    state.leases -= 1;
    if (state.leases !== 0) return;
    state.disposed = true;
    this.#opaqueBindings.delete(state);
    this.#opaqueBindingsByKind[state.kind].delete(state.handle);
    if (state.kind === 'transform') this.#freeTransformOrdinals.push(state.handle);
  }

  #forceDisposeOpaqueBinding(state: RetainedOpaqueBinding): void {
    if (state.disposed) return;
    state.leases = 0;
    state.disposed = true;
    this.#opaqueBindings.delete(state);
    this.#opaqueBindingsByKind[state.kind].delete(state.handle);
  }

  /** @internal */
  _disposeOpaqueBinding(binding: HandleMaterialBinding | HandleResourceBinding | HandleTransformBinding): void {
    const entry = handleOpaqueBindings.get(binding as object);
    if (entry === undefined || entry.handleState !== this)
      throw new TypeError('opaque binding belongs to another handle');
    this.#releaseOpaqueBinding(entry.state);
  }

  #disposeRetainedFontStack(state: RetainedHandleFontStackBinding): void {
    if (state.disposed) return;
    this.disposeFontStack(state.handle);
    state.leases = 0;
    state.disposed = true;
    this.#retainedFontStacks.delete(state.identity);
    this.#liveRetainedFontStacks.delete(state);
    let failure: unknown;
    for (const binding of [...state.bindings].reverse()) {
      try {
        binding.dispose();
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure !== undefined) throw failure;
  }

  #claim(owners: Map<number, GlyphHandleState>, handle: number, label: string): boolean {
    const owner = owners.get(handle);
    if (owner === this) return false;
    if (owner !== undefined) throw new Error(`${label} ${handle} is already owned by another Glyph handle state`);
    owners.set(handle, this);
    return true;
  }

  #rollbackClaim(owners: Map<number, GlyphHandleState>, handle: number, claimed: boolean): void {
    if (claimed && owners.get(handle) === this) owners.delete(handle);
  }

  #releaseClaim(owners: Map<number, GlyphHandleState>, handle: number): void {
    if (owners.get(handle) !== this) throw new Error(`Glyph handle state lost registration ${handle}`);
    owners.delete(handle);
  }

  #withBytes(bytes: Uint8Array, call: (pointer: number, length: number) => void): void {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      throw new TypeError('text-engine registration bytes must be a nonempty Uint8Array');
    }
    const length = uint32(bytes.byteLength, 'registration byte length');
    const pointer = this.#exports.allocate(length);
    if (pointer === 0) throw engineStatusError('allocate registration bytes', textShaperAbi.status.resultTooLarge);
    try {
      new Uint8Array(this.#exports.memory.buffer, pointer, length).set(bytes);
      call(pointer, length);
    } finally {
      this.#exports.deallocate(pointer, length);
    }
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('Glyph handle state is disposed');
    this.#assertEngineAvailable?.();
  }
}

function samePortablePayloadGroup(
  left: readonly RetainedPortablePayload[],
  right: readonly RetainedPortablePayload[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((resource, index) => right[index] === resource);
}

function samePortableResource(left: PortableResource, right: PortableResource): boolean {
  if (left === right) return true;
  if (left.kind !== right.kind) return false;
  if (left.kind === 'group' && right.kind === 'group') {
    const leftNames = Object.keys(left.members).sort();
    const rightNames = Object.keys(right.members).sort();
    return (
      leftNames.length === rightNames.length &&
      leftNames.every((name, index) => {
        const leftMember = left.members[name];
        const rightMember = right.members[rightNames[index]!];
        return (
          name === rightNames[index] &&
          leftMember !== undefined &&
          rightMember !== undefined &&
          samePortableResource(leftMember, rightMember)
        );
      })
    );
  }
  if (left.kind === 'group' || right.kind === 'group') return false;
  if (!sameBytes(left.bytes, right.bytes)) return false;
  if (left.kind === 'buffer' && right.kind === 'buffer') return left.stride === right.stride;
  if (left.kind === 'texture' && right.kind === 'texture') {
    return left.format === right.format && left.width === right.width && left.height === right.height;
  }
  if (left.kind === 'texture-array' && right.kind === 'texture-array') {
    return (
      left.format === right.format &&
      left.width === right.width &&
      left.height === right.height &&
      left.layers === right.layers
    );
  }
  if (left.kind !== 'geometry' || right.kind !== 'geometry') return false;
  return (
    left.topology === right.topology &&
    JSON.stringify(left.views) === JSON.stringify(right.views) &&
    JSON.stringify(left.accessors) === JSON.stringify(right.accessors) &&
    JSON.stringify(left.attributes) === JSON.stringify(right.attributes) &&
    JSON.stringify(left.indices) === JSON.stringify(right.indices) &&
    JSON.stringify(left.drawRange) === JSON.stringify(right.drawRange)
  );
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

class CodecRegistrationImpl implements CodecRegistration {
  declare readonly [codecRegistrationBrand]: true;
  readonly #handleState: GlyphHandleState;
  readonly #state: InstalledCodecRegistration;
  #disposed = false;

  constructor(handleState: GlyphHandleState, state: InstalledCodecRegistration) {
    this.#handleState = handleState;
    this.#state = state;
  }

  get disposed(): boolean {
    return this.#disposed || this.#state.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.#handleState._disposeInstalledCodec(this.#state);
    this.#disposed = true;
  }
}

class HandleFontBindingImpl {
  readonly #handleState: GlyphHandleState;
  readonly #state: RetainedHandleFontBinding;
  #disposed = false;

  constructor(handleState: GlyphHandleState, state: RetainedHandleFontBinding) {
    this.#handleState = handleState;
    this.#state = state;
  }

  get raster(): AnyRasterFormat {
    return this.#state.raster;
  }

  get disposed(): boolean {
    return this.#disposed || this.#state.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.#handleState._disposeRetainedFontBinding(this.#state);
    this.#disposed = true;
  }

  /** @internal */
  _state(): RetainedHandleFontBinding {
    if (this.disposed) throw new Error('handle font binding has been disposed');
    return this.#state;
  }
}

class HandleFontStackBindingImpl implements HandleFontStackBinding {
  declare readonly [handleFontStackBindingBrand]: true;
  readonly #handleState: GlyphHandleState;
  readonly #state: RetainedHandleFontStackBinding;
  #disposed = false;

  constructor(handleState: GlyphHandleState, state: RetainedHandleFontStackBinding) {
    this.#handleState = handleState;
    this.#state = state;
  }

  get disposed(): boolean {
    return this.#disposed || this.#state.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.#handleState._disposeRetainedFontStack(this.#state);
    this.#disposed = true;
  }
}

class HandleOpaqueBindingImpl implements HandleMaterialBinding, HandleResourceBinding, HandleTransformBinding {
  declare readonly [handleMaterialBindingBrand]: true;
  declare readonly [handleResourceBindingBrand]: true;
  declare readonly [handleTransformBindingBrand]: true;
  readonly #handleState: GlyphHandleState;
  readonly #state: RetainedOpaqueBinding;
  #disposed = false;

  constructor(handleState: GlyphHandleState, state: RetainedOpaqueBinding) {
    this.#handleState = handleState;
    this.#state = state;
  }

  get disposed(): boolean {
    return this.#disposed || this.#state.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.#handleState._disposeOpaqueBinding(this);
    this.#disposed = true;
  }
}

function snapshotPolicyDescriptor(descriptor: PolicyDescriptor): PolicyDescriptor {
  try {
    return structuredClone(descriptor) as PolicyDescriptor;
  } catch (cause) {
    throw new TypeError('policy descriptor must contain cloneable data', { cause });
  }
}

/** @internal Owns one planner's direct Wasm request/result exchange. */
export class PlanTransport {
  readonly #exports;
  readonly #handle: PlannerHandle;
  readonly #onDispose: () => void;
  readonly #assertRequestOwnership: (request: Uint8Array) => void;
  readonly #assertEngineAvailable: () => void;
  #requestCapacity: number;
  #resultCapacity: number;
  #textCapacity: number;
  #disposed = false;
  /** Bumped before every call that can answer with new bytes; borrows from older epochs are dead. */
  #epoch = 0;
  /** The epoch each issued borrow was published under, keyed by publication identity. */
  readonly #issued = new WeakMap<PlanPublication, number>();
  /** Owned copies made by this transport; unlike borrows, they never expire. */
  readonly #owned = new WeakSet<PlanPublication>();
  #latestGeneration = 0;

  /** @internal Plan transports are created by the render-planner implementation. */
  constructor(
    exports: ReturnType<typeof runtimeShaperEngineExports>,
    handle: PlannerHandle,
    requestCapacity: number,
    resultCapacity: number,
    textCapacity: number,
    assertRequestOwnership: (request: Uint8Array) => void,
    assertEngineAvailable: () => void,
    onDispose: () => void,
  ) {
    this.#exports = exports;
    this.#handle = handle;
    this.#requestCapacity = requestCapacity;
    this.#resultCapacity = resultCapacity;
    this.#textCapacity = textCapacity;
    this.#assertRequestOwnership = assertRequestOwnership;
    this.#assertEngineAvailable = assertEngineAvailable;
    this.#onDispose = onDispose;
  }

  get handle(): PlannerHandle {
    return this.#handle;
  }

  /**
   * Whether this transport's publication has expired. An owned copy always answers false.
   * A borrow expires after another answer, Wasm memory growth, or transport disposal.
   */
  isExpired(publication: PlanPublication): boolean {
    if (this.#owned.has(publication)) return false;
    if (this.#issued.get(publication) === undefined) {
      throw new TypeError('publication was not issued by this plan transport');
    }
    return (
      this.#disposed ||
      this.#issued.get(publication) !== this.#epoch ||
      publication.memoryBuffer !== this.#exports.memory.buffer
    );
  }

  /**
   * Takes ownership with one contiguous copy of the whole encoded result — header,
   * every plan table, and every patch payload. Never expires; safe to hold across
   * asynchronous work and later engine calls in this JavaScript realm. Transfer its
   * self-owned bytes to a worker as untrusted boundary data; runtime provenance is realm-local.
   */
  copyPublication(publication: PlanPublication): OwnedPlanPublication {
    this.#assertPublicationCurrent(publication);
    const bytes = publication.bytes.slice();
    const owned = markOwnedPlanPublication(
      Object.freeze({
        ...publication,
        bytes,
        memoryBuffer: bytes.buffer,
        memoryGrew: false,
      }),
    );
    this.#owned.add(owned);
    return owned;
  }

  #assertPublicationCurrent(publication: PlanPublication): void {
    if (this.isExpired(publication)) {
      throw new PlanPublicationExpiredError(publication.publicationGeneration, this.#latestGeneration);
    }
  }

  #invalidate(): void {
    this.#epoch += 1;
  }

  reserve(requestCapacity: number, resultCapacity: number, textCapacity: number = this.#textCapacity): void {
    this.#assertActive();
    requestCapacity = uint32(requestCapacity, 'request capacity');
    resultCapacity = uint32(resultCapacity, 'result capacity');
    textCapacity = uint32(textCapacity, 'text capacity');
    this.#invalidate();
    requireStatus(
      this.#exports.reservePlanner(this.#handle, requestCapacity, resultCapacity, textCapacity),
      'reserve render planner',
    );
    this.#requestCapacity = Math.max(this.#requestCapacity, requestCapacity);
    this.#resultCapacity = Math.max(this.#resultCapacity, resultCapacity);
    this.#textCapacity = Math.max(this.#textCapacity, textCapacity);
  }

  /** @internal Reserve one paragraph's retained text scratch without changing transport capacities. */
  _reserveText(textCapacity: number): void {
    this.reserve(this.#requestCapacity, this.#resultCapacity, textCapacity);
  }

  update(request: Uint8Array): PlanPublication {
    this.#assertActive();
    if (!(request instanceof Uint8Array) || request.byteLength === 0) {
      throw new TypeError('text update request must be a nonempty Uint8Array');
    }
    this.#assertRequestOwnership(request);
    this.#invalidate();
    const requestLength = uint32(request.byteLength, 'text update byte length');
    const initialMemoryBuffer = this.#exports.memory.buffer;
    if (requestLength > this.#requestCapacity || requestLength > this.#exports.requestCapacity(this.#handle)) {
      this.reserve(requestLength, this.#resultCapacity);
    }
    let retriedResultGrowth = false;
    for (;;) {
      const requestPointer = this.#exports.requestPointer(this.#handle);
      if (requestPointer === 0)
        throw engineStatusError('resolve text request arena', textShaperAbi.status.plannerMissing);
      const pinnedMemoryBuffer = this.#exports.memory.buffer;
      new Uint8Array(pinnedMemoryBuffer, requestPointer, requestLength).set(request);
      const resultPointer = this.#exports.textUpdate(this.#handle, requestPointer, requestLength);
      const memoryBuffer = this.#exports.memory.buffer;
      if (resultPointer === 0) throw engineStatusError('publish text update', textShaperAbi.status.resultTooLarge);
      const layout = textShaperAbi.layouts.engineResult;
      if (resultPointer + layout.size > memoryBuffer.byteLength) {
        throw new RangeError('text engine returned an out-of-bounds result header');
      }
      const header = new DataView(memoryBuffer, resultPointer, layout.size);
      const status = header.getUint32(layout.status, true);
      const requiredRequestCapacity = header.getUint32(layout.requiredRequestCapacity, true);
      const requiredResultCapacity = header.getUint32(layout.requiredResultCapacity, true);
      if (
        status === textShaperAbi.status.resultTooLarge &&
        !retriedResultGrowth &&
        requiredResultCapacity > this.#resultCapacity
      ) {
        retriedResultGrowth = true;
        this.reserve(Math.max(requestLength, requiredRequestCapacity), requiredResultCapacity);
        continue;
      }
      if (status !== textShaperAbi.status.ok) {
        throw engineStatusError(
          'publish text update',
          status,
          requiredRequestCapacity,
          requiredResultCapacity,
          headerFault(header),
        );
      }
      return this.#decodeResult(header, resultPointer, memoryBuffer, initialMemoryBuffer);
    }
  }

  /**
   * Answers one paragraph-scoped synchronous measurement without publishing. The
   * result rides the inactive output slot under a handle-state lease: its bytes stay readable
   * only until the next call into the same Wasm module. Engine revisions, the
   * publication generation, and the renderer fence are untouched, so the following
   * ordinary frame proceeds from pre-measure state.
   */
  measureParagraph(request: Uint8Array, paragraphId: ParagraphId): PlanPublication {
    this.#assertActive();
    if (!(request instanceof Uint8Array) || request.byteLength === 0) {
      throw new TypeError('paragraph measure request must be a nonempty Uint8Array');
    }
    this.#assertRequestOwnership(request);
    assertGlyphId(paragraphId, 'paragraph', 'paragraph id');
    this.#invalidate();
    const requestLength = uint32(request.byteLength, 'paragraph measure byte length');
    const initialMemoryBuffer = this.#exports.memory.buffer;
    if (requestLength > this.#requestCapacity || requestLength > this.#exports.requestCapacity(this.#handle)) {
      this.reserve(requestLength, this.#resultCapacity);
    }
    let retriedResultGrowth = false;
    for (;;) {
      const requestPointer = this.#exports.requestPointer(this.#handle);
      if (requestPointer === 0)
        throw engineStatusError('resolve text request arena', textShaperAbi.status.plannerMissing);
      new Uint8Array(this.#exports.memory.buffer, requestPointer, requestLength).set(request);
      const resultPointer = this.#exports.measureParagraph(this.#handle, requestPointer, requestLength, paragraphId);
      const memoryBuffer = this.#exports.memory.buffer;
      if (resultPointer === 0) throw engineStatusError('measure paragraph', textShaperAbi.status.resultTooLarge);
      const layout = textShaperAbi.layouts.engineResult;
      if (resultPointer + layout.size > memoryBuffer.byteLength) {
        throw new RangeError('text engine returned an out-of-bounds result header');
      }
      const header = new DataView(memoryBuffer, resultPointer, layout.size);
      const status = header.getUint32(layout.status, true);
      const requiredResultCapacity = header.getUint32(layout.requiredResultCapacity, true);
      if (
        status === textShaperAbi.status.resultTooLarge &&
        !retriedResultGrowth &&
        requiredResultCapacity > this.#resultCapacity
      ) {
        retriedResultGrowth = true;
        this.reserve(requestLength, requiredResultCapacity);
        continue;
      }
      if (status !== textShaperAbi.status.ok) {
        throw engineStatusError(
          'measure paragraph',
          status,
          header.getUint32(layout.requiredRequestCapacity, true),
          requiredResultCapacity,
          headerFault(header),
        );
      }
      return this.#decodeResult(header, resultPointer, memoryBuffer, initialMemoryBuffer);
    }
  }

  /** @internal Copies selected committed glyph records into a complete query checkpoint. */
  copyGlyphs(
    paragraphId: ParagraphId,
    stableIds: ArrayLike<number>,
    policyHandle: PolicyHandle,
    capabilitySet: number,
    maxOutputBytes: number,
  ): PlanPublication {
    this.#assertActive();
    assertGlyphId(paragraphId, 'paragraph', 'paragraph id');
    if (stableIds === null || stableIds === undefined || stableIds.length === 0) {
      throw new TypeError('glyph copy needs at least one stable glyph id');
    }
    const byteLength = checkedProduct(stableIds.length, Uint32Array.BYTES_PER_ELEMENT, 'glyph copy stable ids');
    const encoded = new Uint8Array(byteLength);
    const view = new DataView(encoded.buffer);
    const seen = new Set<number>();
    for (let index = 0; index < stableIds.length; index += 1) {
      const stableId = stableIds[index];
      if (stableId === undefined) throw new RangeError(`glyph stable id ${index} is missing`);
      const validated = uint32Handle(stableId, `glyph stable id ${index}`);
      if (seen.has(validated)) throw new RangeError(`glyph stable id ${index} duplicates ${validated}`);
      seen.add(validated);
      view.setUint32(index * Uint32Array.BYTES_PER_ELEMENT, validated, true);
    }
    this.#invalidate();
    const initialMemoryBuffer = this.#exports.memory.buffer;
    const pointer = this.#exports.allocate(byteLength);
    if (pointer === 0) throw engineStatusError('allocate glyph copy ids', textShaperAbi.status.resultTooLarge);
    try {
      new Uint8Array(this.#exports.memory.buffer, pointer, byteLength).set(encoded);
      const resultPointer = this.#exports.copyGlyphs(
        this.#handle,
        paragraphId,
        policyHandle,
        uint32(capabilitySet, 'glyph copy capability set'),
        uint32(maxOutputBytes, 'glyph copy max output bytes'),
        pointer,
        stableIds.length,
      );
      return this.#decodeStatusPointer(resultPointer, initialMemoryBuffer, 'copy glyphs');
    } finally {
      this.#exports.deallocate(pointer, byteLength);
    }
  }

  /** @internal Copies one committed paragraph's decorations into a complete query checkpoint. */
  copyDecorations(
    paragraphId: ParagraphId,
    policyHandle: PolicyHandle,
    capabilitySet: number,
    maxOutputBytes: number,
  ): PlanPublication {
    this.#assertActive();
    assertGlyphId(paragraphId, 'paragraph', 'paragraph id');
    this.#invalidate();
    const initialMemoryBuffer = this.#exports.memory.buffer;
    const resultPointer = this.#exports.copyDecorations(
      this.#handle,
      policyHandle,
      uint32(capabilitySet, 'decoration copy capability set'),
      paragraphId,
      uint32(maxOutputBytes, 'decoration copy max output bytes'),
    );
    return this.#decodeStatusPointer(resultPointer, initialMemoryBuffer, 'copy decorations');
  }

  #decodeStatusPointer(resultPointer: number, initialMemoryBuffer: ArrayBuffer, operation: string): PlanPublication {
    if (resultPointer === 0) throw engineStatusError(operation, textShaperAbi.status.resultTooLarge);
    const memoryBuffer = this.#exports.memory.buffer;
    const layout = textShaperAbi.layouts.engineResult;
    if (resultPointer + layout.size > memoryBuffer.byteLength) {
      throw new RangeError(`${operation} returned an out-of-bounds result header`);
    }
    const header = new DataView(memoryBuffer, resultPointer, layout.size);
    const status = header.getUint32(layout.status, true);
    if (status !== textShaperAbi.status.ok) {
      throw engineStatusError(
        operation,
        status,
        header.getUint32(layout.requiredRequestCapacity, true),
        header.getUint32(layout.requiredResultCapacity, true),
        headerFault(header),
      );
    }
    return this.#decodeResult(header, resultPointer, memoryBuffer, initialMemoryBuffer);
  }

  #decodeResult(
    header: DataView,
    resultPointer: number,
    memoryBuffer: ArrayBuffer,
    initialMemoryBuffer: ArrayBuffer,
  ): PlanPublication {
    const layout = textShaperAbi.layouts.engineResult;
    const byteLength = header.getUint32(layout.byteLength, true);
    if (byteLength < layout.size || resultPointer + byteLength > memoryBuffer.byteLength) {
      throw new RangeError('text engine returned an out-of-bounds publication');
    }
    this.#requestCapacity = header.getUint32(layout.requestCapacity, true);
    this.#resultCapacity = header.getUint32(layout.resultCapacity, true);
    const publication: PlanPublication = {
      bytes: new Uint8Array(memoryBuffer, resultPointer, byteLength),
      memoryBuffer,
      memoryGrew: memoryBuffer !== initialMemoryBuffer,
      engineRevision: header.getUint32(layout.engineRevision, true),
      planRevision: header.getUint32(layout.planRevision, true),
      requiredBaseRevision: header.getUint32(layout.requiredBaseRevision, true),
      publicationGeneration: header.getUint32(layout.publicationGeneration, true),
      outputSlot: header.getUint32(layout.outputSlot, true),
      flags: header.getUint32(layout.flags, true),
      policyHandle: uint32(header.getUint32(layout.policyHandle, true), 'result policy handle') as PolicyHandle | 0,
      capabilitySet: header.getUint32(layout.capabilitySet, true),
      semanticViewCount: header.getUint32(layout.semanticViewCount, true),
      primitiveCount: header.getUint32(layout.primitiveCount, true),
      patchCount: header.getUint32(layout.patchCount, true),
      drawCount: header.getUint32(layout.drawCount, true),
    };
    this.#issued.set(publication, this.#epoch);
    this.#latestGeneration = Math.max(this.#latestGeneration, publication.publicationGeneration);
    return publication;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#assertEngineAvailable();
    requireStatus(this.#exports.disposePlanner(this.#handle), 'dispose render planner');
    this.#invalidate();
    this.#disposed = true;
    this.#onDispose();
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('plan transport is disposed');
    this.#assertEngineAvailable();
  }
}

interface FrameRegistrationReferences {
  readonly plannerHandle: number;
  readonly policyHandle: number;
  readonly fontStackHandles: ReadonlySet<number>;
}

function frameRegistrationReferences(bytes: Uint8Array): FrameRegistrationReferences {
  const request = textShaperAbi.layouts.engineUpdateRequest;
  if (bytes.byteLength < request.size) throw new RangeError('text update request is smaller than its header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(request.abiVersion, true) !== textShaperAbi.version) {
    throw new TypeError('text update request ABI version is unsupported');
  }
  if (view.getUint32(request.byteLength, true) !== bytes.byteLength) {
    throw new RangeError('text update request byte length contradicts its buffer');
  }
  const style = textShaperAbi.layouts.engineStyleMutation;
  const count = view.getUint32(request.styleMutationCount, true);
  const offset = view.getUint32(request.styleMutationsOffset, true);
  const end = checkedTableEnd(offset, count, style.size, bytes.byteLength, 'style mutation table');
  if (count !== 0 && (offset < request.size || offset % style.alignment !== 0 || end <= offset)) {
    throw new RangeError('text update style mutation table is invalid');
  }
  const fontStackHandles = new Set<number>();
  for (let index = 0; index < count; index += 1) {
    const record = offset + index * style.size;
    if (view.getUint8(record + style.opcode) !== textShaperAbi.engine.styleMutationOpcodes.upsert) continue;
    const fields = view.getUint32(record + style.fieldMask, true);
    if (fields & textShaperAbi.engine.styleFields.fontStack) {
      fontStackHandles.add(uint32Handle(view.getUint32(record + style.fontStackHandle, true), 'style font stack'));
    }
  }
  return {
    plannerHandle: uint32Handle(view.getUint32(request.plannerId, true), 'frame planner handle'),
    policyHandle: uint32Handle(view.getUint32(request.policyHandle, true), 'frame policy handle'),
    fontStackHandles,
  };
}

function checkedTableEnd(offset: number, count: number, stride: number, capacity: number, label: string): number {
  if (count === 0) {
    if (offset !== 0) throw new RangeError(`${label} offset must be zero when empty`);
    return 0;
  }
  const byteLength = checkedProduct(count, stride, `${label} bytes`);
  const end = offset + byteLength;
  if (!Number.isSafeInteger(end) || end > capacity) throw new RangeError(`${label} exceeds the request`);
  return end;
}

function requireStatus(status: number, operation: string): void {
  if (status !== textShaperAbi.status.ok) throw engineStatusError(operation, status);
}

function uint32(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_U32) throw new RangeError(`${label} must be a u32`);
  return value;
}

function uint32Handle<const Value extends number>(value: Value, label: string): Value {
  const validated = uint32(value, label);
  if (validated === 0) throw new RangeError(`${label} must be nonzero`);
  return validated as Value;
}

function checkedProduct(left: number, right: number, label: string): number {
  const value = left * right;
  if (!Number.isSafeInteger(value) || value > MAX_U32) throw new RangeError(`${label} exceeds u32`);
  return value;
}

function nextHandleOrdinal(current: number, label: string): number {
  if (!Number.isSafeInteger(current) || current <= 0 || current > MAX_U32) {
    throw new RangeError(`${label} identities are exhausted`);
  }
  return current + 1;
}
