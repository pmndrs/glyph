import type { LoadedFont } from '../loaded-font.js';
import { bitmap, type BitmapData, type BitmapPageData } from '../raster/bitmap-technique.js';
import { msdf, type MsdfData } from '../raster/msdf.js';
import { slug, type SlugData, type SlugPageData } from '../raster/slug-technique.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import type { TextRuntime } from '../text-runtime.js';
import { firstPartyFontBindingBytes } from '../internal/font-binding-wire.js';
import { firstPartyThreeRenderPolicyBytes, type ThreeTransformMode } from '../internal/render-policy-wire.js';
import { TextEngineHost, type TextEngineSession, type TextEngineSessionOptions } from '../internal/text-engine-host.js';
import type { ThreeTextMaterial } from './material.js';

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

export type ThreeTextEngineResource =
  | Readonly<{ technique: typeof bitmap.id; page: BitmapPageData }>
  | Readonly<{ technique: typeof msdf.id; data: MsdfData }>
  | Readonly<{ technique: typeof slug.id; page: SlugPageData }>;

export interface ThreeTextEngineCoordinatorOptions {
  /** Renderer-policy choice; indexed is the first-party high-throughput default. */
  readonly transformMode?: ThreeTransformMode;
}

/** Three-owned cold registrations shared by every text batch using one renderer-neutral runtime. */
export class ThreeTextEngineCoordinator {
  readonly host: TextEngineHost;
  readonly #bindingHandles = new WeakMap<LoadedFont<AnyRasterTechnique>, number>();
  readonly #resources = new Map<number, ThreeTextEngineResource>();
  readonly #stacks = new Map<string, RetainedStack>();
  readonly #materialHandles = new WeakMap<ThreeTextMaterial, RetainedMaterial>();
  readonly #materials = new Map<number, RetainedMaterial>();
  #nextBindingHandle = 1;
  #nextStackHandle = 1;
  #nextSessionHandle = 1;
  #nextMaterialHandle = 1;
  #disposed = false;

  constructor(runtime: Pick<TextRuntime, 'shaper'>, options: ThreeTextEngineCoordinatorOptions = {}) {
    this.host = new TextEngineHost(runtime.shaper);
    this.host.registerPolicy(
      POLICY_HANDLE,
      firstPartyThreeRenderPolicyBytes(this.host.wireIdentities, options.transformMode),
    );
  }

  get policyHandle(): number {
    return POLICY_HANDLE;
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
    const resource = this.#resources.get(referenceId);
    if (resource === undefined) throw new Error(`Three text command buffer references unknown resource ${referenceId}`);
    return resource;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.host.dispose();
    this.#stacks.clear();
    this.#materials.clear();
    this.#disposed = true;
  }

  #bindingHandle(font: LoadedFont<AnyRasterTechnique>): number {
    if (font.disposed) throw new TypeError('cannot register a disposed loaded font with the Three text engine');
    const existing = this.#bindingHandles.get(font);
    if (existing !== undefined) return existing;
    const handle = this.#allocateBindingHandle();
    this.#registerResources(font);
    this.host.registerFontBinding(handle, font.font.handle, firstPartyFontBindingBytes(font, this.host.wireIdentities));
    this.#bindingHandles.set(font, handle);
    return handle;
  }

  #registerResources(font: LoadedFont<AnyRasterTechnique>): void {
    if (font.technique.id === bitmap.id) {
      const data = font.data as BitmapData;
      for (const strike of data.strikes) {
        for (const page of strike.pages) this.#retainResource(page.resource, { technique: bitmap.id, page });
      }
      return;
    }
    if (font.technique.id === msdf.id) {
      const data = font.data as MsdfData;
      this.#retainResource(data.resource, { technique: msdf.id, data });
      return;
    }
    if (font.technique.id === slug.id) {
      const data = font.data as SlugData;
      for (const page of data.pages) this.#retainResource(page.resource, { technique: slug.id, page });
      return;
    }
    throw new TypeError(`no first-party Three resource resolver is registered for "${font.technique.id}"`);
  }

  #retainResource(key: string, resource: ThreeTextEngineResource): void {
    const referenceId = this.host.wireIdentities.resolve(key);
    const existing = this.#resources.get(referenceId);
    if (existing !== undefined && existing.technique !== resource.technique) {
      throw new TypeError(`Three text resource ${referenceId} is registered for incompatible techniques`);
    }
    if (existing === undefined) this.#resources.set(referenceId, resource);
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
    coordinator = new ThreeTextEngineCoordinator(runtime);
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
