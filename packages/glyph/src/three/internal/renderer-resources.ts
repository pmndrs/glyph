import type * as THREE from 'three/webgpu';

import type { Codec } from '../../config/glyph.js';
import type { CodecIdFactory } from '../../config/codec.js';
import type { PortableResourceGroupPayload, PortableTextureArrayPayload } from '../../config/resources.js';
import type { TslSlugPageResources } from '../../shaders/tsl/index.js';
import type { ThreeShaderSet } from './shader-set.js';
import type { ThreeCodec } from '../schema.js';
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

/**
 * One MSDF font's GPU state: an atlas holding only the glyphs that have been drawn, and the per-glyph table that
 * says where each one is.
 */
export interface RetainedMsdfAtlas {
  readonly texture: THREE.DataArrayTexture;
  /** `rgba32float`, one texel per baked glyph record: `[left, top, width, height + layer * 4096]` in atlas texels. */
  readonly glyphs: THREE.DataTexture;
  readonly glyphsWidth: number;
  /** `(atlas width, atlas height, field range in texels, plane units per em over field range)`. */
  readonly metrics: THREE.Vector4;
  /** The texture holds only the true distance, in its red channel. */
  readonly singleChannel: boolean;
  readonly byteLength: number;
  /**
   * Makes the atlas cells of the glyph rows in `lane` resident. `lane` holds `stride` values per instance with the
   * glyph table row last; `start` and `end` are instance indices.
   */
  use(lane: Float32Array, start: number, end: number, stride: number): void;
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
  shaders: ThreeShaderSet,
  msdfSingleChannel = false,
): ThreeCodec {
  const programs = compiledThreeRasterPrograms(ids, transformMode);
  const resources = new ThreeRendererResources(
    new Map(programs.map((program) => [program.raster.id, program])),
    material,
    shaders,
    msdfSingleChannel,
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
  readonly #msdfAtlases = new Map<PortableResourceGroupPayload, RetainedThreeRenderResource<RetainedMsdfAtlas>>();
  #disposed = false;

  constructor(
    programs: ReadonlyMap<string, CompiledThreeRasterProgram>,
    material: ThreeTextMaterial | undefined,
    readonly shaders: ThreeShaderSet,
    /** MSDF atlases of this handle keep only the true-distance channel. */
    readonly msdfSingleChannel = false,
  ) {
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

  acquireMsdfAtlasResource(
    key: PortableResourceGroupPayload,
    create: () => RetainedMsdfAtlas,
  ): ThreeRenderResourceLease<RetainedMsdfAtlas> {
    this.#assertActive();
    return acquireRenderResource(this.#msdfAtlases, key, create);
  }

  get sharedRenderResourceCount(): number {
    return this.#textureArrays.size + this.#slugPages.size + this.#msdfAtlases.size;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const textureFailure = disposeRenderResources(this.#textureArrays);
    const slugFailure = disposeRenderResources(this.#slugPages);
    const msdfFailure = disposeRenderResources(this.#msdfAtlases);
    const failure = textureFailure ?? slugFailure ?? msdfFailure;
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
