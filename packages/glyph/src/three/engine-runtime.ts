import type { Font } from '../font.js';
import { createFontStack, immutableFontSelectionFonts, type FontSelection, type FontStack } from '../loaded-font.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import { bitmap } from '../raster/bitmap-technique.js';
import { msdf } from '../raster/msdf.js';
import { slug } from '../raster/slug-technique.js';
import type { TextRuntime } from '../text-runtime.js';
import {
  type HostFontStackBinding,
  type HostMaterialBinding,
  type HostPolicy,
  type HostTransformBinding,
  type PolicyBufferId,
  type PolicyCapabilitySet,
  type PortableResource,
  type RenderWireIdentityRegistry,
  type TextEngineBufferBinding,
  type TextEngineHost,
} from '../core.js';
import { threeRenderPolicyDescriptor, type ThreeTransformMode } from './render-policy.js';
import type { ThreeTextMaterial } from './material.js';
import {
  compiledThreeRasterPlanPrograms,
  releaseThreeRasterPlanProgramSnapshot,
  type CompiledThreeRasterPlanProgram,
} from './plan-program-registry.js';
import type * as THREE from 'three/webgpu';

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

/** Counted Three material binding; dispose releases this lease without disposing the material. */
export interface ThreeMaterialBindingLease {
  readonly binding: HostMaterialBinding;
  dispose(): void;
}

interface RetainedThreeMaterialBinding {
  readonly binding: HostMaterialBinding;
  readonly material: ThreeTextMaterial;
  references: number;
}

/** Three-owned host, policy, and opaque renderer-binding domain over one text runtime. */
export class ThreeTextEngineCoordinator {
  readonly host: TextEngineHost;
  readonly policy: HostPolicy;
  readonly capabilitySet: PolicyCapabilitySet;
  /** @internal Collision-checked static identities captured while installing this renderer policy. */
  readonly identities: RenderWireIdentityRegistry;
  readonly #planPrograms: ReadonlyMap<string, CompiledThreeRasterPlanProgram>;
  readonly #policyBufferIds: ReadonlyMap<number, ReadonlyMap<number, PolicyBufferId>>;
  readonly #singleFontStacks = new WeakMap<
    Font<AnyRasterTechnique>,
    FontStack<AnyRasterTechnique, Font<AnyRasterTechnique>>
  >();
  readonly #materialBindings = new WeakMap<ThreeTextMaterial, RetainedThreeMaterialBinding>();
  readonly #materials = new WeakMap<HostMaterialBinding, ThreeTextMaterial>();
  readonly #transforms = new WeakMap<HostTransformBinding, THREE.Object3D>();
  #applyingPlan = false;
  #disposed = false;

  constructor(runtime: TextRuntime, options: ThreeTextEngineCoordinatorOptions = {}) {
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      throw new TypeError('Three text engine coordinator options need an object');
    }
    const transformMode = options.transformMode ?? 'indexed';
    if (transformMode !== 'indexed' && transformMode !== 'direct') {
      throw new TypeError('Three text engine transform mode must be "indexed" or "direct"');
    }
    const host = runtime.createTextEngineHost({ integration: '@pmndrs/glyph/three' });
    let snapshot = false;
    let policy: HostPolicy | undefined;
    let identities: RenderWireIdentityRegistry | undefined;
    let planPrograms: readonly CompiledThreeRasterPlanProgram[] | undefined;
    let descriptor: ReturnType<typeof threeRenderPolicyDescriptor> | undefined;
    try {
      policy = host.installPolicy((hostIdentities) => {
        identities = hostIdentities;
        planPrograms = compiledThreeRasterPlanPrograms(hostIdentities, transformMode);
        snapshot = true;
        descriptor = threeRenderPolicyDescriptor(
          hostIdentities,
          transformMode,
          planPrograms.map((program) => program.policy),
        );
        return descriptor;
      });
    } catch (error) {
      if (snapshot && identities !== undefined) releaseThreeRasterPlanProgramSnapshot(identities);
      host.dispose();
      throw error;
    }
    if (identities === undefined || planPrograms === undefined || descriptor === undefined) {
      policy.dispose();
      host.dispose();
      throw new Error('Three policy factory did not produce its retained policy state');
    }
    this.identities = identities;
    this.#planPrograms = new Map(planPrograms.map((program) => [program.technique.id, program]));
    this.#policyBufferIds = policyBufferIds(descriptor.programs);
    this.capabilitySet = descriptor.capabilitySets[0]!;
    this.host = host;
    this.policy = policy;
  }

  bindFontStack(selection: FontSelection<AnyRasterTechnique>): HostFontStackBinding {
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
    return this.host.bindFontStack(stack);
  }

  acquireMaterial(material: ThreeTextMaterial): ThreeMaterialBindingLease {
    this.#assertActive();
    let retained = this.#materialBindings.get(material);
    if (retained === undefined) {
      const binding = this.host.createMaterialBinding();
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

  resolveMaterial(binding: HostMaterialBinding): ThreeTextMaterial {
    const material = this.#materials.get(binding);
    if (material === undefined) throw new TypeError('render plan resolved an unknown Three material binding');
    return material;
  }

  bindTransform(object: THREE.Object3D): HostTransformBinding {
    this.#assertActive();
    const binding = this.host.createTransformBinding();
    this.#transforms.set(binding, object);
    return binding;
  }

  resolveTransform(binding: HostTransformBinding): THREE.Object3D {
    const object = this.#transforms.get(binding);
    if (object === undefined) throw new TypeError('render plan resolved an unknown Three transform binding');
    return object;
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
  resolveBufferBindingId(programId: number, binding: TextEngineBufferBinding): PolicyBufferId | 'order' {
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
      this.host.dispose();
    } catch (error) {
      failure ??= error;
    }
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
