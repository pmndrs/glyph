import { Decorations, Glyphs } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';

import { comparePixelReadbacks } from './renderer/pixel-readback-comparison';

export interface DetachedRasterParity {
  readonly detachedFirstFrameMatches: boolean;
  readonly detachedSameFrameWriteMatches: boolean;
}

interface SplittableText {
  readonly parent: THREE.Object3D | null;
  visible: boolean;
  split(): readonly [Glyphs, Decorations | undefined];
  commitState(): { readonly status: string };
}

/** Copies before source publication, then pixel-compares ordinary publication and detached rendering. */
export async function proveDetachedRasterParity(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  target: THREE.RenderTarget,
  text: SplittableText,
  /**
   * Readback tolerance, exact by default. A detached branch places glyphs through its per-glyph matrices; with quads
   * trimmed to fractional insets that arithmetic rounds a few vertex positions one ulp away from the source's, which
   * can move an edge sample to the adjacent byte. Techniques with untrimmed quads stay exact.
   */
  tolerance: Readonly<{ channelDelta: number; sparseChannels: number }> = { channelDelta: 0, sparseChannels: 0 },
): Promise<DetachedRasterParity> {
  const sourceVisible = text.visible;
  const parent = text.parent;
  if (parent === null) throw new TypeError('detached raster parity requires an attached text object');
  const matches = (expected: ArrayLike<number>, actual: ArrayLike<number>): boolean =>
    comparePixelReadbacks(expected, actual, tolerance.channelDelta, tolerance.sparseChannels).matches;
  let detached: Glyphs | undefined;
  let decorations: Decorations | undefined;
  try {
    [detached, decorations] = text.split();
    if (text.commitState().status !== 'pending') throw new Error('split published the unrendered source');
    await renderer.renderAsync(scene, camera);
    const sourcePixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height);
    parent.add(detached);
    if (decorations !== undefined) parent.add(decorations);
    text.visible = false;
    await renderer.renderAsync(scene, camera);
    const firstFrame = await renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height);

    for (const [index, measurement] of detached.measurements.entries()) {
      detached.setMatrixAt(index, measurement.originalMatrix);
    }
    await renderer.renderAsync(scene, camera);
    const sameFrameWrite = await renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height);
    return {
      detachedFirstFrameMatches: matches(sourcePixels, firstFrame),
      detachedSameFrameWriteMatches: matches(sourcePixels, sameFrameWrite),
    };
  } finally {
    detached?.dispose();
    decorations?.dispose();
    text.visible = sourceVisible;
  }
}
