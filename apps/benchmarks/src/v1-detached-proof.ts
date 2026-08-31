import { Decorations, Glyphs } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';

export interface DetachedRasterParity {
  readonly detachedFirstFrameMatches: boolean;
  readonly detachedSameFrameWriteMatches: boolean;
}

interface BreakableText {
  readonly parent: THREE.Object3D | null;
  visible: boolean;
  breakApart(): readonly [Glyphs, Decorations | undefined];
}

/** Pixel-compares the source, first detached frame, and an immediate full-matrix write. */
export async function proveDetachedRasterParity(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  target: THREE.RenderTarget,
  text: BreakableText,
): Promise<DetachedRasterParity> {
  const sourcePixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height);
  const sourceVisible = text.visible;
  const parent = text.parent;
  if (parent === null) throw new TypeError('detached raster parity requires an attached text object');
  let detached: Glyphs | undefined;
  let decorations: Decorations | undefined;
  try {
    [detached, decorations] = text.breakApart();
    parent.add(detached);
    if (decorations !== undefined) parent.add(decorations);
    text.visible = false;
    await renderer.renderAsync(scene, camera);
    const firstFrame = await renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height);

    for (const [index, measurement] of detached.measurements.entries()) {
      detached.setWorldMatrixAt(index, measurement.originalWorldMatrix);
    }
    await renderer.renderAsync(scene, camera);
    const sameFrameWrite = await renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height);
    return {
      detachedFirstFrameMatches: pixelsEqual(sourcePixels, firstFrame),
      detachedSameFrameWriteMatches: pixelsEqual(sourcePixels, sameFrameWrite),
    };
  } finally {
    detached?.dispose();
    decorations?.dispose();
    text.visible = sourceVisible;
  }
}

function pixelsEqual(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
