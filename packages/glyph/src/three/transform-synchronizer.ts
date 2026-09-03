import * as THREE from 'three/webgpu';

import { visibleBelowRoot } from './internal/scene-tree.js';

export interface ThreeTransformState {
  readonly drawRoot: THREE.Object3D;
  readonly draws: readonly THREE.Mesh[];
  readonly activeTransformIndices: ReadonlySet<number>;
  readonly directDrawsByTransform: ReadonlyMap<number, readonly THREE.Mesh[]>;
  readonly transforms: ReadonlyMap<number, THREE.Object3D>;
  readonly transformAttribute: THREE.StorageInstancedBufferAttribute;
  readonly visibleObject?: (object: THREE.Object3D) => boolean;
}

/** Cheap scene-side synchronization that never enters the Glyph engine or command decoder. */
export class ThreeTransformSynchronizer {
  readonly #rootInverse = new THREE.Matrix4();
  readonly #relativeTransform = new THREE.Matrix4();

  sync(state: ThreeTransformState, transformIds: Iterable<number>, worldMatricesCurrent: boolean): number {
    for (const draw of state.draws) {
      draw.renderOrder = (draw.userData.pmndrsGlyphRenderOrder as number | undefined) ?? draw.renderOrder;
    }
    const target = state.transformAttribute.array as Float32Array;
    let rootPrepared = false;
    let changedTransforms = 0;
    let indexedChanged = 0;
    for (const transformId of transformIds) {
      const indexed = state.activeTransformIndices.has(transformId);
      const directDraws = state.directDrawsByTransform.get(transformId);
      if (!indexed && directDraws === undefined) continue;
      if (!rootPrepared) {
        if (!worldMatricesCurrent) state.drawRoot.updateWorldMatrix(true, false, true);
        this.#rootInverse.copy(state.drawRoot.matrixWorld).invert();
        rootPrepared = true;
      }
      const object = state.transforms.get(transformId);
      if (object === undefined) throw new Error(`Three plan target has no retained transform ${transformId}`);
      if (!worldMatricesCurrent) object.updateWorldMatrix(true, false, true);
      if (object === state.drawRoot) this.#relativeTransform.identity();
      else this.#relativeTransform.multiplyMatrices(this.#rootInverse, object.matrixWorld);
      const visible = state.visibleObject?.(object) ?? visibleBelowRoot(object, state.drawRoot);
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
          state.transformAttribute.addUpdateRange(offset, 16);
          indexedChanged += 1;
        }
      }
      if (directDraws !== undefined) {
        for (const draw of directDraws) {
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
      }
      if (transformChanged) changedTransforms += 1;
    }
    if (changedTransforms === 0) return 0;
    if (indexedChanged !== 0) {
      state.transformAttribute.needsUpdate = true;
      const pbo = (state.transformAttribute as THREE.StorageInstancedBufferAttribute & { pbo?: THREE.DataTexture }).pbo;
      if (pbo !== undefined) pbo.needsUpdate = true;
    }
    return changedTransforms;
  }
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
