import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type { Font } from '../font.js';
import type { FontHandle } from '../identity.js';
import { immutableFontStackFonts, type FontStack } from '../loaded-font.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import { runtimeShaperEngineExports, type RuntimeShaper } from '../shaper.js';
import { compileRasterFont, resolveRasterPlanProgram, type CompiledRasterFont } from './raster-plan-program.js';
import { portableResourceIdentity, type PortableResource } from './portable-resources.js';
import {
  createRetainedTextEngineSession,
  type SessionFor,
  type TextEngineSessionOptions as RetainedTextEngineSessionOptions,
  type TextPlanTarget,
} from './retained-session.js';
import {
  markOwnedTextEnginePublication,
  TextEnginePublicationExpiredError,
  type OwnedTextEnginePublication,
} from './retention.js';
import {
  assertGlyphId,
  compileRenderPolicy,
  GlyphIdScope,
  RenderWireIdentityRegistry,
  type FontBindingHandle,
  type FontStackHandle,
  type GlyphId,
  type GlyphIdKind,
  type ParagraphId,
  type PolicyDescriptor,
  type PolicyHandle,
  type StyleId,
  type TextEngineSessionHandle,
} from './render-policy.js';

const MAX_U32 = 0xffff_ffff;

/** @internal Raw wire-session construction retained only while first-party integrations migrate. */
export interface RawTextEngineSessionOptions {
  readonly handle: TextEngineSessionHandle;
  readonly requestCapacity: number;
  readonly resultCapacity: number;
  readonly textCapacity?: number;
}

/** @internal Compatibility name removed with the raw JavaScript session. */
export type TextEngineSessionOptions = RawTextEngineSessionOptions;

/** Names the renderer integration that owns a host. */
export interface TextEngineHostOptions {
  /** Stable diagnostic namespace; never a wire ID or lookup key. */
  readonly integration: string;
}

/** A counted host-local render-policy installation. */
export interface HostPolicy {
  readonly [hostPolicyBrand]: true;
  readonly disposed: boolean;
  dispose(): void;
}

/** Builds one policy descriptor using the host's collision-checked wire identities. */
export type HostPolicyFactory = (identities: RenderWireIdentityRegistry) => PolicyDescriptor;

/** A counted host-local binding of one immutable font. */
export interface HostFontBinding<Technique extends AnyRasterTechnique = AnyRasterTechnique> {
  readonly [hostFontBindingBrand]: true;
  readonly technique: Technique;
  readonly disposed: boolean;
  dispose(): void;
}

/** A counted host-local ordered font-stack binding. */
export interface HostFontStackBinding {
  readonly [hostFontStackBindingBrand]: true;
  readonly disposed: boolean;
  dispose(): void;
}

/** A host-local renderer material identity. */
export interface HostMaterialBinding {
  readonly [hostMaterialBindingBrand]: true;
  readonly disposed: boolean;
  dispose(): void;
}

/** A host-local renderer resource identity. */
export interface HostResourceBinding {
  readonly [hostResourceBindingBrand]: true;
  readonly disposed: boolean;
  dispose(): void;
}

/** A host-local renderer transform identity. */
export interface HostTransformBinding {
  readonly [hostTransformBindingBrand]: true;
  readonly disposed: boolean;
  dispose(): void;
}

declare const hostPolicyBrand: unique symbol;
declare const hostFontBindingBrand: unique symbol;
declare const hostFontStackBindingBrand: unique symbol;
declare const hostMaterialBindingBrand: unique symbol;
declare const hostResourceBindingBrand: unique symbol;
declare const hostTransformBindingBrand: unique symbol;

/** @internal Runtime-owned shaping registration supplied only by TextRuntime. */
export interface HostRuntimeFontBinding<Technique extends AnyRasterTechnique = AnyRasterTechnique> {
  readonly technique: Technique;
  readonly handle: FontHandle;
  readonly identity: object;
  readonly disposed: boolean;
  dispose(): void;
}

/** @internal Runtime callback installed by TextRuntime when it constructs a host. */
export type HostRuntimeFontBinder = <Technique extends AnyRasterTechnique>(
  font: Font<Technique>,
) => HostRuntimeFontBinding<Technique>;

/**
 * One borrowed A/B render-plan publication. Its bytes point into Wasm memory and expire when
 * this session answers any later call; see `core/retention.ts` for the protocol.
 * `copyPublication` validates and owns bytes that must survive the borrow.
 */
export interface TextEnginePublication {
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
 * Both are the identifiers the REQUEST used, so a host maps them straight back to what it authored.
 * Zero means the status names none: an engine-internal invariant, a capacity watermark, or a
 * session-level conflict attributes nothing.
 */
/** Request identities used by an integration to map a rejected frame back to authored state. */
export interface TextEngineFault {
  readonly paragraphId: ParagraphId | 0;
  readonly styleId: StyleId | 0;
}

const NO_FAULT: TextEngineFault = Object.freeze({ paragraphId: 0, styleId: 0 });

interface EngineRegistrationOwners {
  readonly policies: Map<number, TextEngineHost>;
  readonly fontBindings: Map<number, TextEngineHost>;
  readonly fontStacks: Map<number, TextEngineHost>;
  readonly sessions: Map<number, TextEngineHost>;
}

const registrationOwners = new WeakMap<object, EngineRegistrationOwners>();

function ownersFor(exports: object): EngineRegistrationOwners {
  let owners = registrationOwners.get(exports);
  if (owners === undefined) {
    owners = {
      policies: new Map(),
      fontBindings: new Map(),
      fontStacks: new Map(),
      sessions: new Map(),
    };
    registrationOwners.set(exports, owners);
  }
  return owners;
}

/** Stable semantic classification of a text-engine status. */
export type TextEngineStatusCode =
  | 'invalid-handle'
  | 'invalid-font'
  | 'invalid-extents'
  | 'handle-conflict'
  | 'font-missing'
  | 'invalid-request'
  | 'result-too-large'
  | 'policy-conflict'
  | 'policy-missing'
  | 'session-conflict'
  | 'session-missing'
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

const TEXT_ENGINE_STATUS_CODES: ReadonlyMap<number, TextEngineStatusCode> = new Map<number, TextEngineStatusCode>([
  [textShaperAbi.status.invalidHandle, 'invalid-handle'],
  [textShaperAbi.status.invalidFont, 'invalid-font'],
  [textShaperAbi.status.invalidExtents, 'invalid-extents'],
  [textShaperAbi.status.handleConflict, 'handle-conflict'],
  [textShaperAbi.status.fontMissing, 'font-missing'],
  [textShaperAbi.status.invalidRequest, 'invalid-request'],
  [textShaperAbi.status.resultTooLarge, 'result-too-large'],
  [textShaperAbi.status.policyConflict, 'policy-conflict'],
  [textShaperAbi.status.policyMissing, 'policy-missing'],
  [textShaperAbi.status.sessionConflict, 'session-conflict'],
  [textShaperAbi.status.sessionMissing, 'session-missing'],
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
export class TextEngineStatusError extends Error {
  readonly code: TextEngineStatusCode;
  readonly status: number;

  constructor(operation: string, status: number) {
    super(`${operation} failed with text-engine status ${status}`);
    this.name = 'TextEngineStatusError';
    this.code = textEngineStatusCode(status);
    this.status = status;
  }
}

function textEngineStatusCode(status: number): TextEngineStatusCode {
  return TEXT_ENGINE_STATUS_CODES.get(status) ?? 'unknown';
}

/** Stable diagnostic details associated with a {@link TextEngineStatusError}. */
export interface TextEngineStatusDetails {
  readonly requiredRequestCapacity: number;
  readonly requiredResultCapacity: number;
  readonly fault: TextEngineFault;
}

const textEngineStatusDetails = new WeakMap<TextEngineStatusError, TextEngineStatusDetails>();

/** Reads semantic diagnostic details retained on an engine status error. */
export function textEngineStatusErrorDetails(error: TextEngineStatusError): TextEngineStatusDetails {
  return (
    textEngineStatusDetails.get(error) ?? {
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
  fault: TextEngineFault = NO_FAULT,
): TextEngineStatusError {
  const error = new TextEngineStatusError(operation, status);
  error.message +=
    (fault.paragraphId === 0 ? '' : ` (paragraph ${fault.paragraphId}`) +
    (fault.paragraphId === 0 ? '' : fault.styleId === 0 ? ')' : `, style ${fault.styleId})`) +
    (requiredRequestCapacity === 0 && requiredResultCapacity === 0
      ? ''
      : ` (required request=${requiredRequestCapacity}, result=${requiredResultCapacity})`);
  textEngineStatusDetails.set(error, { requiredRequestCapacity, requiredResultCapacity, fault });
  return error;
}

function headerFault(header: DataView): TextEngineFault {
  const layout = textShaperAbi.layouts.engineResult;
  const paragraphId = header.getUint32(layout.faultParagraphId, true);
  const styleId = header.getUint32(layout.faultStyleId, true);
  return paragraphId === 0 && styleId === 0
    ? NO_FAULT
    : Object.freeze({ paragraphId: paragraphId as ParagraphId | 0, styleId: styleId as StyleId | 0 });
}

interface InstalledHostPolicy {
  readonly handle: PolicyHandle;
  readonly descriptor: PolicyDescriptor;
  readonly techniqueIds: ReadonlySet<number>;
  leases: number;
  disposed: boolean;
}

interface RetainedHostFontBinding {
  readonly identity: object;
  readonly technique: AnyRasterTechnique;
  readonly handle: FontBindingHandle;
  readonly runtime: HostRuntimeFontBinding;
  readonly payloads: ReadonlyMap<number, RetainedHostPortablePayload>;
  leases: number;
  disposed: boolean;
}

interface RetainedHostPortablePayload {
  readonly referenceId: number;
  readonly identity: object;
  readonly techniqueId: string;
  readonly resourceName: string;
  readonly payload: PortableResource;
  group: readonly RetainedHostPortablePayload[] | undefined;
  owners: number;
  leases: number;
}

interface RetainedHostFontStackBinding {
  readonly identity: object;
  readonly handle: FontStackHandle;
  readonly bindings: readonly HostFontBindingImpl[];
  leases: number;
  disposed: boolean;
}

interface RetainedHostOpaqueBinding {
  readonly kind: 'material' | 'resource' | 'transform';
  readonly handle: number;
  binding: HostMaterialBinding | HostResourceBinding | HostTransformBinding;
  leases: number;
  disposed: boolean;
}

/** Counted lease over one host-local renderer binding. */
export interface HostOpaqueBindingLease {
  readonly handle: number;
  readonly binding: HostMaterialBinding | HostResourceBinding | HostTransformBinding;
  dispose(): void;
}

const hostPolicies = new WeakMap<object, Readonly<{ host: TextEngineHost; state: InstalledHostPolicy }>>();
const hostFontStacks = new WeakMap<object, Readonly<{ host: TextEngineHost; state: RetainedHostFontStackBinding }>>();
const hostOpaqueBindings = new WeakMap<object, Readonly<{ host: TextEngineHost; state: RetainedHostOpaqueBinding }>>();

/** Lifecycle owner for retained policies, font bindings, font stacks, and sessions in one RuntimeShaper. */
export class TextEngineHost {
  readonly integration: string;
  readonly #identityNamespace: string;
  readonly #wireIdentities = new RenderWireIdentityRegistry();
  readonly #ids = new GlyphIdScope();
  readonly #exports;
  readonly #owners: EngineRegistrationOwners;
  readonly #retainedSessions = new Set<{ dispose(): void }>();
  readonly #sessions = new Set<TextEngineSession>();
  readonly #policies = new Set<PolicyHandle>();
  readonly #fontStacks = new Map<FontStackHandle, readonly FontBindingHandle[]>();
  readonly #fontBindings = new Set<FontBindingHandle>();
  readonly #installedPolicies = new Set<InstalledHostPolicy>();
  readonly #retainedFontBindings = new WeakMap<object, RetainedHostFontBinding>();
  readonly #liveRetainedFontBindings = new Set<RetainedHostFontBinding>();
  readonly #retainedFontStacks = new WeakMap<object, RetainedHostFontStackBinding>();
  readonly #liveRetainedFontStacks = new Set<RetainedHostFontStackBinding>();
  readonly #portablePayloads = new Map<number, RetainedHostPortablePayload>();
  readonly #opaqueBindings = new Set<RetainedHostOpaqueBinding>();
  readonly #opaqueBindingsByKind = {
    material: new Map<number, RetainedHostOpaqueBinding>(),
    resource: new Map<number, RetainedHostOpaqueBinding>(),
    transform: new Map<number, RetainedHostOpaqueBinding>(),
  };
  readonly #onDispose: (() => void) | undefined;
  readonly #bindRuntimeFont: HostRuntimeFontBinder | undefined;
  readonly #assertRuntimeAvailable: (() => void) | undefined;
  readonly #enterRuntimeBorrow: (() => () => void) | undefined;
  #nextPolicyOrdinal = 1;
  #nextFontBindingOrdinal = 1;
  #nextFontStackOrdinal = 1;
  #nextMaterialOrdinal = 1;
  #nextResourceOrdinal = 1;
  #nextTransformOrdinal = 1;
  readonly #freeTransformOrdinals: number[] = [];
  #nextRetainedSessionOrdinal = 1;
  #disposed = false;

  /** @internal Hosts are owned and normally created by TextRuntime. */
  constructor(
    shaper: RuntimeShaper,
    options: TextEngineHostOptions = { integration: 'internal' },
    onDispose?: () => void,
    bindRuntimeFont?: HostRuntimeFontBinder,
    assertRuntimeAvailable?: () => void,
    enterRuntimeBorrow?: () => () => void,
    identityNamespace?: string,
  ) {
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      throw new TypeError('text engine host options need an object');
    }
    if (typeof options.integration !== 'string' || options.integration.length === 0) {
      throw new TypeError('text engine host integration must be a nonempty string');
    }
    this.integration = options.integration;
    this.#identityNamespace = identityNamespace ?? options.integration;
    this.#exports = runtimeShaperEngineExports(shaper);
    this.#owners = ownersFor(this.#exports);
    this.#onDispose = onDispose;
    this.#bindRuntimeFont = bindRuntimeFont;
    this.#assertRuntimeAvailable = assertRuntimeAvailable;
    this.#enterRuntimeBorrow = enterRuntimeBorrow;
  }

  /** @internal Derive one branded ID retained until its registration or this host is disposed. */
  readonly id = <const Kind extends GlyphIdKind>(kind: Kind, name: string): GlyphId<Kind> => {
    this.#assertActive();
    return this.#ids.id(kind, name);
  };

  /** Installs one renderer policy for this host and returns its counted lease. */
  installPolicy(factory: HostPolicyFactory): HostPolicy {
    this.#assertActive();
    if (typeof factory !== 'function') throw new TypeError('text engine policy must be a factory');
    const snapshot = snapshotPolicyDescriptor(factory(this.#wireIdentities));
    const bytes = compileRenderPolicy(snapshot);
    const ordinal = this.#nextPolicyOrdinal;
    const handle = this.id('policy', `${this.#identityNamespace}/policy/${ordinal}`);
    this.registerPolicy(handle, bytes);
    this.#nextPolicyOrdinal = ordinal + 1;
    const state: InstalledHostPolicy = {
      handle,
      descriptor: snapshot,
      techniqueIds: new Set(snapshot.programs.map((program) => program.techniqueId)),
      leases: 1,
      disposed: false,
    };
    this.#installedPolicies.add(state);
    const policy = new HostPolicyImpl(this, state) as HostPolicy;
    hostPolicies.set(policy, { host: this, state });
    return policy;
  }

  /** Binds one immutable font's shaping and portable raster resources to this host. */
  bindFont<Technique extends AnyRasterTechnique>(font: Font<Technique>): HostFontBinding<Technique> {
    this.#assertActive();
    if (this.#bindRuntimeFont === undefined) {
      throw new Error('text engine host was not created by a text runtime');
    }
    const runtime = this.#bindRuntimeFont(font);
    try {
      const techniqueId = this.#wireIdentities.techniqueId(font.technique);
      if (![...this.#installedPolicies].some((policy) => !policy.disposed && policy.techniqueIds.has(techniqueId))) {
        throw new TypeError(`text engine host has no installed policy for "${font.technique.id}"`);
      }
      const existing = this.#retainedFontBindings.get(runtime.identity);
      if (existing !== undefined && !existing.disposed) {
        if (existing.technique !== font.technique) throw new Error('runtime font identity changed raster technique');
        runtime.dispose();
        existing.leases += 1;
        return new HostFontBindingImpl(this, existing) as unknown as HostFontBinding<Technique>;
      }
      const compiled = compileRasterFont(font, this.#wireIdentities);
      if (compiled === undefined) {
        throw new TypeError(`no portable raster plan program is registered for "${font.technique.id}"`);
      }
      const ordinal = this.#nextFontBindingOrdinal;
      const handle = this.id('font-binding', `${this.#identityNamespace}/font/${ordinal}`);
      const payloads = this.#retainPortablePayloads(font.technique, compiled);
      try {
        this.registerFontBinding(handle, runtime.handle, compiled.binding);
      } catch (error) {
        this.#releasePortablePayloadOwners(payloads);
        throw error;
      }
      this.#nextFontBindingOrdinal = ordinal + 1;
      const state: RetainedHostFontBinding = {
        identity: runtime.identity,
        technique: font.technique,
        handle,
        runtime,
        payloads,
        leases: 1,
        disposed: false,
      };
      this.#retainedFontBindings.set(runtime.identity, state);
      this.#liveRetainedFontBindings.add(state);
      return new HostFontBindingImpl(this, state) as unknown as HostFontBinding<Technique>;
    } catch (error) {
      runtime.dispose();
      throw error;
    }
  }

  /** Binds an ordered immutable font stack to this host. */
  bindFontStack<Technique extends AnyRasterTechnique>(
    stack: FontStack<Technique, Font<Technique>>,
  ): HostFontStackBinding {
    this.#assertActive();
    const fonts = immutableFontStackFonts(stack as FontStack<AnyRasterTechnique, Font<AnyRasterTechnique>>);
    for (const font of fonts) {
      const techniqueId = this.#wireIdentities.techniqueId(font.technique);
      if (![...this.#installedPolicies].some((policy) => !policy.disposed && policy.techniqueIds.has(techniqueId))) {
        throw new TypeError(`text engine host has no installed policy for "${font.technique.id}"`);
      }
    }
    const existing = this.#retainedFontStacks.get(stack);
    if (existing !== undefined && !existing.disposed) {
      existing.leases += 1;
      const binding = new HostFontStackBindingImpl(this, existing) as HostFontStackBinding;
      hostFontStacks.set(binding, { host: this, state: existing });
      return binding;
    }
    const bindings: HostFontBindingImpl[] = [];
    try {
      for (const font of fonts) {
        bindings.push(this.bindFont(font) as unknown as HostFontBindingImpl);
      }
      const ordinal = this.#nextFontStackOrdinal;
      const handle = this.id('font-stack', `${this.#identityNamespace}/font-stack/${ordinal}`);
      this.registerFontStack(
        handle,
        bindings.map((binding) => binding._state().handle),
      );
      this.#nextFontStackOrdinal = ordinal + 1;
      const state: RetainedHostFontStackBinding = {
        identity: stack,
        handle,
        bindings: Object.freeze(bindings),
        leases: 1,
        disposed: false,
      };
      this.#retainedFontStacks.set(stack, state);
      this.#liveRetainedFontStacks.add(state);
      const binding = new HostFontStackBindingImpl(this, state) as HostFontStackBinding;
      hostFontStacks.set(binding, { host: this, state });
      return binding;
    } catch (error) {
      for (const binding of bindings.reverse()) binding.dispose();
      throw error;
    }
  }

  /** @internal */
  _disposeInstalledPolicy(state: InstalledHostPolicy): void {
    if (state.disposed) return;
    if (state.leases <= 0) throw new Error('host policy lease underflow');
    state.leases -= 1;
    if (state.leases === 0) this.#disposeInstalledPolicy(state);
  }

  /** @internal */
  _retainInstalledPolicy(
    policy: HostPolicy,
  ): Readonly<{ handle: PolicyHandle; descriptor: PolicyDescriptor; dispose(): void }> {
    this.#assertActive();
    const entry = hostPolicies.get(policy as object);
    if (entry === undefined || entry.host !== this || entry.state.disposed || policy.disposed) {
      throw new TypeError('host policy must be a live policy installed by this text engine host');
    }
    entry.state.leases += 1;
    let disposed = false;
    return Object.freeze({
      handle: entry.state.handle,
      descriptor: entry.state.descriptor,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this._disposeInstalledPolicy(entry.state);
      },
    });
  }

  /** @internal */
  _retainFontStackBinding(
    binding: HostFontStackBinding,
  ): Readonly<{ handle: FontStackHandle; binding: HostFontStackBinding; dispose(): void }> {
    this.#assertActive();
    const entry = hostFontStacks.get(binding as object);
    if (entry === undefined || entry.host !== this || entry.state.disposed || binding.disposed) {
      throw new TypeError('font stack binding must be a live binding from this text engine host');
    }
    entry.state.leases += 1;
    const retained = new HostFontStackBindingImpl(this, entry.state) as HostFontStackBinding;
    hostFontStacks.set(retained, { host: this, state: entry.state });
    return Object.freeze({
      handle: entry.state.handle,
      binding: retained,
      dispose: () => retained.dispose(),
    });
  }

  /** Allocates a host-local identity for renderer-owned material state. */
  createMaterialBinding(): HostMaterialBinding {
    return this.#createOpaqueBinding('material') as HostMaterialBinding;
  }

  /** Allocates a host-local identity for renderer-owned resource state. */
  createResourceBinding(): HostResourceBinding {
    return this.#createOpaqueBinding('resource') as HostResourceBinding;
  }

  /** Allocates a host-local identity for renderer-owned transform state. */
  createTransformBinding(): HostTransformBinding {
    return this.#createOpaqueBinding('transform') as HostTransformBinding;
  }

  /** @internal */
  _retainOpaqueBinding(
    binding: HostMaterialBinding | HostResourceBinding | HostTransformBinding,
    kind: RetainedHostOpaqueBinding['kind'],
  ): HostOpaqueBindingLease {
    this.#assertActive();
    const entry = hostOpaqueBindings.get(binding as object);
    if (
      entry === undefined ||
      entry.host !== this ||
      entry.state.kind !== kind ||
      entry.state.disposed ||
      binding.disposed
    ) {
      throw new TypeError(`${kind} binding must be a live binding from this text engine host`);
    }
    entry.state.leases += 1;
    const retained = new HostOpaqueBindingImpl(this, entry.state) as HostMaterialBinding &
      HostResourceBinding &
      HostTransformBinding;
    hostOpaqueBindings.set(retained, { host: this, state: entry.state });
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
    if (this.#disposed) throw new Error('text engine host is disposed');
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
  _resolveOpaqueBinding(
    kind: RetainedHostOpaqueBinding['kind'],
    handle: number,
  ): HostMaterialBinding | HostResourceBinding | HostTransformBinding {
    if (this.#disposed) throw new Error('text engine host is disposed');
    const state = this.#opaqueBindingsByKind[kind].get(handle);
    if (state !== undefined && !state.disposed) return state.binding;
    throw new Error(`text render plan references unknown ${kind} binding ${handle}`);
  }

  /** @internal */
  _disposeRetainedFontBinding(state: RetainedHostFontBinding): void {
    if (state.disposed) return;
    if (state.leases <= 0) throw new Error('host font binding lease underflow');
    if (state.leases > 1) {
      state.leases -= 1;
      return;
    }
    this.#disposeRetainedFontBinding(state);
  }

  /** @internal */
  _disposeRetainedFontStack(state: RetainedHostFontStackBinding): void {
    if (state.disposed) return;
    if (state.leases <= 0) throw new Error('host font stack lease underflow');
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
      throw new Error(`font binding ${bindingHandle} is not owned by this text engine host`);
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
        throw new Error(`font binding ${checkedHandle} is not owned by this text engine host`);
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
    if (!this.#fontStacks.has(handle)) throw new Error(`font stack ${handle} is not owned by this text engine host`);
    requireStatus(this.#exports.disposeFontStack(handle), 'dispose font stack');
    this.#fontStacks.delete(handle);
    this.#releaseClaim(this.#owners.fontStacks, handle);
    this.#ids.release(handle, 'font-stack');
  }

  /** @internal */
  registerPolicy(handle: PolicyHandle, bytes: Uint8Array): void {
    this.#assertActive();
    handle = assertGlyphId(handle, 'policy', 'policy handle');
    const adopted = this.#ids.retain(handle, 'policy', 'policy handle');
    let claimed = false;
    try {
      claimed = this.#claim(this.#owners.policies, handle, 'render policy');
      this.#withBytes(bytes, (pointer, length) =>
        requireStatus(this.#exports.registerPolicy(handle, pointer, length), 'register render policy'),
      );
      this.#policies.add(handle);
    } catch (error) {
      this.#rollbackClaim(this.#owners.policies, handle, claimed);
      if (adopted) this.#ids.release(handle, 'policy');
      throw error;
    }
  }

  /** @internal */
  disposePolicy(handle: PolicyHandle): void {
    this.#assertActive();
    handle = assertGlyphId(handle, 'policy', 'policy handle');
    if (!this.#policies.has(handle)) throw new Error(`render policy ${handle} is not owned by this text engine host`);
    requireStatus(this.#exports.disposePolicy(handle), 'dispose render policy');
    this.#policies.delete(handle);
    this.#releaseClaim(this.#owners.policies, handle);
    this.#ids.release(handle, 'policy');
  }

  /** Creates a retained text session whose delivery mode is selected by its plan target. */
  createSession<Target extends TextPlanTarget>(options: RetainedTextEngineSessionOptions<Target>): SessionFor<Target>;
  /** @internal Raw compatibility overload removed with caller-authored wire updates. */
  createSession(options: RawTextEngineSessionOptions): TextEngineSession;
  createSession(
    options: RetainedTextEngineSessionOptions<TextPlanTarget> | RawTextEngineSessionOptions,
  ): SessionFor<TextPlanTarget> | TextEngineSession {
    if (typeof options === 'object' && options !== null && 'target' in options) {
      const session = createRetainedTextEngineSession(this, options);
      this.#retainedSessions.add(session);
      return session;
    }
    return this._createRawSession(options);
  }

  /** @internal */
  _detachRetainedSession(session: { dispose(): void }): void {
    this.#retainedSessions.delete(session);
  }

  /** @internal */
  _createRawSession(options: RawTextEngineSessionOptions): TextEngineSession {
    this.#assertActive();
    const handle = assertGlyphId(options.handle, 'session', 'session handle');
    const requestCapacity = uint32(options.requestCapacity, 'request capacity');
    const resultCapacity = uint32(options.resultCapacity, 'result capacity');
    const textCapacity = uint32(options.textCapacity ?? 0, 'text capacity');
    const adopted = this.#ids.retain(handle, 'session', 'session handle');
    let claimed = false;
    try {
      claimed = this.#claim(this.#owners.sessions, handle, 'text session');
      requireStatus(
        this.#exports.createSession(handle, requestCapacity, resultCapacity, textCapacity),
        'create text session',
      );
      const session = new TextEngineSession(
        this.#exports,
        handle,
        requestCapacity,
        resultCapacity,
        textCapacity,
        (request) => this.#assertFrameOwnership(handle, request),
        () => this.#assertRuntimeAvailable?.(),
        () => {
          this.#sessions.delete(session);
          this.#releaseClaim(this.#owners.sessions, handle);
          this.#ids.release(handle, 'session');
        },
      );
      this.#sessions.add(session);
      return session;
    } catch (error) {
      this.#rollbackClaim(this.#owners.sessions, handle, claimed);
      if (adopted) this.#ids.release(handle, 'session');
      throw error;
    }
  }

  /** @internal */
  _allocateRetainedSessionHandle(): TextEngineSessionHandle {
    this.#assertActive();
    const ordinal = this.#nextRetainedSessionOrdinal;
    if (!Number.isSafeInteger(ordinal) || ordinal <= 0 || ordinal > MAX_U32) {
      throw new RangeError('retained text session handles are exhausted');
    }
    this.#nextRetainedSessionOrdinal = ordinal + 1;
    return this.id('session', `${this.#identityNamespace}/retained-session/${ordinal}`);
  }

  /** @internal */
  _enterBorrowedPlan(): () => void {
    this.#assertActive();
    return this.#enterRuntimeBorrow?.() ?? (() => {});
  }

  /** @internal */
  _assertRuntimeMutationAllowed(): void {
    this.#assertActive();
  }

  /** Disposes this host and every policy, binding, and session it still owns. */
  dispose(): void {
    if (this.#disposed) return;
    this.#assertRuntimeAvailable?.();
    let failure: unknown;
    const attempt = (dispose: () => void): void => {
      try {
        dispose();
      } catch (error) {
        failure ??= error;
      }
    };
    for (const session of [...this.#retainedSessions]) attempt(() => session.dispose());
    for (const session of [...this.#sessions]) attempt(() => session.dispose());
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
    const installedPolicyHandles = new Set([...this.#installedPolicies].map((policy) => policy.handle));
    for (const policy of [...this.#installedPolicies]) attempt(() => this.#disposeInstalledPolicy(policy));
    for (const handle of [...this.#policies]) {
      if (!installedPolicyHandles.has(handle)) attempt(() => this.disposePolicy(handle));
    }
    if (
      this.#sessions.size !== 0 ||
      this.#fontStacks.size !== 0 ||
      this.#fontBindings.size !== 0 ||
      this.#policies.size !== 0 ||
      this.#portablePayloads.size !== 0
    ) {
      failure ??= new Error('text engine host disposal left live registrations or payload leases');
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

  #assertFrameOwnership(sessionHandle: TextEngineSessionHandle, request: Uint8Array): void {
    const references = frameRegistrationReferences(request);
    if (references.sessionHandle !== sessionHandle) {
      throw new TypeError(`text update belongs to session ${references.sessionHandle}, not ${sessionHandle}`);
    }
    if (this.#owners.policies.get(references.policyHandle) !== this) {
      throw new TypeError(`render policy ${references.policyHandle} is not owned by this text engine host`);
    }
    for (const handle of references.fontStackHandles) {
      if (this.#owners.fontStacks.get(handle) !== this) {
        throw new TypeError(`font stack ${handle} is not owned by this text engine host`);
      }
    }
  }

  #disposeRetainedFontBinding(state: RetainedHostFontBinding): void {
    if (state.disposed) return;
    this.disposeFontBinding(state.handle);
    state.leases = 0;
    state.disposed = true;
    this.#retainedFontBindings.delete(state.identity);
    this.#liveRetainedFontBindings.delete(state);
    this.#releasePortablePayloadOwners(state.payloads);
    state.runtime.dispose();
  }

  #retainPortablePayloads(
    technique: AnyRasterTechnique,
    compiled: CompiledRasterFont,
  ): ReadonlyMap<number, RetainedHostPortablePayload> {
    const resourceNames = new Map<string, string>();
    for (const [name, keys] of compiled.declaredResources) {
      for (const key of keys) resourceNames.set(key, name);
    }
    const payloads = new Map<number, RetainedHostPortablePayload>();
    try {
      for (const [key, payload] of compiled.resources) {
        const resourceName = resourceNames.get(key);
        if (resourceName === undefined) throw new Error(`compiled font retained an unnamed resource "${key}"`);
        const referenceId = this.#wireIdentities.resourceId(key);
        let retained = this.#portablePayloads.get(referenceId);
        if (retained === undefined) {
          retained = {
            referenceId,
            identity: portableResourceIdentity(payload),
            techniqueId: technique.id,
            resourceName,
            payload,
            group: undefined,
            owners: 0,
            leases: 0,
          };
          this.#portablePayloads.set(referenceId, retained);
        } else if (
          retained.techniqueId !== technique.id ||
          retained.resourceName !== resourceName ||
          !samePortableResource(retained.payload, payload)
        ) {
          throw new TypeError(`portable payload reference ${referenceId} resolves to different content`);
        }
        retained.owners += 1;
        payloads.set(referenceId, retained);
      }
      this.#bindPortablePayloadGroups(technique, compiled, payloads);
      return payloads;
    } catch (error) {
      this.#releasePortablePayloadOwners(payloads);
      throw error;
    }
  }

  #bindPortablePayloadGroups(
    technique: AnyRasterTechnique,
    compiled: CompiledRasterFont,
    payloads: ReadonlyMap<number, RetainedHostPortablePayload>,
  ): void {
    const program = resolveRasterPlanProgram(technique.id);
    if (program === undefined) throw new Error(`portable plan program "${technique.id}" is no longer registered`);
    const selectedName = program.schema.render.resource;
    if (selectedName === undefined) throw new Error(`portable plan program "${technique.id}" has no render resource`);
    const companions: RetainedHostPortablePayload[] = [];
    for (const [name, keys] of compiled.declaredResources) {
      if (name === selectedName || program.schema.resources[name]?.cardinality === 'many') continue;
      if (keys.length !== 1) throw new Error(`singleton resource "${name}" does not have exactly one payload`);
      const companion = payloads.get(this.#wireIdentities.resourceId(keys[0]!));
      if (companion === undefined) throw new Error(`compiled font does not own companion resource "${name}"`);
      companions.push(companion);
    }
    for (const key of compiled.declaredResources.get(selectedName) ?? []) {
      const selected = payloads.get(this.#wireIdentities.resourceId(key));
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

  #releasePortablePayloadOwners(payloads: ReadonlyMap<number, RetainedHostPortablePayload>): void {
    for (const payload of payloads.values()) {
      if (payload.owners <= 0) throw new Error('portable payload owner underflow');
      payload.owners -= 1;
      this.#deletePortablePayloadIfUnused(payload);
    }
  }

  #releasePortablePayloadLease(payload: RetainedHostPortablePayload): void {
    if (payload.leases <= 0) throw new Error('portable payload lease underflow');
    payload.leases -= 1;
    this.#deletePortablePayloadIfUnused(payload);
  }

  #deletePortablePayloadIfUnused(payload: RetainedHostPortablePayload): void {
    if (payload.owners === 0 && payload.leases === 0 && this.#portablePayloads.get(payload.referenceId) === payload) {
      this.#portablePayloads.delete(payload.referenceId);
    }
  }

  #disposeInstalledPolicy(state: InstalledHostPolicy): void {
    if (state.disposed) return;
    this.disposePolicy(state.handle);
    state.leases = 0;
    state.disposed = true;
    this.#installedPolicies.delete(state);
  }

  #createOpaqueBinding(kind: RetainedHostOpaqueBinding['kind']): HostOpaqueBindingImpl {
    this.#assertActive();
    const recycledTransformOrdinal = kind === 'transform' ? this.#freeTransformOrdinals.pop() : undefined;
    const ordinal =
      recycledTransformOrdinal ??
      (kind === 'material'
        ? this.#nextMaterialOrdinal
        : kind === 'resource'
          ? this.#nextResourceOrdinal
          : this.#nextTransformOrdinal);
    const next = recycledTransformOrdinal === undefined ? nextHostOrdinal(ordinal, `${kind} binding`) : undefined;
    const handle = kind === 'transform' ? ordinal : this.id(kind, `${this.#identityNamespace}/${kind}/${ordinal}`);
    const state: RetainedHostOpaqueBinding = {
      kind,
      handle,
      binding: undefined as unknown as HostOpaqueBindingImpl,
      leases: 1,
      disposed: false,
    };
    const binding = new HostOpaqueBindingImpl(this, state);
    state.binding = binding;
    this.#opaqueBindings.add(state);
    this.#opaqueBindingsByKind[kind].set(handle, state);
    hostOpaqueBindings.set(binding, { host: this, state });
    if (kind === 'material') this.#nextMaterialOrdinal = next!;
    else if (kind === 'resource') this.#nextResourceOrdinal = next!;
    else if (next !== undefined) this.#nextTransformOrdinal = next;
    return binding;
  }

  #releaseOpaqueBinding(state: RetainedHostOpaqueBinding): void {
    if (state.disposed) return;
    if (state.leases <= 0) throw new Error(`host ${state.kind} binding lease underflow`);
    state.leases -= 1;
    if (state.leases !== 0) return;
    state.disposed = true;
    this.#opaqueBindings.delete(state);
    this.#opaqueBindingsByKind[state.kind].delete(state.handle);
    if (state.kind === 'transform') this.#freeTransformOrdinals.push(state.handle);
  }

  #forceDisposeOpaqueBinding(state: RetainedHostOpaqueBinding): void {
    if (state.disposed) return;
    state.leases = 0;
    state.disposed = true;
    this.#opaqueBindings.delete(state);
    this.#opaqueBindingsByKind[state.kind].delete(state.handle);
  }

  /** @internal */
  _disposeOpaqueBinding(binding: HostMaterialBinding | HostResourceBinding | HostTransformBinding): void {
    const entry = hostOpaqueBindings.get(binding as object);
    if (entry === undefined || entry.host !== this) throw new TypeError('opaque binding belongs to another host');
    this.#releaseOpaqueBinding(entry.state);
  }

  #disposeRetainedFontStack(state: RetainedHostFontStackBinding): void {
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

  #claim(owners: Map<number, TextEngineHost>, handle: number, label: string): boolean {
    const owner = owners.get(handle);
    if (owner === this) return false;
    if (owner !== undefined) throw new Error(`${label} ${handle} is already owned by another text engine host`);
    owners.set(handle, this);
    return true;
  }

  #rollbackClaim(owners: Map<number, TextEngineHost>, handle: number, claimed: boolean): void {
    if (claimed && owners.get(handle) === this) owners.delete(handle);
  }

  #releaseClaim(owners: Map<number, TextEngineHost>, handle: number): void {
    if (owners.get(handle) !== this) throw new Error(`text engine host lost registration ${handle}`);
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
    if (this.#disposed) throw new Error('text engine host is disposed');
    this.#assertRuntimeAvailable?.();
  }
}

function samePortablePayloadGroup(
  left: readonly RetainedHostPortablePayload[],
  right: readonly RetainedHostPortablePayload[],
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

class HostPolicyImpl implements HostPolicy {
  declare readonly [hostPolicyBrand]: true;
  readonly #host: TextEngineHost;
  readonly #state: InstalledHostPolicy;
  #disposed = false;

  constructor(host: TextEngineHost, state: InstalledHostPolicy) {
    this.#host = host;
    this.#state = state;
  }

  get disposed(): boolean {
    return this.#disposed || this.#state.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.#host._disposeInstalledPolicy(this.#state);
    this.#disposed = true;
  }
}

class HostFontBindingImpl {
  readonly #host: TextEngineHost;
  readonly #state: RetainedHostFontBinding;
  #disposed = false;

  constructor(host: TextEngineHost, state: RetainedHostFontBinding) {
    this.#host = host;
    this.#state = state;
  }

  get technique(): AnyRasterTechnique {
    return this.#state.technique;
  }

  get disposed(): boolean {
    return this.#disposed || this.#state.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.#host._disposeRetainedFontBinding(this.#state);
    this.#disposed = true;
  }

  /** @internal */
  _state(): RetainedHostFontBinding {
    if (this.disposed) throw new Error('host font binding has been disposed');
    return this.#state;
  }
}

class HostFontStackBindingImpl implements HostFontStackBinding {
  declare readonly [hostFontStackBindingBrand]: true;
  readonly #host: TextEngineHost;
  readonly #state: RetainedHostFontStackBinding;
  #disposed = false;

  constructor(host: TextEngineHost, state: RetainedHostFontStackBinding) {
    this.#host = host;
    this.#state = state;
  }

  get disposed(): boolean {
    return this.#disposed || this.#state.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.#host._disposeRetainedFontStack(this.#state);
    this.#disposed = true;
  }
}

class HostOpaqueBindingImpl implements HostMaterialBinding, HostResourceBinding, HostTransformBinding {
  declare readonly [hostMaterialBindingBrand]: true;
  declare readonly [hostResourceBindingBrand]: true;
  declare readonly [hostTransformBindingBrand]: true;
  readonly #host: TextEngineHost;
  readonly #state: RetainedHostOpaqueBinding;
  #disposed = false;

  constructor(host: TextEngineHost, state: RetainedHostOpaqueBinding) {
    this.#host = host;
    this.#state = state;
  }

  get disposed(): boolean {
    return this.#disposed || this.#state.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.#host._disposeOpaqueBinding(this);
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

export class TextEngineSession {
  readonly #exports;
  readonly #handle: TextEngineSessionHandle;
  readonly #onDispose: () => void;
  readonly #assertRequestOwnership: (request: Uint8Array) => void;
  readonly #assertRuntimeAvailable: () => void;
  #requestCapacity: number;
  #resultCapacity: number;
  #textCapacity: number;
  #disposed = false;
  /** Bumped before every call that can answer with new bytes; borrows from older epochs are dead. */
  #epoch = 0;
  /** The epoch each issued borrow was published under, keyed by publication identity. */
  readonly #issued = new WeakMap<TextEnginePublication, number>();
  /** Owned copies made by this session; unlike borrows, they never expire. */
  readonly #owned = new WeakSet<TextEnginePublication>();
  #latestGeneration = 0;

  /** @internal Sessions are created through {@link TextEngineHost.createSession}. */
  constructor(
    exports: ReturnType<typeof runtimeShaperEngineExports>,
    handle: TextEngineSessionHandle,
    requestCapacity: number,
    resultCapacity: number,
    textCapacity: number,
    assertRequestOwnership: (request: Uint8Array) => void,
    assertRuntimeAvailable: () => void,
    onDispose: () => void,
  ) {
    this.#exports = exports;
    this.#handle = handle;
    this.#requestCapacity = requestCapacity;
    this.#resultCapacity = resultCapacity;
    this.#textCapacity = textCapacity;
    this.#assertRequestOwnership = assertRequestOwnership;
    this.#assertRuntimeAvailable = assertRuntimeAvailable;
    this.#onDispose = onDispose;
  }

  get handle(): TextEngineSessionHandle {
    return this.#handle;
  }

  /**
   * Whether this session's publication has expired. An owned copy always answers false.
   * A borrow expires when the session answers another call, Wasm memory grows, or the
   * session is disposed.
   */
  isExpired(publication: TextEnginePublication): boolean {
    if (this.#owned.has(publication)) return false;
    if (this.#issued.get(publication) === undefined) {
      throw new TypeError('publication was not issued by this text engine session');
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
  copyPublication(publication: TextEnginePublication): OwnedTextEnginePublication {
    this.#assertPublicationCurrent(publication);
    const bytes = publication.bytes.slice();
    const owned = markOwnedTextEnginePublication(
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

  #assertPublicationCurrent(publication: TextEnginePublication): void {
    if (this.isExpired(publication)) {
      throw new TextEnginePublicationExpiredError(publication.publicationGeneration, this.#latestGeneration);
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
      this.#exports.reserveSession(this.#handle, requestCapacity, resultCapacity, textCapacity),
      'reserve text session',
    );
    this.#requestCapacity = Math.max(this.#requestCapacity, requestCapacity);
    this.#resultCapacity = Math.max(this.#resultCapacity, resultCapacity);
    this.#textCapacity = Math.max(this.#textCapacity, textCapacity);
  }

  /** @internal Reserve one paragraph's retained text scratch without changing transport capacities. */
  _reserveText(textCapacity: number): void {
    this.reserve(this.#requestCapacity, this.#resultCapacity, textCapacity);
  }

  update(request: Uint8Array): TextEnginePublication {
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
        throw engineStatusError('resolve text request arena', textShaperAbi.status.sessionMissing);
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
   * result rides the inactive output slot under a host lease: its bytes stay readable
   * only until the next call into the same Wasm module. Engine revisions, the
   * publication generation, and the renderer fence are untouched, so the following
   * ordinary frame proceeds from pre-measure state.
   */
  measureParagraph(request: Uint8Array, paragraphId: ParagraphId): TextEnginePublication {
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
        throw engineStatusError('resolve text request arena', textShaperAbi.status.sessionMissing);
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

  #decodeResult(
    header: DataView,
    resultPointer: number,
    memoryBuffer: ArrayBuffer,
    initialMemoryBuffer: ArrayBuffer,
  ): TextEnginePublication {
    const layout = textShaperAbi.layouts.engineResult;
    const byteLength = header.getUint32(layout.byteLength, true);
    if (byteLength < layout.size || resultPointer + byteLength > memoryBuffer.byteLength) {
      throw new RangeError('text engine returned an out-of-bounds publication');
    }
    this.#requestCapacity = header.getUint32(layout.requestCapacity, true);
    this.#resultCapacity = header.getUint32(layout.resultCapacity, true);
    const publication: TextEnginePublication = {
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
    this.#assertRuntimeAvailable();
    requireStatus(this.#exports.disposeSession(this.#handle), 'dispose text session');
    this.#invalidate();
    this.#disposed = true;
    this.#onDispose();
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('text engine session is disposed');
    this.#assertRuntimeAvailable();
  }
}

interface FrameRegistrationReferences {
  readonly sessionHandle: number;
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
    sessionHandle: uint32Handle(view.getUint32(request.sessionId, true), 'frame session handle'),
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

function nextHostOrdinal(current: number, label: string): number {
  if (!Number.isSafeInteger(current) || current <= 0 || current > MAX_U32) {
    throw new RangeError(`${label} identities are exhausted`);
  }
  return current + 1;
}
