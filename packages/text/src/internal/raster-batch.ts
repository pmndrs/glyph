import * as THREE from 'three/webgpu';

import type { ParagraphLayout } from '../layout.js';
import type { GlyphPaint, LinearRgba } from '../paint.js';

/** Build the indexed unit quad shared by instanced raster techniques. */
export function unitRasterQuadGeometry(): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  return geometry;
}

export function resolvedGlyphColor(paint: GlyphPaint, glyphIndex: number): LinearRgba {
  const paintIndex = paint.paintIndices[glyphIndex];
  const resolved = paintIndex === undefined ? undefined : paint.palette[paintIndex];
  if (resolved === undefined) throw new TypeError('glyph paint references a missing palette entry');
  return resolved.color;
}

/** Compose one composite-object base with a raster run's first-glyph-local order. */
export function rasterRenderOrder(base: number, glyphIndices: Uint32Array): number {
  return base + (glyphIndices[0] ?? 0);
}

export function assertParallelRasterLayout(layout: ParagraphLayout, paint: GlyphPaint): void {
  const glyphCount = layout.glyphIds.length;
  for (const values of [layout.glyphFontSlots, layout.glyphFontSizes, layout.x, layout.y]) {
    if (values.length !== glyphCount) throw new TypeError('paragraph glyph arrays are not parallel');
  }
  assertParallelRasterPaint(layout, paint);
}

export function assertParallelRasterPaint(layout: ParagraphLayout, paint: GlyphPaint): void {
  if (paint.paintIndices.length !== layout.glyphIds.length || paint.palette.length === 0) {
    throw new TypeError('glyph paint does not match the paragraph layout');
  }
}
