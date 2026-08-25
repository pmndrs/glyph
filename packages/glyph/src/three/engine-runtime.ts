import type { LoadedFont } from '../loaded-font.js';
import { bitmap, type BitmapData, type BitmapStrikeData } from '../raster/bitmap-technique.js';
import { msdf, type MsdfData } from '../raster/msdf.js';
import { slug, type SlugData, type SlugPageData } from '../raster/slug-technique.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import { observeTextRuntimeDispose, type TextRuntime } from '../text-runtime.js';
import {
  loadedFontBindingBytes,
  observeLoadedFontDispose,
  resolveRasterPlanProgram,
  TextEngineHost,
  textRuntimeShaper,
  type PortableGeometryPayload,
  type PortableResource,
  type TextEngineSession,
  type TextEngineSessionOptions,
} from '../core.js';
import { threeRenderPolicyBytes, type ThreeTransformMode } from './render-policy.js';
import type { ThreeTextMaterial } from './material.js';
import {
  assertThreeGeometryPayload,
  compiledThreeRasterPlanPrograms,
  releaseThreeRasterPlanProgramSnapshot,
  type CompiledThreeRasterPlanProgram,
} from './plan-program-registry.js';

const POLICY_HANDLE = 1;
const MAX_U32 = 0xffff_ffff;
const coordinators = new WeakMap<TextRuntime, ThreeTextEngineCoordinator>();
const coordinatorDisposeObservers = new WeakMap<ThreeTextEngineCoordinator, () => void>();

export interface ThreeTextEngineStackLease {
  readonly handle: number;
  release(): void;
}

export interface ThreeTextMaterialLease {
  readonly id: number;
  release(): void;
}

interface RetainedStack {
  readonly handle: number;
  references: number;
}

interface RetainedMaterial {
  readonly id: number;
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

export type ThreeTextEngineResource =
  | Readonly<{ technique: typeof bitmap.id; strike: BitmapStrikeData }>
  | Readonly<{ technique: typeof msdf.id; data: MsdfData }>
  | Readonly<{ technique: typeof slug.id; page: SlugPageData }>
  | Readonly<{
      technique: string;
      resourceName: string;
      resources: ReadonlyMap<string, PortableResource>;
      resourceReferences: ReadonlyMap<string, number>;
      program: CompiledThreeRasterPlanProgram;
    }>;

export interface ThreeTextEngineCoordinatorOptions {
  /** Renderer-policy choice; indexed is the first-party high-throughput default. */
  readonly transformMode?: ThreeTransformMode;
}

/** Three-owned cold registrations shared by every text batch using one renderer-neutral runtime. */
export class ThreeTextEngineCoordinator {
  readonly host: TextEngineHost;
  readonly #bindingHandles = new WeakMap<LoadedFont<AnyRasterTechnique>, number>();
  readonly #resources = new Map<number, RetainedResourceOwners>();
  readonly #fontResourceReferences = new Map<LoadedFont<AnyRasterTechnique>, Set<number>>();
  readonly #fontDisposeObservers = new Map<LoadedFont<AnyRasterTechnique>, () => void>();
  readonly #stacks = new Map<string, RetainedStack>();
  readonly #materialHandles = new WeakMap<ThreeTextMaterial, RetainedMaterial>();
  readonly #materials = new Map<number, RetainedMaterial>();
  readonly #planPrograms: ReadonlyMap<string, CompiledThreeRasterPlanProgram>;
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
      this.host.registerPolicy(
        POLICY_HANDLE,
        threeRenderPolicyBytes(
          this.host.wireIdentities,
          transformMode,
          planPrograms.map((program) => program.policy),
        ),
      );
    } catch (error) {
      if (snapshot) releaseThreeRasterPlanProgramSnapshot(this.host.wireIdentities);
      this.host.dispose();
      throw error;
    }
  }

  get policyHandle(): number {
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

  #bindingHandle(font: LoadedFont<AnyRasterTechnique>): number {
    if (font.disposed) throw new TypeError('cannot register a disposed loaded font with the Three text engine');
    const existing = this.#bindingHandles.get(font);
    if (existing !== undefined) return existing;
    const program = this.#planPrograms.get(font.technique.id);
    if (program === undefined && resolveRasterPlanProgram(font.technique.id) !== undefined) {
      throw new TypeError(`Three has no registered renderer variant for portable technique "${font.technique.id}"`);
    }
    let binding: Uint8Array;
    let prepared: readonly PreparedResource[];
    if (program === undefined) {
      binding = loadedFontBindingBytes(font, this.host.wireIdentities);
      prepared = this.#firstPartyResources(font);
    } else {
      const compiled = program.compileFont(font, this.host.wireIdentities);
      const namedResources = new Map<string, PortableResource>();
      const resourceReferences = new Map<string, number>();
      const resourceNames = new Map<string, string>();
      for (const [name, key] of compiled.declaredResources) {
        const resource = compiled.resources.get(key);
        if (resource === undefined) throw new Error(`compiled font omitted declared resource "${name}"`);
        namedResources.set(name, resource);
        resourceReferences.set(name, this.host.wireIdentities.resourceId(key));
        resourceNames.set(key, name);
      }
      assertThreeGeometryPayload(program, namedResources);
      const resources = readonlyMap(namedResources);
      const references = readonlyMap(resourceReferences);
      const next: PreparedResource[] = [];
      for (const key of compiled.resources.keys()) {
        const resourceName = resourceNames.get(key);
        if (resourceName === undefined) throw new Error(`compiled font retained an unnamed resource "${key}"`);
        next.push({
          key,
          resource: {
            technique: font.technique.id,
            resourceName,
            resources,
            resourceReferences: references,
            program,
          },
        });
      }
      binding = compiled.binding;
      prepared = next;
    }
    this.#assertResourcesCompatible(prepared);
    const handle = availableHandle(this.#nextBindingHandle, 'font binding');
    this.#observeFont(font);
    try {
      for (const { key, resource } of prepared) this.#retainResource(font, key, resource);
      this.host.registerFontBinding(handle, font.font.handle, binding);
    } catch (error) {
      this.#rollbackFontRegistration(font);
      throw error;
    }
    this.#nextBindingHandle = nextHandle(handle);
    this.#bindingHandles.set(font, handle);
    return handle;
  }

  #firstPartyResources(font: LoadedFont<AnyRasterTechnique>): readonly PreparedResource[] {
    if (font.technique.id === bitmap.id) {
      const data = font.data as BitmapData;
      return data.strikes.map((strike) => ({
        key: strike.pages[0]!.resource,
        resource: { technique: bitmap.id, strike },
      }));
    }
    if (font.technique.id === msdf.id) {
      const data = font.data as MsdfData;
      return [{ key: data.resource, resource: { technique: msdf.id, data } }];
    }
    if (font.technique.id === slug.id) {
      const data = font.data as SlugData;
      return data.pages.map((page) => ({ key: page.resource, resource: { technique: slug.id, page } }));
    }
    throw new TypeError(`no first-party Three resource resolver is registered for "${font.technique.id}"`);
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

  #allocateStackHandle(): number {
    return allocateHandle(this.#nextStackHandle, (next) => (this.#nextStackHandle = next), 'font stack');
  }

  #allocateSessionHandle(): number {
    return allocateHandle(this.#nextSessionHandle, (next) => (this.#nextSessionHandle = next), 'text session');
  }

  #allocateMaterialHandle(): number {
    return allocateHandle(this.#nextMaterialHandle, (next) => (this.#nextMaterialHandle = next), 'material');
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

function allocateHandle(current: number, setNext: (next: number) => void, label: string): number {
  const handle = availableHandle(current, label);
  setNext(nextHandle(handle));
  return handle;
}

function availableHandle(current: number, label: string): number {
  if (!Number.isSafeInteger(current) || current <= 0 || current > MAX_U32) {
    throw new RangeError(`${label} handles are exhausted`);
  }
  return current;
}

function nextHandle(current: number): number {
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

function sameResourceBundle(left: ThreeTextEngineResource, right: ThreeTextEngineResource): boolean {
  if ('resourceReferences' in left) {
    if (!('resourceReferences' in right)) return false;
    return (
      left.resourceName === right.resourceName &&
      left.program === right.program &&
      sameMap(left.resourceReferences, right.resourceReferences, Object.is) &&
      sameMap(left.resources, right.resources, samePortableResource)
    );
  }
  if ('resourceReferences' in right) return false;
  if ('strike' in left && 'strike' in right) return sameBitmapStrike(left.strike, right.strike);
  if ('data' in left && 'data' in right) return sameMsdfData(left.data, right.data);
  return 'page' in left && 'page' in right && sameSlugPage(left.page, right.page);
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

function sameBitmapStrike(left: BitmapStrikeData, right: BitmapStrikeData): boolean {
  return (
    left.ppem === right.ppem &&
    left.planeUnitsPerEm === right.planeUnitsPerEm &&
    sameBytes(left.records, right.records) &&
    left.pages.length === right.pages.length &&
    left.pages.every((page, index) => {
      const other = right.pages[index]!;
      return (
        page.width === other.width &&
        page.height === other.height &&
        page.format === other.format &&
        sameBytes(page.bytes, other.bytes)
      );
    })
  );
}

function sameMsdfData(left: MsdfData, right: MsdfData): boolean {
  return (
    left.binding.width === right.binding.width &&
    left.binding.height === right.binding.height &&
    left.binding.layers === right.binding.layers &&
    left.emSize === right.emSize &&
    left.pixelRange === right.pixelRange &&
    left.planeUnitsPerEm === right.planeUnitsPerEm &&
    sameBytes(left.records, right.records) &&
    (left.coverage === undefined || right.coverage === undefined
      ? left.coverage === right.coverage
      : sameBytes(left.coverage, right.coverage)) &&
    left.pages.length === right.pages.length &&
    left.pages.every((page, index) => {
      const other = right.pages[index]!;
      return (
        page.width === other.width &&
        page.height === other.height &&
        page.format === other.format &&
        sameBytes(page.bytes, other.bytes)
      );
    })
  );
}

function sameSlugPage(left: SlugPageData, right: SlugPageData): boolean {
  return (
    left.curveWidth === right.curveWidth &&
    left.curveHeight === right.curveHeight &&
    sameBytes(left.curveBytes, right.curveBytes) &&
    left.headerCount === right.headerCount &&
    left.headerWidth === right.headerWidth &&
    left.headerHeight === right.headerHeight &&
    sameBytes(left.headerBytes, right.headerBytes) &&
    left.referenceCount === right.referenceCount &&
    left.referenceWidth === right.referenceWidth &&
    left.referenceHeight === right.referenceHeight &&
    sameBytes(left.referenceBytes, right.referenceBytes)
  );
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
  return left.kind === 'geometry' && right.kind === 'geometry' && sameGeometry(left, right);
}

function isPortableResource(value: unknown): value is PortableResource {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const kind = (value as { readonly kind?: unknown }).kind;
  return kind === 'buffer' || kind === 'texture' || kind === 'texture-array' || kind === 'geometry';
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
