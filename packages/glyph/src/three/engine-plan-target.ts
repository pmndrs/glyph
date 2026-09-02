import * as THREE from 'three/webgpu';

import {
  type CommandBufferView,
  type TransformUpdate,
  type GlyphRenderer,
  type PreparedRendererCommit,
} from '../index.js';
import type { ThreeGlyphGeometrySource } from './glyph-measurement.js';
import type { ThreeBindings, ThreeBufferBinding, ThreeResolvedResourceBinding } from './handle.js';
import type { ThreeRendererResources } from './renderer-resources.js';
import type { ThreeRootContext } from './material.js';
import { ThreeTransformSynchronizer } from './transform-synchronizer.js';
import {
  commitBufferMutations,
  commitTransforms,
  includeMutationRange,
  scalarArray,
  threePolicyAttributeName,
  transformAttribute,
  type RetainedBuffer,
  type StagedBufferMutations,
  type StagedBufferOperation,
  type StagedBufferUpload,
} from './internal/host-buffer.js';
import { updateGeometryInstances } from './internal/geometry.js';
import { physicalRecordIndex } from './internal/material-realizer.js';
import { prepareDrawReplacement } from './internal/draw-realizer.js';
import { visibleBelowRoot } from './internal/scene-tree.js';
import type {
  MaterialRealization,
  OriginRecord,
  OriginSegment,
  PreparationContext,
  PreparedDrawReplacement,
  PreparedPublication,
  PreparedTransforms,
  PreparedTransformUpdate,
  RetainedGpuResourceLease,
  RetainedResource,
  RetainedSlugPageLease,
  RetainedTextureLease,
  ReusedDrawUpdate,
  ThreeHostResource,
} from './internal/render-state.js';

export { markStorageAttributeUpdated } from './internal/host-buffer.js';

export interface ThreeTextEnginePlanOwner {
  readonly drawRoot: THREE.Object3D;
  readonly root?: ThreeRootContext;
  readonly pixelSnapping?: boolean;
  readonly renderOrderBase?: number;
  /** Resolves retained visibility when transforms are not descendants of the private draw root. */
  visibleObject?(object: THREE.Object3D): boolean;
  /** Optional transform remapping used when a copied plan is imported beneath a detached root. */
  objectForTransform?(transformId: number, source: THREE.Object3D): THREE.Object3D;
  /** Allocates detached per-record storage before any material captures it. */
  prepareGlyphStorage?(storageKey: string, capacityRecords: number): void;
  /** Resolves per-record transforms and pivots for one physical record index space. */
  glyphStorage?(storageKey: string):
    | Readonly<{
        transforms: THREE.StorageInstancedBufferAttribute;
        pivots: THREE.StorageInstancedBufferAttribute;
      }>
    | undefined;
}

/** Applies retained Rust command-buffer deltas to Three storage attributes and draw objects. */
export class ThreeTextRenderPlanExecutor implements GlyphRenderer<ThreeBindings, void> {
  readonly #resourcesContext: ThreeRendererResources;
  readonly #owner: ThreeTextEnginePlanOwner;
  #buffers = new Map<ThreeBufferBinding, RetainedBuffer>();
  #resources = new Map<ThreeResolvedResourceBinding, RetainedResource>();
  #bitmapTextures = new Map<ThreeResolvedResourceBinding, RetainedTextureLease>();
  #msdfAtlases = new Map<ThreeResolvedResourceBinding, RetainedTextureLease>();
  #slugPages = new Map<ThreeResolvedResourceBinding, RetainedSlugPageLease>();
  #materials = new Map<string, MaterialRealization>();
  readonly #ownedMaterials = new WeakSet<THREE.NodeMaterial>();
  readonly #activeTransformIndices = new Set<number>();
  readonly #directDrawsByTransform = new Map<number, THREE.Mesh[]>();
  #transforms = new Map<number, THREE.Object3D>();
  readonly #originRecords = new Map<number, OriginRecord>();
  readonly #transformSynchronizer = new ThreeTransformSynchronizer();
  #transformAttribute = transformAttribute(0);
  #transformGeneration = 1;
  #draws: THREE.Mesh[] = [];
  #drawKeys: string[] = [];
  #originSegments: OriginSegment[] = [];
  readonly #bindingIds = new WeakMap<object, number>();
  #nextBindingId = 1;
  #preparation: PreparationContext | undefined;
  #pendingTransformSync:
    | Readonly<{ ids: readonly number[]; worldMatricesCurrent: boolean; changed: number }>
    | undefined;
  #disposed = false;

  constructor(resources: ThreeRendererResources, owner: ThreeTextEnginePlanOwner) {
    this.#resourcesContext = resources;
    this.#owner = owner;
  }

  get draws(): readonly THREE.Mesh[] {
    return this.#draws;
  }

  get gpuBytes(): number {
    let bytes = 0;
    for (const buffer of this.#buffers.values()) bytes += buffer.array.byteLength;
    bytes += this.#transformAttribute.array.byteLength;
    for (const { resource: texture } of this.#bitmapTextures.values()) {
      const data = texture.image.data as ArrayBufferView | undefined;
      bytes += data?.byteLength ?? 0;
    }
    for (const { resource: atlas } of this.#msdfAtlases.values()) {
      const data = atlas.image.data as ArrayBufferView | undefined;
      bytes += data?.byteLength ?? 0;
    }
    for (const { resource: page } of this.#slugPages.values()) bytes += page.byteLength;
    return bytes;
  }

  decode(view: CommandBufferView<ThreeBindings>): PreparedRendererCommit<void> {
    if (this.#disposed) throw new Error('Three renderer has been disposed');
    return this.#decodeRendererCommit(view);
  }

  /**
   * Reads where each glyph is drawn, in paragraph glyph-origin space, and names what it could not read.
   *
   * The retained lane is NOT in glyph-origin space, and which space it is in is the technique's own
   * business: Slug and MSDF pack the ink box's top-left corner, and Bitmap stores the origin plus the
   * baked strike's raster bearing, which is a third space that no measure value can reconstruct. What
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

  /** Returns retained supplied geometry for requested stable glyph ids. */
  glyphGeometry(stableIds: Uint32Array): ReadonlyMap<number, ThreeGlyphGeometrySource> {
    this.#ensureOriginRecords();
    const geometry = new Map<number, ThreeGlyphGeometrySource>();
    for (const stableId of stableIds) {
      const record = this.#originRecords.get(stableId);
      if (record?.geometry !== undefined) geometry.set(stableId, record.geometry);
    }
    return geometry;
  }

  /** Returns the detached plan's physical record address for one stable glyph id. */
  glyphRecord(stableId: number): Readonly<{ storageKey: string; index: number }> | undefined {
    this.#ensureOriginRecords();
    const record = this.#originRecords.get(stableId);
    return record === undefined ? undefined : { storageKey: record.storageKey, index: record.index };
  }

  /** Material instances owned exclusively by this executor's current draw branch. */
  get materials(): readonly THREE.NodeMaterial[] {
    return Object.freeze([...new Set(this.#draws.map((draw) => draw.material as THREE.NodeMaterial))]);
  }

  /** Returns the first realized draw order containing any selected stable glyph. */
  renderOrderBaseForGlyphs(stableIds: Uint32Array): number | undefined {
    this.#ensureOriginRecords();
    let base: number | undefined;
    for (const stableId of stableIds) {
      const drawIndex = this.#originRecords.get(stableId)?.drawIndex;
      const renderOrder = drawIndex === undefined ? undefined : this.#draws[drawIndex]?.renderOrder;
      if (renderOrder === undefined) continue;
      base = base === undefined ? renderOrder : Math.min(base, renderOrder);
    }
    return base;
  }

  /** Upload changed scene transforms without crossing into Wasm or invalidating text measure. */
  synchronizeTransforms(worldMatricesCurrent: boolean, sync: () => void): number {
    const ids = [...this.#transforms.keys()];
    this.#pendingTransformSync = { ids, worldMatricesCurrent, changed: 0 };
    try {
      sync();
      return this.#pendingTransformSync.changed;
    } finally {
      this.#pendingTransformSync = undefined;
    }
  }

  syncTransforms(updates: readonly TransformUpdate<THREE.Object3D>[]): void {
    const pending = this.#pendingTransformSync;
    const requested = new Set(updates.map(({ transform }) => transform));
    const ids = (pending?.ids ?? [...this.#transforms.keys()]).filter((id) => {
      const transform = this.#transforms.get(id);
      return transform !== undefined && requested.has(transform);
    });
    const changed = this.#syncTransformsCore(ids, pending?.worldMatricesCurrent ?? false);
    if (pending !== undefined) this.#pendingTransformSync = { ...pending, changed };
  }

  #syncTransformsCore(transformIds: Iterable<number>, worldMatricesCurrent: boolean): number {
    return this.#transformSynchronizer.sync(
      {
        drawRoot: this.#owner.drawRoot,
        draws: this.#draws,
        activeTransformIndices: this.#activeTransformIndices,
        directDrawsByTransform: this.#directDrawsByTransform,
        transforms: this.#transforms,
        transformAttribute: this.#transformAttribute,
        ...(this.#owner.visibleObject === undefined ? {} : { visibleObject: this.#owner.visibleObject }),
      },
      transformIds,
      worldMatricesCurrent,
    );
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
    this.#transforms.clear();
    this.#activeTransformIndices.clear();
    this.#directDrawsByTransform.clear();
    this.#originRecords.clear();
    this.#originSegments = [];
  }

  #decodeRendererCommit(view: CommandBufferView<ThreeBindings>): PreparedRendererCommit<void> {
    const prepared = this.#prepareBound(view);
    let state: 'open' | 'committed' | 'discarded' = 'open';
    return Object.freeze({
      result: undefined,
      commit: (): void => {
        if (state !== 'open') throw new Error(`Three renderer preparation was already ${state}`);
        state = 'committed';
        const failure = this.#commit(prepared);
        if (failure !== undefined) throw failure;
      },
      discard: (): void => {
        if (state !== 'open') return;
        state = 'discarded';
        this.#discardPreparation(prepared.context, prepared.draws);
      },
    });
  }

  #prepareBound(frame: CommandBufferView<ThreeBindings>): PreparedPublication {
    const replacesDraws = frame.displayList.kind === 'replace';
    const transforms = replacesDraws ? new Map<number, THREE.Object3D>() : this.#transforms;
    if (frame.displayList.kind === 'replace') {
      for (let index = 0; index < frame.displayList.value.transforms.length; index += 1) {
        const transform = frame.displayList.value.transforms.at(index)!;
        transforms.set(transform.recordIndex, transform.value);
      }
    }
    const context: PreparationContext = {
      buffers: replacesDraws ? new Map(this.#buffers) : this.#buffers,
      resources: replacesDraws ? new Map(this.#resources) : this.#resources,
      bitmapTextures: replacesDraws ? new Map(this.#bitmapTextures) : this.#bitmapTextures,
      msdfAtlases: replacesDraws ? new Map(this.#msdfAtlases) : this.#msdfAtlases,
      slugPages: replacesDraws ? new Map(this.#slugPages) : this.#slugPages,
      materials: replacesDraws ? new Map(this.#materials) : this.#materials,
      newMaterials: new Set(),
      newTextures: new Set(),
      transforms,
      transformAttribute: this.#transformAttribute,
      transformGeneration: this.#transformGeneration,
    };
    let preparedDraws: PreparedDrawReplacement | undefined;
    this.#preparation = context;
    try {
      this.#readBoundResources(frame, context);
      this.#readBoundBuffers(frame, context.buffers);
      preparedDraws =
        frame.displayList.kind === 'replace'
          ? prepareDrawReplacement({
              root: frame.displayList.value.drawRoot,
              children: frame.displayList.value.children,
              context,
              coordinator: this.#resourcesContext,
              owner: this.#owner,
              ownedMaterials: this.#ownedMaterials,
              previousDraws: this.#draws,
              previousKeys: this.#drawKeys,
              bindingId: (value) => this.#bindingId(value),
            })
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
      this.#applyBoundRetirements(frame, context);
      const preparedTransforms = this.#prepareTransforms(preparedDraws);
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
      const bufferMutations = this.#stageBoundBufferMutations(frame, context.buffers);
      return {
        context,
        bufferMutations,
        draws: preparedDraws,
        transforms: preparedTransforms,
        retiredMaterials,
        retiredTextures,
      };
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
    this.#transforms = new Map(prepared.context.transforms);
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

  #readBoundResources(frame: CommandBufferView<ThreeBindings>, context: PreparationContext): void {
    for (const command of frame.updates.resources) {
      if (context.resources.has(command.resource)) continue;
      const program = this.#resourcesContext.planProgram(command.resource.technique);
      const resolved: ThreeHostResource = Object.freeze({
        ...command.resource,
        ...(program === undefined ? {} : { program }),
      });
      const resource: RetainedResource = {
        binding: command.resource,
        resolved,
      };
      context.resources.set(command.resource, resource);
    }
  }

  #readBoundBuffers(frame: CommandBufferView<ThreeBindings>, buffers: Map<ThreeBufferBinding, RetainedBuffer>): void {
    for (const command of frame.updates.buffers) {
      if (buffers.has(command.buffer)) continue;
      const declaration = command.buffer.input.declaration;
      const policyBufferId = declaration.kind === 'order' ? 'order' : declaration.value.id;
      const array = scalarArray(command.scalarType, command.byteLength);
      const attribute = new THREE.StorageInstancedBufferAttribute(array, command.vectorWidth);
      attribute.setUsage(THREE.DynamicDrawUsage);
      attribute.needsUpdate = true;
      buffers.set(command.buffer, {
        binding: command.buffer,
        storageKey: `buffer:${this.#bindingId(command.buffer)}`,
        policyBufferId,
        threeAttributeName: threePolicyAttributeName(policyBufferId),
        scalarType: command.scalarType,
        vectorWidth: command.vectorWidth,
        capacityRecords: command.capacityRecords,
        array,
        attribute,
      });
    }
  }

  #stageBoundBufferMutations(
    frame: CommandBufferView<ThreeBindings>,
    buffers: ReadonlyMap<ThreeBufferBinding, RetainedBuffer>,
  ): StagedBufferMutations {
    const operations: StagedBufferOperation[] = [];
    const staged = new Map<RetainedBuffer, StagedBufferUpload>();
    const mutable = (buffer: RetainedBuffer): StagedBufferUpload => {
      let upload = staged.get(buffer);
      if (upload !== undefined) return upload;
      upload = { buffer, start: buffer.array.byteLength, end: 0 };
      staged.set(buffer, upload);
      return upload;
    };
    for (const patch of frame.updates.patches) {
      const buffer = buffers.get(patch.kind === 'copy' ? patch.destination : patch.buffer)!;
      if (patch.kind === 'allocate-or-resize' || patch.kind === 'retire') continue;
      if (patch.kind === 'write') {
        operations.push({
          kind: patch.kind,
          buffer,
          destinationOffset: patch.destinationOffset,
          payload: patch.payload,
        });
      } else if (patch.kind === 'fill') {
        operations.push({
          kind: patch.kind,
          buffer,
          destinationOffset: patch.destinationOffset,
          byteLength: patch.byteLength,
          value: patch.value,
        });
      } else {
        operations.push({
          kind: patch.kind,
          buffer,
          destinationOffset: patch.destinationOffset,
          source: buffers.get(patch.source)!,
          sourceOffset: patch.sourceOffset,
          byteLength: patch.byteLength,
        });
      }
      includeMutationRange(
        mutable(buffer),
        patch.destinationOffset,
        patch.kind === 'write' ? patch.payload.byteLength : patch.byteLength,
      );
    }
    return { operations, uploads: [...staged.values()].filter(({ start, end }) => end > start) };
  }

  #applyBoundRetirements(frame: CommandBufferView<ThreeBindings>, context: PreparationContext): void {
    for (const retirement of frame.updates.retirements) {
      if (retirement.kind === 'buffer') {
        context.buffers.delete(retirement.buffer);
        for (const [key, realization] of context.materials) {
          if (realization.buffers.includes(retirement.buffer)) context.materials.delete(key);
        }
      } else if (retirement.kind === 'resource') {
        const resource = context.resources.get(retirement.resource);
        if (resource === undefined) continue;
        context.resources.delete(retirement.resource);
        for (const [key, realization] of context.materials) {
          if (realization.resource === retirement.resource) context.materials.delete(key);
        }
        context.bitmapTextures.delete(resource.binding);
        context.msdfAtlases.delete(resource.binding);
        context.slugPages.delete(resource.binding);
      }
    }
  }

  #ensureOriginRecords(): void {
    if (this.#originRecords.size !== 0) return;
    for (const segment of this.#originSegments) {
      if (!(segment.origins.array instanceof Float32Array) || !(segment.stableIds.array instanceof Uint32Array))
        continue;
      for (let index = segment.start; index < segment.start + segment.count; index += 1) {
        const recordIndex = physicalRecordIndex(segment.order, index);
        const stableId = segment.stableIds.array[recordIndex]!;
        const offset = recordIndex * segment.origins.vectorWidth;
        this.#originRecords.set(stableId, {
          buffer: segment.origins,
          storageKey: segment.storageKey,
          index: recordIndex,
          geometry: segment.geometry,
          drawIndex: segment.drawIndex,
          targetX: segment.origins.array[offset]!,
          targetY: segment.origins.array[offset + 1]!,
        });
      }
    }
  }

  #retiredTextures(context: PreparationContext): readonly RetainedGpuResourceLease[] {
    const retained = new Set<RetainedGpuResourceLease>([
      ...context.bitmapTextures.values(),
      ...context.msdfAtlases.values(),
      ...context.slugPages.values(),
    ]);
    return [
      ...new Set<RetainedGpuResourceLease>([
        ...this.#bitmapTextures.values(),
        ...this.#msdfAtlases.values(),
        ...this.#slugPages.values(),
        ...context.newTextures,
      ]),
    ].filter((texture) => !retained.has(texture));
  }

  #prepareTransforms(draws: PreparedDrawReplacement): PreparedTransforms {
    const attribute = this.#preparation?.transformAttribute ?? this.#transformAttribute;
    const contents = (attribute.array as Float32Array).slice();
    const direct: PreparedTransformUpdate[] = [];
    let start = contents.length;
    let end = 0;
    const transformIds = new Set<number>();
    const transforms = this.#preparation?.transforms ?? this.#transforms;
    for (const transformId of transforms.keys()) {
      if (draws.activeTransformIndices.has(transformId) || draws.directDrawsByTransform.has(transformId)) {
        transformIds.add(transformId);
      }
    }
    if (transformIds.size === 0) return { contents, start: 0, end: 0, direct };
    draws.root.updateWorldMatrix(true, false, true);
    const rootInverse = new THREE.Matrix4().copy(draws.root.matrixWorld).invert();
    const relative = new THREE.Matrix4();
    for (const transformId of transformIds) {
      const object = transforms.get(transformId);
      if (object === undefined) throw new Error(`Three plan target has no candidate transform ${transformId}`);
      object.updateWorldMatrix(true, false, true);
      if (object === draws.root) relative.identity();
      else relative.multiplyMatrices(rootInverse, object.matrixWorld);
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

  #bindingId(value: object): number {
    let id = this.#bindingIds.get(value);
    if (id === undefined) {
      id = this.#nextBindingId;
      this.#nextBindingId += 1;
      this.#bindingIds.set(value, id);
    }
    return id;
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

function applyReusedDrawUpdate(update: ReusedDrawUpdate): void {
  updateGeometryInstances(update.mesh.geometry, update.recordCount);
  update.mesh.userData.pmndrsGlyphRunStart = update.recordIndex;
  update.mesh.userData.pmndrsGlyphTransformId = update.transformId;
  update.mesh.userData.pmndrsGlyphPrimitiveKind = update.primitiveKind;
  update.mesh.userData.pmndrsGlyphDepthKey = update.depthKey;
  update.mesh.userData.pmndrsGlyphRenderOrder = update.renderOrder;
  update.mesh.matrixAutoUpdate = update.matrixAutoUpdate;
  update.mesh.renderOrder = update.renderOrder;
}

function applyTransformUpdate(update: PreparedTransformUpdate): void {
  update.mesh.visible = update.visible;
  update.mesh.matrix.copy(update.matrix);
  update.mesh.matrixWorldNeedsUpdate = true;
}
