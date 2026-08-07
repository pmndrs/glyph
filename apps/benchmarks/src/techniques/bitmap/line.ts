import { Text, type FontFeature, type ParagraphLayout, type RegisteredFont } from '@pmndrs/text';
import { bitmap, selectBitmapStrikePpem } from '@pmndrs/text/raster/bitmap/v0';
import * as THREE from 'three/webgpu';

import { LIVE_TEXT_COLOR, LIVE_TEXT_LINE_HEIGHT } from '../../workloads/shared/text-style';

export interface BitmapLine {
  readonly object: Text;
  readonly layout: ParagraphLayout;
  readonly height: number;
  readonly width: number;
  readonly cssFontSize: number;
  readonly glyphCount: number;
  readonly missingGlyphCount: number;
  readonly drawCount: number;
  readonly strikePpem: number;
  readonly scheduleMs: number;
  readonly readyMs: number;
}

export interface BitmapLineShaping {
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
  readonly features: readonly FontFeature[];
  readonly textAlign: 'start' | 'center';
  readonly rejectMissingGlyphs?: boolean;
}

const defaultShaping: BitmapLineShaping = { language: 'en', direction: 'ltr', features: [], textAlign: 'start' };

export async function createBitmapLine(
  font: RegisteredFont,
  raster: ReturnType<typeof bitmap>,
  text: string,
  fontSize: number,
  rasterPixelRatio: number,
  signal?: AbortSignal,
  layoutWidth?: number,
  shaping: BitmapLineShaping = defaultShaping,
): Promise<BitmapLine> {
  signal?.throwIfAborted();
  const startedAt = performance.now();
  const object = new Text({
    text,
    font,
    raster,
    fontSize,
    rasterPixelRatio,
    lineHeight: LIVE_TEXT_LINE_HEIGHT,
    color: LIVE_TEXT_COLOR,
    language: shaping.language,
    direction: shaping.direction,
    features: shaping.features,
    textAlign: shaping.textAlign,
    ...(layoutWidth === undefined ? {} : { width: layoutWidth, wrap: 'word' as const, overflow: 'visible' as const }),
  });
  const scheduledAt = performance.now();
  try {
    await object.ready;
    const readyAt = performance.now();
    signal?.throwIfAborted();
    const layout = object.layout;
    if (layout === undefined) throw new Error('public Text did not commit a bitmap layout');
    const missingGlyphCount = layout.glyphIds.reduce((count, glyphId) => count + (glyphId === 0 ? 1 : 0), 0);
    if (shaping.rejectMissingGlyphs !== false && missingGlyphCount !== 0) {
      throw new Error(`benchmark specimen contains ${missingGlyphCount} missing glyphs`);
    }
    return {
      object,
      layout,
      height: layout.height,
      width: layout.width,
      cssFontSize: fontSize,
      glyphCount: countRenderedGlyphs(object),
      missingGlyphCount,
      drawCount: countDraws(object),
      strikePpem: selectBitmapStrikePpem(
        raster.options.strikes.map((ppem) => ({ ppem })),
        fontSize,
        rasterPixelRatio,
      ),
      scheduleMs: scheduledAt - startedAt,
      readyMs: readyAt - scheduledAt,
    };
  } catch (error) {
    object.dispose();
    throw error;
  }
}

export function disposeBitmapLine(line: BitmapLine): void {
  line.object.dispose();
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
