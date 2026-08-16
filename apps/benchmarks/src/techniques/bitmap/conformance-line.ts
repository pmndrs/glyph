import type { LoadedFont, ParagraphLayout } from '@pmndrs/glyph';
import { selectBitmapStrikePpem, type bitmap } from '@pmndrs/glyph/three/bitmap';
import { Text } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';

import { LIVE_TEXT_LINE_HEIGHT } from '../../workloads/shared/text-style';

/** White, so every rendered channel carries the atlas coverage the exact CPU reference composites. */
const CONFORMANCE_TEXT_COLOR = '#ffffff';

/**
 * One committed target-v1 Bitmap paragraph, measured. The exact conformance oracle compares GPU bytes against a CPU
 * compositor that reads the same layout, so the layout has to be readable without re-running it.
 */
export interface BitmapConformanceLine {
  readonly object: Text<typeof bitmap>;
  readonly layout: ParagraphLayout;
  readonly height: number;
  readonly width: number;
  readonly cssFontSize: number;
  readonly glyphCount: number;
  readonly missingGlyphCount: number;
  readonly drawCount: number;
  readonly strikePpem: number;
}

/**
 * Builds one target-v1 paragraph under `parent` and commits it. `Text` reconciles during `updateMatrixWorld` and only
 * while it is parented, so attaching before committing — rather than awaiting a readiness promise — is what makes the
 * layout and its draws observable, and lets a preparation failure surface as a thrown error instead of an empty frame.
 */
export function createBitmapConformanceLine(
  parent: THREE.Object3D,
  font: LoadedFont<typeof bitmap>,
  text: string,
  cssFontSize: number,
  rasterPixelRatio: number,
  signal?: AbortSignal,
): BitmapConformanceLine {
  signal?.throwIfAborted();
  const object = new Text({
    font,
    text,
    pixelSnapping: true,
    contentBox: { align: 'start' },
    style: { fontSize: cssFontSize, lineHeight: LIVE_TEXT_LINE_HEIGHT, language: 'en', direction: 'ltr', features: [] },
    paint: { color: CONFORMANCE_TEXT_COLOR },
    rasterPixelRatio,
  });
  parent.add(object);
  try {
    object.updateMatrixWorld(true);
    if (object.error !== undefined) throw object.error;
    const layout = object.inspectLayout();
    if (layout === undefined) throw new Error('target-v1 Text did not commit a bitmap layout');
    const missingGlyphCount = layout.glyphIds.reduce((count, glyphId) => count + (glyphId === 0 ? 1 : 0), 0);
    if (missingGlyphCount !== 0) throw new Error(`benchmark specimen contains ${missingGlyphCount} missing glyphs`);
    return {
      object,
      layout,
      height: layout.height,
      width: layout.width,
      cssFontSize,
      glyphCount: countRenderedGlyphs(object),
      missingGlyphCount,
      drawCount: countDraws(object),
      strikePpem: selectBitmapStrikePpem(font.data.strikes, cssFontSize, rasterPixelRatio),
    };
  } catch (error) {
    disposeText(object);
    throw error;
  }
}

export function disposeBitmapConformanceLine(line: BitmapConformanceLine): void {
  disposeText(line.object);
}

function disposeText(object: Text<typeof bitmap>): void {
  object.removeFromParent();
  object.dispose();
}

function countDraws(object: THREE.Object3D): number {
  let count = 0;
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) count += 1;
  });
  return count;
}

function countRenderedGlyphs(object: THREE.Object3D): number {
  let count = 0;
  object.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry instanceof THREE.InstancedBufferGeometry) {
      count += child.geometry.instanceCount;
    }
  });
  return count;
}
