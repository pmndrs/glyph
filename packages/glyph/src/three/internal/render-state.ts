import type * as THREE from 'three/webgpu';

import type { TslSlugPageResources } from '../../tsl.js';
import type { ThreeRenderResourceLease, ThreeRendererResources } from './renderer-resources.js';
import type { ThreeGlyphGeometrySource } from '../glyph-measurement.js';
import type { ThreeBufferBinding, ThreeResolvedResourceBinding } from '../handle.js';
import type { RetainedBuffer, StagedBufferMutations } from './host-buffer.js';

export type ThreeHostResource = ThreeResolvedResourceBinding &
  Readonly<{ program?: ReturnType<ThreeRendererResources['planProgram']> }>;

export interface RetainedResource {
  readonly binding: ThreeResolvedResourceBinding;
  readonly resolved: ThreeHostResource;
}

export interface RetainedSlugPage extends TslSlugPageResources {
  readonly byteLength: number;
  dispose(): void;
}

export type RetainedTextureLease = ThreeRenderResourceLease<THREE.DataArrayTexture>;
export type RetainedSlugPageLease = ThreeRenderResourceLease<RetainedSlugPage>;
export type RetainedGpuResourceLease = RetainedTextureLease | RetainedSlugPageLease;

export interface MaterialRealization {
  readonly material: THREE.NodeMaterial;
  readonly resource: ThreeResolvedResourceBinding | undefined;
  readonly buffers: readonly ThreeBufferBinding[];
  readonly indexedTransform: boolean;
}

export interface OriginSegment {
  readonly origins: RetainedBuffer;
  readonly stableIds: RetainedBuffer;
  readonly storageKey: string;
  readonly order: RetainedBuffer | undefined;
  readonly geometry: ThreeGlyphGeometrySource | undefined;
  readonly start: number;
  readonly count: number;
  readonly drawIndex: number;
}

export interface OriginRecord {
  readonly buffer: RetainedBuffer;
  readonly storageKey: string;
  readonly index: number;
  readonly geometry: ThreeGlyphGeometrySource | undefined;
  readonly drawIndex: number;
  /** The lane's value with the glyph at rest. Displacement from it is the technique-free bridge. */
  targetX: number;
  targetY: number;
}

export type TransformRealization =
  | Readonly<{ kind: 'direct'; transformId: number }>
  | Readonly<{ kind: 'indexed'; indices: RetainedBuffer }>;

export interface RecordAddressing {
  readonly order: RetainedBuffer | undefined;
}

export interface ReusedDrawUpdate {
  readonly mesh: THREE.Mesh;
  readonly recordCount: number;
  readonly recordIndex: number;
  readonly transformId: number;
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
  readonly contents: Float32Array;
  readonly start: number;
  readonly end: number;
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
}

export interface PreparationContext {
  readonly buffers: Map<ThreeBufferBinding, RetainedBuffer>;
  readonly resources: Map<ThreeResolvedResourceBinding, RetainedResource>;
  readonly bitmapTextures: Map<ThreeResolvedResourceBinding, RetainedTextureLease>;
  readonly msdfAtlases: Map<ThreeResolvedResourceBinding, RetainedTextureLease>;
  readonly slugPages: Map<ThreeResolvedResourceBinding, RetainedSlugPageLease>;
  readonly materials: Map<string, MaterialRealization>;
  readonly newMaterials: Set<THREE.NodeMaterial>;
  readonly newTextures: Set<RetainedGpuResourceLease>;
  readonly transforms: ReadonlyMap<number, THREE.Object3D>;
  transformAttribute: THREE.StorageInstancedBufferAttribute;
  transformGeneration: number;
}

export interface PreparedPublication {
  readonly context: PreparationContext;
  readonly bufferMutations: StagedBufferMutations;
  readonly draws: PreparedDrawReplacement;
  readonly transforms: PreparedTransforms;
  readonly retiredMaterials: readonly THREE.NodeMaterial[];
  readonly retiredTextures: readonly RetainedGpuResourceLease[];
}
