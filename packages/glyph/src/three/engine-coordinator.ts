import type { Font } from '../font.js';
import { createFontStack, immutableFontSelectionFonts, type FontSelection, type FontStack } from '../loaded-font.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import { bitmap } from '../raster/bitmap-technique.js';
import { msdf } from '../raster/msdf.js';
import { slug } from '../raster/slug-technique.js';
import type { GlyphEngine } from '../glyph-engine.js';
import {
  type BackendFontStackBinding,
  type BackendMaterialBinding,
  type BackendPolicy,
  type BackendTransformBinding,
  type Codec,
  type EncodeContext,
  type PolicyBufferId,
  type PolicyCapabilitySet,
  type PortableResource,
  type RenderIdFactory,
  type RenderPlanBufferBinding,
  type GlyphBackend,
} from '../core.js';
import { TRANSFORM_BUFFER_ID, threeRenderPolicyDescriptor, type ThreeTransformMode } from './render-policy.js';
import type { ThreeTextMaterial } from './material.js';
import {
  compiledThreeRasterPlanPrograms,
  releaseThreeRasterPlanProgramSnapshot,
  type CompiledThreeRasterPlanProgram,
} from './plan-program-registry.js';
import type * as THREE from 'three/webgpu';
import type { ThreeGlyphConfig } from './handle.js';

const builtInThreeTechniques = new Set<string>([bitmap.id, msdf.id, slug.id]);

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

interface ThreeConfigEncode {
  encode(context: EncodeContext): Codec;
}

/** Counted Three material binding; dispose releases this lease without disposing the material. */
export interface ThreeMaterialBindingLease {
  readonly binding: BackendMaterialBinding;
  dispose(): void;
}

interface RetainedThreeMaterialBinding {
  readonly binding: BackendMaterialBinding;
  readonly material: ThreeTextMaterial;
  references: number;
}

interface DisposableThreeRenderResource {
  dispose(): void;
}

interface RetainedThreeRenderResource {
  readonly resource: DisposableThreeRenderResource;
  references: number;
}

/** @internal Counted lease for a coordinator-shared GPU resource. */
export interface ThreeRenderResourceLease<Resource extends DisposableThreeRenderResource> {
  readonly resource: Resource;
  dispose(): void;
}

/** Three-owned backend, policy, and opaque renderer-binding domain over one glyph engine. */
export class ThreeTextEngineCoordinator {
  readonly backend: GlyphBackend;
  readonly policy: BackendPolicy;
  readonly capabilitySet: PolicyCapabilitySet;
  /** @internal Collision-checked static identities captured while installing this renderer policy. */
  readonly identities: RenderIdFactory;
  readonly config: ThreeGlyphConfig | undefined;
  readonly #planPrograms: ReadonlyMap<string, CompiledThreeRasterPlanProgram>;
  readonly #policyBufferIds: ReadonlyMap<number, ReadonlyMap<number, PolicyBufferId>>;
  readonly #singleFontStacks = new WeakMap<
    Font<AnyRasterTechnique>,
    FontStack<AnyRasterTechnique, Font<AnyRasterTechnique>>
  >();
  readonly #materialBindings = new WeakMap<ThreeTextMaterial, RetainedThreeMaterialBinding>();
  readonly #materials = new WeakMap<BackendMaterialBinding, ThreeTextMaterial>();
  readonly #transforms = new WeakMap<BackendTransformBinding, THREE.Object3D>();
  readonly #renderResources = new Map<string, RetainedThreeRenderResource>();
  #applyingPlan = false;
  #disposed = false;

  constructor(glyphEngine: GlyphEngine, options: ThreeTextEngineCoordinatorOptions = {}, config?: ThreeConfigEncode) {
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      throw new TypeError('Three text engine coordinator options need an object');
    }
    const transformMode = options.transformMode ?? 'indexed';
    if (transformMode !== 'indexed' && transformMode !== 'direct') {
      throw new TypeError('Three text engine transform mode must be "indexed" or "direct"');
    }
    const backend = glyphEngine.createBackend({ integration: '@pmndrs/glyph/three' });
    let snapshot = false;
    let policy: BackendPolicy | undefined;
    let identities: RenderIdFactory | undefined;
    let planPrograms: readonly CompiledThreeRasterPlanProgram[] | undefined;
    let descriptor: ReturnType<typeof threeRenderPolicyDescriptor> | undefined;
    try {
      policy = backend.installPolicy((backendIdentities) => {
        identities = backendIdentities;
        if (config === undefined) {
          planPrograms = compiledThreeRasterPlanPrograms(backendIdentities, transformMode);
          snapshot = true;
          descriptor = threeRenderPolicyDescriptor(
            backendIdentities,
            transformMode,
            planPrograms.map((program) => program.policy),
          );
        } else {
          const codec = config.encode({ integration: '@pmndrs/glyph/three', ids: backendIdentities });
          if (typeof codec !== 'object' || codec === null || Array.isArray(codec)) {
            throw new TypeError('ThreeConfig.encode() must return a Codec');
          }
          const configuredTransformMode = codec.descriptor.programs.some((program) =>
            program.buffers.some((buffer) => buffer.id === TRANSFORM_BUFFER_ID),
          )
            ? 'indexed'
            : 'direct';
          planPrograms = compiledThreeRasterPlanPrograms(backendIdentities, configuredTransformMode);
          snapshot = true;
          descriptor = {
            ...codec.descriptor,
            programs: [...codec.descriptor.programs, ...planPrograms.map((program) => program.policy)],
          };
        }
        return descriptor;
      });
    } catch (error) {
      if (snapshot && identities !== undefined) releaseThreeRasterPlanProgramSnapshot(identities);
      backend.dispose();
      throw error;
    }
    if (identities === undefined || planPrograms === undefined || descriptor === undefined) {
      policy.dispose();
      backend.dispose();
      throw new Error('Three policy factory did not produce its retained policy state');
    }
    this.identities = identities;
    this.#planPrograms = new Map(planPrograms.map((program) => [program.technique.id, program]));
    this.#policyBufferIds = policyBufferIds(descriptor.programs);
    this.capabilitySet = descriptor.capabilitySets[0]!;
    this.backend = backend;
    this.policy = policy;
    this.config = config as ThreeGlyphConfig | undefined;
  }

  bindFontStack(selection: FontSelection<AnyRasterTechnique>): BackendFontStackBinding {
    this.#assertActive();
    const fonts = immutableFontSelectionFonts(selection);
    for (const font of fonts) {
      if (!this.#planPrograms.has(font.technique.id) && !builtInThreeTechniques.has(font.technique.id)) {
        throw new TypeError(`Three has no registered renderer variant for portable technique "${font.technique.id}"`);
      }
    }
    let stack: FontStack<AnyRasterTechnique, Font<AnyRasterTechnique>>;
    if ('fonts' in selection) {
      stack = selection as FontStack<AnyRasterTechnique, Font<AnyRasterTechnique>>;
    } else {
      const font = fonts[0];
      stack = this.#singleFontStacks.get(font) ?? createFontStack(font);
      this.#singleFontStacks.set(font, stack);
    }
    return this.backend.bindFontStack(stack);
  }

  acquireMaterial(material: ThreeTextMaterial): ThreeMaterialBindingLease {
    this.#assertActive();
    let retained = this.#materialBindings.get(material);
    if (retained === undefined) {
      const binding = this.backend.createMaterialBinding();
      retained = { binding, material, references: 0 };
      this.#materialBindings.set(material, retained);
      this.#materials.set(binding, material);
    }
    retained.references += 1;
    let disposed = false;
    return Object.freeze({
      binding: retained.binding,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        retained.references -= 1;
        if (retained.references !== 0) return;
        this.#materialBindings.delete(material);
        this.#materials.delete(retained.binding);
        retained.binding.dispose();
      },
    });
  }

  resolveMaterial(binding: BackendMaterialBinding): ThreeTextMaterial {
    const material = this.#materials.get(binding);
    if (material === undefined) throw new TypeError('render plan resolved an unknown Three material binding');
    return material;
  }

  bindTransform(object: THREE.Object3D): BackendTransformBinding {
    this.#assertActive();
    const binding = this.backend.createTransformBinding();
    this.#transforms.set(binding, object);
    return binding;
  }

  resolveTransform(binding: BackendTransformBinding): THREE.Object3D {
    const object = this.#transforms.get(binding);
    if (object === undefined) throw new TypeError('render plan resolved an unknown Three transform binding');
    return object;
  }

  /** @internal Shares immutable atlas/page GPU resources across live plan executors. */
  acquireRenderResource<Resource extends DisposableThreeRenderResource>(
    key: string,
    create: () => Resource,
  ): ThreeRenderResourceLease<Resource> {
    this.#assertActive();
    let retained = this.#renderResources.get(key);
    if (retained === undefined) {
      retained = { resource: create(), references: 0 };
      this.#renderResources.set(key, retained);
    }
    retained.references += 1;
    let disposed = false;
    const exact = retained;
    return Object.freeze({
      // The key is authored by the renderer integration and partitions resource kinds. A key is
      // acquired through one factory type for the coordinator's lifetime.
      resource: exact.resource as Resource,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        exact.references -= 1;
        if (exact.references !== 0 || this.#renderResources.get(key) !== exact) return;
        this.#renderResources.delete(key);
        exact.resource.dispose();
      },
    });
  }

  /** @internal Test evidence for shared renderer-resource lifetime. */
  get sharedRenderResourceCount(): number {
    return this.#renderResources.size;
  }

  planProgram(techniqueId: string): CompiledThreeRasterPlanProgram | undefined {
    return this.#planPrograms.get(techniqueId);
  }

  assertFrameUpdateAllowed(): void {
    this.#assertActive();
    if (this.#applyingPlan) throw new Error('text updates and queries cannot reenter Three render-plan application');
  }

  applyPlan<Result>(apply: () => Result): Result {
    this.#assertActive();
    if (this.#applyingPlan) throw new Error('Three render-plan application cannot be reentered');
    this.#applyingPlan = true;
    try {
      return apply();
    } finally {
      this.#applyingPlan = false;
    }
  }

  /** Resolve a decoded wire value through the exact policy program that declared it. */
  resolveBufferBindingId(programId: number, binding: RenderPlanBufferBinding): PolicyBufferId | 'order' {
    if (binding.kind === 'order') return 'order';
    const bufferId = this.#policyBufferIds.get(programId)?.get(binding.id);
    if (bufferId === undefined) {
      throw new TypeError(`Three policy program ${programId} does not declare buffer ${binding.id}`);
    }
    return bufferId;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    let failure: unknown;
    try {
      this.policy.dispose();
    } catch (error) {
      failure = error;
    }
    try {
      this.backend.dispose();
    } catch (error) {
      failure ??= error;
    }
    for (const retained of this.#renderResources.values()) {
      try {
        retained.resource.dispose();
      } catch (error) {
        failure ??= error;
      }
    }
    this.#renderResources.clear();
    releaseThreeRasterPlanProgramSnapshot(this.identities);
    if (failure !== undefined) throw failure;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('Three text engine coordinator is disposed');
  }
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
