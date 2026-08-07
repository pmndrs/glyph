import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { UniformNode } from 'three/webgpu';

import { slugDilate, slugRender, type SlugShaderPage } from '../internal/slug-shaders/index.js';
import type {
  GlyphBatchKey,
  ParagraphId,
  PreparedGlyphBatch,
  PreparedParagraphBatchRevision,
} from '../paragraph-batch.js';
import type { ParagraphBatchTarget, ParagraphBatchTargetUpdate } from '../paragraph-batch-attachment.js';
import { slug, type SlugPageData } from '../raster/slug-technique.js';
import {
  instanceStorageBytes,
  invalidatePboTexture,
  retainedRunIdentities,
  RetainedThreeGpuBytes,
  RetainedThreeTargetRevision,
  type RetainedThreeTargetResource,
} from './retained-target.js';

export interface ThreeSlugTargetOwner {
  objectForParagraph(paragraph: ParagraphId): THREE.Object3D;
  readonly renderOrderBase: number;
}

interface ThreeSlugPage extends SlugShaderPage {
  readonly curveHeight: number;
  readonly headerHeight: number;
  readonly referenceHeight: number;
  dispose(): void;
}

interface SlugTargetResource extends RetainedThreeTargetResource<typeof slug> {
  readonly key: GlyphBatchKey;
  readonly capacity: number;
  readonly gpuBytes: number;
  readonly material: THREE.MeshBasicNodeMaterial;
  readonly viewport: UniformNode<'vec2', THREE.Vector2>;
  readonly mvpRow0: UniformNode<'vec4', THREE.Vector4>;
  readonly mvpRow1: UniformNode<'vec4', THREE.Vector4>;
  readonly mvpRow3: UniformNode<'vec4', THREE.Vector4>;
  update(batch: PreparedGlyphBatch<typeof slug>): void;
  geometry(count: number): THREE.InstancedBufferGeometry;
  dispose(): void;
}

const drawingBufferSize = new THREE.Vector2();
const modelViewProjectionMatrix = new THREE.Matrix4();

export class ThreeSlugTargetRevision extends RetainedThreeTargetRevision<typeof slug, SlugTargetResource> {}

export class ThreeSlugTarget<Variant> implements ParagraphBatchTarget<typeof slug, Variant, ThreeSlugTargetRevision> {
  readonly technique: typeof slug = slug;
  readonly #owner: ThreeSlugTargetOwner;
  readonly #pages = new Map<string, ThreeSlugPage>();
  readonly #gpuBytes = new RetainedThreeGpuBytes<typeof slug, SlugTargetResource>();
  #disposed = false;

  constructor(owner: ThreeSlugTargetOwner) {
    this.#owner = owner;
  }

  get gpuBytes(): number {
    return this.#gpuBytes.total;
  }

  stage(
    previous: ThreeSlugTargetRevision | undefined,
    next: PreparedParagraphBatchRevision<typeof slug, Variant>,
  ): ParagraphBatchTargetUpdate<ThreeSlugTargetRevision> {
    if (this.#disposed) throw new Error('Three Slug target has been disposed');
    if (previous?.canReuse(next) === true) {
      let finished = false;
      return {
        status: 'ready',
        stage: {
          sourceRevision: next.revision,
          commit: () => {
            if (finished) throw new Error('Three Slug stage is no longer active');
            finished = true;
            const state = previous.transfer(next, this.#owner.renderOrderBase);
            return this.#gpuBytes.retain(
              new ThreeSlugTargetRevision(next.revision, state.draws, state.resources, state.runIdentities),
            );
          },
          abort: () => {
            finished = true;
          },
        },
      };
    }
    const resources = new Map<GlyphBatchKey, SlugTargetResource>();
    const draws: THREE.Mesh[] = [];
    try {
      for (const batch of next.glyphBatches) resources.set(batch.key, this.#createResource(batch));
      for (let index = 0; index < next.glyphRuns.length; index += 1) {
        const run = next.glyphRuns[index]!;
        const resource = resources.get(run.batch);
        if (resource === undefined) throw new Error('Slug run references an unknown physical batch');
        const mesh = new THREE.Mesh(resource.geometry(run.count), resource.material);
        mesh.userData.pmndrsTextRunStart = run.start;
        mesh.frustumCulled = false;
        mesh.renderOrder = this.#owner.renderOrderBase + index;
        mesh.onBeforeRender = (renderer, _scene, camera): void => {
          renderer.getDrawingBufferSize(drawingBufferSize);
          resource.viewport.value.copy(drawingBufferSize);
          updateMvpUniforms(resource, mesh, camera);
        };
        draws.push(mesh);
      }
      let finished = false;
      return {
        status: 'ready',
        stage: {
          sourceRevision: next.revision,
          commit: () => {
            if (finished) throw new Error('Three Slug stage is no longer active');
            finished = true;
            for (let index = 0; index < draws.length; index += 1)
              this.#owner.objectForParagraph(next.glyphRuns[index]!.paragraph).add(draws[index]!);
            return this.#gpuBytes.retain(
              new ThreeSlugTargetRevision(next.revision, draws, resources, retainedRunIdentities(next)),
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
    for (const page of this.#pages.values()) page.dispose();
    this.#pages.clear();
    this.#gpuBytes.release();
  }

  #createResource(batch: PreparedGlyphBatch<typeof slug>): SlugTargetResource {
    const page = batch.font.data.pages[batch.binding.page];
    if (page === undefined) throw new TypeError('Slug binding references a missing decoded page');
    return createSlugTargetResource(batch, this.#page(page));
  }

  #page(data: SlugPageData): ThreeSlugPage {
    let page = this.#pages.get(data.resource);
    if (page !== undefined) return page;
    const curves = ownedUint16(data.curveBytes);
    const headers = ownedUint32(data.headerBytes);
    const packedReferences = packReferencePairs(ownedUint16(data.referenceBytes), data.referenceWidth);
    const curveTexture = dataTexture(curves, data.curveWidth, data.curveHeight, THREE.RGBAFormat, THREE.HalfFloatType);
    const headerTexture = dataTexture(
      headers,
      data.headerWidth,
      data.headerHeight,
      THREE.RedIntegerFormat,
      THREE.UnsignedIntType,
    );
    const referenceTexture = dataTexture(
      packedReferences.data,
      packedReferences.width,
      packedReferences.height,
      THREE.RedIntegerFormat,
      THREE.UnsignedIntType,
    );
    page = {
      curveTexture,
      curveWidth: data.curveWidth,
      curveHeight: data.curveHeight,
      headerTexture,
      headerWidth: data.headerWidth,
      headerHeight: data.headerHeight,
      referenceTexture,
      referenceWidth: packedReferences.width,
      referenceHeight: packedReferences.height,
      dispose() {
        curveTexture.dispose();
        headerTexture.dispose();
        referenceTexture.dispose();
      },
    };
    this.#pages.set(data.resource, page);
    this.#gpuBytes.addShared(curves.byteLength + headers.byteLength + packedReferences.data.byteLength);
    return page;
  }
}

function createSlugTargetResource(batch: PreparedGlyphBatch<typeof slug>, page: ThreeSlugPage): SlugTargetResource {
  const geometryValues = new Float32Array(batch.capacity * 4);
  const emValues = new Float32Array(batch.capacity * 4);
  const bandValues = new Float32Array(batch.capacity * 4);
  const colorValues = new Float32Array(batch.capacity * 4);
  const scalarValues = new Float32Array(batch.capacity * 4);
  const addressValues = new Uint32Array(batch.capacity * 4);
  const countValues = new Uint32Array(batch.capacity * 4);
  const arrays = {
    geometry: geometryValues,
    em: emValues,
    band: bandValues,
    color: colorValues,
    scalar: scalarValues,
    address: addressValues,
    count: countValues,
  };
  writeSlugStorageRange(batch, arrays, 0, batch.instanceCount);
  const attributes = {
    geometry: storageAttribute(geometryValues),
    em: storageAttribute(emValues),
    band: storageAttribute(bandValues),
    color: storageAttribute(colorValues),
    scalar: storageAttribute(scalarValues),
    address: storageAttribute(addressValues),
    count: storageAttribute(countValues),
  };
  const runStart = TSL.uniform(0, 'uint').onObjectUpdate(
    ({ object }) => (object?.userData.pmndrsTextRunStart as number | undefined) ?? 0,
  );
  const instance = TSL.instanceIndex.add(runStart);
  const geometry = TSL.storage(attributes.geometry, 'vec4', attributes.geometry.count).setPBO(true).element(instance);
  const em = TSL.storage(attributes.em, 'vec4', attributes.em.count).setPBO(true).element(instance);
  const bandTransform = TSL.storage(attributes.band, 'vec4', attributes.band.count).setPBO(true).element(instance);
  const color = TSL.storage(attributes.color, 'vec4', attributes.color.count).setPBO(true).element(instance);
  const inverseScale = TSL.storage(attributes.scalar, 'vec4', attributes.scalar.count).setPBO(true).element(instance).x;
  const addresses = TSL.storage(attributes.address, 'uvec4', attributes.address.count).setPBO(true).element(instance);
  const counts = TSL.storage(attributes.count, 'uvec4', attributes.count.count).setPBO(true).element(instance);
  const viewport: UniformNode<'vec2', THREE.Vector2> = TSL.uniform(new THREE.Vector2(1, 1));
  const mvpRow0: UniformNode<'vec4', THREE.Vector4> = TSL.uniform(new THREE.Vector4(1, 0, 0, 0));
  const mvpRow1: UniformNode<'vec4', THREE.Vector4> = TSL.uniform(new THREE.Vector4(0, 1, 0, 0));
  const mvpRow3: UniformNode<'vec4', THREE.Vector4> = TSL.uniform(new THREE.Vector4(0, 0, 0, 1));
  const renderCoordinate = TSL.varyingProperty('vec2', 'pmndrsSlugRenderCoordinate');
  const origin = geometry.xy;
  const size = geometry.zw;
  const emOrigin = em.xy;
  const emSize = em.zw;
  const material = new THREE.MeshBasicNodeMaterial({
    blending: THREE.NormalBlending,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    transparent: true,
  });
  material.positionNode = TSL.Fn(() => {
    const localPosition = TSL.vec2(
      origin.x.add(TSL.positionLocal.x.mul(size.x)),
      origin.y.add(TSL.positionLocal.y.mul(size.y)).negate(),
    );
    const outwardNormal = TSL.vec2(
      TSL.positionLocal.x.sub(0.5).mul(size.x),
      TSL.positionLocal.y.sub(0.5).mul(size.y).negate(),
    );
    const emCoordinate = TSL.vec2(
      emOrigin.x.add(TSL.positionLocal.x.mul(emSize.x)),
      emOrigin.y.add(TSL.positionLocal.y.mul(emSize.y)),
    );
    const dilated = slugDilate(
      localPosition,
      outwardNormal,
      emCoordinate,
      inverseScale,
      mvpRow0,
      mvpRow1,
      mvpRow3,
      viewport,
    );
    renderCoordinate.assign(dilated.textureCoordinate);
    return TSL.vec3(dilated.position.x, dilated.position.y, 0);
  })();
  material.colorNode = color.rgb;
  material.opacityNode = TSL.Fn(() => {
    const coverage = slugRender(
      page,
      {
        curveBaseTexel: addresses.x,
        horizontalHeaderBase: addresses.y,
        verticalHeaderBase: addresses.z,
        referenceBase: addresses.w,
        horizontalBandCount: counts.x,
        verticalBandCount: counts.y,
        bandTransform,
      },
      renderCoordinate,
      { evenOdd: TSL.bool(false), weightBoost: TSL.bool(false) },
    );
    return color.a.mul(coverage);
  })();
  const allAttributes = Object.entries(attributes);
  return {
    key: batch.key,
    capacity: batch.capacity,
    gpuBytes: instanceStorageBytes(Object.values(attributes)),
    material,
    viewport,
    mvpRow0,
    mvpRow1,
    mvpRow3,
    update(next) {
      for (const range of next.dirtyRanges) writeSlugStorageRange(next, arrays, range.start, range.count);
      markStorageRanges(attributes.geometry, arrays.geometry, next.dirtyRanges);
      markStorageRanges(attributes.em, arrays.em, next.dirtyRanges);
      markStorageRanges(attributes.band, arrays.band, next.dirtyRanges);
      markStorageRanges(attributes.color, arrays.color, next.dirtyRanges);
      markStorageRanges(attributes.scalar, arrays.scalar, next.dirtyRanges);
      markStorageRanges(attributes.address, arrays.address, next.dirtyRanges);
      markStorageRanges(attributes.count, arrays.count, next.dirtyRanges);
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

interface SlugTargetArrays {
  readonly geometry: Float32Array;
  readonly em: Float32Array;
  readonly band: Float32Array;
  readonly color: Float32Array;
  readonly scalar: Float32Array;
  readonly address: Uint32Array;
  readonly count: Uint32Array;
}

function writeSlugStorageRange(
  batch: PreparedGlyphBatch<typeof slug>,
  arrays: SlugTargetArrays,
  start: number,
  count: number,
): void {
  const storage = batch.storage;
  for (let index = start; index < start + count; index += 1) {
    const pair = index * 2;
    const vector = index * 4;
    arrays.geometry.set(storage.origins.subarray(pair, pair + 2), vector);
    arrays.geometry.set(storage.sizes.subarray(pair, pair + 2), vector + 2);
    arrays.em.set(storage.emOrigins.subarray(pair, pair + 2), vector);
    arrays.em.set(storage.emSizes.subarray(pair, pair + 2), vector + 2);
    arrays.band.set(storage.bandTransforms.subarray(vector, vector + 4), vector);
    arrays.color.set(storage.colors.subarray(vector, vector + 4), vector);
    arrays.scalar[vector] = storage.inverseScales[index]!;
    arrays.address[vector] = storage.curveBases[index]!;
    arrays.address[vector + 1] = storage.horizontalHeaderBases[index]!;
    arrays.address[vector + 2] = storage.verticalHeaderBases[index]!;
    arrays.address[vector + 3] = storage.referenceBases[index]!;
    arrays.count[vector] = storage.horizontalBandCounts[index]!;
    arrays.count[vector + 1] = storage.verticalBandCounts[index]!;
  }
}

function markStorageRanges(
  attribute: THREE.StorageInstancedBufferAttribute,
  source: Float32Array | Uint32Array,
  ranges: readonly { readonly start: number; readonly count: number }[],
): void {
  if (ranges.length === 0) return;
  const target = attribute.array as Float32Array | Uint32Array;
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

function updateMvpUniforms(resource: SlugTargetResource, object: THREE.Object3D, camera: THREE.Camera): void {
  modelViewProjectionMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  modelViewProjectionMatrix.multiply(object.matrixWorld);
  const values = modelViewProjectionMatrix.elements;
  resource.mvpRow0.value.set(values[0]!, values[4]!, values[8]!, values[12]!);
  resource.mvpRow1.value.set(values[1]!, values[5]!, values[9]!, values[13]!);
  resource.mvpRow3.value.set(values[3]!, values[7]!, values[11]!, values[15]!);
}

function storageAttribute(array: Float32Array | Uint32Array): THREE.StorageInstancedBufferAttribute {
  const attribute = new THREE.StorageInstancedBufferAttribute(array, 4);
  attribute.setUsage(THREE.DynamicDrawUsage);
  attribute.needsUpdate = true;
  return attribute;
}

function dataTexture(
  data: Uint16Array | Uint32Array,
  width: number,
  height: number,
  format: THREE.PixelFormat,
  type: THREE.TextureDataType,
): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, width, height, format, type);
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

function ownedUint16(bytes: Uint8Array): Uint16Array {
  const copy = bytes.slice();
  return new Uint16Array(copy.buffer, copy.byteOffset, copy.byteLength / 2);
}

function ownedUint32(bytes: Uint8Array): Uint32Array {
  const copy = bytes.slice();
  return new Uint32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

function packReferencePairs(
  references: Uint16Array,
  preferredWidth: number,
): { readonly data: Uint32Array; readonly width: number; readonly height: number } {
  const texelCount = Math.ceil(references.length / 2);
  const width = Math.min(preferredWidth, texelCount);
  const height = Math.ceil(texelCount / width);
  const data = new Uint32Array(width * height);
  for (let index = 0; index < references.length; index += 1)
    data[index >>> 1] = data[index >>> 1]! | (references[index]! << ((index & 1) * 16));
  return { data, width, height };
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

function disposeStaged(draws: readonly THREE.Mesh[], resources: Iterable<SlugTargetResource>): void {
  for (const draw of draws) draw.geometry.dispose();
  for (const resource of resources) resource.dispose();
}
