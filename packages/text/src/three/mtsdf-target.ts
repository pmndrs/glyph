import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';

import type {
  GlyphBatchKey,
  ParagraphId,
  PreparedGlyphBatch,
  PreparedParagraphBatchRevision,
} from '../paragraph-batch.js';
import type { ParagraphBatchTarget, ParagraphBatchTargetUpdate } from '../paragraph-batch-attachment.js';
import { mtsdf, type MtsdfBinding, type MtsdfData } from '../raster/mtsdf.js';
import {
  instanceStorageBytes,
  invalidatePboTexture,
  retainedRunIdentities,
  RetainedThreeGpuBytes,
  RetainedThreeTargetRevision,
  type RetainedThreeTargetResource,
} from './retained-target.js';

export interface ThreeMtsdfTargetOwner {
  objectForParagraph(paragraph: ParagraphId): THREE.Object3D;
  readonly renderOrderBase: number;
}

interface MtsdfTargetResource extends RetainedThreeTargetResource<typeof mtsdf> {
  readonly key: GlyphBatchKey;
  readonly capacity: number;
  readonly gpuBytes: number;
  readonly material: THREE.MeshBasicNodeMaterial;
  update(batch: PreparedGlyphBatch<typeof mtsdf>): void;
  geometry(count: number): THREE.InstancedBufferGeometry;
  dispose(): void;
}

export class ThreeMtsdfTargetRevision extends RetainedThreeTargetRevision<typeof mtsdf, MtsdfTargetResource> {}

export class ThreeMtsdfTarget<Variant> implements ParagraphBatchTarget<
  typeof mtsdf,
  Variant,
  ThreeMtsdfTargetRevision
> {
  readonly technique: typeof mtsdf = mtsdf;
  readonly #owner: ThreeMtsdfTargetOwner;
  readonly #atlases = new Map<string, THREE.DataArrayTexture>();
  readonly #gpuBytes = new RetainedThreeGpuBytes<typeof mtsdf, MtsdfTargetResource>();
  #disposed = false;

  constructor(owner: ThreeMtsdfTargetOwner) {
    this.#owner = owner;
  }

  get gpuBytes(): number {
    return this.#gpuBytes.total;
  }

  stage(
    previous: ThreeMtsdfTargetRevision | undefined,
    next: PreparedParagraphBatchRevision<typeof mtsdf, Variant>,
  ): ParagraphBatchTargetUpdate<ThreeMtsdfTargetRevision> {
    if (this.#disposed) throw new Error('Three MTSDF target has been disposed');
    if (previous?.canReuse(next) === true) {
      let finished = false;
      return {
        status: 'ready',
        stage: {
          sourceRevision: next.revision,
          commit: () => {
            if (finished) throw new Error('Three MTSDF stage is no longer active');
            finished = true;
            const state = previous.transfer(next, this.#owner.renderOrderBase);
            return this.#gpuBytes.retain(
              new ThreeMtsdfTargetRevision(next.revision, state.draws, state.resources, state.runIdentities),
            );
          },
          abort: () => {
            finished = true;
          },
        },
      };
    }
    const resources = new Map<GlyphBatchKey, MtsdfTargetResource>();
    const draws: THREE.Mesh[] = [];
    try {
      for (const batch of next.glyphBatches)
        resources.set(batch.key, createMtsdfTargetResource(batch, this.#atlas(batch.font.data)));
      for (let index = 0; index < next.glyphRuns.length; index += 1) {
        const run = next.glyphRuns[index]!;
        const resource = resources.get(run.batch);
        if (resource === undefined) throw new Error('MTSDF run references an unknown physical batch');
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
            if (finished) throw new Error('Three MTSDF stage is no longer active');
            finished = true;
            for (let index = 0; index < draws.length; index += 1)
              this.#owner.objectForParagraph(next.glyphRuns[index]!.paragraph).add(draws[index]!);
            return this.#gpuBytes.retain(
              new ThreeMtsdfTargetRevision(next.revision, draws, resources, retainedRunIdentities(next)),
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

  #atlas(data: MtsdfData): THREE.DataArrayTexture {
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

function createMtsdfTargetResource(
  batch: PreparedGlyphBatch<typeof mtsdf>,
  atlas: THREE.DataArrayTexture,
): MtsdfTargetResource {
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
  writeMtsdfStorage(batch, arrays, 0, batch.instanceCount);
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
  const origin = geometry.xy;
  const size = geometry.zw;
  const uvOrigin = uvData.xy;
  const uvSize = uvData.zw;
  const shadowOffset = effects.xy;
  const outlineWidth = effects.z;
  const pageIndex = effects.w;
  const atlasU = uvOrigin.x.add(TSL.uv().x.mul(uvSize.x));
  const atlasV = uvOrigin.y.add(TSL.uv().y.mul(uvSize.y));
  const minimumU = uvBounds.x.add(0.5 / batch.binding.width);
  const minimumV = uvBounds.y.add(0.5 / batch.binding.height);
  const maximumU = uvBounds.z.sub(0.5 / batch.binding.width);
  const maximumV = uvBounds.w.sub(0.5 / batch.binding.height);
  const baseInside = insideRectangle(atlasU, atlasV, uvBounds);
  const layer = TSL.int(pageIndex);
  const baseSample = TSL.texture(
    atlas,
    TSL.vec2(TSL.clamp(atlasU, minimumU, maximumU), TSL.clamp(atlasV, minimumV, maximumV)),
  ).depth(layer);
  const fillDistance = median3(baseSample.rgb).sub(0.5);
  const trueDistance = baseSample.a.sub(0.5);
  const pixelRange = screenPixelRange(atlasU, atlasV, batch.binding, batch.font.data.pixelRange);
  const fillCoverage = distanceCoverage(fillDistance, pixelRange).mul(baseInside);
  const outlineCoverage = distanceCoverage(trueDistance.add(outlineWidth), pixelRange).mul(baseInside);
  const outlineOnly = TSL.max(outlineCoverage.sub(fillCoverage), 0);
  const shadowU = atlasU.sub(shadowOffset.x);
  const shadowV = atlasV.sub(shadowOffset.y);
  const shadowInside = insideRectangle(shadowU, shadowV, uvBounds);
  const shadowSample = TSL.texture(
    atlas,
    TSL.vec2(TSL.clamp(shadowU, minimumU, maximumU), TSL.clamp(shadowV, minimumV, maximumV)),
  ).depth(layer);
  const shadowCoverage = distanceCoverage(shadowSample.a.sub(0.5), pixelRange).mul(shadowInside);
  const fillAlpha = fillColor.a.mul(fillCoverage);
  const outlineAlpha = outlineColor.a.mul(outlineOnly);
  const glyphAlpha = fillAlpha.add(outlineAlpha);
  const shadowAlpha = shadowColor.a.mul(shadowCoverage).mul(TSL.float(1).sub(glyphAlpha));
  const outputAlpha = glyphAlpha.add(shadowAlpha);
  const outputRgb = fillColor.rgb
    .mul(fillAlpha)
    .add(outlineColor.rgb.mul(outlineAlpha))
    .add(shadowColor.rgb.mul(shadowAlpha))
    .div(TSL.max(outputAlpha, 1e-6));
  const material = new THREE.MeshBasicNodeMaterial({
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    transparent: true,
  });
  material.positionNode = TSL.vec3(
    origin.x.add(TSL.positionLocal.x.mul(size.x)),
    origin.y.add(TSL.positionLocal.y.mul(size.y)).negate(),
    0,
  );
  material.colorNode = outputRgb;
  material.opacityNode = outputAlpha;
  const allAttributes = Object.entries(attributes);
  return {
    key: batch.key,
    capacity: batch.capacity,
    gpuBytes: instanceStorageBytes(Object.values(attributes)),
    material,
    update(next) {
      for (const range of next.dirtyRanges) writeMtsdfStorage(next, arrays, range.start, range.count);
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

interface MtsdfTargetArrays {
  readonly geometry: Float32Array;
  readonly uv: Float32Array;
  readonly bounds: Float32Array;
  readonly fill: Float32Array;
  readonly outline: Float32Array;
  readonly shadow: Float32Array;
  readonly effects: Float32Array;
}

function writeMtsdfStorage(
  batch: PreparedGlyphBatch<typeof mtsdf>,
  arrays: MtsdfTargetArrays,
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

function median3(value: Node<'vec3'>): Node<'float'> {
  return TSL.max(TSL.min(value.r, value.g), TSL.min(TSL.max(value.r, value.g), value.b));
}

function screenPixelRange(
  atlasU: Node<'float'>,
  atlasV: Node<'float'>,
  binding: MtsdfBinding,
  pixelRange: number,
): Node<'float'> {
  const screenTexelsU = TSL.float(1).div(TSL.max(TSL.fwidth(atlasU), 1e-6));
  const screenTexelsV = TSL.float(1).div(TSL.max(TSL.fwidth(atlasV), 1e-6));
  return TSL.max(
    TSL.float(0.5).mul(
      TSL.float(pixelRange / binding.width)
        .mul(screenTexelsU)
        .add(TSL.float(pixelRange / binding.height).mul(screenTexelsV)),
    ),
    1,
  );
}

function distanceCoverage(distance: Node<'float'>, pixelRange: Node<'float'>): Node<'float'> {
  return TSL.clamp(distance.mul(pixelRange).add(0.5), 0, 1);
}

function insideRectangle(u: Node<'float'>, v: Node<'float'>, bounds: Node<'vec4'>): Node<'float'> {
  return TSL.step(bounds.x, u).mul(TSL.step(u, bounds.z)).mul(TSL.step(bounds.y, v)).mul(TSL.step(v, bounds.w));
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

function disposeStaged(draws: readonly THREE.Mesh[], resources: Iterable<MtsdfTargetResource>): void {
  for (const draw of draws) draw.geometry.dispose();
  for (const resource of resources) resource.dispose();
}
