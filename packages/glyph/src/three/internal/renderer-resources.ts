import type { Codec } from '../../config/glyph.js';
import type { CodecIdFactory } from '../../config/codec.js';
import type { ThreeCodec } from '../handle.js';
import type { ThreeTextMaterial } from '../material.js';
import {
  compiledThreeRasterPrograms,
  releaseThreeRasterProgramSnapshot,
  type CompiledThreeRasterProgram,
} from './raster-program-registry.js';

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

interface ThreeCodecState {
  readonly programs: ReadonlyMap<string, CompiledThreeRasterProgram>;
  readonly resources: ThreeRendererResources;
}

const threeCodecStates = new WeakMap<ThreeCodec, ThreeCodecState>();

export function createThreeCodec(
  ids: CodecIdFactory,
  transformMode: 'direct' | 'indexed',
  descriptor: (programs: readonly CompiledThreeRasterProgram[]) => Codec['descriptor'],
  material: ThreeTextMaterial | undefined,
): ThreeCodec {
  const programs = compiledThreeRasterPrograms(ids, transformMode);
  const resources = new ThreeRendererResources(
    new Map(programs.map((program) => [program.raster.id, program])),
    material,
  );
  let disposed = false;
  const codec: ThreeCodec = Object.freeze({
    descriptor: descriptor(programs),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      try {
        resources.dispose();
      } finally {
        releaseThreeRasterProgramSnapshot(ids);
      }
    },
  });
  threeCodecStates.set(codec, Object.freeze({ programs: resources.programs, resources }));
  return codec;
}

export function threeCodecResources(codec: ThreeCodec): ThreeRendererResources {
  const state = threeCodecStates.get(codec);
  if (state === undefined) throw new TypeError('Codec was not created by the Glyph Three config');
  return state.resources;
}

/** Handle-owned renderer-only state shared by sibling Three roots. */
export class ThreeRendererResources {
  readonly programs: ReadonlyMap<string, CompiledThreeRasterProgram>;
  readonly material: ThreeTextMaterial | undefined;
  readonly #renderResources = new Map<object, RetainedThreeRenderResource>();
  #disposed = false;

  constructor(programs: ReadonlyMap<string, CompiledThreeRasterProgram>, material: ThreeTextMaterial | undefined) {
    this.programs = programs;
    this.material = material;
  }

  rasterProgram(techniqueId: string): CompiledThreeRasterProgram | undefined {
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
