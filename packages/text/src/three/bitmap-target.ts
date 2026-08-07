import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import type {
  GlyphBatchKey,
  ParagraphId,
  PreparedGlyphBatch,
  PreparedParagraphBatchRevision,
} from '../paragraph-batch.js';
import type { ParagraphBatchTarget, ParagraphBatchTargetUpdate } from '../paragraph-batch-attachment.js';
import { bitmap, type BitmapPageData } from '../raster/bitmap-technique.js';
import { bitmapShader } from './bitmap-shader.js';
import {
  instanceStorageBytes,
  invalidatePboTexture,
  retainedRunIdentities,
  RetainedThreeGpuBytes,
  RetainedThreeTargetRevision,
  type RetainedThreeTargetResource,
} from './retained-target.js';

export interface ThreeBitmapTargetOwner {
  objectForParagraph(paragraph: ParagraphId): THREE.Object3D;
  readonly renderOrderBase: number;
}

interface BitmapTargetResource extends RetainedThreeTargetResource<typeof bitmap> {
  readonly key: GlyphBatchKey;
  readonly capacity: number;
  readonly gpuBytes: number;
  readonly material: THREE.MeshBasicNodeMaterial;
  readonly attributes: readonly THREE.StorageInstancedBufferAttribute[];
  update(batch: PreparedGlyphBatch<typeof bitmap>): void;
  geometry(count: number): THREE.InstancedBufferGeometry;
  dispose(): void;
}

export class ThreeBitmapTargetRevision extends RetainedThreeTargetRevision<typeof bitmap, BitmapTargetResource> {}

export class ThreeBitmapTarget<Variant> implements ParagraphBatchTarget<
  typeof bitmap,
  Variant,
  ThreeBitmapTargetRevision
> {
  readonly technique: typeof bitmap = bitmap;
  readonly #owner: ThreeBitmapTargetOwner;
  readonly #textures = new Map<string, THREE.DataTexture>();
  readonly #gpuBytes = new RetainedThreeGpuBytes<typeof bitmap, BitmapTargetResource>();
  #disposed = false;

  constructor(owner: ThreeBitmapTargetOwner) {
    this.#owner = owner;
  }

  get gpuBytes(): number {
    return this.#gpuBytes.total;
  }

  stage(
    previous: ThreeBitmapTargetRevision | undefined,
    next: PreparedParagraphBatchRevision<typeof bitmap, Variant>,
  ): ParagraphBatchTargetUpdate<ThreeBitmapTargetRevision> {
    if (this.#disposed) throw new Error('Three bitmap target has been disposed');
    if (previous?.canReuse(next) === true) {
      let finished = false;
      return {
        status: 'ready',
        stage: {
          sourceRevision: next.revision,
          commit: () => {
            if (finished) throw new Error('Three bitmap stage is no longer active');
            finished = true;
            const state = previous.transfer(next, this.#owner.renderOrderBase);
            return this.#gpuBytes.retain(
              new ThreeBitmapTargetRevision(next.revision, state.draws, state.resources, state.runIdentities),
            );
          },
          abort: () => {
            finished = true;
          },
        },
      };
    }
    const resources = new Map<GlyphBatchKey, BitmapTargetResource>();
    const draws: THREE.Mesh[] = [];
    try {
      for (const batch of next.glyphBatches) resources.set(batch.key, this.#createResource(batch));
      for (let index = 0; index < next.glyphRuns.length; index += 1) {
        const run = next.glyphRuns[index]!;
        const resource = resources.get(run.batch);
        if (resource === undefined) throw new Error('bitmap run references an unknown physical batch');
        const mesh = new THREE.Mesh(resource.geometry(run.count), resource.material);
        mesh.userData.pmndrsTextRunStart = run.start;
        mesh.frustumCulled = false;
        mesh.renderOrder = this.#owner.renderOrderBase + index;
        draws.push(mesh);
      }
      let finished = false;
      return {
        status: 'ready' as const,
        stage: {
          sourceRevision: next.revision,
          commit: () => {
            if (finished) throw new Error('Three bitmap stage is no longer active');
            finished = true;
            for (let index = 0; index < draws.length; index += 1) {
              this.#owner.objectForParagraph(next.glyphRuns[index]!.paragraph).add(draws[index]!);
            }
            return this.#gpuBytes.retain(
              new ThreeBitmapTargetRevision(next.revision, draws, resources, retainedRunIdentities(next)),
            );
          },
          abort: () => {
            if (finished) return;
            finished = true;
            disposeStaged(draws, resources.values());
          },
        },
      };
    } catch (error) {
      disposeStaged(draws, resources.values());
      throw error;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const texture of this.#textures.values()) texture.dispose();
    this.#textures.clear();
    this.#gpuBytes.release();
  }

  #createResource(batch: PreparedGlyphBatch<typeof bitmap>): BitmapTargetResource {
    const page = batch.font.data.strikes[batch.binding.strike]?.pages[batch.binding.page];
    if (page === undefined) throw new TypeError('bitmap binding references a missing decoded page');
    const texture = this.#texture(page);
    return createBitmapTargetResource(batch, texture);
  }

  #texture(page: BitmapPageData): THREE.DataTexture {
    let texture = this.#textures.get(page.resource);
    if (texture !== undefined) return texture;
    texture = new THREE.DataTexture(page.bytes, page.width, page.height, THREE.RedFormat, THREE.UnsignedByteType);
    texture.colorSpace = THREE.NoColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.flipY = false;
    texture.needsUpdate = true;
    this.#textures.set(page.resource, texture);
    this.#gpuBytes.addShared(page.bytes.byteLength);
    return texture;
  }
}

function createBitmapTargetResource(
  batch: PreparedGlyphBatch<typeof bitmap>,
  texture: THREE.DataTexture,
): BitmapTargetResource {
  const storage = batch.storage;
  const origins = storageAttribute(storage.origins, 2);
  const sizes = storageAttribute(storage.sizes, 2);
  const uvOrigins = storageAttribute(storage.uvOrigins, 2);
  const uvSizes = storageAttribute(storage.uvSizes, 2);
  const colors = storageAttribute(storage.colors, 4);
  const attributes = [origins, sizes, uvOrigins, uvSizes, colors] as const;
  const runStart = TSL.uniform(0, 'uint').onObjectUpdate(
    ({ object }) => (object?.userData.pmndrsTextRunStart as number | undefined) ?? 0,
  );
  const instance = TSL.instanceIndex.add(runStart);
  const shader = bitmapShader(
    {
      origin: TSL.storage(origins, 'vec2', origins.count).setPBO(true).element(instance),
      size: TSL.storage(sizes, 'vec2', sizes.count).setPBO(true).element(instance),
      uvOrigin: TSL.storage(uvOrigins, 'vec2', uvOrigins.count).setPBO(true).element(instance),
      uvSize: TSL.storage(uvSizes, 'vec2', uvSizes.count).setPBO(true).element(instance),
      color: TSL.storage(colors, 'vec4', colors.count).setPBO(true).element(instance),
    },
    { page: texture },
  );
  const material = new THREE.MeshBasicNodeMaterial({
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    transparent: true,
  });
  material.positionNode = shader.position;
  material.vertexNode = shader.clipPosition;
  material.colorNode = shader.color;
  material.opacityNode = shader.opacity;

  return {
    key: batch.key,
    capacity: batch.capacity,
    gpuBytes: instanceStorageBytes(attributes),
    material,
    attributes,
    update(next) {
      updateStorageAttribute(origins, next.storage.origins, 2, next.dirtyRanges);
      updateStorageAttribute(sizes, next.storage.sizes, 2, next.dirtyRanges);
      updateStorageAttribute(uvOrigins, next.storage.uvOrigins, 2, next.dirtyRanges);
      updateStorageAttribute(uvSizes, next.storage.uvSizes, 2, next.dirtyRanges);
      updateStorageAttribute(colors, next.storage.colors, 4, next.dirtyRanges);
    },
    geometry(count) {
      const geometry = unitQuad();
      geometry.instanceCount = count;
      geometry.setAttribute('_pmndrsTextOrigins', origins);
      geometry.setAttribute('_pmndrsTextSizes', sizes);
      geometry.setAttribute('_pmndrsTextUvOrigins', uvOrigins);
      geometry.setAttribute('_pmndrsTextUvSizes', uvSizes);
      geometry.setAttribute('_pmndrsTextColors', colors);
      return geometry;
    },
    dispose() {
      material.dispose();
    },
  };
}

function updateStorageAttribute(
  attribute: THREE.StorageInstancedBufferAttribute,
  source: Float32Array,
  itemSize: number,
  ranges: readonly { readonly start: number; readonly count: number }[],
): void {
  if (ranges.length === 0) return;
  const target = attribute.array as Float32Array;
  attribute.clearUpdateRanges();
  for (const range of ranges) {
    const start = range.start * itemSize;
    const count = range.count * itemSize;
    target.set(source.subarray(start, start + count), start);
    attribute.addUpdateRange(start, count);
  }
  attribute.needsUpdate = true;
  invalidatePboTexture(attribute);
}

function storageAttribute(array: Float32Array, itemSize: number): THREE.StorageInstancedBufferAttribute {
  const copy = new Float32Array(array);
  const attribute = new THREE.StorageInstancedBufferAttribute(copy, itemSize);
  attribute.setUsage(THREE.DynamicDrawUsage);
  attribute.needsUpdate = true;
  return attribute;
}

function unitQuad(): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0], 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
  return geometry;
}

function disposeStaged(draws: readonly THREE.Mesh[], resources: Iterable<BitmapTargetResource>): void {
  for (const draw of draws) draw.geometry.dispose();
  for (const resource of resources) resource.dispose();
}
