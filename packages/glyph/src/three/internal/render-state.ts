import type * as THREE from 'three/webgpu';

import type {
  RetainedMsdfAtlas,
  RetainedSlugPage,
  ThreeRenderResourceLease,
  ThreeRendererResources,
} from './renderer-resources.js';
import type { ThreeGlyphGeometrySource } from '../glyph-measurement.js';
import type { ThreeBufferBinding, ThreeResolvedResourceBinding } from '../schema.js';
import type { RetainedBuffer, StagedBufferMutations } from './host-buffer.js';

export type ThreeHostResource = ThreeResolvedResourceBinding &
  Readonly<{ program?: ReturnType<ThreeRendererResources['rasterProgram']> }>;

export interface RetainedResource {
  readonly binding: ThreeResolvedResourceBinding;
  readonly resolved: ThreeHostResource;
}

export type RetainedTextureLease = ThreeRenderResourceLease<THREE.DataArrayTexture>;
export type RetainedSlugPageLease = ThreeRenderResourceLease<RetainedSlugPage>;
export type RetainedMsdfAtlasLease = ThreeRenderResourceLease<RetainedMsdfAtlas>;
export type RetainedGpuResourceLease = RetainedTextureLease | RetainedSlugPageLease | RetainedMsdfAtlasLease;

/** One storage node of a realized material and the Codec lane whose buffer it reads. */
export interface MaterialStorageNode {
  readonly node: { value: THREE.StorageBufferAttribute | THREE.StorageInstancedBufferAttribute };
  readonly lane: RetainedBuffer['codecBufferId'];
}

export interface MaterialRealization {
  readonly material: THREE.NodeMaterial;
  readonly resource: ThreeResolvedResourceBinding | undefined;
  readonly buffers: readonly ThreeBufferBinding[];
  readonly indexedTransform: boolean;
  /** Everything that identifies the material except which buffers its lanes currently read. */
  readonly shape?: string;
  /** The material's storage nodes, when they can be pointed at successor buffers without rebuilding the graph. */
  readonly storage?: readonly MaterialStorageNode[];
  /** Successor buffers to bind when the publication that adopted this material commits. */
  pendingStorage?: readonly (readonly [MaterialStorageNode['node'], THREE.StorageInstancedBufferAttribute])[];
}

export interface OriginSegment {
  readonly origins: RetainedBuffer;
  readonly stableIds: RetainedBuffer;
  readonly storageKey: string;
  readonly geometry: ThreeGlyphGeometrySource | undefined;
  readonly start: number;
  readonly count: number;
  readonly drawIndex: number;
}

export type TransformRealization =
  | Readonly<{ kind: 'direct'; transformId: number }>
  | Readonly<{ kind: 'indexed'; indices: RetainedBuffer }>;

export interface ReusedDrawUpdate {
  readonly mesh: THREE.Mesh;
  readonly visible: boolean;
  readonly recordCount: number;
  readonly recordIndex: number;
  readonly primitiveKind: 'decoration' | 'glyph';
  readonly matrixAutoUpdate: boolean;
  readonly renderOrder: number;
  readonly depthKey: number;
}

export interface PreparedTransformUpdate {
  readonly mesh: THREE.Mesh;
  readonly matrix: THREE.Matrix4;
  readonly visible: boolean;
}

export interface PreparedTransforms {
  /** Transform identities whose table rows are replaced, parallel to sixteen `values` each. */
  readonly rows: readonly number[];
  readonly values: Float32Array;
  readonly direct: readonly PreparedTransformUpdate[];
}

export interface PreparedDrawReplacement {
  readonly changed: boolean;
  readonly root: THREE.Object3D;
  readonly draws: THREE.Mesh[];
  readonly keys: string[];
  readonly originSegments: OriginSegment[];
  readonly reused: ReadonlySet<THREE.Mesh>;
  readonly reusedUpdates: readonly ReusedDrawUpdate[];
  readonly activeTransformIndices: ReadonlySet<number>;
  readonly directDrawsByTransform: ReadonlyMap<number, THREE.Mesh[]>;
  readonly batchDrawsByScope: WeakMap<THREE.Object3D, THREE.Mesh[]>;
}

export interface PreparationContext {
  readonly buffers: Map<ThreeBufferBinding, RetainedBuffer>;
  placementTable: RetainedBuffer | undefined;
  readonly resources: Map<ThreeResolvedResourceBinding, RetainedResource>;
  readonly bitmapTextures: Map<ThreeResolvedResourceBinding, RetainedTextureLease>;
  readonly msdfAtlases: Map<ThreeResolvedResourceBinding, RetainedMsdfAtlasLease>;
  readonly slugPages: Map<ThreeResolvedResourceBinding, RetainedSlugPageLease>;
  readonly materials: Map<string, MaterialRealization>;
  readonly newMaterials: Set<THREE.NodeMaterial>;
  readonly newTextures: Set<RetainedGpuResourceLease>;
  readonly transforms: Map<number, THREE.Object3D>;
  transformAttribute: THREE.StorageInstancedBufferAttribute;
  transformGeneration: number;
}

interface PreparedPublicationBase {
  readonly context: PreparationContext;
  readonly bufferMutations: StagedBufferMutations;
  readonly draws: PreparedDrawReplacement;
  readonly retiredMaterials: readonly THREE.NodeMaterial[];
  readonly retiredTextures: readonly RetainedGpuResourceLease[];
}

export type PreparedPublication =
  | (PreparedPublicationBase &
      Readonly<{
        replacesDraws: false;
        transforms: PreparedTransforms | undefined;
      }>)
  | (PreparedPublicationBase &
      Readonly<{
        replacesDraws: true;
        transforms: PreparedTransforms;
      }>);
