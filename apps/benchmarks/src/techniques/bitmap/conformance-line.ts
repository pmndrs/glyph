import type { Font, GlyphLayout } from '@pmndrs/glyph';
import { selectBitmapStrikePpem, type bitmap, type BitmapData } from '@pmndrs/glyph/raster/bitmap';
import type { Text, ThreeRoot } from '@pmndrs/glyph/three';
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
  readonly layout: GlyphLayout;
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
  scene: THREE.Scene,
  root: ThreeRoot,
  font: Font<typeof bitmap>,
  data: BitmapData,
  text: string,
  cssFontSize: number,
  rasterPixelRatio: number,
  signal?: AbortSignal,
): BitmapConformanceLine {
  signal?.throwIfAborted();
  const object = root.createText({
    font,
    text,
    pixelSnapping: true,
    layout: { align: 'start' },
    style: {
      fontSize: cssFontSize,
      lineHeight: LIVE_TEXT_LINE_HEIGHT,
      language: 'en',
      direction: 'ltr',
      features: [],
      color: CONFORMANCE_TEXT_COLOR,
    },
    rasterPixelRatio,
  });
  scene.add(object);
  try {
    object.updateMatrixWorld(true);
    if (object.error !== undefined) throw object.error;
    const layout = object.glyphs();
    if (layout === undefined) throw new Error('target-v1 Text did not commit a bitmap layout');
    const missingGlyphCount = layout.glyphIds.reduce((count, glyphId) => count + (glyphId === 0 ? 1 : 0), 0);
    if (missingGlyphCount !== 0) throw new Error(`benchmark specimen contains ${missingGlyphCount} missing glyphs`);
    return {
      object,
      layout,
      height: layout.height,
      width: layout.width,
      cssFontSize,
      glyphCount: layout.glyphIds.length,
      missingGlyphCount,
      drawCount: countDraws(scene, root),
      strikePpem: selectBitmapStrikePpem(data.strikes, cssFontSize, rasterPixelRatio),
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

function countDraws(scene: THREE.Scene, root: ThreeRoot): number {
  let count = 0;
  const name = root.name === undefined ? '@pmndrs/glyph:anonymous' : `@pmndrs/glyph:${root.name}`;
  scene.getObjectByName(name)?.traverse((child) => {
    if (child instanceof THREE.Mesh) count += 1;
  });
  return count;
}
