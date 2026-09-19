import { getSlugGlyphCurves } from '@pmndrs/glyph';
import { ShapePath, ShapeUtils, type Vector2 } from 'three/webgpu';
import type { SlugFont } from '../hero/fonts';

/** Invisible convex prisms extruded from a glyph outline and centered on its ink box. */
export interface Solid {
  /** Each prism is a flat `[x, y, z, ...]` list of the six corners of one triangle through the thickness. */
  readonly prisms: readonly (readonly number[])[];
}

/**
 * Triangulates the rendered glyph at `fontSize` per em and extrudes each triangle through `thickness`.
 */
export function solidOf(font: SlugFont, glyphId: number, fontSize: number, thickness: number): Solid {
  const outline = new ShapePath();
  let endX = NaN;
  let endY = NaN;
  let startX = NaN;
  let startY = NaN;

  for (const [x0, y0, x1, y1, x2, y2] of getSlugGlyphCurves(font, glyphId)) {
    if (x0 !== endX || y0 !== endY) {
      outline.moveTo(x0 * fontSize, y0 * fontSize);
      startX = x0;
      startY = y0;
    }

    outline.quadraticCurveTo(x1 * fontSize, y1 * fontSize, x2 * fontSize, y2 * fontSize);
    endX = x2;
    endY = y2;

    if (startX === x2 && startY === y2) {
      outline.currentPath!.closePath();
      endX = NaN;
      endY = NaN;
    }
  }

  const shapes = outline.toShapes();
  const points = shapes.map((shape) => shape.extractPoints(3));

  // Centred on the ink box: the body's origin is the letter's centre, as the paragraph measures it.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const { shape } of points) {
    for (const point of shape) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }

  if (!Number.isFinite(minX)) throw new Error(`no outline for glyph ${glyphId}`);

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const prisms: number[][] = [];
  const half = thickness / 2;

  for (const { shape: contour, holes } of points) {
    const vertices: Vector2[] = [...contour, ...holes.flat()];

    for (const triangle of ShapeUtils.triangulateShape(contour, holes)) {
      const p = vertices[triangle[0] ?? -1];
      const q = vertices[triangle[1] ?? -1];
      const r = vertices[triangle[2] ?? -1];

      if (p === undefined || q === undefined || r === undefined) continue;

      if (Math.abs((q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y)) / 2 < 1e-4) continue;

      const prism: number[] = [];

      for (const z of [-half, half]) {
        for (const corner of [p, q, r]) prism.push(corner.x - centerX, corner.y - centerY, z);
      }

      prisms.push(prism);
    }
  }

  return { prisms };
}
