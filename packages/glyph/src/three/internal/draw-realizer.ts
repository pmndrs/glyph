import * as THREE from 'three/webgpu';

import type { BorrowedCommandSequence, DisplayListBatch, DisplayListRootInstance } from '../../config/glyph.js';
import type { ThreeRendererResources } from './renderer-resources.js';
import type {
  ThreeBatchBinding,
  ThreeBufferBinding,
  ThreeInstanceBinding,
  ThreeInstanceSpanBinding,
} from '../handle.js';
import { threeSystemBuffers } from '../codec.js';
import { createGeometrySource, realizeGeometry, resolveDrawGeometry } from './geometry.js';
import { transformAttribute, type RetainedBuffer, type ThreeBufferBindingId } from './host-buffer.js';
import { glyphOriginBuffer, glyphStorageKey, ThreeMaterialRealizer, transformProgramKey } from './material-realizer.js';
import type {
  OriginSegment,
  PreparationContext,
  PreparedDrawReplacement,
  RecordAddressing,
  ReusedDrawUpdate,
  TransformRealization,
} from './render-state.js';

interface DrawOwner {
  readonly renderObject: THREE.Object3D;
  readonly pixelSnapping?: boolean;
  readonly renderOrderBase?: number;
  prepareGlyphStorage?(storageKey: string, capacityRecords: number): void;
  glyphStorage?(storageKey: string):
    | Readonly<{
        transforms: THREE.StorageInstancedBufferAttribute;
        pivots: THREE.StorageInstancedBufferAttribute;
      }>
    | undefined;
}

interface PrepareDrawReplacementOptions {
  readonly root: THREE.Object3D;
  readonly children: BorrowedCommandSequence<
    | DisplayListBatch<ThreeBatchBinding, ThreeInstanceSpanBinding>
    | DisplayListRootInstance<ThreeInstanceBinding, THREE.Object3D>
  >;
  readonly context: PreparationContext;
  readonly coordinator: ThreeRendererResources;
  readonly owner: DrawOwner;
  readonly ownedMaterials: WeakSet<THREE.NodeMaterial>;
  readonly previousDraws: readonly THREE.Mesh[];
  readonly previousKeys: readonly string[];
  readonly bindingId: (value: object) => number;
}

/** Builds one ordered Three draw-tree replacement without mutating the committed scene. */
export function prepareDrawReplacement(options: PrepareDrawReplacementOptions): PreparedDrawReplacement {
  const { context, owner, bindingId } = options;
  prepareOwnerGlyphStorage(context.buffers, owner);
  const materials = new ThreeMaterialRealizer({
    coordinator: options.coordinator,
    owner,
    context,
    ownedMaterials: options.ownedMaterials,
    bindingId,
  });

  const next: THREE.Mesh[] = [];
  const nextKeys: string[] = [];
  const nextOriginSegments: OriginSegment[] = [];
  const reusedUpdates: ReusedDrawUpdate[] = [];
  const previous = new Map<string, THREE.Mesh[]>();
  for (let index = 0; index < options.previousDraws.length; index += 1) {
    const key = options.previousKeys[index]!;
    const matches = previous.get(key) ?? [];
    matches.push(options.previousDraws[index]!);
    previous.set(key, matches);
  }

  const retained = (binding: ThreeBufferBinding): RetainedBuffer => context.buffers.get(binding)!;
  const transformIds = new WeakMap<THREE.Object3D, number>();
  for (const [recordIndex, object] of context.transforms) transformIds.set(object, recordIndex);
  const activeTransformIndices = new Set<number>();
  let indexedTransformsPrepared = false;
  const reused = new Set<THREE.Mesh>();
  let drawIndex = 0;

  try {
    for (let childIndex = 0; childIndex < options.children.length; childIndex += 1) {
      const child = options.children.at(childIndex)!;
      if (child.kind === 'batch' && !indexedTransformsPrepared) {
        indexedTransformsPrepared = true;
        for (const transformIndex of context.transforms.keys()) activeTransformIndices.add(transformIndex);
        if (ensureTransformCapacity(context, activeTransformIndices)) {
          for (const [key, realization] of context.materials) {
            if (realization.indexedTransform) context.materials.delete(key);
          }
        }
      }
      const draw = child.value.input;
      const transformId = child.kind === 'instance' ? (transformIds.get(child.transform!) ?? 0) : 0;
      const byCodecId = new Map<ThreeBufferBindingId, RetainedBuffer>();
      for (const binding of draw.buffers) {
        const buffer = retained(binding);
        byCodecId.set(buffer.codecBufferId, buffer);
      }
      const addressing: RecordAddressing = {
        order: draw.indirect === undefined ? undefined : retained(draw.indirect.buffer),
      };
      const transform = transformRealization(byCodecId, transformId);
      const materialKey = materials.key(draw.material);
      const renderOrderBase = owner.renderOrderBase ?? draw.material?.renderOrder ?? 0;
      const clipId = draw.clip === undefined ? 0 : bindingId(draw.clip);

      const spanCount = child.kind === 'batch' ? child.instances.length : 1;
      for (let spanIndex = 0; spanIndex < spanCount; spanIndex += 1) {
        const boundSpan = child.kind === 'batch' ? child.instances.at(spanIndex)! : child.value.input.instance;
        const span = boundSpan.value.input;
        if (span.kind !== 'glyph' && span.kind !== 'decoration') {
          throw new Error(`Three does not realize ${span.kind} instance spans`);
        }
        const decoration = span.kind === 'decoration';
        const resource = span.resource === undefined ? undefined : context.resources.get(span.resource);
        const resolvedResource = resource?.resolved;
        const drawGeometry = resolveDrawGeometry(resolvedResource);
        const material = decoration
          ? materials.decoration(byCodecId, draw.material, transform, addressing)
          : materials.glyph(resource!, byCodecId, draw.material, transform, addressing);
        const originDeclaration =
          decoration || resolvedResource === undefined ? undefined : glyphOriginBuffer(resolvedResource);
        const origins = originDeclaration === undefined ? undefined : byCodecId.get(originDeclaration.id);
        const stableIds = decoration ? undefined : byCodecId.get(threeSystemBuffers.stableGlyphId.id);
        if (originDeclaration !== undefined && origins !== undefined && stableIds !== undefined) {
          nextOriginSegments.push({
            origins,
            stableIds,
            storageKey: glyphStorageKey(stableIds),
            order: addressing.order,
            geometry: createGeometrySource(drawGeometry),
            start: span.recordIndex,
            count: span.recordCount,
            drawIndex,
          });
        }
        const key = drawRealizationKey(
          `program:${bindingId(draw.program)}`,
          resource === undefined ? 'decoration' : `resource:${bindingId(resource.binding)}`,
          materialKey,
          byCodecId,
          clipId,
          draw.depthKey,
          transform,
          context.transformGeneration,
          drawGeometry.key,
        );
        const reusable = previous.get(key)?.shift();
        if (reusable !== undefined) {
          reusedUpdates.push({
            mesh: reusable,
            recordCount: span.recordCount,
            recordIndex: span.recordIndex,
            transformId,
            primitiveKind: decoration ? 'decoration' : 'glyph',
            matrixAutoUpdate: transform.kind !== 'direct',
            renderOrder: renderOrderBase + drawIndex,
            depthKey: draw.depthKey,
          });
          reused.add(reusable);
          next.push(reusable);
          nextKeys.push(key);
          drawIndex += 1;
          continue;
        }

        const geometry = realizeGeometry(drawGeometry, span.recordCount);
        for (const buffer of byCodecId.values()) geometry.setAttribute(buffer.threeAttributeName, buffer.attribute);
        const glyphStorage = stableIds === undefined ? undefined : owner.glyphStorage?.(glyphStorageKey(stableIds));
        if (glyphStorage !== undefined) {
          geometry.setAttribute('_pmndrsGlyphInstanceTransforms', glyphStorage.transforms);
          geometry.setAttribute('_pmndrsGlyphInstancePivots', glyphStorage.pivots);
        }
        if (transform.kind === 'indexed') geometry.setAttribute('_pmndrsGlyphTransforms', context.transformAttribute);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.pmndrsGlyphRunStart = span.recordIndex;
        mesh.userData.pmndrsGlyphTransformId = transformId;
        mesh.userData.pmndrsGlyphPrimitiveKind = decoration ? 'decoration' : 'glyph';
        mesh.userData.pmndrsGlyphDepthKey = draw.depthKey;
        mesh.matrixAutoUpdate = transform.kind !== 'direct';
        mesh.frustumCulled = false;
        mesh.renderOrder = renderOrderBase + drawIndex;
        mesh.userData.pmndrsGlyphRenderOrder = mesh.renderOrder;
        next.push(mesh);
        nextKeys.push(key);
        drawIndex += 1;
      }
    }
  } catch (error) {
    for (const mesh of next) {
      if (reused.has(mesh)) continue;
      try {
        mesh.geometry.dispose();
      } catch {
        // The renderer preparation failed before publication.
      }
    }
    throw error;
  }

  const directDrawsByTransform = new Map<number, THREE.Mesh[]>();
  for (const draw of next) {
    const transformId = (draw.userData.pmndrsGlyphTransformId as number | undefined) ?? 0;
    if (transformId === 0) continue;
    const draws = directDrawsByTransform.get(transformId) ?? [];
    draws.push(draw);
    directDrawsByTransform.set(transformId, draws);
  }
  return {
    changed: true,
    root: options.root,
    draws: next,
    keys: nextKeys,
    originSegments: nextOriginSegments,
    reused,
    reusedUpdates,
    activeTransformIndices,
    directDrawsByTransform,
  };
}

function prepareOwnerGlyphStorage(buffers: ReadonlyMap<ThreeBufferBinding, RetainedBuffer>, owner: DrawOwner): void {
  if (owner.prepareGlyphStorage === undefined) return;
  for (const buffer of buffers.values()) {
    if (buffer.codecBufferId === threeSystemBuffers.stableGlyphId.id) {
      owner.prepareGlyphStorage(glyphStorageKey(buffer), buffer.capacityRecords);
    }
  }
}

function transformRealization(
  buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>,
  transformId: number,
): TransformRealization {
  if (transformId !== 0) return { kind: 'direct', transformId };
  const indices = buffers.get(threeSystemBuffers.transformIndex.id);
  if (indices === undefined || !(indices.array instanceof Uint32Array)) {
    throw new Error('indexed Three draw is missing its u32 transform-index buffer');
  }
  return { kind: 'indexed', indices };
}

function ensureTransformCapacity(context: PreparationContext, indices: ReadonlySet<number>): boolean {
  let maximum = 0;
  for (const index of indices) maximum = Math.max(maximum, index);
  const requiredRecords = (maximum + 1) * 4;
  if (context.transformAttribute.count >= requiredRecords) return false;
  let capacity = Math.max(4, context.transformAttribute.count);
  while (capacity < requiredRecords) capacity *= 2;
  context.transformAttribute = transformAttribute(capacity / 4);
  context.transformGeneration += 1;
  return true;
}

function drawRealizationKey(
  programKey: string,
  resourceKey: string,
  materialKey: string,
  buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>,
  clipId: number,
  depthKey: number,
  transform: TransformRealization,
  transformGeneration: number,
  geometry: string,
): string {
  const bufferKey = [...buffers]
    .sort(
      ([left], [right]) =>
        (left === 'order' ? Number.MAX_SAFE_INTEGER : left) - (right === 'order' ? Number.MAX_SAFE_INTEGER : right),
    )
    .map(([codecBufferId, buffer]) => `${codecBufferId}:${buffer.storageKey}`)
    .join(',');
  const transformKey =
    transform.kind === 'direct'
      ? `direct:${transform.transformId}`
      : transformProgramKey(transform, transformGeneration);
  return `${programKey}:${resourceKey}:${materialKey}:${clipId}:${depthKey}:${transformKey}:${geometry}:${bufferKey}`;
}
