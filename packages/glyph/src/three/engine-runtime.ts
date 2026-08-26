import type { LoadedFont } from '../loaded-font.js';
import { bitmap } from '../raster/bitmap-technique.js';
import { msdf } from '../raster/msdf.js';
import { slug } from '../raster/slug-technique.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import { observeTextRuntimeDispose, type TextRuntime } from '../text-runtime.js';
import {
  compileRenderPolicy,
  compileRasterFont,
  id,
  observeLoadedFontDispose,
  resolveRasterPlanProgram,
  TextEngineHost,
  textRuntimeShaper,
  type FontBindingHandle,
  type FontStackHandle,
  type GlyphId,
  type GlyphIdKind,
  type MaterialHandle,
  type PolicyBufferId,
  type PolicyHandle,
  type PortableGeometryPayload,
  type PortableResource,
  type TextEngineSession,
  type TextEngineSessionOptions,
  textShaperAbi,
} from '../core.js';
import { threeRenderPolicyDescriptor, type ThreeTransformMode } from './render-policy.js';
import type { ThreeTextMaterial } from './material.js';
import {
  assertThreeGeometryPayload,
  compiledThreeRasterPlanPrograms,
  releaseThreeRasterPlanProgramSnapshot,
  type CompiledThreeRasterPlanProgram,
} from './plan-program-registry.js';

const POLICY_HANDLE = id('policy', 'glyph-three/render');
const MAX_U32 = 0xffff_ffff;
const INTERNAL_ORDER_BUFFER_ID: typeof textShaperAbi.engine.internalBufferBindings.order =
  textShaperAbi.engine.internalBufferBindings.order;
const coordinators = new WeakMap<TextRuntime, ThreeTextEngineCoordinator>();
const coordinatorDisposeObservers = new WeakMap<ThreeTextEngineCoordinator, () => void>();

export interface ThreeTextEngineStackLease {
  readonly handle: FontStackHandle;
  release(): void;
}

export interface ThreeTextMaterialLease {
  readonly id: MaterialHandle;
  release(): void;
}

interface RetainedStack {
  readonly handle: FontStackHandle;
  references: number;
}

interface RetainedMaterial {
  readonly id: MaterialHandle;
  readonly material: ThreeTextMaterial;
  references: number;
}

interface RetainedResourceOwners {
  readonly owners: Map<LoadedFont<AnyRasterTechnique>, ThreeTextEngineResource>;
}

interface PreparedResource {
  readonly key: string;
  readonly resource: ThreeTextEngineResource;
}

export type ThreeTextEngineResource = Readonly<{
  technique: string;
  resourceName: string;
  resources: ReadonlyMap<string, PortableResource>;
  resourceReferences: ReadonlyMap<string, number>;
  program?: CompiledThreeRasterPlanProgram;
}>;

export interface ThreeTextEngineCoordinatorOptions {
  /** Renderer-policy choice; indexed is the first-party high-throughput default. */
  readonly transformMode?: ThreeTransformMode;
}

/** Three-owned cold registrations shared by every text batch using one renderer-neutral runtime. */
export class ThreeTextEngineCoordinator {
  readonly host: TextEngineHost;
  readonly #bindingHandles = new WeakMap<LoadedFont<AnyRasterTechnique>, FontBindingHandle>();
  readonly #resources = new Map<number, RetainedResourceOwners>();
  readonly #fontResourceReferences = new Map<LoadedFont<AnyRasterTechnique>, Set<number>>();
  readonly #fontDisposeObservers = new Map<LoadedFont<AnyRasterTechnique>, () => void>();
  readonly #stacks = new Map<string, RetainedStack>();
  readonly #materialHandles = new WeakMap<ThreeTextMaterial, RetainedMaterial>();
  readonly #materials = new Map<number, RetainedMaterial>();
  readonly #planPrograms: ReadonlyMap<string, CompiledThreeRasterPlanProgram>;
  readonly #policyBufferIds: ReadonlyMap<number, ReadonlyMap<number, PolicyBufferId>>;
  #nextBindingHandle = 1;
  #nextStackHandle = 1;
  #nextSessionHandle = 1;
  #nextMaterialHandle = 1;
  #applyingPlan = false;
  #disposed = false;

  constructor(
    shaper: ConstructorParameters<typeof TextEngineHost>[0],
    options: ThreeTextEngineCoordinatorOptions = {},
  ) {
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      throw new TypeError('Three text engine coordinator options need an object');
    }
    const transformMode = options.transformMode ?? 'indexed';
    if (transformMode !== 'indexed' && transformMode !== 'direct') {
      throw new TypeError(
        `Three text engine transform mode must be "indexed" or "direct", not "${String(transformMode)}"`,
      );
    }
    this.host = new TextEngineHost(shaper);
    let snapshot = false;
    try {
      const planPrograms = compiledThreeRasterPlanPrograms(this.host.wireIdentities, transformMode);
      snapshot = true;
      this.#planPrograms = new Map(planPrograms.map((program) => [program.technique.id, program]));
      const policy = threeRenderPolicyDescriptor(
        this.host.wireIdentities,
        transformMode,
        planPrograms.map((program) => program.policy),
      );
      const policyBytes = compileRenderPolicy(policy);
      this.#policyBufferIds = policyBufferIds(policy.programs);
      this.host.registerPolicy(POLICY_HANDLE, policyBytes);
    } catch (error) {
      if (snapshot) releaseThreeRasterPlanProgramSnapshot(this.host.wireIdentities);
      this.host.dispose();
      throw error;
    }
  }

  get policyHandle(): PolicyHandle {
    return POLICY_HANDLE;
  }

  assertFrameUpdateAllowed(): void {
    if (this.#applyingPlan) throw new Error('text updates and queries cannot reenter Three render-plan application');
  }

  applyPlan<Result>(apply: () => Result): Result {
    if (this.#applyingPlan) throw new Error('Three render-plan application cannot be reentered');
    this.#applyingPlan = true;
    try {
      return apply();
    } finally {
      this.#applyingPlan = false;
    }
  }

  acquireFontStack(
    fonts: readonly [LoadedFont<AnyRasterTechnique>, ...LoadedFont<AnyRasterTechnique>[]],
  ): ThreeTextEngineStackLease {
    this.#assertActive();
    const bindingHandles = fonts.map((font) => this.#bindingHandle(font));
    const key = bindingHandles.join(',');
    let retained = this.#stacks.get(key);
    if (retained === undefined) {
      retained = { handle: this.#allocateStackHandle(), references: 0 };
      this.host.registerFontStack(retained.handle, bindingHandles);
      this.#stacks.set(key, retained);
    }
    retained.references += 1;
    let released = false;
    return {
      handle: retained.handle,
      release: () => {
        if (released) return;
        released = true;
        if (this.#disposed) return;
        retained.references -= 1;
        if (retained.references !== 0) return;
        this.#stacks.delete(key);
        this.host.disposeFontStack(retained.handle);
      },
    };
  }

  createSession(options: Omit<TextEngineSessionOptions, 'handle'>): TextEngineSession {
    this.#assertActive();
    return this.host.createSession({ ...options, handle: this.#allocateSessionHandle() });
  }

  acquireMaterial(material: ThreeTextMaterial): ThreeTextMaterialLease {
    this.#assertActive();
    let retained = this.#materialHandles.get(material);
    if (retained === undefined || retained.references === 0) {
      retained = { id: this.#allocateMaterialHandle(), material, references: 0 };
      this.#materialHandles.set(material, retained);
      this.#materials.set(retained.id, retained);
    }
    retained.references += 1;
    let released = false;
    return {
      id: retained.id,
      release: () => {
        if (released) return;
        released = true;
        if (this.#disposed) return;
        retained.references -= 1;
        if (retained.references === 0) this.#materials.delete(retained.id);
      },
    };
  }

  resolveMaterial(materialId: number): ThreeTextMaterial | undefined {
    if (materialId === 0) return undefined;
    const retained = this.#materials.get(materialId);
    if (retained === undefined) throw new Error(`Three text command buffer references unknown material ${materialId}`);
    return retained.material;
  }

  resolveResource(referenceId: number): ThreeTextEngineResource {
    const resource = this.#resources.get(referenceId)?.owners.values().next().value;
    if (resource === undefined) throw new Error(`Three text command buffer references unknown resource ${referenceId}`);
    return resource;
  }

  /** Resolve a decoded wire value through the exact policy program that declared it. */
  resolveBufferBindingId(programId: number, value: number): PolicyBufferId | typeof INTERNAL_ORDER_BUFFER_ID {
    if (value === INTERNAL_ORDER_BUFFER_ID) return INTERNAL_ORDER_BUFFER_ID;
    const bufferId = this.#policyBufferIds.get(programId)?.get(value);
    if (bufferId === undefined) {
      throw new TypeError(`Three policy program ${programId} does not declare buffer ${value}`);
    }
    return bufferId;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    let failure: unknown;
    const attempt = (dispose: () => void): void => {
      try {
        dispose();
      } catch (error) {
        failure ??= error;
      }
    };
    const stopObservingRuntime = coordinatorDisposeObservers.get(this);
    if (stopObservingRuntime !== undefined) attempt(stopObservingRuntime);
    coordinatorDisposeObservers.delete(this);
    attempt(() => this.host.dispose());
    for (const stopObserving of this.#fontDisposeObservers.values()) attempt(stopObserving);
    this.#fontDisposeObservers.clear();
    this.#fontResourceReferences.clear();
    this.#resources.clear();
    this.#stacks.clear();
    this.#materials.clear();
    releaseThreeRasterPlanProgramSnapshot(this.host.wireIdentities);
    if (failure !== undefined) throw failure;
  }

  #bindingHandle(font: LoadedFont<AnyRasterTechnique>): FontBindingHandle {
    if (font.disposed) throw new TypeError('cannot register a disposed loaded font with the Three text engine');
    const existing = this.#bindingHandles.get(font);
    if (existing !== undefined) return existing;
    const program = this.#planPrograms.get(font.technique.id);
    const portable = resolveRasterPlanProgram(font.technique.id);
    if (portable === undefined) {
      throw new TypeError(`no portable raster plan program is registered for "${font.technique.id}"`);
    }
    if (
      program === undefined &&
      font.technique.id !== bitmap.id &&
      font.technique.id !== msdf.id &&
      font.technique.id !== slug.id
    ) {
      throw new TypeError(`Three has no registered renderer variant for portable technique "${font.technique.id}"`);
    }
    const compiled = compileRasterFont(font, this.host.wireIdentities);
    if (compiled === undefined) throw new Error(`portable raster plan program "${font.technique.id}" did not compile`);
    const resourceNames = new Map<string, string>();
    const singletonResources = new Map<string, PortableResource>();
    const singletonReferences = new Map<string, number>();
    for (const [name, keys] of compiled.declaredResources) {
      for (const key of keys) resourceNames.set(key, name);
      if (portable.schema.resources[name]?.cardinality === 'many') continue;
      const key = keys[0]!;
      const resource = compiled.resources.get(key);
      if (resource === undefined) throw new Error(`compiled font omitted declared resource "${name}"`);
      singletonResources.set(name, resource);
      singletonReferences.set(name, this.host.wireIdentities.resourceId(key));
    }
    const prepared: PreparedResource[] = [];
    for (const [key, selected] of compiled.resources) {
      const resourceName = resourceNames.get(key);
      if (resourceName === undefined) throw new Error(`compiled font retained an unnamed resource "${key}"`);
      const namedResources = new Map(singletonResources);
      const resourceReferences = new Map(singletonReferences);
      namedResources.set(resourceName, selected);
      resourceReferences.set(resourceName, this.host.wireIdentities.resourceId(key));
      if (program !== undefined) assertThreeGeometryPayload(program, namedResources);
      prepared.push({
        key,
        resource: {
          technique: font.technique.id,
          resourceName,
          resources: readonlyMap(namedResources),
          resourceReferences: readonlyMap(resourceReferences),
          ...(program === undefined ? {} : { program }),
        },
      });
    }
    const binding = compiled.binding;
    this.#assertResourcesCompatible(prepared);
    const handle = this.#namedHandle('font-binding', 'glyph-three', this.#nextBindingHandle);
    this.#observeFont(font);
    try {
      for (const { key, resource } of prepared) this.#retainResource(font, key, resource);
      this.host.registerFontBinding(handle, font.font.handle, binding);
    } catch (error) {
      this.#rollbackFontRegistration(font);
      throw error;
    }
    this.#nextBindingHandle = nextOrdinal(this.#nextBindingHandle);
    this.#bindingHandles.set(font, handle);
    return handle;
  }

  #assertResourcesCompatible(resources: readonly PreparedResource[]): void {
    const prepared = new Map<number, ThreeTextEngineResource>();
    for (const { key, resource } of resources) {
      const referenceId = this.host.wireIdentities.idFor(key);
      const registered = this.#resources.get(referenceId)?.owners.values().next().value;
      if (registered !== undefined) assertEquivalentResource(referenceId, registered, resource);
      const batched = prepared.get(referenceId);
      if (batched !== undefined) assertEquivalentResource(referenceId, batched, resource);
      prepared.set(referenceId, resource);
    }
  }

  #retainResource(font: LoadedFont<AnyRasterTechnique>, key: string, resource: ThreeTextEngineResource): void {
    const referenceId = this.host.wireIdentities.idFor(key);
    let retained = this.#resources.get(referenceId);
    const existing = retained?.owners.values().next().value;
    if (existing !== undefined) assertEquivalentResource(referenceId, existing, resource);
    if (retained === undefined) {
      retained = { owners: new Map() };
      this.#resources.set(referenceId, retained);
    }
    retained.owners.set(font, resource);
    let references = this.#fontResourceReferences.get(font);
    if (references === undefined) {
      references = new Set();
      this.#fontResourceReferences.set(font, references);
    }
    references.add(referenceId);
  }

  #observeFont(font: LoadedFont<AnyRasterTechnique>): void {
    if (this.#fontDisposeObservers.has(font)) return;
    const stopObserving = observeLoadedFontDispose(font, () => this.#releaseFontResources(font));
    this.#fontDisposeObservers.set(font, stopObserving);
  }

  #rollbackFontRegistration(font: LoadedFont<AnyRasterTechnique>): void {
    this.#fontDisposeObservers.get(font)?.();
    this.#releaseFontResources(font);
  }

  #releaseFontResources(font: LoadedFont<AnyRasterTechnique>): void {
    for (const referenceId of this.#fontResourceReferences.get(font) ?? []) {
      const retained = this.#resources.get(referenceId);
      retained?.owners.delete(font);
      if (retained?.owners.size === 0) {
        this.#resources.delete(referenceId);
      }
    }
    this.#fontResourceReferences.delete(font);
    this.#fontDisposeObservers.delete(font);
    this.#bindingHandles.delete(font);
  }

  #allocateStackHandle(): FontStackHandle {
    return this.#allocateHandle('font-stack', this.#nextStackHandle, (next) => (this.#nextStackHandle = next));
  }

  #allocateSessionHandle(): GlyphId<'session'> {
    return this.#allocateHandle('session', this.#nextSessionHandle, (next) => (this.#nextSessionHandle = next));
  }

  #allocateMaterialHandle(): MaterialHandle {
    return this.#allocateHandle('material', this.#nextMaterialHandle, (next) => (this.#nextMaterialHandle = next));
  }

  #allocateHandle<const Kind extends GlyphIdKind>(
    kind: Kind,
    ordinal: number,
    setNext: (next: number) => void,
  ): GlyphId<Kind> {
    const handle = this.#namedHandle(kind, 'glyph-three', ordinal);
    setNext(nextOrdinal(ordinal));
    return handle;
  }

  #namedHandle<const Kind extends GlyphIdKind>(kind: Kind, namespace: string, ordinal: number): GlyphId<Kind> {
    if (!Number.isSafeInteger(ordinal) || ordinal <= 0 || ordinal > MAX_U32) {
      throw new RangeError(`${kind} handles are exhausted`);
    }
    return this.host.id(kind, `${namespace}/${ordinal}`);
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('Three text engine coordinator is disposed');
  }
}

/** Resolve the lazy Three-owned coordinator without pulling renderer policies into the core runtime graph. */
export function threeTextEngineCoordinator(runtime: TextRuntime): ThreeTextEngineCoordinator {
  let coordinator = coordinators.get(runtime);
  if (coordinator === undefined) {
    coordinator = new ThreeTextEngineCoordinator(textRuntimeShaper(runtime));
    coordinators.set(runtime, coordinator);
    const owned = coordinator;
    coordinatorDisposeObservers.set(
      owned,
      observeTextRuntimeDispose(runtime, () => {
        coordinators.delete(runtime);
        owned.dispose();
      }),
    );
  }
  return coordinator;
}

function nextOrdinal(current: number): number {
  return current === MAX_U32 ? MAX_U32 + 1 : current + 1;
}

function readonlyMap<Key, Value>(source: Map<Key, Value>): ReadonlyMap<Key, Value> {
  let view: ReadonlyMap<Key, Value>;
  view = Object.freeze({
    get: source.get.bind(source),
    has: source.has.bind(source),
    get size() {
      return source.size;
    },
    entries: source.entries.bind(source),
    keys: source.keys.bind(source),
    values: source.values.bind(source),
    forEach(callback: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void, thisArg?: unknown) {
      source.forEach((value, key) => callback.call(thisArg, value, key, view));
    },
    [Symbol.iterator]: source[Symbol.iterator].bind(source),
  });
  return view;
}

function policyBufferIds(
  programs: readonly import('../core.js').PolicyProgram[],
): ReadonlyMap<number, ReadonlyMap<number, PolicyBufferId>> {
  return new Map(
    programs.map((program) => [
      program.programId,
      new Map(program.buffers.map((buffer) => [buffer.id, buffer.id] as const)),
    ]),
  );
}

function sameResourceBundle(left: ThreeTextEngineResource, right: ThreeTextEngineResource): boolean {
  return (
    left.resourceName === right.resourceName &&
    left.program === right.program &&
    sameMap(left.resourceReferences, right.resourceReferences, Object.is) &&
    sameMap(left.resources, right.resources, samePortableResource)
  );
}

function assertEquivalentResource(
  referenceId: number,
  existing: ThreeTextEngineResource,
  incoming: ThreeTextEngineResource,
): void {
  if (existing.technique !== incoming.technique) {
    throw new TypeError(`Three text resource ${referenceId} is registered for incompatible techniques`);
  }
  if (!sameResourceBundle(existing, incoming)) {
    throw new TypeError(`Three text resource ${referenceId} is registered with incompatible resource content`);
  }
}

function sameMap<Key, Value>(
  left: ReadonlyMap<Key, Value>,
  right: ReadonlyMap<Key, Value>,
  same: (left: Value, right: Value) => boolean,
): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    const other = right.get(key);
    if (other === undefined || !same(value, other)) return false;
  }
  return true;
}

function samePortableResource(left: unknown, right: unknown): boolean {
  if (!isPortableResource(left) || !isPortableResource(right) || left.kind !== right.kind) return false;
  if (left.kind === 'buffer' && right.kind === 'buffer') {
    return left.stride === right.stride && sameBytes(left.bytes, right.bytes);
  }
  if (left.kind === 'texture' && right.kind === 'texture') {
    return (
      left.format === right.format &&
      left.width === right.width &&
      left.height === right.height &&
      sameBytes(left.bytes, right.bytes)
    );
  }
  if (left.kind === 'texture-array' && right.kind === 'texture-array') {
    return (
      left.format === right.format &&
      left.width === right.width &&
      left.height === right.height &&
      left.layers === right.layers &&
      sameBytes(left.bytes, right.bytes)
    );
  }
  if (left.kind === 'group' && right.kind === 'group') {
    return sameRecordMap(left.members, right.members, samePortableResource);
  }
  return left.kind === 'geometry' && right.kind === 'geometry' && sameGeometry(left, right);
}

function isPortableResource(value: unknown): value is PortableResource {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const kind = (value as { readonly kind?: unknown }).kind;
  return kind === 'buffer' || kind === 'texture' || kind === 'texture-array' || kind === 'geometry' || kind === 'group';
}

function sameRecordMap<Value>(
  left: Readonly<Record<string, Value>>,
  right: Readonly<Record<string, Value>>,
  same: (left: Value, right: Value) => boolean,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.hasOwn(right, key) && same(left[key]!, right[key]!))
  );
}

function sameGeometry(left: PortableGeometryPayload, right: PortableGeometryPayload): boolean {
  return (
    left.topology === right.topology &&
    sameBytes(left.bytes, right.bytes) &&
    sameRecords(left.views, right.views, ['offset', 'length']) &&
    sameRecords(left.accessors, right.accessors, ['componentType', 'components', 'view', 'count', 'offset']) &&
    sameRecords(left.attributes, right.attributes, ['semantic', 'accessor']) &&
    sameOptionalRecord(left.indices, right.indices, ['accessor']) &&
    sameOptionalRecord(left.drawRange, right.drawRange, ['start', 'count'])
  );
}

function sameRecords(left: readonly object[], right: readonly object[], fields: readonly string[]): boolean {
  return left.length === right.length && left.every((record, index) => sameRecord(record, right[index]!, fields));
}

function sameOptionalRecord(left: object | undefined, right: object | undefined, fields: readonly string[]): boolean {
  return left === undefined || right === undefined ? left === right : sameRecord(left, right, fields);
}

function sameRecord(left: object, right: object, fields: readonly string[]): boolean {
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  return fields.every((field) => a[field] === b[field]);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left === right) return true;
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
