import type { Codec } from '../../config/glyph.js';
import type { CodecIdFactory } from '../../config/codec.js';
import type { ThreeTextMaterial } from '../material.js';
import {
  compiledThreeRasterPlanPrograms,
  releaseThreeRasterPlanProgramSnapshot,
  type CompiledThreeRasterPlanProgram,
} from './plan-program-registry.js';

interface DisposableThreeRenderResource {
  dispose(): void;
}

interface RetainedThreeRenderResource {
  readonly resource: DisposableThreeRenderResource;
  references: number;
}

export interface ThreeRenderResourceLease<Resource extends DisposableThreeRenderResource> {
  readonly resource: Resource;
  dispose(): void;
}

/** Exact Codec value created once for one Three handle. */
export interface ThreeCodec extends Codec {
  readonly programs: ReadonlyMap<string, CompiledThreeRasterPlanProgram>;
  readonly resources: ThreeRendererResources;
}

export function createThreeCodec(
  ids: CodecIdFactory,
  transformMode: 'direct' | 'indexed',
  descriptor: (programs: readonly CompiledThreeRasterPlanProgram[]) => Codec['descriptor'],
  material: ThreeTextMaterial | undefined,
): ThreeCodec {
  const programs = compiledThreeRasterPlanPrograms(ids, transformMode);
  const resources = new ThreeRendererResources(
    new Map(programs.map((program) => [program.raster.id, program])),
    material,
  );
  let disposed = false;
  return Object.freeze({
    descriptor: descriptor(programs),
    programs: resources.programs,
    resources,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      try {
        resources.dispose();
      } finally {
        releaseThreeRasterPlanProgramSnapshot(ids);
      }
    },
  });
}

/** Handle-owned renderer-only state shared by sibling Three roots. */
export class ThreeRendererResources {
  readonly programs: ReadonlyMap<string, CompiledThreeRasterPlanProgram>;
  readonly material: ThreeTextMaterial | undefined;
  readonly #renderResources = new Map<object, RetainedThreeRenderResource>();
  #disposed = false;

  constructor(programs: ReadonlyMap<string, CompiledThreeRasterPlanProgram>, material: ThreeTextMaterial | undefined) {
    this.programs = programs;
    this.material = material;
  }

  planProgram(techniqueId: string): CompiledThreeRasterPlanProgram | undefined {
    return this.programs.get(techniqueId);
  }

  acquireRenderResource<Resource extends DisposableThreeRenderResource>(
    key: object,
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

  get sharedRenderResourceCount(): number {
    return this.#renderResources.size;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    let failure: unknown;
    for (const retained of this.#renderResources.values()) {
      try {
        retained.resource.dispose();
      } catch (error) {
        failure ??= error;
      }
    }
    this.#renderResources.clear();
    if (failure !== undefined) throw failure;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('Three renderer resources have been disposed');
  }
}
