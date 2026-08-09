import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type { TextEnginePublication } from '../internal/text-engine-host.js';
import { FIRST_PARTY_TRANSFORM_BUFFER_ID } from '../internal/render-policy-wire.js';
import { TextEngineRenderPlanView, type RenderPlanTable } from '../internal/render-plan-view.js';
import { bitmap, type BitmapPageData } from '../raster/bitmap-technique.js';
import { msdf, type MsdfData } from '../raster/msdf.js';
import { bitmapShader } from './bitmap-shader.js';
import type { ThreeTextEngineCoordinator, ThreeTextEngineResource } from './engine-runtime.js';
import { msdfShader } from './msdf-shader.js';
import { invalidatePboTexture } from './retained-target.js';

type ScalarArray = Float32Array | Uint32Array | Uint16Array;

interface RetainedBuffer {
  readonly id: number;
  readonly generation: number;
  readonly policyBufferId: number;
  readonly scalarType: number;
  readonly vectorWidth: number;
  readonly capacityRecords: number;
  readonly array: ScalarArray;
  readonly attribute: THREE.StorageInstancedBufferAttribute;
}

interface RetainedResource {
  readonly id: number;
  readonly generation: number;
  readonly techniqueId: number;
  readonly referenceId: number;
}

export interface ThreeTextEnginePlanOwner {
  readonly drawRoot: THREE.Object3D;
  objectForTransform(transformId: number): THREE.Object3D;
  readonly renderOrderBase: number;
}

/** Applies retained Rust command-buffer deltas to Three storage attributes and draw objects. */
export class ThreeTextEnginePlanTarget {
  readonly #coordinator: ThreeTextEngineCoordinator;
  readonly #owner: ThreeTextEnginePlanOwner;
  readonly #view = new TextEngineRenderPlanView();
  readonly #buffers = new Map<number, RetainedBuffer>();
  readonly #resources = new Map<number, RetainedResource>();
  readonly #bitmapTextures = new Map<number, THREE.DataTexture>();
  readonly #msdfAtlases = new Map<number, THREE.DataArrayTexture>();
  readonly #materials = new Map<string, THREE.MeshBasicNodeMaterial>();
  readonly #activeTransformIndices = new Set<number>();
  readonly #rootInverse = new THREE.Matrix4();
  readonly #relativeTransform = new THREE.Matrix4();
  #transformAttribute = transformAttribute(1);
  #transformGeneration = 1;
  #draws: THREE.Mesh[] = [];
  #disposed = false;

  constructor(coordinator: ThreeTextEngineCoordinator, owner: ThreeTextEnginePlanOwner) {
    this.#coordinator = coordinator;
    this.#owner = owner;
  }

  get draws(): readonly THREE.Mesh[] {
    return this.#draws;
  }

  get gpuBytes(): number {
    let bytes = 0;
    for (const buffer of this.#buffers.values()) bytes += buffer.array.byteLength;
    bytes += this.#transformAttribute.array.byteLength;
    for (const texture of this.#bitmapTextures.values()) {
      const data = texture.image.data as ArrayBufferView | undefined;
      bytes += data?.byteLength ?? 0;
    }
    for (const atlas of this.#msdfAtlases.values()) {
      const data = atlas.image.data as ArrayBufferView | undefined;
      bytes += data?.byteLength ?? 0;
    }
    return bytes;
  }

  apply(publication: TextEnginePublication): void {
    if (this.#disposed) throw new Error('Three text-engine plan target has been disposed');
    const plan = this.#view.bind(publication);
    const resources = plan.table('resources');
    const buffers = plan.table('buffers');
    const patches = plan.table('patches');
    const primitives = plan.table('primitives');
    const draws = plan.table('draws');
    const retirements = plan.table('retirements');
    if (resources.count !== 0) this.#readResources(plan, resources);
    if (buffers.count !== 0) this.#readBuffers(plan, buffers);
    this.#applyPatches(plan, patches);
    if (
      resources.count !== 0 ||
      buffers.count !== 0 ||
      primitives.count !== 0 ||
      draws.count !== 0 ||
      retirements.count !== 0
    ) {
      this.#replaceDraws(plan, draws, primitives, buffers, resources);
    }
    this.syncTransforms();
    this.#applyRetirements(plan, retirements);
  }

  /** Upload changed scene transforms without crossing into Wasm or invalidating text layout. */
  syncTransforms(): number {
    if (this.#activeTransformIndices.size === 0) return 0;
    this.#owner.drawRoot.updateWorldMatrix(true, false);
    this.#rootInverse.copy(this.#owner.drawRoot.matrixWorld).invert();
    const target = this.#transformAttribute.array as Float32Array;
    let changed = 0;
    for (const index of this.#activeTransformIndices) {
      const object = this.#owner.objectForTransform(index);
      object.updateWorldMatrix(true, false);
      this.#relativeTransform.multiplyMatrices(this.#rootInverse, object.matrixWorld);
      if (matrixEquals(target, index * 16, this.#relativeTransform.elements)) continue;
      target.set(this.#relativeTransform.elements, index * 16);
      this.#transformAttribute.addUpdateRange(index * 16, 16);
      changed += 1;
    }
    if (changed === 0) return 0;
    this.#transformAttribute.needsUpdate = true;
    invalidatePboTexture(this.#transformAttribute);
    return changed;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#disposeDraws();
    for (const material of this.#materials.values()) material.dispose();
    for (const texture of this.#bitmapTextures.values()) texture.dispose();
    for (const atlas of this.#msdfAtlases.values()) atlas.dispose();
    this.#materials.clear();
    this.#bitmapTextures.clear();
    this.#msdfAtlases.clear();
    this.#buffers.clear();
    this.#resources.clear();
    this.#activeTransformIndices.clear();
  }

  #readResources(plan: TextEngineRenderPlanView, table: RenderPlanTable): void {
    const layout = textShaperAbi.layouts.engineResource;
    for (let index = 0; index < table.count; index += 1) {
      const record = plan.record(table, index);
      const resource: RetainedResource = {
        id: plan.u32(record + layout.id),
        generation: plan.u32(record + layout.generation),
        techniqueId: plan.u32(record + layout.techniqueId),
        referenceId: plan.u32(record + layout.referenceId),
      };
      this.#coordinator.resolveResource(resource.referenceId);
      this.#resources.set(resource.id, resource);
    }
  }

  #readBuffers(plan: TextEngineRenderPlanView, table: RenderPlanTable): void {
    const layout = textShaperAbi.layouts.engineBuffer;
    for (let index = 0; index < table.count; index += 1) {
      const record = plan.record(table, index);
      const id = plan.u32(record + layout.id);
      const generation = plan.u32(record + layout.generation);
      const scalarType = plan.u8(record + layout.scalarType);
      const vectorWidth = plan.u8(record + layout.vectorWidth);
      const capacityRecords = plan.u32(record + layout.capacityRecords);
      const byteLength = plan.u32(record + layout.byteLength);
      const existing = this.#buffers.get(id);
      if (
        existing?.generation === generation &&
        existing.scalarType === scalarType &&
        existing.vectorWidth === vectorWidth &&
        existing.array.byteLength === byteLength
      ) {
        continue;
      }
      const array = scalarArray(scalarType, byteLength);
      if (array.length !== capacityRecords * vectorWidth) {
        throw new Error('first-party Three policy requires tightly packed physical buffers');
      }
      const attribute = new THREE.StorageInstancedBufferAttribute(array, vectorWidth);
      attribute.setUsage(THREE.DynamicDrawUsage);
      attribute.needsUpdate = true;
      this.#buffers.set(id, {
        id,
        generation,
        policyBufferId: plan.u16(record + layout.policyBufferId),
        scalarType,
        vectorWidth,
        capacityRecords,
        array,
        attribute,
      });
    }
  }

  #applyPatches(plan: TextEngineRenderPlanView, table: RenderPlanTable): void {
    const layout = textShaperAbi.layouts.enginePatch;
    const opcodes = textShaperAbi.engine.patchOpcodes;
    const touched = new Set<number>();
    for (let index = 0; index < table.count; index += 1) {
      const record = plan.record(table, index);
      const opcode = plan.u16(record + layout.opcode);
      const buffer = this.#buffer(plan.u32(record + layout.bufferId), plan.u32(record + layout.bufferGeneration));
      const destinationOffset = plan.u32(record + layout.destinationOffset);
      const byteLength = plan.u32(record + layout.byteLength);
      if (opcode === opcodes.allocateOrResize || opcode === opcodes.retire) continue;
      const destination = new Uint8Array(buffer.array.buffer, buffer.array.byteOffset, buffer.array.byteLength);
      if (destinationOffset + byteLength > destination.byteLength)
        throw new RangeError('buffer patch exceeds allocation');
      if (opcode === opcodes.write) {
        destination.set(plan.bytes(plan.u32(record + layout.payloadOffset), byteLength), destinationOffset);
      } else if (opcode === opcodes.fill) {
        const fill = plan.u32(record + layout.fillValue);
        const view = new DataView(destination.buffer, destination.byteOffset + destinationOffset, byteLength);
        if (byteLength % 4 !== 0) throw new RangeError('fill patch is not u32 aligned');
        for (let offset = 0; offset < byteLength; offset += 4) view.setUint32(offset, fill, true);
      } else if (opcode === opcodes.copy) {
        const source = this.#buffers.get(plan.u32(record + layout.sourceBufferId));
        if (source === undefined) throw new Error('copy patch references an unknown source buffer');
        const sourceOffset = plan.u32(record + layout.sourceOffset);
        const sourceBytes = new Uint8Array(source.array.buffer, source.array.byteOffset, source.array.byteLength);
        if (source.array.buffer === buffer.array.buffer && source.array.byteOffset === buffer.array.byteOffset) {
          destination.copyWithin(destinationOffset, sourceOffset, sourceOffset + byteLength);
        } else {
          destination.set(sourceBytes.subarray(sourceOffset, sourceOffset + byteLength), destinationOffset);
        }
      } else {
        throw new Error(`unsupported text-engine patch opcode ${opcode}`);
      }
      markUpdated(buffer, destinationOffset, byteLength, !touched.has(buffer.id));
      touched.add(buffer.id);
    }
  }

  #replaceDraws(
    plan: TextEngineRenderPlanView,
    draws: RenderPlanTable,
    primitives: RenderPlanTable,
    buffers: RenderPlanTable,
    resources: RenderPlanTable,
  ): void {
    const drawLayout = textShaperAbi.layouts.engineDraw;
    const primitiveLayout = textShaperAbi.layouts.enginePrimitive;
    const bufferLayout = textShaperAbi.layouts.engineBuffer;
    const resourceLayout = textShaperAbi.layouts.engineResource;
    const next: THREE.Mesh[] = [];
    const transformIndices = this.#collectTransformIndices(plan, draws, primitives, buffers);
    this.#ensureTransformCapacity(transformIndices);
    try {
      for (let index = 0; index < draws.count; index += 1) {
        const draw = plan.record(draws, index);
        if (plan.u32(draw + drawLayout.primitiveCount) !== 1) {
          throw new Error('first-party Three plan target requires one primitive span per draw');
        }
        const primitiveIndex = plan.u32(draw + drawLayout.primitiveStart);
        const primitive = plan.record(primitives, primitiveIndex);
        if (plan.u16(primitive + primitiveLayout.kind) !== textShaperAbi.engine.primitiveKinds.glyph) {
          throw new Error('first-party Three plan target does not yet realize non-glyph primitives');
        }
        const drawBufferStart = plan.u32(draw + drawLayout.bufferStart);
        const drawBufferCount = plan.u32(draw + drawLayout.bufferCount);
        const byPolicyId = new Map<number, RetainedBuffer>();
        for (let bufferIndex = drawBufferStart; bufferIndex < drawBufferStart + drawBufferCount; bufferIndex += 1) {
          const record = plan.record(buffers, bufferIndex);
          const buffer = this.#buffer(plan.u32(record + bufferLayout.id), plan.u32(record + bufferLayout.generation));
          byPolicyId.set(buffer.policyBufferId, buffer);
        }
        const resourceRecord = plan.record(resources, plan.u32(draw + drawLayout.resourceStart));
        const resource = this.#resources.get(plan.u32(resourceRecord + resourceLayout.id));
        if (resource === undefined) throw new Error('draw references an unknown retained resource');
        const materialId = plan.u32(draw + drawLayout.materialId);
        const material = this.#material(resource, byPolicyId, materialId);
        const geometry = unitQuad();
        geometry.instanceCount = plan.u16(primitive + primitiveLayout.recordCount);
        for (const buffer of byPolicyId.values()) {
          geometry.setAttribute(`_pmndrsText_${buffer.policyBufferId}`, buffer.attribute);
        }
        geometry.setAttribute('_pmndrsTextTransforms', this.#transformAttribute);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.pmndrsTextRunStart = plan.u32(primitive + primitiveLayout.recordIndex);
        mesh.frustumCulled = false;
        mesh.renderOrder = this.#owner.renderOrderBase + index;
        this.#owner.drawRoot.add(mesh);
        next.push(mesh);
      }
    } catch (error) {
      for (const mesh of next) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
      }
      throw error;
    }
    this.#disposeDraws();
    this.#draws = next;
    this.#activeTransformIndices.clear();
    for (const transformIndex of transformIndices) this.#activeTransformIndices.add(transformIndex);
  }

  #collectTransformIndices(
    plan: TextEngineRenderPlanView,
    draws: RenderPlanTable,
    primitives: RenderPlanTable,
    buffers: RenderPlanTable,
  ): Set<number> {
    const drawLayout = textShaperAbi.layouts.engineDraw;
    const primitiveLayout = textShaperAbi.layouts.enginePrimitive;
    const bufferLayout = textShaperAbi.layouts.engineBuffer;
    const result = new Set<number>();
    for (let drawIndex = 0; drawIndex < draws.count; drawIndex += 1) {
      const draw = plan.record(draws, drawIndex);
      const primitive = plan.record(primitives, plan.u32(draw + drawLayout.primitiveStart));
      const bufferStart = plan.u32(draw + drawLayout.bufferStart);
      const bufferEnd = bufferStart + plan.u32(draw + drawLayout.bufferCount);
      let transformBuffer: RetainedBuffer | undefined;
      for (let bufferIndex = bufferStart; bufferIndex < bufferEnd; bufferIndex += 1) {
        const record = plan.record(buffers, bufferIndex);
        const candidate = this.#buffer(plan.u32(record + bufferLayout.id), plan.u32(record + bufferLayout.generation));
        if (candidate.policyBufferId === FIRST_PARTY_TRANSFORM_BUFFER_ID) transformBuffer = candidate;
      }
      if (transformBuffer === undefined || !(transformBuffer.array instanceof Uint32Array)) {
        throw new Error('indexed Three draw is missing its u32 transform-index buffer');
      }
      const start = plan.u32(primitive + primitiveLayout.recordIndex);
      const end = start + plan.u16(primitive + primitiveLayout.recordCount);
      for (let recordIndex = start; recordIndex < end; recordIndex += 1) {
        const transformIndex = transformBuffer.array[recordIndex];
        if (transformIndex === undefined || transformIndex === 0) {
          throw new Error('indexed Three draw references an invalid transform slot');
        }
        result.add(transformIndex);
      }
    }
    return result;
  }

  #ensureTransformCapacity(indices: ReadonlySet<number>): void {
    let maximum = 0;
    for (const index of indices) maximum = Math.max(maximum, index);
    const requiredRecords = (maximum + 1) * 4;
    if (this.#transformAttribute.count >= requiredRecords) return;
    let capacity = this.#transformAttribute.count;
    while (capacity < requiredRecords) capacity *= 2;
    this.#transformAttribute = transformAttribute(capacity / 4);
    this.#transformGeneration += 1;
    for (const material of this.#materials.values()) material.dispose();
    this.#materials.clear();
  }

  #bitmapMaterial(
    resource: RetainedResource,
    buffers: ReadonlyMap<number, RetainedBuffer>,
    materialId: number,
  ): THREE.MeshBasicNodeMaterial {
    const resolved = this.#coordinator.resolveResource(resource.referenceId);
    if (resolved.technique !== bitmap.id) {
      throw new Error('this Three plan target checkpoint realizes Bitmap draws only');
    }
    const page = bitmapPage(resolved);
    const required = [1, 2, 3, 4, 5].map((id) => {
      const buffer = buffers.get(id);
      if (buffer === undefined) throw new Error(`Bitmap draw is missing policy buffer ${id}`);
      return buffer;
    });
    const transformIndices = buffers.get(FIRST_PARTY_TRANSFORM_BUFFER_ID);
    if (transformIndices === undefined) throw new Error('Bitmap draw is missing its transform-index buffer');
    const key = `${resource.id}:${resource.generation}:${materialId}:${required
      .map((buffer) => `${buffer.id}:${buffer.generation}`)
      .join(',')}:${transformIndices.id}:${transformIndices.generation}:transform:${this.#transformGeneration}`;
    let material = this.#materials.get(key);
    if (material !== undefined) return material;
    const texture = this.#bitmapTexture(resource.referenceId, page);
    const runStart = TSL.uniform(0, 'uint').onObjectUpdate(
      ({ object }) => (object?.userData.pmndrsTextRunStart as number | undefined) ?? 0,
    );
    const instance = TSL.instanceIndex.add(runStart);
    const shader = bitmapShader(
      {
        origin: TSL.storage(required[0]!.attribute, 'vec2', required[0]!.attribute.count)
          .setPBO(true)
          .element(instance),
        size: TSL.storage(required[1]!.attribute, 'vec2', required[1]!.attribute.count).setPBO(true).element(instance),
        uvOrigin: TSL.storage(required[2]!.attribute, 'vec2', required[2]!.attribute.count)
          .setPBO(true)
          .element(instance),
        uvSize: TSL.storage(required[3]!.attribute, 'vec2', required[3]!.attribute.count)
          .setPBO(true)
          .element(instance),
        color: TSL.storage(required[4]!.attribute, 'vec4', required[4]!.attribute.count).setPBO(true).element(instance),
      },
      { page: texture },
    );
    material = new THREE.MeshBasicNodeMaterial({
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      transparent: true,
    });
    material.positionNode = indexedTransformPosition(
      shader.position,
      transformIndices.attribute,
      this.#transformAttribute,
      instance,
    );
    material.vertexNode = shader.clipPosition;
    material.colorNode = shader.color;
    material.opacityNode = shader.opacity;
    this.#materials.set(key, material);
    return material;
  }

  #material(
    resource: RetainedResource,
    buffers: ReadonlyMap<number, RetainedBuffer>,
    materialId: number,
  ): THREE.MeshBasicNodeMaterial {
    const resolved = this.#coordinator.resolveResource(resource.referenceId);
    if (resolved.technique === bitmap.id) return this.#bitmapMaterial(resource, buffers, materialId);
    if (resolved.technique === msdf.id) return this.#msdfMaterial(resource, buffers, materialId);
    throw new Error('this Three plan target checkpoint does not yet realize Slug draws');
  }

  #msdfMaterial(
    resource: RetainedResource,
    buffers: ReadonlyMap<number, RetainedBuffer>,
    materialId: number,
  ): THREE.MeshBasicNodeMaterial {
    const data = msdfData(this.#coordinator.resolveResource(resource.referenceId));
    const required = [1, 2, 3, 4, 5, 6, 7].map((id) => {
      const buffer = buffers.get(id);
      if (buffer === undefined) throw new Error(`MSDF draw is missing policy buffer ${id}`);
      return buffer;
    });
    const transformIndices = buffers.get(FIRST_PARTY_TRANSFORM_BUFFER_ID);
    if (transformIndices === undefined) throw new Error('MSDF draw is missing its transform-index buffer');
    const key = `msdf:${resource.id}:${resource.generation}:${materialId}:${required
      .map((buffer) => `${buffer.id}:${buffer.generation}`)
      .join(',')}:${transformIndices.id}:${transformIndices.generation}:transform:${this.#transformGeneration}`;
    let material = this.#materials.get(key);
    if (material !== undefined) return material;
    const runStart = TSL.uniform(0, 'uint').onObjectUpdate(
      ({ object }) => (object?.userData.pmndrsTextRunStart as number | undefined) ?? 0,
    );
    const instance = TSL.instanceIndex.add(runStart);
    const fields = required.map((buffer) =>
      TSL.storage(buffer.attribute, 'vec4', buffer.attribute.count).setPBO(true).element(instance),
    );
    const shader = msdfShader(
      {
        origin: fields[0]!.xy,
        size: fields[0]!.zw,
        uvOrigin: fields[1]!.xy,
        uvSize: fields[1]!.zw,
        uvBounds: fields[2]!,
        fillColor: fields[3]!,
        outlineColor: fields[4]!,
        shadowColor: fields[5]!,
        shadowOffset: fields[6]!.xy,
        outlineWidth: fields[6]!.z,
        pageIndex: fields[6]!.w,
      },
      {
        atlas: this.#msdfAtlas(resource.referenceId, data),
        atlasWidth: data.binding.width,
        atlasHeight: data.binding.height,
        pixelRange: data.pixelRange,
      },
    );
    material = new THREE.MeshBasicNodeMaterial({
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      transparent: true,
    });
    material.positionNode = indexedTransformPosition(
      shader.position,
      transformIndices.attribute,
      this.#transformAttribute,
      instance,
    );
    material.colorNode = shader.color;
    material.opacityNode = shader.opacity;
    this.#materials.set(key, material);
    return material;
  }

  #bitmapTexture(referenceId: number, page: BitmapPageData): THREE.DataTexture {
    let texture = this.#bitmapTextures.get(referenceId);
    if (texture !== undefined) return texture;
    texture = new THREE.DataTexture(page.bytes, page.width, page.height, THREE.RedFormat, THREE.UnsignedByteType);
    texture.colorSpace = THREE.NoColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.flipY = false;
    texture.needsUpdate = true;
    this.#bitmapTextures.set(referenceId, texture);
    return texture;
  }

  #msdfAtlas(referenceId: number, data: MsdfData): THREE.DataArrayTexture {
    let atlas = this.#msdfAtlases.get(referenceId);
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
    this.#msdfAtlases.set(referenceId, atlas);
    return atlas;
  }

  #applyRetirements(plan: TextEngineRenderPlanView, table: RenderPlanTable): void {
    const layout = textShaperAbi.layouts.engineRetirement;
    for (let index = 0; index < table.count; index += 1) {
      const record = plan.record(table, index);
      if (plan.u16(record + layout.kind) !== textShaperAbi.engine.retirementKinds.buffer) continue;
      const id = plan.u32(record + layout.id);
      const generation = plan.u32(record + layout.generation);
      if (this.#buffers.get(id)?.generation === generation) this.#buffers.delete(id);
    }
  }

  #buffer(id: number, generation: number): RetainedBuffer {
    const buffer = this.#buffers.get(id);
    if (buffer === undefined || buffer.generation !== generation) {
      throw new Error(`text-engine buffer ${id}:${generation} is not retained`);
    }
    return buffer;
  }

  #disposeDraws(): void {
    for (const draw of this.#draws) {
      draw.removeFromParent();
      draw.geometry.dispose();
    }
    this.#draws = [];
  }
}

function bitmapPage(resource: ThreeTextEngineResource): BitmapPageData {
  if (resource.technique !== bitmap.id || !('page' in resource)) {
    throw new Error('this Three plan target checkpoint realizes Bitmap draws only');
  }
  return resource.page as BitmapPageData;
}

function msdfData(resource: ThreeTextEngineResource): MsdfData {
  if (resource.technique !== msdf.id || !('data' in resource)) {
    throw new Error('Three MSDF draw references an incompatible resource');
  }
  return resource.data;
}

function scalarArray(scalarType: number, byteLength: number): ScalarArray {
  const scalar = textShaperAbi.policy.scalarTypes;
  if (scalarType === scalar.f32) return new Float32Array(byteLength / 4);
  if (scalarType === scalar.u32) return new Uint32Array(byteLength / 4);
  if (scalarType === scalar.u16) return new Uint16Array(byteLength / 2);
  throw new Error(`unsupported text-engine scalar type ${scalarType}`);
}

function transformAttribute(transformCapacity: number): THREE.StorageInstancedBufferAttribute {
  const attribute = new THREE.StorageInstancedBufferAttribute(new Float32Array(transformCapacity * 16), 4);
  attribute.setUsage(THREE.DynamicDrawUsage);
  return attribute;
}

function matrixEquals(target: Float32Array, offset: number, matrix: readonly number[]): boolean {
  for (let index = 0; index < 16; index += 1) {
    if (target[offset + index] !== Math.fround(matrix[index]!)) return false;
  }
  return true;
}

function indexedTransformPosition(
  position: THREE.Node<'vec3'>,
  indexAttribute: THREE.StorageInstancedBufferAttribute,
  transforms: THREE.StorageInstancedBufferAttribute,
  instance: THREE.Node<'uint'>,
): THREE.Node<'vec3'> {
  const transformIndex = TSL.storage(indexAttribute, 'uint', indexAttribute.count).setPBO(true).element(instance);
  const firstColumn = transformIndex.mul(4);
  const table = TSL.storage(transforms, 'vec4', transforms.count).setPBO(true);
  const local = TSL.vec4(position, 1);
  return table
    .element(firstColumn)
    .mul(local.x)
    .add(table.element(firstColumn.add(1)).mul(local.y))
    .add(table.element(firstColumn.add(2)).mul(local.z))
    .add(table.element(firstColumn.add(3)).mul(local.w)).xyz;
}

function markUpdated(buffer: RetainedBuffer, byteOffset: number, byteLength: number, firstPatch: boolean): void {
  const scalarBytes = buffer.array.BYTES_PER_ELEMENT;
  if (byteOffset % scalarBytes !== 0 || byteLength % scalarBytes !== 0) {
    throw new RangeError('buffer patch is not scalar aligned');
  }
  if (firstPatch) buffer.attribute.clearUpdateRanges();
  buffer.attribute.addUpdateRange(byteOffset / scalarBytes, byteLength / scalarBytes);
  buffer.attribute.needsUpdate = true;
  invalidatePboTexture(buffer.attribute);
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
