import type { LoadedFont } from '../loaded-font.js';
import { bitmap, type BitmapData, type BitmapStrikeData } from '../raster/bitmap-technique.js';
import { msdf, type MsdfData } from '../raster/msdf.js';
import { slug, type SlugData, type SlugPageData } from '../raster/slug-technique.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import type { TextRuntime } from '../text-runtime.js';
import {
  loadedFontBindingBytes,
  observeLoadedFontDispose,
  TextEngineHost,
  textRuntimeShaper,
  type TextEngineSession,
  type TextEngineSessionOptions,
} from '../core.js';
import { threeRenderPolicyBytes, type ThreeTransformMode } from './render-policy.js';
import type { ThreeTextMaterial } from './material.js';
import { compiledThreeRasterPlanPrograms, type CompiledThreeRasterPlanProgram } from './plan-program-registry.js';

const POLICY_HANDLE = 1;
const MAX_U32 = 0xffff_ffff;
const coordinators = new WeakMap<TextRuntime, ThreeTextEngineCoordinator>();

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

export type ThreeTextEngineResource =
  | Readonly<{ technique: typeof bitmap.id; strike: BitmapStrikeData }>
  | Readonly<{ technique: typeof msdf.id; data: MsdfData }>
  | Readonly<{ technique: typeof slug.id; page: SlugPageData }>
  | Readonly<{ technique: string; resource: unknown; program: CompiledThreeRasterPlanProgram }>;

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
    this.host = new TextEngineHost(shaper);
    const planPrograms = compiledThreeRasterPlanPrograms(this.host.wireIdentities);
    this.#planPrograms = new Map(planPrograms.map((program) => [program.technique.id, program]));
    this.host.registerPolicy(
      POLICY_HANDLE,
      threeRenderPolicyBytes(
        this.host.wireIdentities,
        options.transformMode,
        planPrograms.map((program) => program.policy),
      ),
    );
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
    this.host.dispose();
    for (const stopObserving of this.#fontDisposeObservers.values()) stopObserving();
    this.#fontDisposeObservers.clear();
    this.#fontResourceReferences.clear();
    this.#resources.clear();
    this.#stacks.clear();
    this.#materials.clear();
    this.#disposed = true;
  }

  #bindingHandle(font: LoadedFont<AnyRasterTechnique>): number {
    if (font.disposed) throw new TypeError('cannot register a disposed loaded font with the Three text engine');
    const existing = this.#bindingHandles.get(font);
    if (existing !== undefined) return existing;
    this.#observeFont(font);
    const handle = this.#allocateBindingHandle();
    const program = this.#planPrograms.get(font.technique.id);
    if (program === undefined) {
      this.#registerResources(font);
      this.host.registerFontBinding(handle, font.font.handle, loadedFontBindingBytes(font, this.host.wireIdentities));
    } else {
      const compiled = program.compileFont(font, this.host.wireIdentities);
      for (const [key, resource] of compiled.resources) {
        this.#retainResource(font, key, { technique: font.technique.id, resource, program });
      }
      this.host.registerFontBinding(handle, font.font.handle, compiled.binding);
    }
    this.#bindingHandles.set(font, handle);
    return handle;
  }

  #registerResources(font: LoadedFont<AnyRasterTechnique>): void {
    if (font.technique.id === bitmap.id) {
      const data = font.data as BitmapData;
      for (const strike of data.strikes) {
        this.#retainResource(font, strike.pages[0]!.resource, { technique: bitmap.id, strike });
      }
      return;
    }
    if (font.technique.id === msdf.id) {
      const data = font.data as MsdfData;
      this.#retainResource(font, data.resource, { technique: msdf.id, data });
      return;
    }
    if (font.technique.id === slug.id) {
      const data = font.data as SlugData;
      for (const page of data.pages) this.#retainResource(font, page.resource, { technique: slug.id, page });
      return;
    }
    throw new TypeError(`no first-party Three resource resolver is registered for "${font.technique.id}"`);
  }

  #retainResource(font: LoadedFont<AnyRasterTechnique>, key: string, resource: ThreeTextEngineResource): void {
    const referenceId = this.host.wireIdentities.resolve(key);
    let retained = this.#resources.get(referenceId);
    const existing = retained?.owners.values().next().value;
    if (existing !== undefined && existing.technique !== resource.technique) {
      throw new TypeError(`Three text resource ${referenceId} is registered for incompatible techniques`);
    }
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

  #releaseFontResources(font: LoadedFont<AnyRasterTechnique>): void {
    for (const referenceId of this.#fontResourceReferences.get(font) ?? []) {
      const retained = this.#resources.get(referenceId);
      retained?.owners.delete(font);
      if (retained?.owners.size === 0) this.#resources.delete(referenceId);
    }
    this.#fontResourceReferences.delete(font);
    this.#fontDisposeObservers.delete(font);
    this.#bindingHandles.delete(font);
  }

  #allocateBindingHandle(): number {
    return allocateHandle(this.#nextBindingHandle, (next) => (this.#nextBindingHandle = next), 'font binding');
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
  }
  return coordinator;
}

function allocateHandle(current: number, setNext: (next: number) => void, label: string): number {
  if (!Number.isSafeInteger(current) || current <= 0 || current > MAX_U32) {
    throw new RangeError(`${label} handles are exhausted`);
  }
  setNext(current === MAX_U32 ? MAX_U32 + 1 : current + 1);
  return current;
}
