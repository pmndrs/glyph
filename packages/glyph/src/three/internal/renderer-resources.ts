import type * as THREE from 'three/webgpu';

import type { Codec } from '../../config/glyph.js';
import type { CodecIdFactory } from '../../config/codec.js';
import type { PortableResourceGroupPayload, PortableTextureArrayPayload } from '../../config/resources.js';
import type { TslSlugPageResources } from '../../tsl.js';
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

interface RetainedThreeRenderResource<Resource extends DisposableThreeRenderResource> {
  readonly resource: Resource;
  references: number;
}

export interface ThreeRenderResourceLease<Resource extends DisposableThreeRenderResource> {
  readonly resource: Resource;
  dispose(): void;
}

export interface RetainedSlugPage extends TslSlugPageResources {
  readonly byteLength: number;
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
  readonly #textureArrays = new Map<PortableTextureArrayPayload, RetainedThreeRenderResource<THREE.DataArrayTexture>>();
  readonly #slugPages = new Map<PortableResourceGroupPayload, RetainedThreeRenderResource<RetainedSlugPage>>();
  #disposed = false;

  constructor(programs: ReadonlyMap<string, CompiledThreeRasterProgram>, material: ThreeTextMaterial | undefined) {
    this.programs = programs;
    this.material = material;
  }

  rasterProgram(techniqueId: string): CompiledThreeRasterProgram | undefined {
    return this.programs.get(techniqueId);
  }

  acquireTextureArrayResource(
    key: PortableTextureArrayPayload,
    create: () => THREE.DataArrayTexture,
  ): ThreeRenderResourceLease<THREE.DataArrayTexture> {
    this.#assertActive();
    return acquireRenderResource(this.#textureArrays, key, create);
  }

  acquireSlugPageResource(
    key: PortableResourceGroupPayload,
    create: () => RetainedSlugPage,
  ): ThreeRenderResourceLease<RetainedSlugPage> {
    this.#assertActive();
    return acquireRenderResource(this.#slugPages, key, create);
  }

  get sharedRenderResourceCount(): number {
    return this.#textureArrays.size + this.#slugPages.size;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const textureFailure = disposeRenderResources(this.#textureArrays);
    const slugFailure = disposeRenderResources(this.#slugPages);
    const failure = textureFailure ?? slugFailure;
    if (failure !== undefined) throw failure;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('Three renderer resources have been disposed');
  }
}

function acquireRenderResource<Key extends object, Resource extends DisposableThreeRenderResource>(
  resources: Map<Key, RetainedThreeRenderResource<Resource>>,
  key: Key,
  create: () => Resource,
): ThreeRenderResourceLease<Resource> {
  let retained = resources.get(key);
  if (retained === undefined) {
    retained = { resource: create(), references: 0 };
    resources.set(key, retained);
  }
  retained.references += 1;
  let disposed = false;
  const exact = retained;
  return Object.freeze({
    resource: exact.resource,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      exact.references -= 1;
      if (exact.references !== 0 || resources.get(key) !== exact) return;
      resources.delete(key);
      exact.resource.dispose();
    },
  });
}

function disposeRenderResources<Key extends object, Resource extends DisposableThreeRenderResource>(
  resources: Map<Key, RetainedThreeRenderResource<Resource>>,
): unknown {
  let failure: unknown;
  for (const retained of resources.values()) {
    try {
      retained.resource.dispose();
    } catch (error) {
      failure ??= error;
    }
  }
  resources.clear();
  return failure;
}
