import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import type {
  GlyphBatchKey,
  ParagraphId,
  PreparedGlyphBatch,
  PreparedParagraphBatchRevision,
} from '../paragraph-batch.js';
import type { ParagraphBatchTarget, ParagraphBatchTargetUpdate } from '../paragraph-batch-attachment.js';
import { msdf, type MsdfData } from '../raster/msdf.js';
import { msdfShader } from './msdf-shader.js';
import {
  instanceStorageBytes,
  invalidatePboTexture,
  retainedRunIdentities,
  RetainedThreeGpuBytes,
  RetainedThreeTargetRevision,
  type RetainedThreeTargetResource,
} from './retained-target.js';

export interface ThreeMsdfTargetOwner {
  objectForParagraph(paragraph: ParagraphId): THREE.Object3D;
  readonly renderOrderBase: number;
}

interface MsdfTargetResource extends RetainedThreeTargetResource<typeof msdf> {
  readonly key: GlyphBatchKey;
  readonly capacity: number;
  readonly gpuBytes: number;
  readonly material: THREE.MeshBasicNodeMaterial;
  update(batch: PreparedGlyphBatch<typeof msdf>): void;
  geometry(count: number): THREE.InstancedBufferGeometry;
  dispose(): void;
}

export class ThreeMsdfTargetRevision extends RetainedThreeTargetRevision<typeof msdf, MsdfTargetResource> {}

export class ThreeMsdfTarget<Variant> implements ParagraphBatchTarget<typeof msdf, Variant, ThreeMsdfTargetRevision> {
  readonly technique: typeof msdf = msdf;
  readonly #owner: ThreeMsdfTargetOwner;
  readonly #atlases = new Map<string, THREE.DataArrayTexture>();
  readonly #gpuBytes = new RetainedThreeGpuBytes<typeof msdf, MsdfTargetResource>();
  #disposed = false;

  constructor(owner: ThreeMsdfTargetOwner) {
    this.#owner = owner;
  }

  get gpuBytes(): number {
    return this.#gpuBytes.total;
  }

  stage(
    previous: ThreeMsdfTargetRevision | undefined,
    next: PreparedParagraphBatchRevision<typeof msdf, Variant>,
  ): ParagraphBatchTargetUpdate<ThreeMsdfTargetRevision> {
    if (this.#disposed) throw new Error('Three MSDF target has been disposed');
    if (previous?.canReuse(next) === true) {
      let finished = false;
      return {
        status: 'ready',
        stage: {
          sourceRevision: next.revision,
          commit: () => {
            if (finished) throw new Error('Three MSDF stage is no longer active');
            finished = true;
            const state = previous.transfer(next, this.#owner.renderOrderBase);
            return this.#gpuBytes.retain(
              new ThreeMsdfTargetRevision(next.revision, state.draws, state.resources, state.runIdentities),
            );
          },
          abort: () => {
            finished = true;
          },
        },
      };
    }
    const resources = new Map<GlyphBatchKey, MsdfTargetResource>();
    const draws: THREE.Mesh[] = [];
    try {
      for (const batch of next.glyphBatches)
        resources.set(batch.key, createMsdfTargetResource(batch, this.#atlas(batch.font.data)));
      for (let index = 0; index < next.glyphRuns.length; index += 1) {
        const run = next.glyphRuns[index]!;
        const resource = resources.get(run.batch);
        if (resource === undefined) throw new Error('MSDF run references an unknown physical batch');
        const mesh = new THREE.Mesh(resource.geometry(run.count), resource.material);
        mesh.userData.pmndrsTextRunStart = run.start;
        mesh.frustumCulled = false;
        mesh.renderOrder = this.#owner.renderOrderBase + index;
        draws.push(mesh);
      }
      let finished = false;
      return {
        status: 'ready',
        stage: {
          sourceRevision: next.revision,
          commit: () => {
            if (finished) throw new Error('Three MSDF stage is no longer active');
            finished = true;
            for (let index = 0; index < draws.length; index += 1)
              this.#owner.objectForParagraph(next.glyphRuns[index]!.paragraph).add(draws[index]!);
            return this.#gpuBytes.retain(
              new ThreeMsdfTargetRevision(next.revision, draws, resources, retainedRunIdentities(next)),
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
    for (const atlas of this.#atlases.values()) atlas.dispose();
    this.#atlases.clear();
    this.#gpuBytes.release();
  }

  #atlas(data: MsdfData): THREE.DataArrayTexture {
    let atlas = this.#atlases.get(data.resource);
    if (atlas !== undefined) return atlas;
    const bytes = new Uint8Array(data.binding.width * data.binding.height * data.binding.layers * 4);
    for (let layer = 0; layer < data.pages.length; layer += 1) {
      const page = data.pages[layer]!;
      for (let row = 0; row < page.height; row += 1) {
        const source = row * page.width * 4;
        const target = (layer * data.binding.height + row) * data.binding.width * 4;
        bytes.set(page.bytes.subarray(source, source + page.width * 4), target);
      }
    }
    atlas = new THREE.DataArrayTexture(bytes, data.binding.width, data.binding.height, data.binding.layers);
    atlas.format = THREE.RGBAFormat;
    atlas.type = THREE.UnsignedByteType;
    atlas.colorSpace = THREE.NoColorSpace;
    atlas.magFilter = THREE.LinearFilter;
    atlas.minFilter = THREE.LinearFilter;
    atlas.generateMipmaps = false;
    atlas.needsUpdate = true;
    this.#atlases.set(data.resource, atlas);
    this.#gpuBytes.addShared(bytes.byteLength);
    return atlas;
  }
}

function createMsdfTargetResource(
  batch: PreparedGlyphBatch<typeof msdf>,
  atlas: THREE.DataArrayTexture,
): MsdfTargetResource {
  const geometryValues = new Float32Array(batch.capacity * 4);
  const uvValues = new Float32Array(batch.capacity * 4);
  const boundsValues = new Float32Array(batch.capacity * 4);
  const fillValues = new Float32Array(batch.capacity * 4);
  const outlineValues = new Float32Array(batch.capacity * 4);
  const shadowValues = new Float32Array(batch.capacity * 4);
  const effectsValues = new Float32Array(batch.capacity * 4);
  const arrays = {
    geometry: geometryValues,
    uv: uvValues,
    bounds: boundsValues,
    fill: fillValues,
    outline: outlineValues,
    shadow: shadowValues,
    effects: effectsValues,
  };
  writeMsdfStorage(batch, arrays, 0, batch.instanceCount);
  const attributes = {
    geometry: floatStorage(geometryValues, 4),
    uv: floatStorage(uvValues, 4),
    bounds: floatStorage(boundsValues, 4),
    fill: floatStorage(fillValues, 4),
    outline: floatStorage(outlineValues, 4),
    shadow: floatStorage(shadowValues, 4),
    effects: floatStorage(effectsValues, 4),
  };
  const runStart = TSL.uniform(0, 'uint').onObjectUpdate(
    ({ object }) => (object?.userData.pmndrsTextRunStart as number | undefined) ?? 0,
  );
  const instance = TSL.instanceIndex.add(runStart);
  const geometry = TSL.storage(attributes.geometry, 'vec4', attributes.geometry.count).setPBO(true).element(instance);
  const uvData = TSL.storage(attributes.uv, 'vec4', attributes.uv.count).setPBO(true).element(instance);
  const uvBounds = TSL.storage(attributes.bounds, 'vec4', attributes.bounds.count).setPBO(true).element(instance);
  const fillColor = TSL.storage(attributes.fill, 'vec4', attributes.fill.count).setPBO(true).element(instance);
  const outlineColor = TSL.storage(attributes.outline, 'vec4', attributes.outline.count).setPBO(true).element(instance);
  const shadowColor = TSL.storage(attributes.shadow, 'vec4', attributes.shadow.count).setPBO(true).element(instance);
  const effects = TSL.storage(attributes.effects, 'vec4', attributes.effects.count).setPBO(true).element(instance);
  const shader = msdfShader(
    {
      origin: geometry.xy,
      size: geometry.zw,
      uvOrigin: uvData.xy,
      uvSize: uvData.zw,
      uvBounds,
      fillColor,
      outlineColor,
      shadowColor,
      shadowOffset: effects.xy,
      outlineWidth: effects.z,
      pageIndex: effects.w,
    },
    {
      atlas,
      atlasWidth: batch.binding.width,
      atlasHeight: batch.binding.height,
      pixelRange: batch.font.data.pixelRange,
    },
  );
  const material = new THREE.MeshBasicNodeMaterial({
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    transparent: true,
  });
  material.positionNode = shader.position;
  material.colorNode = shader.color;
  material.opacityNode = shader.opacity;
  const allAttributes = Object.entries(attributes);
  return {
    key: batch.key,
    capacity: batch.capacity,
    gpuBytes: instanceStorageBytes(Object.values(attributes)),
    material,
    update(next) {
      for (const range of next.dirtyRanges) writeMsdfStorage(next, arrays, range.start, range.count);
      markStorageRanges(attributes.geometry, arrays.geometry, next.dirtyRanges);
      markStorageRanges(attributes.uv, arrays.uv, next.dirtyRanges);
      markStorageRanges(attributes.bounds, arrays.bounds, next.dirtyRanges);
      markStorageRanges(attributes.fill, arrays.fill, next.dirtyRanges);
      markStorageRanges(attributes.outline, arrays.outline, next.dirtyRanges);
      markStorageRanges(attributes.shadow, arrays.shadow, next.dirtyRanges);
      markStorageRanges(attributes.effects, arrays.effects, next.dirtyRanges);
    },
    geometry(count) {
      const result = unitQuad();
      result.instanceCount = count;
      for (const [name, attribute] of allAttributes) result.setAttribute(`_pmndrsText_${name}`, attribute);
      return result;
    },
    dispose() {
      material.dispose();
    },
  };
}

interface MsdfTargetArrays {
  readonly geometry: Float32Array;
  readonly uv: Float32Array;
  readonly bounds: Float32Array;
  readonly fill: Float32Array;
  readonly outline: Float32Array;
  readonly shadow: Float32Array;
  readonly effects: Float32Array;
}

function writeMsdfStorage(
  batch: PreparedGlyphBatch<typeof msdf>,
  arrays: MsdfTargetArrays,
  start: number,
  count: number,
): void {
  const storage = batch.storage;
  for (let index = start; index < start + count; index += 1) {
    const pair = index * 2;
    const vector = index * 4;
    arrays.geometry.set(storage.origins.subarray(pair, pair + 2), vector);
    arrays.geometry.set(storage.sizes.subarray(pair, pair + 2), vector + 2);
    arrays.uv.set(storage.uvOrigins.subarray(pair, pair + 2), vector);
    arrays.uv.set(storage.uvSizes.subarray(pair, pair + 2), vector + 2);
    arrays.bounds.set(storage.uvBounds.subarray(vector, vector + 4), vector);
    arrays.fill.set(storage.fillColors.subarray(vector, vector + 4), vector);
    arrays.outline.set(storage.outlineColors.subarray(vector, vector + 4), vector);
    arrays.shadow.set(storage.shadowColors.subarray(vector, vector + 4), vector);
    arrays.effects[vector] = storage.shadowOffsets[pair]!;
    arrays.effects[vector + 1] = storage.shadowOffsets[pair + 1]!;
    arrays.effects[vector + 2] = storage.outlineWidths[index]!;
    arrays.effects[vector + 3] = storage.pageIndices[index]!;
  }
}

function markStorageRanges(
  attribute: THREE.StorageInstancedBufferAttribute,
  source: Float32Array,
  ranges: readonly { readonly start: number; readonly count: number }[],
): void {
  if (ranges.length === 0) return;
  const target = attribute.array as Float32Array;
  attribute.clearUpdateRanges();
  for (const range of ranges) {
    const start = range.start * 4;
    const count = range.count * 4;
    target.set(source.subarray(start, start + count), start);
    attribute.addUpdateRange(start, count);
  }
  attribute.needsUpdate = true;
  invalidatePboTexture(attribute);
}

function floatStorage(array: Float32Array, itemSize: number): THREE.StorageInstancedBufferAttribute {
  const attribute = new THREE.StorageInstancedBufferAttribute(new Float32Array(array), itemSize);
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

function disposeStaged(draws: readonly THREE.Mesh[], resources: Iterable<MsdfTargetResource>): void {
  for (const draw of draws) draw.geometry.dispose();
  for (const resource of resources) resource.dispose();
}
