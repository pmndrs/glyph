import type { GlyphOutlineContour } from '@pmndrs/glyph';
import { decomposePolygon2Quick } from 'math/geometry';
import { polygon2 } from 'math/shapes';

/**
 * Convex collider pieces from a glyph outline, in em units with y up and the origin at the pen position. Every
 * quadratic is flattened to a chord tolerance, the contours that lie inside another are dropped, so a counter is
 * solid and a letter is a few fat pieces, and each outer contour is cut into convex polygons.
 */
export interface Collider {
  /** Counter-clockwise convex polygons as flat `x, y` pairs. */
  readonly pieces: readonly number[][];
  /** The pieces' area-weighted centre, which is what the body turns about. */
  readonly centerX: number;
  readonly centerY: number;
}

const point: [number, number] = [0, 0];

export function buildCollider(outline: readonly GlyphOutlineContour[], tolerance: number): Collider {
  const contours: number[][] = [];

  for (const contour of outline) {
    const vertices: number[] = [];

    for (const [x0, y0, cx, cy, x1, y1, isLine] of contour) {
      if (!isLine) {
        // A chord of a quadratic strays from it by at most |p0 - 2c + p1| / (4 n^2) over n equal steps.
        const bend = Math.hypot(x0 - 2 * cx + x1, y0 - 2 * cy + y1);
        const steps = Math.max(1, Math.ceil(Math.sqrt(bend / (4 * tolerance))));

        for (let step = 1; step < steps; step++) {
          const t = step / steps;
          const u = 1 - t;
          vertices.push(u * u * x0 + 2 * u * t * cx + t * t * x1, -(u * u * y0 + 2 * u * t * cy + t * t * y1));
        }
      }

      vertices.push(x1, -y1);
    }

    if (vertices.length >= 6) contours.push(vertices);
  }

  const pieces: number[][] = [];
  let area = 0;
  let centerX = 0;
  let centerY = 0;

  for (const [index, contour] of contours.entries()) {
    point[0] = contour[0]!;
    point[1] = contour[1]!;
    // Inside an odd number of the others means this contour bounds a counter, not ink.
    let depth = 0;

    for (const [other, around] of contours.entries()) {
      if (other !== index && polygon2.containsPoint(around, around.length / 2, point)) depth++;
    }

    if (depth % 2 === 1) continue;

    const count = contour.length / 2;
    const outer = polygon2.signedArea(contour, count) < 0 ? polygon2.reverse([], contour, count) : contour;

    for (const piece of decomposePolygon2Quick(outer, count)) {
      const pieceArea = polygon2.area(piece, piece.length / 2);

      // A sliver has no hull worth making.
      if (piece.length < 6 || pieceArea < 1e-5) continue;

      polygon2.centroid(point, piece, piece.length / 2);
      centerX += point[0] * pieceArea;
      centerY += point[1] * pieceArea;
      area += pieceArea;
      pieces.push(piece);
    }
  }

  return { pieces, centerX: area > 0 ? centerX / area : 0, centerY: area > 0 ? centerY / area : 0 };
}
