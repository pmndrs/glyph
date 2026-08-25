import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { textShaperAbi } from '../core.js';
import { decorationSchema, threeSystemBuffers } from './render-policy.js';
import { bitmapSchema } from '../raster/bitmap-technique.js';
import { msdfSchema } from '../raster/msdf.js';
import { slugSchema } from '../raster/slug-technique.js';
import type { AnyTechniqueSchema, PolicyBufferDeclaration, PolicyBufferDeclarations } from '../core.js';
import {
  TextEngineRenderPlanView,
  type PortableGeometryPayload,
  type PortableResourceGroupPayload,
  type PortableTextureArrayPayload,
  type PortableTexturePayload,
  type RenderPlanTable,
  type TextEnginePublication,
} from '../core.js';
import { bitmap } from '../raster/bitmap-technique.js';
import { msdf } from '../raster/msdf.js';
import { slug } from '../raster/slug-technique.js';

import { bitmapShader, decorationShader, msdfShader, slugShader, type TslSlugPageResources } from '../tsl.js';
import type { ThreeTextEngineCoordinator, ThreeTextEngineResource } from './engine-runtime.js';
import type { ThreeTextMaterialContext } from './material.js';
import type { ThreePlanProgramBuffer } from './plan-program-registry.js';

type ScalarArray = Float32Array | Uint32Array | Uint16Array;
const MAX_RESOURCE_KIND = 32;
const MAX_POLICY_BUFFER_VECTOR_WIDTH = 4;

interface RetainedBuffer {
  readonly id: number;
  readonly generation: number;
  readonly programId: number;
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
  readonly resourceKind: number;
  readonly referenceId: number;
}

interface RetainedSlugPage extends TslSlugPageResources {
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
  /** The lane's value with the glyph at rest. Displacement from it is the technique-free bridge. */
  targetX: number;
  targetY: number;
}

type TransformRealization =
  | Readonly<{ kind: 'direct'; transformId: number }>
  | Readonly<{ kind: 'indexed'; indices: RetainedBuffer }>;

interface RecordAddressing {
  readonly order: RetainedBuffer | undefined;
}

type DrawGeometry =
  | Readonly<{ kind: 'synthetic-quad'; key: 'synthetic-quad' }>
  | Readonly<{ kind: 'supplied'; key: string; resourceName: string; payload: PortableGeometryPayload }>;

interface ReusedDrawUpdate {
  readonly mesh: THREE.Mesh;
  readonly recordCount: number;
  readonly recordIndex: number;
  readonly transformId: number;
  readonly primitiveKind: 'decoration' | 'glyph';
  readonly matrixAutoUpdate: boolean;
  readonly renderOrder: number;
}

type StagedBufferOperation =
  | Readonly<{
      kind: 'write';
      buffer: RetainedBuffer;
      destinationOffset: number;
      payload: Uint8Array;
    }>
  | Readonly<{
      kind: 'fill';
      buffer: RetainedBuffer;
      destinationOffset: number;
      byteLength: number;
      value: number;
    }>
  | Readonly<{
      kind: 'copy';
      buffer: RetainedBuffer;
      destinationOffset: number;
      source: RetainedBuffer;
      sourceOffset: number;
      byteLength: number;
    }>
  | Readonly<{
      kind: 'restore-origin';
      buffer: RetainedBuffer;
      scalarOffset: number;
      x: number;
      y: number;
    }>;

interface StagedBufferUpload {
  readonly buffer: RetainedBuffer;
  start: number;
  end: number;
}

interface StagedBufferMutations {
  readonly operations: readonly StagedBufferOperation[];
  readonly uploads: readonly StagedBufferUpload[];
}

interface PreparedTransformUpdate {
  readonly mesh: THREE.Mesh;
  readonly matrix: THREE.Matrix4;
  readonly visible: boolean;
}

interface PreparedTransforms {
  readonly contents: Float32Array;
  readonly start: number;
  readonly end: number;
  readonly direct: readonly PreparedTransformUpdate[];
}

interface PreparedDrawReplacement {
  readonly changed: boolean;
  readonly root: THREE.Object3D;
  readonly draws: THREE.Mesh[];
  readonly keys: string[];
  readonly originSegments: OriginSegment[];
  readonly reused: ReadonlySet<THREE.Mesh>;
  readonly reusedUpdates: readonly ReusedDrawUpdate[];
  readonly activeTransformIndices: ReadonlySet<number>;
  readonly directDrawsByTransform: ReadonlyMap<number, THREE.Mesh[]>;
}

interface PreparationContext {
  readonly buffers: Map<number, RetainedBuffer>;
  readonly resources: Map<number, RetainedResource>;
  readonly bitmapTextures: Map<number, THREE.DataArrayTexture>;
  readonly msdfAtlases: Map<number, THREE.DataArrayTexture>;
  readonly slugPages: Map<number, RetainedSlugPage>;
  readonly materials: Map<string, MaterialRealization>;
  readonly newMaterials: Set<THREE.NodeMaterial>;
  readonly newTextures: Set<THREE.Texture | RetainedSlugPage>;
  transformAttribute: THREE.StorageInstancedBufferAttribute;
  transformGeneration: number;
}

interface PreparedPublication {
  readonly context: PreparationContext;
  readonly bufferMutations: StagedBufferMutations;
  readonly draws: PreparedDrawReplacement;
  readonly transforms: PreparedTransforms;
  readonly retiredMaterials: readonly THREE.NodeMaterial[];
  readonly retiredTextures: readonly (THREE.Texture | RetainedSlugPage)[];
}

const syntheticQuadGeometry: DrawGeometry = Object.freeze({ kind: 'synthetic-quad', key: 'synthetic-quad' });

export interface ThreeTextEnginePlanOwner {
  readonly drawRoot: THREE.Object3D;
  readonly pixelSnapping: boolean;
  objectForTransform(transformId: number): THREE.Object3D;
  /** Sparse direct identities and compact indexed slots that currently resolve to objects. */
  transformIds(): Iterable<number>;
  /** Compact slots that may address the dense GPU transform table. */
  transformIndices(): Iterable<number>;
  readonly renderOrderBase: number;
}

/** Applies retained Rust command-buffer deltas to Three storage attributes and draw objects. */
export class ThreeTextRenderPlanExecutor {
  readonly #coordinator: ThreeTextEngineCoordinator;
  readonly #owner: ThreeTextEnginePlanOwner;
  readonly #view = new TextEngineRenderPlanView();
  #buffers = new Map<number, RetainedBuffer>();
  #resources = new Map<number, RetainedResource>();
  #bitmapTextures = new Map<number, THREE.DataArrayTexture>();
  #msdfAtlases = new Map<number, THREE.DataArrayTexture>();
  #slugPages = new Map<number, RetainedSlugPage>();
  #materials = new Map<string, MaterialRealization>();
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
  #preparation: PreparationContext | undefined;
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

  apply(publication: TextEnginePublication): unknown | undefined {
    if (this.#disposed) throw new Error('Three text-engine plan target has been disposed');
    return this.#coordinator.applyPlan(() => {
      const prepared = this.#prepare(publication);
      return this.#commit(prepared);
    });
  }

  /**
   * Reads where each glyph is drawn, in paragraph glyph-origin space, and names what it could not read.
   *
   * The retained lane is NOT in glyph-origin space, and which space it is in is the technique's own
   * business: Slug and MSDF pack the ink box's top-left corner, and Bitmap stores the origin plus the
   * baked strike's raster bearing, which is a third space that no layout value can reconstruct. What
   * every technique does share is that `targetX`/`targetY` is that same lane's value with the glyph
   * at rest — the position the layout put it. So the displacement from rest, `value - target`, is in
   * glyph-origin space for all of them, and adding it to the shaped origin converts without the
   * executor knowing anything about the technique's packing at all.
   */
  snapshotGlyphOrigins(
    stableIds: Uint32Array,
    shapedX: Float32Array,
    shapedY: Float32Array,
  ): Readonly<{ drawnX: Float32Array; drawnY: Float32Array; incomplete: readonly number[] }> {
    if (stableIds.length !== shapedX.length || stableIds.length !== shapedY.length) {
      throw new RangeError('glyph origin snapshot arrays must be parallel');
    }
    this.#ensureOriginRecords();
    const drawnX = shapedX.slice();
    const drawnY = shapedY.slice();
    const incomplete: number[] = [];
    for (let index = 0; index < stableIds.length; index += 1) {
      const record = this.#originRecords.get(stableIds[index]!);
      if (record === undefined || !(record.buffer.array instanceof Float32Array)) {
        incomplete.push(index);
        continue;
      }
      const offset = record.index * record.buffer.vectorWidth;
      drawnX[index] = shapedX[index]! + (record.buffer.array[offset]! - record.targetX);
      drawnY[index] = shapedY[index]! + (record.buffer.array[offset + 1]! - record.targetY);
    }
    return { drawnX, drawnY, incomplete };
  }

  /**
   * Patches the retained buffer and returns the indices it could not reach, never silently skipping.
   *
   * `shapedX`/`shapedY` are the layout's rest positions for the same glyphs; the displacement from
   * them is what the record actually stores, under the reasoning on `snapshotGlyphOrigins`.
   */
  setGlyphOriginOverrides(
    stableIds: Uint32Array,
    shapedX: Float32Array,
    shapedY: Float32Array,
    x: Float32Array,
    y: Float32Array,
  ): readonly number[] {
    if (
      stableIds.length !== shapedX.length ||
      stableIds.length !== shapedY.length ||
      stableIds.length !== x.length ||
      stableIds.length !== y.length
    ) {
      throw new RangeError('glyph origin override arrays must be parallel');
    }
    this.#ensureOriginRecords();
    const touched = new Map<RetainedBuffer, readonly [number, number]>();
    const unapplied: number[] = [];
    for (let index = 0; index < stableIds.length; index += 1) {
      const record = this.#originRecords.get(stableIds[index]!);
      if (record === undefined || !(record.buffer.array instanceof Float32Array)) {
        unapplied.push(index);
        continue;
      }
      const offset = record.index * record.buffer.vectorWidth;
      record.buffer.array[offset] = record.targetX + (x[index]! - shapedX[index]!);
      record.buffer.array[offset + 1] = record.targetY + (y[index]! - shapedY[index]!);
      const range = touched.get(record.buffer);
      touched.set(record.buffer, [
        Math.min(range?.[0] ?? offset, offset),
        Math.max(range?.[1] ?? offset + 2, offset + 2),
      ]);
    }
    markOriginRanges(touched);
    return unapplied;
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

  #prepare(publication: TextEnginePublication): PreparedPublication {
    const plan = this.#view.bind(publication);
    const resources = plan.table('resources');
    const buffers = plan.table('buffers');
    const patches = plan.table('patches');
    const primitives = plan.table('primitives');
    const draws = plan.table('draws');
    const retirements = plan.table('retirements');
    const replacesDraws =
      resources.count !== 0 ||
      buffers.count !== 0 ||
      primitives.count !== 0 ||
      draws.count !== 0 ||
      retirements.count !== 0;
    const context: PreparationContext = {
      buffers: replacesDraws ? new Map(this.#buffers) : this.#buffers,
      resources: replacesDraws ? new Map(this.#resources) : this.#resources,
      bitmapTextures: replacesDraws ? new Map(this.#bitmapTextures) : this.#bitmapTextures,
      msdfAtlases: replacesDraws ? new Map(this.#msdfAtlases) : this.#msdfAtlases,
      slugPages: replacesDraws ? new Map(this.#slugPages) : this.#slugPages,
      materials: replacesDraws ? new Map(this.#materials) : this.#materials,
      newMaterials: new Set(),
      newTextures: new Set(),
      transformAttribute: this.#transformAttribute,
      transformGeneration: this.#transformGeneration,
    };
    let preparedDraws: PreparedDrawReplacement | undefined;
    this.#preparation = context;
    try {
      if (resources.count !== 0) this.#readResources(plan, resources, context.resources);
      if (buffers.count !== 0) this.#readBuffers(plan, buffers, context.buffers);
      preparedDraws = replacesDraws
        ? this.#prepareDraws(plan, draws, primitives, buffers, resources)
        : {
            changed: false,
            root: this.#owner.drawRoot,
            draws: this.#draws,
            keys: this.#drawKeys,
            originSegments: this.#originSegments,
            reused: new Set(),
            reusedUpdates: [],
            activeTransformIndices: this.#activeTransformIndices,
            directDrawsByTransform: this.#directDrawsByTransform,
          };
      this.#applyRetirementsToCandidate(plan, retirements, context);
      if (preparedDraws.changed) this.#assertDrawResourcesRetained(preparedDraws, context.materials);
      const transforms = this.#prepareTransforms(preparedDraws);
      const retainedMaterials = preparedDraws.changed
        ? new Set([...context.materials.values()].map(({ material }) => material))
        : undefined;
      const retiredMaterials =
        retainedMaterials === undefined
          ? []
          : [
              ...new Set([...[...this.#materials.values()].map(({ material }) => material), ...context.newMaterials]),
            ].filter((material) => !retainedMaterials.has(material));
      const retiredTextures = preparedDraws.changed ? this.#retiredTextures(context) : [];
      const bufferMutations = this.#stageBufferMutations(plan, patches, context.buffers);
      for (const { buffer } of bufferMutations.uploads) validateDetachedUpload(buffer);
      return { context, bufferMutations, draws: preparedDraws, transforms, retiredMaterials, retiredTextures };
    } catch (error) {
      this.#discardPreparation(context, preparedDraws);
      throw error;
    } finally {
      this.#preparation = undefined;
    }
  }

  #commit(prepared: PreparedPublication): unknown | undefined {
    let failure: unknown;
    const attempt = (operation: () => void): void => {
      try {
        operation();
      } catch (error) {
        failure ??= error;
      }
    };
    commitBufferMutations(prepared.bufferMutations);
    commitTransforms(prepared.context.transformAttribute, prepared.transforms);
    if (prepared.draws.changed) {
      for (const update of prepared.draws.reusedUpdates) applyReusedDrawUpdate(update);
    }
    for (const update of prepared.transforms.direct) applyTransformUpdate(update);
    if (prepared.draws.changed) {
      for (const mesh of prepared.draws.draws) {
        if (mesh.parent !== prepared.draws.root) attempt(() => prepared.draws.root.add(mesh));
      }
      for (const mesh of this.#draws) {
        if (prepared.draws.reused.has(mesh)) continue;
        attempt(() => mesh.removeFromParent());
        attempt(() => mesh.geometry.dispose());
      }
    }
    this.#buffers = prepared.context.buffers;
    this.#resources = prepared.context.resources;
    this.#bitmapTextures = prepared.context.bitmapTextures;
    this.#msdfAtlases = prepared.context.msdfAtlases;
    this.#slugPages = prepared.context.slugPages;
    this.#materials = prepared.context.materials;
    this.#transformAttribute = prepared.context.transformAttribute;
    this.#transformGeneration = prepared.context.transformGeneration;
    if (prepared.draws.changed) {
      this.#draws = prepared.draws.draws;
      this.#drawKeys = prepared.draws.keys;
      this.#originSegments = prepared.draws.originSegments;
      this.#activeTransformIndices.clear();
      for (const id of prepared.draws.activeTransformIndices) this.#activeTransformIndices.add(id);
      this.#directDrawsByTransform.clear();
      for (const [id, meshes] of prepared.draws.directDrawsByTransform) {
        this.#directDrawsByTransform.set(id, meshes);
      }
    }
    for (const material of prepared.context.newMaterials) this.#ownedMaterials.add(material);
    for (const material of prepared.retiredMaterials) attempt(() => material.dispose());
    for (const texture of prepared.retiredTextures) attempt(() => texture.dispose());
    for (const draw of this.#draws) attempt(() => draw.updateMatrixWorld(false));
    this.#originRecords.clear();
    return failure;
  }

  #readResources(
    plan: TextEngineRenderPlanView,
    table: RenderPlanTable,
    resources: Map<number, RetainedResource>,
  ): void {
    const layout = textShaperAbi.layouts.engineResource;
    const actions = textShaperAbi.engine.resourceActions;
    for (let index = 0; index < table.count; index += 1) {
      const record = plan.record(table, index);
      const action = plan.u16(record + layout.action);
      if (action !== actions.create && action !== actions.update && action !== actions.retain) {
        throw new Error(`text-engine resource has unsupported action ${action}`);
      }
      const resource: RetainedResource = {
        id: plan.u32(record + layout.id),
        generation: plan.u32(record + layout.generation),
        techniqueId: plan.u32(record + layout.techniqueId),
        resourceKind: plan.u16(record + layout.resourceKind),
        referenceId: plan.u32(record + layout.referenceId),
      };
      if (resource.id === 0 || resource.generation === 0 || resource.referenceId === 0) {
        throw new Error('text-engine resources require nonzero identities and generations');
      }
      if (resource.resourceKind === 0 || resource.resourceKind > MAX_RESOURCE_KIND) {
        throw new RangeError(`text-engine resource ${resource.id}:${resource.generation} has an invalid kind`);
      }
      const resolved = this.#coordinator.resolveResource(resource.referenceId);
      const techniqueId = this.#coordinator.host.wireIdentities.techniqueId(resolved.technique);
      if (resource.techniqueId !== techniqueId) {
        throw new Error(`resource ${resource.id}:${resource.generation} contradicts its registered technique`);
      }
      const existing = resources.get(resource.id);
      if (existing !== undefined && resource.generation < existing.generation) {
        throw new Error(`resource ${resource.id} rejects stale generation ${resource.generation}`);
      }
      if (existing?.generation === resource.generation && !sameRetainedResource(existing, resource)) {
        throw new Error(`resource ${resource.id}:${resource.generation} changed without a generation advance`);
      }
      resources.set(resource.id, resource);
    }
  }

  #readBuffers(plan: TextEngineRenderPlanView, table: RenderPlanTable, buffers: Map<number, RetainedBuffer>): void {
    const layout = textShaperAbi.layouts.engineBuffer;
    for (let index = 0; index < table.count; index += 1) {
      const record = plan.record(table, index);
      const id = plan.u32(record + layout.id);
      const generation = plan.u32(record + layout.generation);
      const scalarType = plan.u8(record + layout.scalarType);
      const vectorWidth = plan.u8(record + layout.vectorWidth);
      const capacityRecords = plan.u32(record + layout.capacityRecords);
      const byteLength = plan.u32(record + layout.byteLength);
      const programId = plan.u32(record + layout.programId);
      const policyBufferId = plan.u16(record + layout.policyBufferId);
      const existing = buffers.get(id);
      if (id === 0 || generation === 0 || programId === 0 || policyBufferId === 0) {
        throw new Error('text-engine buffers require nonzero identities and generations');
      }
      if (existing !== undefined && generation < existing.generation) {
        throw new Error(`buffer ${id} rejects stale generation ${generation}`);
      }
      if (
        vectorWidth === 0 ||
        vectorWidth > MAX_POLICY_BUFFER_VECTOR_WIDTH ||
        capacityRecords === 0 ||
        byteLength === 0
      ) {
        throw new RangeError(`buffer ${id}:${generation} has an invalid physical shape`);
      }
      if (existing?.generation === generation) {
        if (
          existing.programId !== programId ||
          existing.policyBufferId !== policyBufferId ||
          existing.scalarType !== scalarType ||
          existing.vectorWidth !== vectorWidth ||
          existing.capacityRecords !== capacityRecords ||
          existing.array.byteLength !== byteLength
        ) {
          throw new Error(`buffer ${id}:${generation} changed without a generation advance`);
        }
        continue;
      }
      const array = scalarArray(scalarType, byteLength);
      if (array.length !== capacityRecords * vectorWidth) {
        throw new Error('first-party Three policy requires tightly packed physical buffers');
      }
      const attribute = new THREE.StorageInstancedBufferAttribute(array, vectorWidth);
      attribute.setUsage(THREE.DynamicDrawUsage);
      attribute.needsUpdate = true;
      buffers.set(id, {
        id,
        generation,
        programId,
        policyBufferId,
        scalarType,
        vectorWidth,
        capacityRecords,
        array,
        attribute,
      });
    }
  }

  #stageBufferMutations(
    plan: TextEngineRenderPlanView,
    table: RenderPlanTable,
    buffers: ReadonlyMap<number, RetainedBuffer>,
  ): StagedBufferMutations {
    const layout = textShaperAbi.layouts.enginePatch;
    const opcodes = textShaperAbi.engine.patchOpcodes;
    const operations: StagedBufferOperation[] = [];
    const staged = new Map<RetainedBuffer, StagedBufferUpload>();
    const mutable = (buffer: RetainedBuffer): StagedBufferUpload => {
      let upload = staged.get(buffer);
      if (upload !== undefined) return upload;
      validateDetachedUpload(buffer);
      upload = { buffer, start: buffer.array.byteLength, end: 0 };
      staged.set(buffer, upload);
      return upload;
    };
    for (const origin of this.#originRecords.values()) {
      const buffer = buffers.get(origin.buffer.id);
      if (buffer !== origin.buffer || !(buffer.array instanceof Float32Array)) continue;
      const offset = origin.index * buffer.vectorWidth;
      assertByteRange(
        offset * Float32Array.BYTES_PER_ELEMENT,
        2 * Float32Array.BYTES_PER_ELEMENT,
        buffer.array.byteLength,
        'glyph origin record exceeds its retained buffer',
      );
      operations.push({
        kind: 'restore-origin',
        buffer,
        scalarOffset: offset,
        x: origin.targetX,
        y: origin.targetY,
      });
      includeMutationRange(
        mutable(buffer),
        offset * Float32Array.BYTES_PER_ELEMENT,
        2 * Float32Array.BYTES_PER_ELEMENT,
      );
    }

    for (let index = 0; index < table.count; index += 1) {
      const record = plan.record(table, index);
      const opcode = plan.u16(record + layout.opcode);
      const buffer = retainedBuffer(
        buffers,
        plan.u32(record + layout.bufferId),
        plan.u32(record + layout.bufferGeneration),
      );
      const destinationOffset = plan.u32(record + layout.destinationOffset);
      const byteLength = plan.u32(record + layout.byteLength);

      if (opcode === opcodes.allocateOrResize) {
        if (destinationOffset !== 0 || byteLength !== buffer.array.byteLength) {
          throw new RangeError('allocation patch does not match its retained buffer');
        }
        continue;
      }
      if (opcode === opcodes.retire) continue;

      const destination = scalarBytes(buffer.array);
      assertByteRange(destinationOffset, byteLength, destination.byteLength, 'buffer patch exceeds allocation');
      assertScalarAligned(buffer, destinationOffset, byteLength);

      if (opcode === opcodes.write) {
        operations.push({
          kind: 'write',
          buffer,
          destinationOffset,
          payload: plan.bytes(plan.u32(record + layout.payloadOffset), byteLength),
        });
      } else if (opcode === opcodes.fill) {
        const fill = plan.u32(record + layout.fillValue);
        if (byteLength % 4 !== 0) throw new RangeError('fill patch is not u32 aligned');
        operations.push({ kind: 'fill', buffer, destinationOffset, byteLength, value: fill });
      } else if (opcode === opcodes.copy) {
        const source = buffers.get(plan.u32(record + layout.sourceBufferId));
        if (source === undefined) throw new Error('copy patch references an unknown source buffer');

        const sourceOffset = plan.u32(record + layout.sourceOffset);
        const sourceBytes = scalarBytes(source.array);
        assertByteRange(sourceOffset, byteLength, sourceBytes.byteLength, 'copy patch exceeds its source buffer');
        assertScalarAligned(source, sourceOffset, byteLength);
        operations.push({ kind: 'copy', buffer, destinationOffset, source, sourceOffset, byteLength });
      } else {
        throw new Error(`unsupported text-engine patch opcode ${opcode}`);
      }
      includeMutationRange(mutable(buffer), destinationOffset, byteLength);
    }
    return {
      operations,
      uploads: [...staged.values()].filter(({ start, end }) => end > start),
    };
  }

  #prepareDraws(
    plan: TextEngineRenderPlanView,
    draws: RenderPlanTable,
    primitives: RenderPlanTable,
    buffers: RenderPlanTable,
    resources: RenderPlanTable,
  ): PreparedDrawReplacement {
    const context = this.#preparation;
    if (context === undefined) throw new Error('Three draw preparation requires an active publication');
    const root = this.#owner.drawRoot;
    const drawLayout = textShaperAbi.layouts.engineDraw;
    const primitiveLayout = textShaperAbi.layouts.enginePrimitive;
    const bufferLayout = textShaperAbi.layouts.engineBuffer;
    const resourceLayout = textShaperAbi.layouts.engineResource;

    const next: THREE.Mesh[] = [];
    const nextKeys: string[] = [];
    const nextOriginSegments: OriginSegment[] = [];
    const reusedUpdates: ReusedDrawUpdate[] = [];
    const previous = new Map<string, THREE.Mesh[]>();

    for (let index = 0; index < this.#draws.length; index += 1) {
      const key = this.#drawKeys[index]!;
      const matches = previous.get(key) ?? [];
      matches.push(this.#draws[index]!);
      previous.set(key, matches);
    }

    const reused = new Set<THREE.Mesh>();
    const transformIndices = this.#collectTransformIndices(plan, draws);
    if (this.#ensureTransformCapacity(context, transformIndices)) {
      for (const [key, realization] of context.materials) {
        if (realization.indexedTransform) context.materials.delete(key);
      }
    }

    try {
      for (let index = 0; index < draws.count; index += 1) {
        const draw = plan.record(draws, index);
        if (plan.u32(draw + drawLayout.primitiveCount) !== 1) {
          throw new Error('first-party Three plan target requires one primitive span per draw');
        }

        const primitiveIndex = plan.u32(draw + drawLayout.primitiveStart);
        const primitive = plan.record(primitives, primitiveIndex);
        const programId = plan.u32(draw + drawLayout.programId);
        const programVariant = plan.u16(draw + drawLayout.programVariant);
        if (
          plan.u32(primitive + primitiveLayout.programId) !== programId ||
          plan.u16(primitive + primitiveLayout.programVariant) !== programVariant
        ) {
          throw new Error('draw and primitive disagree about their renderer program');
        }
        const primitiveKind = plan.u16(primitive + primitiveLayout.kind);
        if (
          primitiveKind !== textShaperAbi.engine.primitiveKinds.glyph &&
          primitiveKind !== textShaperAbi.engine.primitiveKinds.decoration
        ) {
          throw new Error('first-party Three plan target does not yet realize this primitive kind');
        }

        const drawBufferStart = plan.u32(draw + drawLayout.bufferStart);
        const drawBufferCount = plan.u32(draw + drawLayout.bufferCount);
        const byPolicyId = new Map<number, RetainedBuffer>();
        for (let bufferIndex = drawBufferStart; bufferIndex < drawBufferStart + drawBufferCount; bufferIndex += 1) {
          const record = plan.record(buffers, bufferIndex);
          const buffer = this.#buffer(plan.u32(record + bufferLayout.id), plan.u32(record + bufferLayout.generation));
          if (plan.u32(record + bufferLayout.programId) !== programId || buffer.programId !== programId) {
            throw new Error('draw contains a buffer owned by a different renderer program');
          }
          if (byPolicyId.has(buffer.policyBufferId)) {
            throw new Error(`draw repeats policy buffer ${buffer.policyBufferId}`);
          }
          byPolicyId.set(buffer.policyBufferId, buffer);
        }

        const decoration = primitiveKind === textShaperAbi.engine.primitiveKinds.decoration;
        const primitiveResourceId = plan.u32(primitive + primitiveLayout.resourceId);
        const primitiveResourceGeneration = plan.u32(primitive + primitiveLayout.resourceGeneration);
        const resourceStart = plan.u32(draw + drawLayout.resourceStart);
        const resourceCount = plan.u32(draw + drawLayout.resourceCount);
        if (decoration ? resourceCount !== 0 : resourceCount === 0) {
          throw new Error(
            decoration ? 'decoration draw unexpectedly references resources' : 'glyph draw has no resource',
          );
        }
        if (decoration && (primitiveResourceId !== 0 || primitiveResourceGeneration !== 0)) {
          throw new Error('decoration primitive unexpectedly references a resource');
        }
        const resourceRecord = decoration ? undefined : plan.record(resources, resourceStart);
        const resource =
          resourceRecord === undefined
            ? undefined
            : this.#resourcesForPreparation().get(plan.u32(resourceRecord + resourceLayout.id));
        if (!decoration && resource === undefined) {
          throw new Error('draw references an unknown retained resource');
        }
        const techniqueId = plan.u32(primitive + primitiveLayout.techniqueId);
        if (resource !== undefined) {
          if (primitiveResourceId !== resource.id || primitiveResourceGeneration !== resource.generation) {
            throw new Error('primitive and draw disagree about their primary resource');
          }
          for (let resourceIndex = resourceStart; resourceIndex < resourceStart + resourceCount; resourceIndex += 1) {
            const row = plan.record(resources, resourceIndex);
            const retained = context.resources.get(plan.u32(row + resourceLayout.id));
            if (
              retained === undefined ||
              retained.generation !== plan.u32(row + resourceLayout.generation) ||
              retained.techniqueId !== techniqueId ||
              plan.u32(row + resourceLayout.techniqueId) !== techniqueId
            ) {
              throw new Error('draw contains a resource owned by a different technique');
            }
          }
        }

        const materialId = plan.u32(draw + drawLayout.materialId);
        const transformId = plan.u32(draw + drawLayout.transformId);
        const recordIndex = plan.u32(primitive + primitiveLayout.recordIndex);
        const recordCount = plan.u16(primitive + primitiveLayout.recordCount);
        if (recordCount === 0) throw new RangeError('draw primitive needs a positive record count');
        for (const buffer of byPolicyId.values()) {
          if (recordIndex > buffer.capacityRecords || recordCount > buffer.capacityRecords - recordIndex) {
            throw new RangeError('draw record span exceeds a retained buffer');
          }
        }
        const addressing = recordAddressing(plan, draw, primitive, byPolicyId);
        const transform = this.#transformRealization(byPolicyId, transformId);
        const resolvedResource =
          resource === undefined ? undefined : this.#coordinator.resolveResource(resource.referenceId);
        const expectedTechnique = resolvedResource?.technique ?? decorationSchema.technique;
        const expectedTechniqueId = this.#coordinator.host.wireIdentities.techniqueId(expectedTechnique);
        const expectedProgramId =
          resolvedResource?.program !== undefined
            ? resolvedResource.program.programId
            : this.#coordinator.host.wireIdentities.programId(expectedTechnique, 'three');
        const expectedProgramVariant =
          resolvedResource?.program !== undefined ? (resolvedResource.program.policy.variant ?? 0) : 0;
        if (
          techniqueId !== expectedTechniqueId ||
          programId !== expectedProgramId ||
          programVariant !== expectedProgramVariant
        ) {
          throw new Error('draw program contradicts its registered technique implementation');
        }
        const drawGeometry = resolveDrawGeometry(resolvedResource);
        const material = decoration
          ? this.#decorationMaterial(byPolicyId, transform, addressing)
          : this.#material(resource!, byPolicyId, materialId, transform, addressing);
        const originDeclaration =
          decoration || resource === undefined ? undefined : glyphOriginBuffer(resolvedResource!);
        const origins = originDeclaration === undefined ? undefined : byPolicyId.get(originDeclaration.id);
        const stableIds = decoration ? undefined : byPolicyId.get(threeSystemBuffers.stableGlyphId.id);
        if (originDeclaration !== undefined && origins !== undefined && stableIds !== undefined) {
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
          context.transformGeneration,
          drawGeometry.key,
        );

        const reusable = previous.get(key)?.shift();
        if (reusable !== undefined) {
          assertGeometryInstanceCompatibility(reusable.geometry);
          reusedUpdates.push({
            mesh: reusable,
            recordCount,
            recordIndex,
            transformId,
            primitiveKind: decoration ? 'decoration' : 'glyph',
            matrixAutoUpdate: transform.kind !== 'direct',
            renderOrder: this.#owner.renderOrderBase + index,
          });
          reused.add(reusable);
          next.push(reusable);
          nextKeys.push(key);
          continue;
        }

        const geometry = realizeGeometry(drawGeometry, recordCount);
        for (const buffer of byPolicyId.values()) {
          geometry.setAttribute(`_pmndrsGlyph_${buffer.policyBufferId}`, buffer.attribute);
        }

        if (transform.kind === 'indexed') geometry.setAttribute('_pmndrsGlyphTransforms', context.transformAttribute);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.pmndrsGlyphRunStart = recordIndex;
        mesh.userData.pmndrsGlyphTransformId = transformId;
        mesh.userData.pmndrsGlyphPrimitiveKind = decoration ? 'decoration' : 'glyph';
        mesh.matrixAutoUpdate = transform.kind !== 'direct';
        mesh.frustumCulled = false;
        mesh.renderOrder = this.#owner.renderOrderBase + index;
        next.push(mesh);
        nextKeys.push(key);
      }
    } catch (error) {
      for (const mesh of next) {
        if (reused.has(mesh)) continue;
        try {
          mesh.geometry.dispose();
        } catch {
          // Preserve the preparation failure; cleanup is best-effort and the mesh was never published.
        }
      }
      throw error;
    }
    const directDrawsByTransform = new Map<number, THREE.Mesh[]>();
    for (const draw of next) {
      const transformId = directTransformId(draw);
      if (transformId === 0) continue;
      const transformDraws = directDrawsByTransform.get(transformId) ?? [];
      transformDraws.push(draw);
      directDrawsByTransform.set(transformId, transformDraws);
    }
    return {
      changed: true,
      root,
      draws: next,
      keys: nextKeys,
      originSegments: nextOriginSegments,
      reused,
      reusedUpdates,
      activeTransformIndices: transformIndices,
      directDrawsByTransform,
    };
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
    const indices = buffers.get(threeSystemBuffers.transformIndex.id);
    if (indices === undefined || !(indices.array instanceof Uint32Array)) {
      throw new Error('indexed Three draw is missing its u32 transform-index buffer');
    }
    return { kind: 'indexed', indices };
  }

  #collectTransformIndices(plan: TextEngineRenderPlanView, draws: RenderPlanTable): Set<number> {
    const drawLayout = textShaperAbi.layouts.engineDraw;
    for (let drawIndex = 0; drawIndex < draws.count; drawIndex += 1) {
      const draw = plan.record(draws, drawIndex);
      if (plan.u32(draw + drawLayout.transformId) === 0) return new Set(this.#owner.transformIndices());
    }
    return new Set();
  }

  #ensureTransformCapacity(context: PreparationContext, indices: ReadonlySet<number>): boolean {
    let maximum = 0;
    for (const index of indices) maximum = Math.max(maximum, index);
    const requiredRecords = (maximum + 1) * 4;
    if (context.transformAttribute.count >= requiredRecords) return false;
    let capacity = context.transformAttribute.count;
    while (capacity < requiredRecords) capacity *= 2;
    context.transformAttribute = transformAttribute(capacity / 4);
    context.transformGeneration += 1;
    return true;
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
    const atlas = textureArrayResource(resolved, 'atlas', 'r8unorm', 'Bitmap');
    const part = schemaDrawBuffers(bitmapSchema, buffers, 'Bitmap');
    const required = [part.origin, part.size, part.uvOrigin, part.uvSize, part.color, part.page];
    const key = `${resource.id}:${resource.generation}:${materialId}:snap=${String(this.#owner.pixelSnapping)}:${required
      .map((buffer) => `${buffer.id}:${buffer.generation}`)
      .join(
        ',',
      )}:${transformProgramKey(transform, this.#transformGenerationForRealization())}:${addressingProgramKey(addressing)}`;
    const cached = this.#materialRealizations().get(key);
    if (cached !== undefined) return cached.material;
    const texture = this.#bitmapTexture(resource.referenceId, atlas);
    const runStart = TSL.uniform(0, 'uint').onObjectUpdate(
      ({ object }) => (object?.userData.pmndrsGlyphRunStart as number | undefined) ?? 0,
    );
    const instance = physicalInstance(TSL.instanceIndex.add(runStart), addressing);
    const shader = bitmapShader(
      {
        origin: TSL.storage(part.origin.attribute, 'vec2', part.origin.attribute.count).setPBO(true).element(instance),
        size: TSL.storage(part.size.attribute, 'vec2', part.size.attribute.count).setPBO(true).element(instance),
        uvOrigin: TSL.storage(part.uvOrigin.attribute, 'vec2', part.uvOrigin.attribute.count)
          .setPBO(true)
          .element(instance),
        uvSize: TSL.storage(part.uvSize.attribute, 'vec2', part.uvSize.attribute.count).setPBO(true).element(instance),
        color: TSL.storage(part.color.attribute, 'vec4', part.color.attribute.count).setPBO(true).element(instance),
        pageIndex: TSL.storage(part.page.attribute, 'uint', part.page.attribute.count).setPBO(true).element(instance),
      },
      { page: texture },
      { pixelSnapping: this.#owner.pixelSnapping },
    );
    const position =
      transform.kind === 'indexed'
        ? indexedTransformPosition(
            shader.position,
            transform.indices.attribute,
            this.#transformAttributeForRealization(),
            instance,
          )
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

  #decorationMaterial(
    buffers: ReadonlyMap<number, RetainedBuffer>,
    transform: TransformRealization,
    addressing: RecordAddressing,
  ): THREE.NodeMaterial {
    const rect = buffers.get(decorationSchema.buffers.rect.id);
    const packed = buffers.get(decorationSchema.buffers.packed.id);
    if (rect === undefined || packed === undefined) {
      throw new Error('decoration draw is missing its rectangle or packed policy buffer');
    }
    const key = `decoration:${rect.id}:${rect.generation}:${packed.id}:${packed.generation}:${transformProgramKey(
      transform,
      this.#transformGenerationForRealization(),
    )}:${addressingProgramKey(addressing)}`;
    const cached = this.#materialRealizations().get(key);
    if (cached !== undefined) return cached.material;
    const runStart = TSL.uniform(0, 'uint').onObjectUpdate(
      ({ object }) => (object?.userData.pmndrsGlyphRunStart as number | undefined) ?? 0,
    );
    const instance = physicalInstance(TSL.instanceIndex.add(runStart), addressing);
    const shader = decorationShader({
      rect: TSL.storage(rect.attribute, 'vec4', rect.attribute.count).setPBO(true).element(instance),
      packed: TSL.storage(packed.attribute, 'uvec2', packed.attribute.count).setPBO(true).element(instance),
    });
    const position =
      transform.kind === 'indexed'
        ? indexedTransformPosition(
            shader.position,
            transform.indices.attribute,
            this.#transformAttributeForRealization(),
            instance,
          )
        : shader.position;
    const material = baseTextMaterial();
    material.positionNode = position;
    material.colorNode = shader.color;
    material.opacityNode = shader.opacity;
    this.#retainMaterial(
      key,
      material,
      undefined,
      materialBuffers([rect, packed], transform, addressing),
      transform.kind,
    );
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
    if (resolved.program !== undefined) {
      return this.#planProgramMaterial(
        resource,
        { ...resolved, program: resolved.program },
        buffers,
        materialId,
        transform,
        addressing,
      );
    }
    throw new Error('this Three plan target does not recognize the draw technique');
  }

  #planProgramMaterial(
    resource: RetainedResource,
    resolved: ThreeTextEngineResource & { readonly program: NonNullable<ThreeTextEngineResource['program']> },
    buffers: ReadonlyMap<number, RetainedBuffer>,
    materialId: number,
    transform: TransformRealization,
    addressing: RecordAddressing,
  ): THREE.NodeMaterial {
    const required = [...buffers.values()];
    const resourceReferences = [...new Set(resolved.resourceReferences.values())].sort((left, right) => left - right);
    const key = `external:${resource.id}:${resource.generation}:${resourceReferences.join(',')}:${materialId}:${required
      .map((buffer) => `${buffer.policyBufferId}:${buffer.id}:${buffer.generation}`)
      .join(
        ',',
      )}:${transformProgramKey(transform, this.#transformGenerationForRealization())}:${addressingProgramKey(addressing)}`;
    const cached = this.#materialRealizations().get(key);
    if (cached !== undefined) return cached.material;
    const runStart = TSL.uniform(0, 'uint').onObjectUpdate(
      ({ object }) => (object?.userData.pmndrsGlyphRunStart as number | undefined) ?? 0,
    );
    const instance = physicalInstance(TSL.instanceIndex.add(runStart), addressing);
    const namedBuffers = new Map<string, ThreePlanProgramBuffer>();
    for (const [name, declaration] of Object.entries(resolved.program.schema.buffers)) {
      const source = buffers.get(declaration.id);
      const buffer =
        source === undefined
          ? undefined
          : { scalarType: source.scalarType, vectorWidth: source.vectorWidth, attribute: source.attribute };
      if (buffer === undefined) throw new Error(`Three draw is missing declared policy buffer "${name}"`);
      namedBuffers.set(name, buffer);
    }
    const material = this.#ownMaterial(
      resolved.program.createMaterial({
        technique: resolved.program.technique,
        schema: resolved.program.schema,
        variantId: resolved.program.variant.id,
        language: resolved.program.variant.language,
        namedBuffers,
        namedResources: resolved.resources,
        outputTypes: resolved.program.variant.outputs,
        resourceName: resolved.resourceName,
        instance,
        materialId,
        material: this.#coordinator.resolveMaterial(materialId),
        transformPosition: (position) =>
          transform.kind === 'indexed'
            ? indexedTransformPosition(
                position,
                transform.indices.attribute,
                this.#transformAttributeForRealization(),
                instance,
              )
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
    const atlas = resourceGroup(this.#coordinator.resolveResource(resource.referenceId), 'atlas', 'MSDF');
    const data = textureArrayMember(atlas, 'texture', 'rgba8unorm', 'MSDF');
    const pixelRange = f32BufferMember(atlas, 'pixelRange', 'MSDF');
    const part = schemaDrawBuffers(msdfSchema, buffers, 'MSDF');
    const required = [part.rect, part.uvRect, part.uvBounds, part.color, part.effectA, part.effectB, part.page];
    const key = `msdf:${resource.id}:${resource.generation}:${materialId}:${required
      .map((buffer) => `${buffer.id}:${buffer.generation}`)
      .join(
        ',',
      )}:${transformProgramKey(transform, this.#transformGenerationForRealization())}:${addressingProgramKey(addressing)}`;
    const cached = this.#materialRealizations().get(key);
    if (cached !== undefined) return cached.material;
    const runStart = TSL.uniform(0, 'uint').onObjectUpdate(
      ({ object }) => (object?.userData.pmndrsGlyphRunStart as number | undefined) ?? 0,
    );
    const instance = physicalInstance(TSL.instanceIndex.add(runStart), addressing);
    const field = (buffer: RetainedBuffer) =>
      TSL.storage(buffer.attribute, 'vec4', buffer.attribute.count).setPBO(true).element(instance);
    const rect = field(part.rect);
    const uvRect = field(part.uvRect);
    const page = field(part.page);
    const shader = msdfShader(
      {
        origin: rect.xy,
        size: rect.zw,
        uvOrigin: uvRect.xy,
        uvSize: uvRect.zw,
        uvBounds: field(part.uvBounds),
        fillColor: field(part.color),
        outlineColor: field(part.effectA),
        shadowColor: field(part.effectB),
        shadowOffset: page.xy,
        outlineWidth: page.z,
        pageIndex: page.w,
      },
      {
        atlas: this.#msdfAtlas(resource.referenceId, data),
        atlasWidth: data.width,
        atlasHeight: data.height,
        pixelRange,
      },
    );
    const position =
      transform.kind === 'indexed'
        ? indexedTransformPosition(
            shader.position,
            transform.indices.attribute,
            this.#transformAttributeForRealization(),
            instance,
          )
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

  #bitmapTexture(referenceId: number, data: PortableTextureArrayPayload): THREE.DataArrayTexture {
    const textures = this.#bitmapTexturesForRealization();
    let texture = textures.get(referenceId);
    if (texture !== undefined) return texture;
    texture = new THREE.DataArrayTexture(data.bytes, data.width, data.height, data.layers);
    texture.format = THREE.RedFormat;
    texture.type = THREE.UnsignedByteType;
    texture.colorSpace = THREE.NoColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.flipY = false;
    texture.needsUpdate = true;
    this.#preparation?.newTextures.add(texture);
    textures.set(referenceId, texture);
    return texture;
  }

  #msdfAtlas(referenceId: number, data: PortableTextureArrayPayload): THREE.DataArrayTexture {
    const atlases = this.#msdfAtlasesForRealization();
    let atlas = atlases.get(referenceId);
    if (atlas !== undefined) return atlas;
    atlas = new THREE.DataArrayTexture(data.bytes, data.width, data.height, data.layers);
    atlas.format = THREE.RGBAFormat;
    atlas.type = THREE.UnsignedByteType;
    atlas.colorSpace = THREE.NoColorSpace;
    atlas.magFilter = THREE.LinearFilter;
    atlas.minFilter = THREE.LinearFilter;
    atlas.generateMipmaps = false;
    atlas.needsUpdate = true;
    this.#preparation?.newTextures.add(atlas);
    atlases.set(referenceId, atlas);
    return atlas;
  }

  #slugMaterial(
    resource: RetainedResource,
    buffers: ReadonlyMap<number, RetainedBuffer>,
    materialId: number,
    transformRealization: TransformRealization,
    addressing: RecordAddressing,
  ): THREE.NodeMaterial {
    const page = resourceGroup(this.#coordinator.resolveResource(resource.referenceId), 'page', 'Slug');
    const part = schemaDrawBuffers(slugSchema, buffers, 'Slug');
    const required = [
      part.rect,
      part.planeRect,
      part.bandTransform,
      part.color,
      part.inverseFontSize,
      part.tableStarts,
      part.bandCounts,
    ];
    const key = `slug:${resource.id}:${resource.generation}:${materialId}:${required
      .map((buffer) => `${buffer.id}:${buffer.generation}`)
      .join(
        ',',
      )}:${transformProgramKey(transformRealization, this.#transformGenerationForRealization())}:${addressingProgramKey(addressing)}`;
    const cached = this.#materialRealizations().get(key);
    if (cached !== undefined) return cached.material;
    const runStart = TSL.uniform(0, 'uint').onObjectUpdate(
      ({ object }) => (object?.userData.pmndrsGlyphRunStart as number | undefined) ?? 0,
    );
    const instance = physicalInstance(TSL.instanceIndex.add(runStart), addressing);
    const field = (buffer: RetainedBuffer) =>
      TSL.storage(buffer.attribute, 'vec4', buffer.attribute.count).setPBO(true).element(instance);
    const rect = field(part.rect);
    const planeRect = field(part.planeRect);
    const addresses = TSL.storage(part.tableStarts.attribute, 'uvec4', part.tableStarts.attribute.count)
      .setPBO(true)
      .element(instance);
    const counts = TSL.storage(part.bandCounts.attribute, 'uvec4', part.bandCounts.attribute.count)
      .setPBO(true)
      .element(instance);
    const indexedTransform =
      transformRealization.kind === 'indexed'
        ? indexedTransformNodes(
            transformRealization.indices.attribute,
            this.#transformAttributeForRealization(),
            instance,
          )
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
        origin: rect.xy,
        size: rect.zw,
        emOrigin: planeRect.xy,
        emSize: planeRect.zw,
        bandTransform: field(part.bandTransform),
        color: field(part.color),
        inverseScale: field(part.inverseFontSize).x,
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

  #slugPage(referenceId: number, data: PortableResourceGroupPayload): RetainedSlugPage {
    const pages = this.#slugPagesForRealization();
    let page = pages.get(referenceId);
    if (page !== undefined) return page;
    const curves = textureMember(data, 'curves', 'rgba16float', 'Slug');
    const headers = textureMember(data, 'headers', 'r32uint', 'Slug');
    const references = textureMember(data, 'references', 'r32uint', 'Slug');
    const curveBytes = ownedUint16(curves.bytes);
    const headerBytes = ownedUint32(headers.bytes);
    const referenceBytes = ownedUint32(references.bytes);
    const curveTexture = dataTexture(curveBytes, curves.width, curves.height, THREE.RGBAFormat, THREE.HalfFloatType);
    const headerTexture = dataTexture(
      headerBytes,
      headers.width,
      headers.height,
      THREE.RedIntegerFormat,
      THREE.UnsignedIntType,
    );
    const referenceTexture = dataTexture(
      referenceBytes,
      references.width,
      references.height,
      THREE.RedIntegerFormat,
      THREE.UnsignedIntType,
    );
    page = {
      curveTexture,
      curveWidth: curves.width,
      headerTexture,
      headerWidth: headers.width,
      referenceTexture,
      referenceWidth: references.width,
      byteLength: curveBytes.byteLength + headerBytes.byteLength + referenceBytes.byteLength,
      dispose() {
        curveTexture.dispose();
        headerTexture.dispose();
        referenceTexture.dispose();
      },
    };
    this.#preparation?.newTextures.add(page);
    pages.set(referenceId, page);
    return page;
  }

  #createMaterial(materialId: number, context: ThreeTextMaterialContext): THREE.NodeMaterial {
    const definition = this.#coordinator.resolveMaterial(materialId);
    return this.#ownMaterial(definition?.create(context) ?? context.createDefaultMaterial());
  }

  #ownMaterial(material: THREE.NodeMaterial): THREE.NodeMaterial {
    if (material?.isNodeMaterial !== true)
      throw new TypeError('text material factory must return a Three NodeMaterial');
    if (this.#ownedMaterials.has(material) || this.#preparation?.newMaterials.has(material) === true) {
      throw new TypeError('text material factory must return a fresh unowned NodeMaterial');
    }
    if (this.#preparation === undefined) this.#ownedMaterials.add(material);
    else this.#preparation.newMaterials.add(material);
    return material;
  }

  #retainMaterial(
    key: string,
    material: THREE.NodeMaterial,
    resource: RetainedResource | undefined,
    buffers: readonly RetainedBuffer[],
    transformKind: TransformRealization['kind'],
  ): void {
    this.#materialRealizations().set(key, {
      material,
      resourceId: resource?.id ?? 0,
      resourceGeneration: resource?.generation ?? 0,
      buffers: buffers.map(({ id, generation }) => ({ id, generation })),
      indexedTransform: transformKind === 'indexed',
    });
  }

  #materialRealizations(): Map<string, MaterialRealization> {
    return this.#preparation?.materials ?? this.#materials;
  }

  #resourcesForPreparation(): Map<number, RetainedResource> {
    return this.#preparation?.resources ?? this.#resources;
  }

  #bitmapTexturesForRealization(): Map<number, THREE.DataArrayTexture> {
    return this.#preparation?.bitmapTextures ?? this.#bitmapTextures;
  }

  #msdfAtlasesForRealization(): Map<number, THREE.DataArrayTexture> {
    return this.#preparation?.msdfAtlases ?? this.#msdfAtlases;
  }

  #slugPagesForRealization(): Map<number, RetainedSlugPage> {
    return this.#preparation?.slugPages ?? this.#slugPages;
  }

  #transformAttributeForRealization(): THREE.StorageInstancedBufferAttribute {
    return this.#preparation?.transformAttribute ?? this.#transformAttribute;
  }

  #transformGenerationForRealization(): number {
    return this.#preparation?.transformGeneration ?? this.#transformGeneration;
  }

  #applyRetirementsToCandidate(
    plan: TextEngineRenderPlanView,
    table: RenderPlanTable,
    context: PreparationContext,
  ): void {
    const layout = textShaperAbi.layouts.engineRetirement;
    const kinds = textShaperAbi.engine.retirementKinds;
    for (let index = 0; index < table.count; index += 1) {
      const record = plan.record(table, index);
      const kind = plan.u16(record + layout.kind);
      const id = plan.u32(record + layout.id);
      const generation = plan.u32(record + layout.generation);
      if (kind === kinds.buffer) {
        for (const [key, realization] of context.materials) {
          if (realization.buffers.some((buffer) => buffer.id === id && buffer.generation === generation)) {
            context.materials.delete(key);
          }
        }
        if (context.buffers.get(id)?.generation === generation) context.buffers.delete(id);
        continue;
      }
      if (kind === kinds.resource) {
        const resource = context.resources.get(id);
        if (resource?.generation !== generation) continue;
        for (const [key, realization] of context.materials) {
          if (realization.resourceId === resource.id && realization.resourceGeneration === resource.generation) {
            context.materials.delete(key);
          }
        }
        context.resources.delete(id);
        if (![...context.resources.values()].some((entry) => entry.referenceId === resource.referenceId)) {
          context.bitmapTextures.delete(resource.referenceId);
          context.msdfAtlases.delete(resource.referenceId);
          context.slugPages.delete(resource.referenceId);
        }
        continue;
      }
      if (kind === kinds.slotRange || kind === kinds.outputBytes) continue;
      throw new Error(`unsupported text-engine retirement kind ${kind}`);
    }
  }

  #assertDrawResourcesRetained(
    draws: PreparedDrawReplacement,
    materials: ReadonlyMap<string, MaterialRealization>,
  ): void {
    const retained = new Set([...materials.values()].map(({ material }) => material));
    for (const draw of draws.draws) {
      if (Array.isArray(draw.material) || !retained.has(draw.material as THREE.NodeMaterial)) {
        throw new Error('draw references a material retired by the same publication');
      }
    }
  }

  #retiredTextures(context: PreparationContext): readonly (THREE.Texture | RetainedSlugPage)[] {
    const retained = new Set<THREE.Texture | RetainedSlugPage>([
      ...context.bitmapTextures.values(),
      ...context.msdfAtlases.values(),
      ...context.slugPages.values(),
    ]);
    return [
      ...new Set<THREE.Texture | RetainedSlugPage>([
        ...this.#bitmapTextures.values(),
        ...this.#msdfAtlases.values(),
        ...this.#slugPages.values(),
        ...context.newTextures,
      ]),
    ].filter((texture) => !retained.has(texture));
  }

  #prepareTransforms(draws: PreparedDrawReplacement): PreparedTransforms {
    const attribute = this.#transformAttributeForRealization();
    const contents = (attribute.array as Float32Array).slice();
    const direct: PreparedTransformUpdate[] = [];
    let start = contents.length;
    let end = 0;
    const transformIds = new Set<number>();
    for (const transformId of this.#owner.transformIds()) {
      if (draws.activeTransformIndices.has(transformId) || draws.directDrawsByTransform.has(transformId)) {
        transformIds.add(transformId);
      }
    }
    if (transformIds.size === 0) return { contents, start: 0, end: 0, direct };
    draws.root.updateWorldMatrix(true, false);
    const rootInverse = new THREE.Matrix4().copy(draws.root.matrixWorld).invert();
    const relative = new THREE.Matrix4();
    for (const transformId of transformIds) {
      const object = this.#owner.objectForTransform(transformId);
      object.updateWorldMatrix(true, false);
      relative.multiplyMatrices(rootInverse, object.matrixWorld);
      const visible = visibleBelowRoot(object, draws.root);
      if (draws.activeTransformIndices.has(transformId)) {
        const offset = transformId * 16;
        if (offset > contents.length - 16) throw new RangeError('transform identity exceeds its prepared table');
        if (visible) contents.set(relative.elements, offset);
        else contents.fill(0, offset, offset + 16);
        start = Math.min(start, offset);
        end = Math.max(end, offset + 16);
      }
      for (const mesh of draws.directDrawsByTransform.get(transformId) ?? []) {
        direct.push({ mesh, matrix: relative.clone(), visible });
      }
    }
    return { contents, start: end > start ? start : 0, end, direct };
  }

  #discardPreparation(context: PreparationContext, draws: PreparedDrawReplacement | undefined): void {
    if (draws?.changed === true) {
      for (const mesh of draws.draws) {
        if (draws.reused.has(mesh)) continue;
        try {
          mesh.geometry.dispose();
        } catch {
          // The rejected candidate was never published; retain the original preparation failure.
        }
      }
    }
    for (const material of context.newMaterials) {
      try {
        material.dispose();
      } catch {
        // Candidate cleanup cannot replace the error that caused the rejection.
      }
    }
    for (const texture of context.newTextures) {
      try {
        texture.dispose();
      } catch {
        // Candidate cleanup cannot replace the error that caused the rejection.
      }
    }
  }

  #buffer(id: number, generation: number): RetainedBuffer {
    return retainedBuffer(this.#preparation?.buffers ?? this.#buffers, id, generation);
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

/** The techniques this executor realizes, keyed by wire identity. */
const techniqueSchemas: ReadonlyMap<string, AnyTechniqueSchema> = new Map<string, AnyTechniqueSchema>([
  [bitmap.id, bitmapSchema],
  [msdf.id, msdfSchema],
  [slug.id, slugSchema],
]);

/** Glyph-origin augmentation is schema-declared: no declaration, no augmentation. */
function glyphOriginBuffer(resource: ThreeTextEngineResource): PolicyBufferDeclaration | undefined {
  const schema = resource.program?.schema ?? techniqueSchemas.get(resource.technique);
  if (schema?.glyphOrigin === undefined) return undefined;
  return schema.buffers[schema.glyphOrigin.buffer];
}

/** Resolve a draw's retained buffers by the schema's names instead of remembered ids. */
function schemaDrawBuffers<Buffers extends PolicyBufferDeclarations>(
  schema: { readonly buffers: Buffers },
  buffers: ReadonlyMap<number, RetainedBuffer>,
  label: string,
): { readonly [Name in keyof Buffers]: RetainedBuffer } {
  const resolved: Record<string, RetainedBuffer> = {};
  for (const [name, declaration] of Object.entries(schema.buffers)) {
    const buffer = buffers.get(declaration.id);
    if (buffer === undefined) throw new Error(`${label} draw is missing its "${name}" policy buffer`);
    resolved[name] = buffer;
  }
  // The keys are exactly schema.buffers' own keys, collected in the loop above.
  return resolved as { readonly [Name in keyof Buffers]: RetainedBuffer };
}

function drawRealizationKey(
  programId: number,
  resource: RetainedResource | undefined,
  materialId: number,
  buffers: ReadonlyMap<number, RetainedBuffer>,
  clipId: number,
  depthKey: number,
  transform: TransformRealization,
  transformGeneration: number,
  geometry: string,
): string {
  const bufferKey = [...buffers]
    .sort(([left], [right]) => left - right)
    .map(([policyId, buffer]) => `${policyId}:${buffer.id}:${buffer.generation}`)
    .join(',');
  const transformKey =
    transform.kind === 'direct'
      ? `direct:${transform.transformId}`
      : transformProgramKey(transform, transformGeneration);
  const resourceKey = resource === undefined ? 'decoration' : `${resource.id}:${resource.generation}`;
  return `${programId}:${resourceKey}:${materialId}:${clipId}:${depthKey}:${transformKey}:${geometry}:${bufferKey}`;
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
  return (draw.userData.pmndrsGlyphTransformId as number | undefined) ?? 0;
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

function textureArrayResource(
  resource: ThreeTextEngineResource,
  name: string,
  format: PortableTextureArrayPayload['format'],
  label: string,
): PortableTextureArrayPayload {
  const payload = resource.resources.get(name);
  if (payload?.kind !== 'texture-array' || payload.format !== format) {
    throw new TypeError(`${label} draw needs ${format} texture-array resource "${name}"`);
  }
  return payload;
}

function resourceGroup(resource: ThreeTextEngineResource, name: string, label: string): PortableResourceGroupPayload {
  const payload = resource.resources.get(name);
  if (payload?.kind !== 'group') throw new TypeError(`${label} draw needs resource group "${name}"`);
  return payload;
}

function textureMember(
  group: PortableResourceGroupPayload,
  name: string,
  format: PortableTexturePayload['format'],
  label: string,
): PortableTexturePayload {
  const payload = group.members[name];
  if (payload?.kind !== 'texture' || payload.format !== format) {
    throw new TypeError(`${label} resource group needs ${format} texture member "${name}"`);
  }
  return payload;
}

function textureArrayMember(
  group: PortableResourceGroupPayload,
  name: string,
  format: PortableTextureArrayPayload['format'],
  label: string,
): PortableTextureArrayPayload {
  const payload = group.members[name];
  if (payload?.kind !== 'texture-array' || payload.format !== format) {
    throw new TypeError(`${label} resource group needs ${format} texture-array member "${name}"`);
  }
  return payload;
}

function f32BufferMember(group: PortableResourceGroupPayload, name: string, label: string): number {
  const payload = group.members[name];
  if (payload?.kind !== 'buffer' || payload.stride !== 4 || payload.bytes.byteLength !== 4) {
    throw new TypeError(`${label} resource group needs one f32 buffer member "${name}"`);
  }
  const value = new DataView(payload.bytes.buffer, payload.bytes.byteOffset, 4).getFloat32(0, true);
  if (!Number.isFinite(value)) throw new TypeError(`${label} resource group member "${name}" needs a finite f32`);
  return value;
}

function scalarArray(scalarType: number, byteLength: number): ScalarArray {
  const scalar = textShaperAbi.policy.scalarTypes;
  if (scalarType === scalar.f32 || scalarType === scalar.u32) {
    if (byteLength % 4 !== 0) throw new RangeError('f32/u32 text-engine buffers require four-byte alignment');
    return scalarType === scalar.f32 ? new Float32Array(byteLength / 4) : new Uint32Array(byteLength / 4);
  }
  if (scalarType === scalar.u16) {
    if (byteLength % 2 !== 0) throw new RangeError('u16 text-engine buffers require two-byte alignment');
    return new Uint16Array(byteLength / 2);
  }
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

function markUpdated(buffer: RetainedBuffer, byteOffset: number, byteLength: number): void {
  const bytesPerScalar = buffer.array.BYTES_PER_ELEMENT;
  if (byteOffset % bytesPerScalar !== 0 || byteLength % bytesPerScalar !== 0) {
    throw new RangeError('buffer patch is not scalar aligned');
  }
  syncDetachedUploadRange(buffer, byteOffset, byteLength);
  mergeUpdateRange(buffer.attribute, byteOffset / bytesPerScalar, byteLength / bytesPerScalar);
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

function geometryDeclaration(resource: ThreeTextEngineResource | undefined) {
  return resource?.program !== undefined
    ? (resource.program.schema.render?.geometry ?? { kind: 'synthetic-quad' as const })
    : { kind: 'synthetic-quad' as const };
}

function resolveDrawGeometry(resource: ThreeTextEngineResource | undefined): DrawGeometry {
  const declaration = geometryDeclaration(resource);
  if (declaration.kind === 'synthetic-quad') return syntheticQuadGeometry;
  if (resource === undefined || !('resources' in resource) || declaration.resource === undefined) {
    throw new Error(`supplied Three geometry "${declaration.kind}" has no named portable resource`);
  }
  const payload = resource.resources.get(declaration.resource);
  if (payload?.kind !== 'geometry') {
    throw new Error(`Three draw omits supplied geometry resource "${declaration.resource}"`);
  }
  const referenceId =
    'resourceReferences' in resource ? resource.resourceReferences.get(declaration.resource) : undefined;
  if (referenceId === undefined) {
    throw new Error(`supplied Three geometry "${declaration.kind}" has no retained resource identity`);
  }
  const range = geometryDrawRange(payload);
  const indexCount = payload.indices === undefined ? 0 : payload.accessors[payload.indices.accessor]!.count;
  return {
    kind: 'supplied',
    resourceName: declaration.resource,
    payload,
    key: [
      'supplied',
      referenceId,
      declaration.kind,
      declaration.coordinates,
      payload.topology,
      indexCount,
      range.start,
      range.count,
    ].join(':'),
  };
}

function realizeGeometry(drawGeometry: DrawGeometry, recordCount: number): THREE.BufferGeometry {
  if (drawGeometry.kind === 'synthetic-quad') {
    const geometry = unitQuad();
    geometry.instanceCount = recordCount;
    return geometry;
  }
  const geometry = createGeometry(drawGeometry.payload);
  updateGeometryInstances(geometry, recordCount);
  return geometry;
}

function updateGeometryInstances(geometry: THREE.BufferGeometry, recordCount: number): void {
  assertGeometryInstanceCompatibility(geometry);
  geometry.instanceCount = recordCount;
}

function assertGeometryInstanceCompatibility(
  geometry: THREE.BufferGeometry,
): asserts geometry is THREE.InstancedBufferGeometry {
  if (!(geometry instanceof THREE.InstancedBufferGeometry)) {
    throw new TypeError('instanced text draw lost its instanced geometry');
  }
}

function createGeometry(payload: PortableGeometryPayload): THREE.BufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  for (const attribute of payload.attributes) {
    const accessor = payload.accessors[attribute.accessor];
    if (accessor === undefined) throw new Error(`geometry attribute "${attribute.semantic}" has no accessor`);
    const view = payload.views[accessor.view];
    if (view === undefined) throw new Error(`geometry accessor ${attribute.accessor} has no buffer view`);
    const array = typedGeometryArray(payload, accessor, view);
    const bufferAttribute = new THREE.BufferAttribute(array, accessor.components);
    geometry.setAttribute(attribute.semantic, bufferAttribute);
  }
  let indices: Uint16Array | Uint32Array | undefined;
  if (payload.indices !== undefined) {
    const accessor = payload.accessors[payload.indices.accessor];
    if (accessor === undefined) throw new Error('geometry index accessor is missing');
    const view = payload.views[accessor.view];
    if (view === undefined) throw new Error('geometry index buffer view is missing');
    const array = typedGeometryArray(payload, accessor, view);
    if (!(array instanceof Uint16Array) && !(array instanceof Uint32Array)) {
      throw new TypeError('geometry indices require u16 or u32 storage');
    }
    indices = array;
  }
  const positionAttribute = payload.attributes.find((attribute) => attribute.semantic === 'position');
  if (positionAttribute === undefined) throw new TypeError('portable geometry is missing its position attribute');
  const positionAccessor = payload.accessors[positionAttribute.accessor];
  if (positionAccessor === undefined) throw new Error('portable geometry position accessor is missing');
  const range = geometryDrawRange(payload);
  if (payload.topology === 'triangle-strip') {
    geometry.setIndex(new THREE.BufferAttribute(triangleStripIndices(indices, positionAccessor.count, range), 1));
  } else if (indices !== undefined) {
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  }
  applyGeometryDrawState(geometry, payload);
  return geometry;
}

function applyGeometryDrawState(geometry: THREE.BufferGeometry, payload: PortableGeometryPayload): void {
  const range = geometryDrawRange(payload);
  geometry.setDrawRange(payload.topology === 'triangle-strip' ? 0 : range.start, geometryDrawCount(payload));
}

function geometryDrawRange(payload: PortableGeometryPayload): Readonly<{ start: number; count: number }> {
  if (payload.drawRange !== undefined) return payload.drawRange;
  const position = payload.attributes.find((attribute) => attribute.semantic === 'position');
  if (position === undefined) throw new TypeError('portable geometry is missing its position attribute');
  const count =
    payload.indices === undefined
      ? payload.accessors[position.accessor]!.count
      : payload.accessors[payload.indices.accessor]!.count;
  return { start: 0, count };
}

function geometryDrawCount(payload: PortableGeometryPayload): number {
  const count = geometryDrawRange(payload).count;
  return payload.topology === 'triangle-strip' ? (count - 2) * 3 : count;
}

function triangleStripIndices(
  source: Uint16Array | Uint32Array | undefined,
  vertexCount: number,
  range: Readonly<{ start: number; count: number }>,
): Uint16Array | Uint32Array {
  const triangles = new Array<number>((range.count - 2) * 3);
  let maximum = 0;
  for (let triangle = 0; triangle < range.count - 2; triangle += 1) {
    const first = source?.[range.start + triangle] ?? range.start + triangle;
    const second = source?.[range.start + triangle + 1] ?? range.start + triangle + 1;
    const third = source?.[range.start + triangle + 2] ?? range.start + triangle + 2;
    const offset = triangle * 3;
    triangles[offset] = triangle % 2 === 0 ? first : second;
    triangles[offset + 1] = triangle % 2 === 0 ? second : first;
    triangles[offset + 2] = third;
    maximum = Math.max(maximum, first, second, third);
  }
  return maximum < 0x1_0000 && vertexCount < 0x1_0000 ? new Uint16Array(triangles) : new Uint32Array(triangles);
}

function typedGeometryArray(
  payload: PortableGeometryPayload,
  accessor: PortableGeometryPayload['accessors'][number],
  view: PortableGeometryPayload['views'][number],
): Float32Array | Uint32Array | Uint16Array | Int16Array | Uint8Array {
  const offset = payload.bytes.byteOffset + view.offset + (accessor.offset ?? 0);
  const length = accessor.count * accessor.components;
  if (accessor.componentType === 'f32') return new Float32Array(payload.bytes.buffer, offset, length);
  if (accessor.componentType === 'u32') return new Uint32Array(payload.bytes.buffer, offset, length);
  if (accessor.componentType === 'u16') return new Uint16Array(payload.bytes.buffer, offset, length);
  if (accessor.componentType === 'i16') return new Int16Array(payload.bytes.buffer, offset, length);
  return new Uint8Array(payload.bytes.buffer, offset, length);
}

function sameRetainedResource(left: RetainedResource, right: RetainedResource): boolean {
  return (
    left.id === right.id &&
    left.generation === right.generation &&
    left.techniqueId === right.techniqueId &&
    left.resourceKind === right.resourceKind &&
    left.referenceId === right.referenceId
  );
}

function retainedBuffer(buffers: ReadonlyMap<number, RetainedBuffer>, id: number, generation: number): RetainedBuffer {
  const buffer = buffers.get(id);
  if (buffer === undefined || buffer.generation !== generation) {
    throw new Error(`text-engine buffer ${id}:${generation} is not retained`);
  }
  return buffer;
}

function scalarBytes(array: ScalarArray): Uint8Array {
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}

function assertByteRange(offset: number, byteLength: number, capacity: number, message: string): void {
  if (offset > capacity || byteLength > capacity - offset) throw new RangeError(message);
}

function assertScalarAligned(buffer: RetainedBuffer, byteOffset: number, byteLength: number): void {
  const bytesPerScalar = buffer.array.BYTES_PER_ELEMENT;
  if (byteOffset % bytesPerScalar !== 0 || byteLength % bytesPerScalar !== 0) {
    throw new RangeError('buffer patch is not scalar aligned');
  }
}

function includeMutationRange(upload: StagedBufferUpload, byteOffset: number, byteLength: number): void {
  if (byteLength === 0) return;
  upload.start = Math.min(upload.start, byteOffset);
  upload.end = Math.max(upload.end, byteOffset + byteLength);
}

function validateDetachedUpload(buffer: RetainedBuffer): void {
  const upload = buffer.attribute.array;
  if (upload === buffer.array) return;
  if (upload.constructor !== buffer.array.constructor || upload.byteLength < buffer.array.byteLength) {
    throw new TypeError('Three replaced a text-plan upload array with an incompatible view');
  }
}

function commitBufferMutations(staged: StagedBufferMutations): void {
  for (const operation of staged.operations) commitBufferOperation(operation);
  for (const upload of staged.uploads) commitBufferUpload(upload);
}

function commitBufferOperation(operation: StagedBufferOperation): void {
  const destination = scalarBytes(operation.buffer.array);
  if (operation.kind === 'write') {
    destination.set(operation.payload, operation.destinationOffset);
    return;
  }
  if (operation.kind === 'fill') {
    const view = new DataView(
      destination.buffer,
      destination.byteOffset + operation.destinationOffset,
      operation.byteLength,
    );
    for (let offset = 0; offset < operation.byteLength; offset += 4) view.setUint32(offset, operation.value, true);
    return;
  }
  if (operation.kind === 'copy') {
    const source = scalarBytes(operation.source.array);
    if (operation.source === operation.buffer) {
      destination.copyWithin(
        operation.destinationOffset,
        operation.sourceOffset,
        operation.sourceOffset + operation.byteLength,
      );
    } else {
      destination.set(
        source.subarray(operation.sourceOffset, operation.sourceOffset + operation.byteLength),
        operation.destinationOffset,
      );
    }
    return;
  }
  const target = operation.buffer.array;
  if (!(target instanceof Float32Array)) throw new TypeError('glyph origin buffer changed scalar type before commit');
  target[operation.scalarOffset] = operation.x;
  target[operation.scalarOffset + 1] = operation.y;
}

function commitBufferUpload(uploadRange: StagedBufferUpload): void {
  const { buffer, start, end } = uploadRange;
  const byteLength = end - start;
  const source = scalarBytes(buffer.array).subarray(start, end);
  const upload = buffer.attribute.array;
  if (upload !== buffer.array) {
    new Uint8Array(upload.buffer, upload.byteOffset + start, byteLength).set(source);
  }
  const scalarBytesPerElement = buffer.array.BYTES_PER_ELEMENT;
  mergeUpdateRange(buffer.attribute, start / scalarBytesPerElement, byteLength / scalarBytesPerElement);
  buffer.attribute.needsUpdate = true;
  invalidatePboTexture(buffer.attribute);
}

function commitTransforms(attribute: THREE.StorageInstancedBufferAttribute, prepared: PreparedTransforms): void {
  if (prepared.end <= prepared.start) return;
  const target = attribute.array as Float32Array;
  target.set(prepared.contents.subarray(prepared.start, prepared.end), prepared.start);
  mergeUpdateRange(attribute, prepared.start, prepared.end - prepared.start);
  attribute.needsUpdate = true;
  invalidatePboTexture(attribute);
}

function applyReusedDrawUpdate(update: ReusedDrawUpdate): void {
  updateGeometryInstances(update.mesh.geometry, update.recordCount);
  update.mesh.userData.pmndrsGlyphRunStart = update.recordIndex;
  update.mesh.userData.pmndrsGlyphTransformId = update.transformId;
  update.mesh.userData.pmndrsGlyphPrimitiveKind = update.primitiveKind;
  update.mesh.matrixAutoUpdate = update.matrixAutoUpdate;
  update.mesh.renderOrder = update.renderOrder;
}

function applyTransformUpdate(update: PreparedTransformUpdate): void {
  update.mesh.visible = update.visible;
  update.mesh.matrix.copy(update.matrix);
  update.mesh.matrixWorldNeedsUpdate = true;
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
