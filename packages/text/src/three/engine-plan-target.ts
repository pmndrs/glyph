import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type { TextEnginePublication } from '../internal/text-engine-host.js';
import { FIRST_PARTY_STABLE_GLYPH_BUFFER_ID, FIRST_PARTY_TRANSFORM_BUFFER_ID } from '../internal/render-policy-wire.js';
import { TextEngineRenderPlanView, type RenderPlanTable } from '../internal/render-plan-view.js';
import { bitmap, type BitmapStrikeData } from '../raster/bitmap-technique.js';
import { msdf, type MsdfData } from '../raster/msdf.js';
import { slug, type SlugPageData } from '../raster/slug-technique.js';
import { bitmapShader } from './bitmap-shader.js';
import type { ThreeTextEngineCoordinator, ThreeTextEngineResource } from './engine-runtime.js';
import { msdfShader } from './msdf-shader.js';
import { slugShader, type ThreeSlugPageResources } from './slug-shader.js';
import type { ThreeTextMaterialContext } from './material.js';
import type { ThreePlanProgramBuffer } from './plan-program-registry.js';

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

interface RetainedSlugPage extends ThreeSlugPageResources {
  readonly byteLength: number;
  dispose(): void;
}

interface MaterialRealization {
  readonly material: THREE.NodeMaterial;
  readonly resourceId: number;
  readonly resourceGeneration: number;
  readonly buffers: readonly Readonly<{ id: number; generation: number }>[];
  readonly indexedTransform: boolean;
}

interface OriginSegment {
  readonly origins: RetainedBuffer;
  readonly stableIds: RetainedBuffer;
  readonly order: RetainedBuffer | undefined;
  readonly start: number;
  readonly count: number;
}

interface OriginRecord {
  readonly buffer: RetainedBuffer;
  readonly index: number;
  targetX: number;
  targetY: number;
}

type TransformRealization =
  | Readonly<{ kind: 'direct'; transformId: number }>
  | Readonly<{ kind: 'indexed'; indices: RetainedBuffer }>;

interface RecordAddressing {
  readonly order: RetainedBuffer | undefined;
}

export interface ThreeTextEnginePlanOwner {
  readonly drawRoot: THREE.Object3D;
  readonly pixelSnapping: boolean;
  objectForTransform(transformId: number): THREE.Object3D;
  transformIds(): Iterable<number>;
  readonly renderOrderBase: number;
}

/** Applies retained Rust command-buffer deltas to Three storage attributes and draw objects. */
export class ThreeTextRenderPlanExecutor {
  readonly #coordinator: ThreeTextEngineCoordinator;
  readonly #owner: ThreeTextEnginePlanOwner;
  readonly #view = new TextEngineRenderPlanView();
  readonly #buffers = new Map<number, RetainedBuffer>();
  readonly #resources = new Map<number, RetainedResource>();
  readonly #bitmapTextures = new Map<number, THREE.DataArrayTexture>();
  readonly #msdfAtlases = new Map<number, THREE.DataArrayTexture>();
  readonly #slugPages = new Map<number, RetainedSlugPage>();
  readonly #materials = new Map<string, MaterialRealization>();
  readonly #ownedMaterials = new WeakSet<THREE.NodeMaterial>();
  readonly #activeTransformIndices = new Set<number>();
  readonly #directDrawsByTransform = new Map<number, THREE.Mesh[]>();
  readonly #originRecords = new Map<number, OriginRecord>();
  readonly #rootInverse = new THREE.Matrix4();
  readonly #relativeTransform = new THREE.Matrix4();
  #transformAttribute = transformAttribute(1);
  #transformGeneration = 1;
  #draws: THREE.Mesh[] = [];
  #drawKeys: string[] = [];
  #originSegments: OriginSegment[] = [];
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
    for (const page of this.#slugPages.values()) bytes += page.byteLength;
    return bytes;
  }

  apply(publication: TextEnginePublication): void {
    if (this.#disposed) throw new Error('Three text-engine plan target has been disposed');
    this.#coordinator.applyPlan(() => {
      this.#restoreOriginTargets();
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
      for (const draw of this.#draws) draw.updateMatrixWorld(false);
      this.#applyRetirements(plan, retirements);
      this.#originRecords.clear();
    });
  }

  snapshotGlyphOrigins(
    stableIds: Uint32Array,
    fallbackX: Float32Array,
    fallbackY: Float32Array,
  ): Readonly<{ shapedX: Float32Array; shapedY: Float32Array; displayedX: Float32Array; displayedY: Float32Array }> {
    if (stableIds.length !== fallbackX.length || stableIds.length !== fallbackY.length) {
      throw new RangeError('glyph origin snapshot arrays must be parallel');
    }
    this.#ensureOriginRecords();
    const shapedX = fallbackX.slice();
    const shapedY = fallbackY.slice();
    const displayedX = fallbackX.slice();
    const displayedY = fallbackY.slice();
    for (let index = 0; index < stableIds.length; index += 1) {
      const record = this.#originRecords.get(stableIds[index]!);
      if (record === undefined || !(record.buffer.array instanceof Float32Array)) continue;
      const offset = record.index * record.buffer.vectorWidth;
      shapedX[index] = record.targetX;
      shapedY[index] = record.targetY;
      displayedX[index] = record.buffer.array[offset]!;
      displayedY[index] = record.buffer.array[offset + 1]!;
    }
    return { shapedX, shapedY, displayedX, displayedY };
  }

  setGlyphOriginOverrides(stableIds: Uint32Array, x: Float32Array, y: Float32Array): void {
    if (stableIds.length !== x.length || stableIds.length !== y.length) {
      throw new RangeError('glyph origin override arrays must be parallel');
    }
    this.#ensureOriginRecords();
    const touched = new Map<RetainedBuffer, readonly [number, number]>();
    for (let index = 0; index < stableIds.length; index += 1) {
      const record = this.#originRecords.get(stableIds[index]!);
      if (record === undefined || !(record.buffer.array instanceof Float32Array)) continue;
      const offset = record.index * record.buffer.vectorWidth;
      record.buffer.array[offset] = x[index]!;
      record.buffer.array[offset + 1] = y[index]!;
      const range = touched.get(record.buffer);
      touched.set(record.buffer, [
        Math.min(range?.[0] ?? offset, offset),
        Math.max(range?.[1] ?? offset + 2, offset + 2),
      ]);
    }
    markOriginRanges(touched);
  }

  clearGlyphOriginOverrides(stableIds: Uint32Array): void {
    this.#ensureOriginRecords();
    const touched = new Map<RetainedBuffer, readonly [number, number]>();
    for (const stableId of stableIds) {
      const record = this.#originRecords.get(stableId);
      if (record === undefined || !(record.buffer.array instanceof Float32Array)) continue;
      const offset = record.index * record.buffer.vectorWidth;
      record.buffer.array[offset] = record.targetX;
      record.buffer.array[offset + 1] = record.targetY;
      const range = touched.get(record.buffer);
      touched.set(record.buffer, [
        Math.min(range?.[0] ?? offset, offset),
        Math.max(range?.[1] ?? offset + 2, offset + 2),
      ]);
    }
    markOriginRanges(touched);
  }

  /** Upload changed scene transforms without crossing into Wasm or invalidating text layout. */
  syncTransforms(transformIds: Iterable<number> = this.#owner.transformIds(), worldMatricesCurrent = false): number {
    for (const [index, draw] of this.#draws.entries()) {
      draw.renderOrder = this.#owner.renderOrderBase + index;
    }
    const target = this.#transformAttribute.array as Float32Array;
    let rootPrepared = false;
    let changedTransforms = 0;
    let indexedChanged = 0;
    for (const transformId of transformIds) {
      const indexed = this.#activeTransformIndices.has(transformId);
      const directDraws = this.#directDrawsByTransform.get(transformId);
      if (!indexed && directDraws === undefined) continue;
      if (!rootPrepared) {
        if (!worldMatricesCurrent) this.#owner.drawRoot.updateWorldMatrix(true, false);
        this.#rootInverse.copy(this.#owner.drawRoot.matrixWorld).invert();
        rootPrepared = true;
      }
      const object = this.#owner.objectForTransform(transformId);
      if (!worldMatricesCurrent) object.updateWorldMatrix(true, false);
      this.#relativeTransform.multiplyMatrices(this.#rootInverse, object.matrixWorld);
      const visible = visibleBelowRoot(object, this.#owner.drawRoot);
      let transformChanged = false;
      if (indexed) {
        const offset = transformId * 16;
        if (visible) {
          if (!matrixEquals(target, offset, this.#relativeTransform.elements)) {
            target.set(this.#relativeTransform.elements, offset);
            transformChanged = true;
          }
        } else if (!zeroMatrixEquals(target, offset)) {
          target.fill(0, offset, offset + 16);
          transformChanged = true;
        }
        if (transformChanged) {
          this.#transformAttribute.addUpdateRange(offset, 16);
          indexedChanged += 1;
        }
      }
      for (const draw of directDraws ?? []) {
        let drawChanged = false;
        if (draw.visible !== visible) {
          draw.visible = visible;
          drawChanged = true;
        }
        if (!draw.matrix.equals(this.#relativeTransform)) {
          draw.matrix.copy(this.#relativeTransform);
          draw.matrixWorldNeedsUpdate = true;
          drawChanged = true;
        }
        if (drawChanged) {
          draw.updateMatrixWorld(false);
          transformChanged = true;
        }
      }
      if (transformChanged) changedTransforms += 1;
    }
    if (changedTransforms === 0) return 0;
    if (indexedChanged !== 0) {
      this.#transformAttribute.needsUpdate = true;
      invalidatePboTexture(this.#transformAttribute);
    }
    return changedTransforms;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#disposeDraws();
    for (const realization of this.#materials.values()) realization.material.dispose();
    for (const texture of this.#bitmapTextures.values()) texture.dispose();
    for (const atlas of this.#msdfAtlases.values()) atlas.dispose();
    for (const page of this.#slugPages.values()) page.dispose();
    this.#materials.clear();
    this.#bitmapTextures.clear();
    this.#msdfAtlases.clear();
    this.#slugPages.clear();
    this.#buffers.clear();
    this.#resources.clear();
    this.#activeTransformIndices.clear();
    this.#directDrawsByTransform.clear();
    this.#originRecords.clear();
    this.#originSegments = [];
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
      markUpdated(buffer, destinationOffset, byteLength);
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
    const nextKeys: string[] = [];
    const nextOriginSegments: OriginSegment[] = [];
    const previous = new Map<string, THREE.Mesh[]>();
    for (let index = 0; index < this.#draws.length; index += 1) {
      const key = this.#drawKeys[index]!;
      const matches = previous.get(key) ?? [];
      matches.push(this.#draws[index]!);
      previous.set(key, matches);
    }
    const reused = new Set<THREE.Mesh>();
    const transformIndices = this.#collectTransformIndices(plan, draws);
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
        const transformId = plan.u32(draw + drawLayout.transformId);
        const recordIndex = plan.u32(primitive + primitiveLayout.recordIndex);
        const recordCount = plan.u16(primitive + primitiveLayout.recordCount);
        const addressing = recordAddressing(plan, draw, primitive, byPolicyId);
        const transform = this.#transformRealization(byPolicyId, transformId);
        const material = this.#material(resource, byPolicyId, materialId, transform, addressing);
        const origins = byPolicyId.get(1);
        const stableIds = byPolicyId.get(FIRST_PARTY_STABLE_GLYPH_BUFFER_ID);
        if (origins !== undefined && stableIds !== undefined) {
          if (!(origins.array instanceof Float32Array) || !(stableIds.array instanceof Uint32Array)) {
            throw new TypeError('glyph-origin augmentation buffers have invalid scalar types');
          }
          nextOriginSegments.push({
            origins,
            stableIds,
            order: addressing.order,
            start: recordIndex,
            count: recordCount,
          });
        }
        const key = drawRealizationKey(
          plan.u32(draw + drawLayout.programId),
          resource,
          materialId,
          byPolicyId,
          plan.u32(draw + drawLayout.clipId),
          plan.u32(draw + drawLayout.depthKey),
          transform,
          this.#transformGeneration,
        );
        const reusable = previous.get(key)?.shift();
        if (reusable !== undefined) {
          if (!(reusable.geometry instanceof THREE.InstancedBufferGeometry)) {
            throw new TypeError('retained text draw lost its instanced geometry');
          }
          reusable.geometry.instanceCount = recordCount;
          reusable.userData.pmndrsTextRunStart = recordIndex;
          reusable.userData.pmndrsTextTransformId = transformId;
          reusable.matrixAutoUpdate = transform.kind !== 'direct';
          reusable.renderOrder = this.#owner.renderOrderBase + index;
          if (reusable.parent !== this.#owner.drawRoot) this.#owner.drawRoot.add(reusable);
          reused.add(reusable);
          next.push(reusable);
          nextKeys.push(key);
          continue;
        }
        const geometry = unitQuad();
        geometry.instanceCount = recordCount;
        for (const buffer of byPolicyId.values()) {
          geometry.setAttribute(`_pmndrsText_${buffer.policyBufferId}`, buffer.attribute);
        }
        if (transform.kind === 'indexed') geometry.setAttribute('_pmndrsTextTransforms', this.#transformAttribute);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.pmndrsTextRunStart = recordIndex;
        mesh.userData.pmndrsTextTransformId = transformId;
        mesh.matrixAutoUpdate = transform.kind !== 'direct';
        mesh.frustumCulled = false;
        mesh.renderOrder = this.#owner.renderOrderBase + index;
        this.#owner.drawRoot.add(mesh);
        next.push(mesh);
        nextKeys.push(key);
      }
    } catch (error) {
      for (const mesh of next) {
        if (reused.has(mesh)) continue;
        mesh.removeFromParent();
        mesh.geometry.dispose();
      }
      throw error;
    }
    this.#disposeDraws(reused);
    this.#draws = next;
    this.#drawKeys = nextKeys;
    this.#originSegments = nextOriginSegments;
    this.#activeTransformIndices.clear();
    for (const transformIndex of transformIndices) this.#activeTransformIndices.add(transformIndex);
    this.#directDrawsByTransform.clear();
    for (const draw of this.#draws) {
      const transformId = directTransformId(draw);
      if (transformId === 0) continue;
      const transformDraws = this.#directDrawsByTransform.get(transformId) ?? [];
      transformDraws.push(draw);
      this.#directDrawsByTransform.set(transformId, transformDraws);
    }
  }

  #restoreOriginTargets(): void {
    const touched = new Map<RetainedBuffer, readonly [number, number]>();
    for (const record of this.#originRecords.values()) {
      if (!(record.buffer.array instanceof Float32Array)) continue;
      const offset = record.index * record.buffer.vectorWidth;
      if (record.buffer.array[offset] === record.targetX && record.buffer.array[offset + 1] === record.targetY)
        continue;
      record.buffer.array[offset] = record.targetX;
      record.buffer.array[offset + 1] = record.targetY;
      const range = touched.get(record.buffer);
      touched.set(record.buffer, [
        Math.min(range?.[0] ?? offset, offset),
        Math.max(range?.[1] ?? offset + 2, offset + 2),
      ]);
    }
    markOriginRanges(touched);
  }

  #ensureOriginRecords(): void {
    if (this.#originRecords.size !== 0) return;
    for (const segment of this.#originSegments) {
      if (!(segment.origins.array instanceof Float32Array) || !(segment.stableIds.array instanceof Uint32Array))
        continue;
      for (let index = segment.start; index < segment.start + segment.count; index += 1) {
        const recordIndex = physicalRecordIndex(segment.order, index);
        const stableId = segment.stableIds.array[recordIndex];
        if (stableId === undefined || stableId === 0)
          throw new Error('origin augmentation references an invalid glyph');
        const offset = recordIndex * segment.origins.vectorWidth;
        if (this.#originRecords.has(stableId)) throw new Error('origin augmentation repeats a stable glyph identity');
        this.#originRecords.set(stableId, {
          buffer: segment.origins,
          index: recordIndex,
          targetX: segment.origins.array[offset]!,
          targetY: segment.origins.array[offset + 1]!,
        });
      }
    }
  }

  #transformRealization(buffers: ReadonlyMap<number, RetainedBuffer>, transformId: number): TransformRealization {
    if (transformId !== 0) return { kind: 'direct', transformId };
    const indices = buffers.get(FIRST_PARTY_TRANSFORM_BUFFER_ID);
    if (indices === undefined || !(indices.array instanceof Uint32Array)) {
      throw new Error('indexed Three draw is missing its u32 transform-index buffer');
    }
    return { kind: 'indexed', indices };
  }

  #collectTransformIndices(plan: TextEngineRenderPlanView, draws: RenderPlanTable): Set<number> {
    const drawLayout = textShaperAbi.layouts.engineDraw;
    for (let drawIndex = 0; drawIndex < draws.count; drawIndex += 1) {
      const draw = plan.record(draws, drawIndex);
      if (plan.u32(draw + drawLayout.transformId) === 0) return new Set(this.#owner.transformIds());
    }
    return new Set();
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
    this.#disposeMaterials((realization) => realization.indexedTransform);
  }

  #bitmapMaterial(
    resource: RetainedResource,
    buffers: ReadonlyMap<number, RetainedBuffer>,
    materialId: number,
    transform: TransformRealization,
    addressing: RecordAddressing,
  ): THREE.NodeMaterial {
    const resolved = this.#coordinator.resolveResource(resource.referenceId);
    if (resolved.technique !== bitmap.id) {
      throw new Error('this Three plan target checkpoint realizes Bitmap draws only');
    }
    const strike = bitmapStrike(resolved);
    const required = [1, 2, 3, 4, 5, 6].map((id) => {
      const buffer = buffers.get(id);
      if (buffer === undefined) throw new Error(`Bitmap draw is missing policy buffer ${id}`);
      return buffer;
    });
    const key = `${resource.id}:${resource.generation}:${materialId}:snap=${String(this.#owner.pixelSnapping)}:${required
      .map((buffer) => `${buffer.id}:${buffer.generation}`)
      .join(',')}:${transformProgramKey(transform, this.#transformGeneration)}:${addressingProgramKey(addressing)}`;
    const cached = this.#materials.get(key);
    if (cached !== undefined) return cached.material;
    const texture = this.#bitmapTexture(resource.referenceId, strike);
    const runStart = TSL.uniform(0, 'uint').onObjectUpdate(
      ({ object }) => (object?.userData.pmndrsTextRunStart as number | undefined) ?? 0,
    );
    const instance = physicalInstance(TSL.instanceIndex.add(runStart), addressing);
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
        pageIndex: TSL.storage(required[5]!.attribute, 'uint', required[5]!.attribute.count)
          .setPBO(true)
          .element(instance),
      },
      { page: texture },
      { pixelSnapping: this.#owner.pixelSnapping },
    );
    const position =
      transform.kind === 'indexed'
        ? indexedTransformPosition(shader.position, transform.indices.attribute, this.#transformAttribute, instance)
        : shader.position;
    const material = this.#createMaterial(materialId, {
      technique: bitmap.id,
      shader,
      position,
      createDefaultMaterial: () => bitmapMaterial(shader, position),
    });
    this.#retainMaterial(key, material, resource, materialBuffers(required, transform, addressing), transform.kind);
    return material;
  }

  #material(
    resource: RetainedResource,
    buffers: ReadonlyMap<number, RetainedBuffer>,
    materialId: number,
    transform: TransformRealization,
    addressing: RecordAddressing,
  ): THREE.NodeMaterial {
    const resolved = this.#coordinator.resolveResource(resource.referenceId);
    if (resolved.technique === bitmap.id)
      return this.#bitmapMaterial(resource, buffers, materialId, transform, addressing);
    if (resolved.technique === msdf.id) return this.#msdfMaterial(resource, buffers, materialId, transform, addressing);
    if (resolved.technique === slug.id) return this.#slugMaterial(resource, buffers, materialId, transform, addressing);
    if ('program' in resolved)
      return this.#planProgramMaterial(resource, resolved, buffers, materialId, transform, addressing);
    throw new Error('this Three plan target does not recognize the draw technique');
  }

  #planProgramMaterial(
    resource: RetainedResource,
    resolved: Extract<ThreeTextEngineResource, { readonly program: unknown }>,
    buffers: ReadonlyMap<number, RetainedBuffer>,
    materialId: number,
    transform: TransformRealization,
    addressing: RecordAddressing,
  ): THREE.NodeMaterial {
    const required = [...buffers.values()];
    const key = `external:${resource.id}:${resource.generation}:${materialId}:${required
      .map((buffer) => `${buffer.policyBufferId}:${buffer.id}:${buffer.generation}`)
      .join(',')}:${transformProgramKey(transform, this.#transformGeneration)}:${addressingProgramKey(addressing)}`;
    const cached = this.#materials.get(key);
    if (cached !== undefined) return cached.material;
    const runStart = TSL.uniform(0, 'uint').onObjectUpdate(
      ({ object }) => (object?.userData.pmndrsTextRunStart as number | undefined) ?? 0,
    );
    const instance = physicalInstance(TSL.instanceIndex.add(runStart), addressing);
    const publicBuffers = new Map<number, ThreePlanProgramBuffer>(
      [...buffers]
        .filter(([id]) => id !== textShaperAbi.engine.internalBufferBindings.order)
        .map(([id, buffer]) => [
          id,
          {
            scalarType: buffer.scalarType,
            vectorWidth: buffer.vectorWidth,
            attribute: buffer.attribute,
          },
        ]),
    );
    const material = this.#ownMaterial(
      resolved.program.createMaterial({
        resource: resolved.resource,
        buffers: publicBuffers,
        instance,
        materialId,
        material: this.#coordinator.resolveMaterial(materialId),
        transformPosition: (position) =>
          transform.kind === 'indexed'
            ? indexedTransformPosition(position, transform.indices.attribute, this.#transformAttribute, instance)
            : position,
      }),
    );
    this.#retainMaterial(key, material, resource, materialBuffers(required, transform, addressing), transform.kind);
    return material;
  }

  #msdfMaterial(
    resource: RetainedResource,
    buffers: ReadonlyMap<number, RetainedBuffer>,
    materialId: number,
    transform: TransformRealization,
    addressing: RecordAddressing,
  ): THREE.NodeMaterial {
    const data = msdfData(this.#coordinator.resolveResource(resource.referenceId));
    const required = [1, 2, 3, 4, 5, 6, 7].map((id) => {
      const buffer = buffers.get(id);
      if (buffer === undefined) throw new Error(`MSDF draw is missing policy buffer ${id}`);
      return buffer;
    });
    const key = `msdf:${resource.id}:${resource.generation}:${materialId}:${required
      .map((buffer) => `${buffer.id}:${buffer.generation}`)
      .join(',')}:${transformProgramKey(transform, this.#transformGeneration)}:${addressingProgramKey(addressing)}`;
    const cached = this.#materials.get(key);
    if (cached !== undefined) return cached.material;
    const runStart = TSL.uniform(0, 'uint').onObjectUpdate(
      ({ object }) => (object?.userData.pmndrsTextRunStart as number | undefined) ?? 0,
    );
    const instance = physicalInstance(TSL.instanceIndex.add(runStart), addressing);
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
    const position =
      transform.kind === 'indexed'
        ? indexedTransformPosition(shader.position, transform.indices.attribute, this.#transformAttribute, instance)
        : shader.position;
    const material = this.#createMaterial(materialId, {
      technique: msdf.id,
      shader,
      position,
      createDefaultMaterial: () => coverageMaterial(shader, position),
    });
    this.#retainMaterial(key, material, resource, materialBuffers(required, transform, addressing), transform.kind);
    return material;
  }

  #bitmapTexture(referenceId: number, strike: BitmapStrikeData): THREE.DataArrayTexture {
    let texture = this.#bitmapTextures.get(referenceId);
    if (texture !== undefined) return texture;
    const width = Math.max(...strike.pages.map((page) => page.width));
    const height = Math.max(...strike.pages.map((page) => page.height));
    const bytes = new Uint8Array(width * height * strike.pages.length);
    for (let layer = 0; layer < strike.pages.length; layer += 1) {
      const page = strike.pages[layer]!;
      for (let row = 0; row < page.height; row += 1) {
        const source = row * page.width;
        const target = (layer * height + row) * width;
        bytes.set(page.bytes.subarray(source, source + page.width), target);
      }
    }
    texture = new THREE.DataArrayTexture(bytes, width, height, strike.pages.length);
    texture.format = THREE.RedFormat;
    texture.type = THREE.UnsignedByteType;
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

  #slugMaterial(
    resource: RetainedResource,
    buffers: ReadonlyMap<number, RetainedBuffer>,
    materialId: number,
    transformRealization: TransformRealization,
    addressing: RecordAddressing,
  ): THREE.NodeMaterial {
    const page = slugPage(this.#coordinator.resolveResource(resource.referenceId));
    const required = [1, 2, 3, 4, 5, 6, 7].map((id) => {
      const buffer = buffers.get(id);
      if (buffer === undefined) throw new Error(`Slug draw is missing policy buffer ${id}`);
      return buffer;
    });
    const key = `slug:${resource.id}:${resource.generation}:${materialId}:${required
      .map((buffer) => `${buffer.id}:${buffer.generation}`)
      .join(
        ',',
      )}:${transformProgramKey(transformRealization, this.#transformGeneration)}:${addressingProgramKey(addressing)}`;
    const cached = this.#materials.get(key);
    if (cached !== undefined) return cached.material;
    const runStart = TSL.uniform(0, 'uint').onObjectUpdate(
      ({ object }) => (object?.userData.pmndrsTextRunStart as number | undefined) ?? 0,
    );
    const instance = physicalInstance(TSL.instanceIndex.add(runStart), addressing);
    const floatFields = required
      .slice(0, 5)
      .map((buffer) => TSL.storage(buffer.attribute, 'vec4', buffer.attribute.count).setPBO(true).element(instance));
    const addresses = TSL.storage(required[5]!.attribute, 'uvec4', required[5]!.attribute.count)
      .setPBO(true)
      .element(instance);
    const counts = TSL.storage(required[6]!.attribute, 'uvec4', required[6]!.attribute.count)
      .setPBO(true)
      .element(instance);
    const indexedTransform =
      transformRealization.kind === 'indexed'
        ? indexedTransformNodes(transformRealization.indices.attribute, this.#transformAttribute, instance)
        : undefined;
    const modelViewProjection =
      indexedTransform === undefined
        ? TSL.cameraProjectionMatrix.mul(TSL.modelViewMatrix)
        : TSL.cameraProjectionMatrix.mul(TSL.modelViewMatrix).mul(indexedTransform.matrix);
    const viewport = TSL.uniform(new THREE.Vector2(1, 1)).onRenderUpdate(({ renderer }, self) =>
      renderer?.getDrawingBufferSize(self.value),
    );
    const shader = slugShader(
      {
        origin: floatFields[0]!.xy,
        size: floatFields[0]!.zw,
        emOrigin: floatFields[1]!.xy,
        emSize: floatFields[1]!.zw,
        bandTransform: floatFields[2]!,
        color: floatFields[3]!,
        inverseScale: floatFields[4]!.x,
        curveBaseTexel: addresses.x,
        horizontalHeaderBase: addresses.y,
        verticalHeaderBase: addresses.z,
        referenceBase: addresses.w,
        horizontalBandCount: counts.x,
        verticalBandCount: counts.y,
      },
      {
        page: this.#slugPage(resource.referenceId, page),
        viewport,
        modelViewProjection,
      },
    );
    const position = indexedTransform?.position(shader.position) ?? shader.position;
    const material = this.#createMaterial(materialId, {
      technique: slug.id,
      shader,
      position,
      createDefaultMaterial: () => coverageMaterial(shader, position),
    });
    this.#retainMaterial(
      key,
      material,
      resource,
      materialBuffers(required, transformRealization, addressing),
      transformRealization.kind,
    );
    return material;
  }

  #slugPage(referenceId: number, data: SlugPageData): RetainedSlugPage {
    let page = this.#slugPages.get(referenceId);
    if (page !== undefined) return page;
    const curves = ownedUint16(data.curveBytes);
    const headers = ownedUint32(data.headerBytes);
    const references = packReferencePairs(ownedUint16(data.referenceBytes), data.referenceWidth);
    const curveTexture = dataTexture(curves, data.curveWidth, data.curveHeight, THREE.RGBAFormat, THREE.HalfFloatType);
    const headerTexture = dataTexture(
      headers,
      data.headerWidth,
      data.headerHeight,
      THREE.RedIntegerFormat,
      THREE.UnsignedIntType,
    );
    const referenceTexture = dataTexture(
      references.data,
      references.width,
      references.height,
      THREE.RedIntegerFormat,
      THREE.UnsignedIntType,
    );
    page = {
      curveTexture,
      curveWidth: data.curveWidth,
      headerTexture,
      headerWidth: data.headerWidth,
      referenceTexture,
      referenceWidth: references.width,
      byteLength: curves.byteLength + headers.byteLength + references.data.byteLength,
      dispose() {
        curveTexture.dispose();
        headerTexture.dispose();
        referenceTexture.dispose();
      },
    };
    this.#slugPages.set(referenceId, page);
    return page;
  }

  #createMaterial(materialId: number, context: ThreeTextMaterialContext): THREE.NodeMaterial {
    const definition = this.#coordinator.resolveMaterial(materialId);
    return this.#ownMaterial(definition?.create(context) ?? context.createDefaultMaterial());
  }

  #ownMaterial(material: THREE.NodeMaterial): THREE.NodeMaterial {
    if (material?.isNodeMaterial !== true)
      throw new TypeError('text material factory must return a Three NodeMaterial');
    if (this.#ownedMaterials.has(material)) {
      throw new TypeError('text material factory must return a fresh unowned NodeMaterial');
    }
    this.#ownedMaterials.add(material);
    return material;
  }

  #retainMaterial(
    key: string,
    material: THREE.NodeMaterial,
    resource: RetainedResource,
    buffers: readonly RetainedBuffer[],
    transformKind: TransformRealization['kind'],
  ): void {
    this.#materials.set(key, {
      material,
      resourceId: resource.id,
      resourceGeneration: resource.generation,
      buffers: buffers.map(({ id, generation }) => ({ id, generation })),
      indexedTransform: transformKind === 'indexed',
    });
  }

  #disposeMaterials(predicate: (realization: MaterialRealization) => boolean): void {
    for (const [key, realization] of this.#materials) {
      if (!predicate(realization)) continue;
      realization.material.dispose();
      this.#materials.delete(key);
    }
  }

  #disposeResource(referenceId: number): void {
    if ([...this.#resources.values()].some((resource) => resource.referenceId === referenceId)) return;
    const bitmapTexture = this.#bitmapTextures.get(referenceId);
    bitmapTexture?.dispose();
    this.#bitmapTextures.delete(referenceId);
    const msdfAtlas = this.#msdfAtlases.get(referenceId);
    msdfAtlas?.dispose();
    this.#msdfAtlases.delete(referenceId);
    const retainedSlugPage = this.#slugPages.get(referenceId);
    retainedSlugPage?.dispose();
    this.#slugPages.delete(referenceId);
  }

  #applyRetirements(plan: TextEngineRenderPlanView, table: RenderPlanTable): void {
    const layout = textShaperAbi.layouts.engineRetirement;
    const kinds = textShaperAbi.engine.retirementKinds;
    for (let index = 0; index < table.count; index += 1) {
      const record = plan.record(table, index);
      const kind = plan.u16(record + layout.kind);
      const id = plan.u32(record + layout.id);
      const generation = plan.u32(record + layout.generation);
      if (kind === kinds.buffer) {
        this.#disposeMaterials((realization) =>
          realization.buffers.some((buffer) => buffer.id === id && buffer.generation === generation),
        );
        if (this.#buffers.get(id)?.generation === generation) this.#buffers.delete(id);
        continue;
      }
      if (kind === kinds.resource) {
        const resource = this.#resources.get(id);
        if (resource?.generation !== generation) continue;
        this.#disposeMaterials(
          (realization) =>
            realization.resourceId === resource.id && realization.resourceGeneration === resource.generation,
        );
        this.#resources.delete(id);
        this.#disposeResource(resource.referenceId);
      }
    }
  }

  #buffer(id: number, generation: number): RetainedBuffer {
    const buffer = this.#buffers.get(id);
    if (buffer === undefined || buffer.generation !== generation) {
      throw new Error(`text-engine buffer ${id}:${generation} is not retained`);
    }
    return buffer;
  }

  #disposeDraws(retained: ReadonlySet<THREE.Mesh> = new Set()): void {
    for (const draw of this.#draws) {
      if (retained.has(draw)) continue;
      draw.removeFromParent();
      draw.geometry.dispose();
    }
    this.#draws = [];
    this.#drawKeys = [];
  }
}

function drawRealizationKey(
  programId: number,
  resource: RetainedResource,
  materialId: number,
  buffers: ReadonlyMap<number, RetainedBuffer>,
  clipId: number,
  depthKey: number,
  transform: TransformRealization,
  transformGeneration: number,
): string {
  const bufferKey = [...buffers]
    .sort(([left], [right]) => left - right)
    .map(([policyId, buffer]) => `${policyId}:${buffer.id}:${buffer.generation}`)
    .join(',');
  const transformKey =
    transform.kind === 'direct'
      ? `direct:${transform.transformId}`
      : transformProgramKey(transform, transformGeneration);
  return `${programId}:${resource.id}:${resource.generation}:${materialId}:${clipId}:${depthKey}:${transformKey}:${bufferKey}`;
}

function recordAddressing(
  plan: TextEngineRenderPlanView,
  draw: number,
  primitive: number,
  buffers: ReadonlyMap<number, RetainedBuffer>,
): RecordAddressing {
  const drawLayout = textShaperAbi.layouts.engineDraw;
  const primitiveLayout = textShaperAbi.layouts.enginePrimitive;
  const indirectBufferId = plan.u32(draw + drawLayout.indirectBufferId);
  const order = buffers.get(textShaperAbi.engine.internalBufferBindings.order);
  if (indirectBufferId === 0) {
    if (order !== undefined) throw new Error('ordered-direct draw unexpectedly contains an indirection buffer');
    return { order: undefined };
  }
  if (
    order === undefined ||
    order.id !== indirectBufferId ||
    !(order.array instanceof Uint32Array) ||
    order.vectorWidth !== 1
  ) {
    throw new Error('stable-indirect draw is missing its scalar u32 order buffer');
  }
  const indirectOffset = plan.u32(draw + drawLayout.indirectOffset);
  const recordIndex = plan.u32(primitive + primitiveLayout.recordIndex);
  if (
    indirectOffset % Uint32Array.BYTES_PER_ELEMENT !== 0 ||
    indirectOffset / Uint32Array.BYTES_PER_ELEMENT !== recordIndex ||
    plan.u32(primitive + primitiveLayout.bufferId) !== indirectBufferId
  ) {
    throw new Error('stable-indirect draw and primitive disagree about logical record addressing');
  }
  return { order };
}

function physicalInstance(logical: THREE.Node<'uint'>, addressing: RecordAddressing): THREE.Node<'uint'> {
  const order = addressing.order;
  return order === undefined
    ? logical
    : TSL.storage(order.attribute, 'uint', order.attribute.count).setPBO(true).element(logical);
}

function physicalRecordIndex(order: RetainedBuffer | undefined, logical: number): number {
  if (order === undefined) return logical;
  if (!(order.array instanceof Uint32Array) || order.vectorWidth !== 1) {
    throw new TypeError('stable-indirect order buffer must contain scalar u32 records');
  }
  const physical = order.array[logical];
  if (physical === undefined) throw new RangeError('stable-indirect logical record exceeds its order buffer');
  return physical;
}

function addressingProgramKey(addressing: RecordAddressing): string {
  const order = addressing.order;
  return order === undefined ? 'ordered' : `stable:${order.id}:${order.generation}`;
}

function materialBuffers(
  required: readonly RetainedBuffer[],
  transform: TransformRealization,
  addressing: RecordAddressing,
): readonly RetainedBuffer[] {
  const buffers = new Map(required.map((buffer) => [buffer.id, buffer]));
  if (transform.kind === 'indexed') buffers.set(transform.indices.id, transform.indices);
  if (addressing.order !== undefined) buffers.set(addressing.order.id, addressing.order);
  return [...buffers.values()];
}

function transformProgramKey(transform: TransformRealization, generation: number): string {
  return transform.kind === 'direct'
    ? 'direct'
    : `indexed:${transform.indices.id}:${transform.indices.generation}:table:${generation}`;
}

function directTransformId(draw: THREE.Mesh): number {
  return (draw.userData.pmndrsTextTransformId as number | undefined) ?? 0;
}

function visibleBelowRoot(object: THREE.Object3D, root: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current !== null && current !== root) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return current === root;
}

function bitmapMaterial(
  shader: Readonly<{
    clipPosition: THREE.Node<'vec4'>;
    color: THREE.Node<'vec3'>;
    opacity: THREE.Node<'float'>;
  }>,
  position: THREE.Node<'vec3'>,
): THREE.MeshBasicNodeMaterial {
  const material = baseTextMaterial();
  material.positionNode = position;
  material.vertexNode = shader.clipPosition;
  material.colorNode = shader.color;
  material.opacityNode = shader.opacity;
  return material;
}

function coverageMaterial(
  shader: Readonly<{ color: THREE.Node<'vec3'>; opacity: THREE.Node<'float'> }>,
  position: THREE.Node<'vec3'>,
): THREE.MeshBasicNodeMaterial {
  const material = baseTextMaterial();
  material.positionNode = position;
  material.colorNode = shader.color;
  material.opacityNode = shader.opacity;
  return material;
}

function baseTextMaterial(): THREE.MeshBasicNodeMaterial {
  return new THREE.MeshBasicNodeMaterial({
    blending: THREE.NormalBlending,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    transparent: true,
  });
}

function bitmapStrike(resource: ThreeTextEngineResource): BitmapStrikeData {
  if (resource.technique !== bitmap.id || !('strike' in resource)) {
    throw new Error('this Three plan target checkpoint realizes Bitmap draws only');
  }
  return resource.strike as BitmapStrikeData;
}

function msdfData(resource: ThreeTextEngineResource): MsdfData {
  if (resource.technique !== msdf.id || !('data' in resource)) {
    throw new Error('Three MSDF draw references an incompatible resource');
  }
  return resource.data;
}

function slugPage(resource: ThreeTextEngineResource): SlugPageData {
  if (resource.technique !== slug.id || !('page' in resource)) {
    throw new Error('Three Slug draw references an incompatible resource');
  }
  return resource.page as SlugPageData;
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

function zeroMatrixEquals(target: Float32Array, offset: number): boolean {
  for (let index = 0; index < 16; index += 1) {
    if (target[offset + index] !== 0) return false;
  }
  return true;
}

function indexedTransformPosition(
  position: THREE.Node<'vec3'>,
  indexAttribute: THREE.StorageInstancedBufferAttribute,
  transforms: THREE.StorageInstancedBufferAttribute,
  instance: THREE.Node<'uint'>,
): THREE.Node<'vec3'> {
  return indexedTransformNodes(indexAttribute, transforms, instance).position(position);
}

function indexedTransformNodes(
  indexAttribute: THREE.StorageInstancedBufferAttribute,
  transforms: THREE.StorageInstancedBufferAttribute,
  instance: THREE.Node<'uint'>,
): {
  readonly matrix: THREE.Node<'mat4'>;
  readonly position: (position: THREE.Node<'vec3'>) => THREE.Node<'vec3'>;
} {
  const transformIndex = TSL.storage(indexAttribute, 'uint', indexAttribute.count).setPBO(true).element(instance);
  const firstColumn = transformIndex.mul(4);
  const table = TSL.storage(transforms, 'vec4', transforms.count).setPBO(true);
  const column0 = table.element(firstColumn);
  const column1 = table.element(firstColumn.add(1));
  const column2 = table.element(firstColumn.add(2));
  const column3 = table.element(firstColumn.add(3));
  return {
    matrix: TSL.mat4(column0, column1, column2, column3),
    position(position) {
      const local = TSL.vec4(position, 1);
      return column0.mul(local.x).add(column1.mul(local.y)).add(column2.mul(local.z)).add(column3.mul(local.w)).xyz;
    },
  };
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
  for (let index = 0; index < references.length; index += 1) {
    data[index >> 1] = (data[index >> 1] ?? 0) | (references[index]! << ((index & 1) * 16));
  }
  return { data, width, height };
}

function markUpdated(buffer: RetainedBuffer, byteOffset: number, byteLength: number): void {
  const scalarBytes = buffer.array.BYTES_PER_ELEMENT;
  if (byteOffset % scalarBytes !== 0 || byteLength % scalarBytes !== 0) {
    throw new RangeError('buffer patch is not scalar aligned');
  }
  syncDetachedUploadRange(buffer, byteOffset, byteLength);
  mergeUpdateRange(buffer.attribute, byteOffset / scalarBytes, byteLength / scalarBytes);
  buffer.attribute.needsUpdate = true;
  invalidatePboTexture(buffer.attribute);
}

function syncDetachedUploadRange(buffer: RetainedBuffer, byteOffset: number, byteLength: number): void {
  const upload = buffer.attribute.array;
  if (upload === buffer.array) return;
  if (upload.constructor !== buffer.array.constructor || upload.byteLength < buffer.array.byteLength) {
    throw new TypeError('Three replaced a text-plan upload array with an incompatible view');
  }
  const source = new Uint8Array(buffer.array.buffer, buffer.array.byteOffset + byteOffset, byteLength);
  const destination = new Uint8Array(upload.buffer, upload.byteOffset + byteOffset, byteLength);
  destination.set(source);
}

function mergeUpdateRange(attribute: THREE.BufferAttribute, start: number, count: number): void {
  let mergedStart = start;
  let mergedEnd = start + count;
  for (let index = attribute.updateRanges.length - 1; index >= 0; index -= 1) {
    const range = attribute.updateRanges[index]!;
    const rangeEnd = range.start + range.count;
    if (rangeEnd < mergedStart || mergedEnd < range.start) continue;
    mergedStart = Math.min(mergedStart, range.start);
    mergedEnd = Math.max(mergedEnd, rangeEnd);
    attribute.updateRanges.splice(index, 1);
  }
  attribute.addUpdateRange(mergedStart, mergedEnd - mergedStart);
}

function markOriginRanges(ranges: ReadonlyMap<RetainedBuffer, readonly [number, number]>): void {
  for (const [buffer, [start, end]] of ranges) {
    markUpdated(buffer, start * buffer.array.BYTES_PER_ELEMENT, (end - start) * buffer.array.BYTES_PER_ELEMENT);
  }
}

function invalidatePboTexture(attribute: THREE.StorageInstancedBufferAttribute): void {
  const pbo = (attribute as THREE.StorageInstancedBufferAttribute & { pbo?: THREE.DataTexture }).pbo;
  if (pbo !== undefined) pbo.needsUpdate = true;
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
