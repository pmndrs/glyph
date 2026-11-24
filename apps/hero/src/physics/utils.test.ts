import type { GlyphOutlineContour } from '@pmndrs/glyph';
import { polygon2 } from 'math/shapes';
import { expect, it } from 'vitest';
import { buildCollider } from './utils';

/** A closed contour of straight edges through `points`, as an outline carries it: em units, y down. */
function contour(points: readonly (readonly [number, number])[]): GlyphOutlineContour {
  return points.map(([x, y], index) => {
    const [nextX, nextY] = points[(index + 1) % points.length]!;

    return [x, y, x, y, nextX, nextY, true];
  }) as unknown as GlyphOutlineContour;
}

it('builds a letter with a counter as solid convex pieces covering its outer shape', () => {
  // A square ring: an outer square wound one way and a counter wound the other.
  const outer = contour([
    [0, 0],
    [1, 0],
    [1, -1],
    [0, -1],
  ]);
  const counter = contour([
    [0.3, -0.3],
    [0.3, -0.7],
    [0.7, -0.7],
    [0.7, -0.3],
  ]);
  const collider = buildCollider([outer, counter], 0.02);
  const area = collider.pieces.reduce((sum, piece) => sum + polygon2.area(piece, piece.length / 2), 0);

  expect(area).toBeCloseTo(1);
  expect(collider.centerX).toBeCloseTo(0.5);
  expect(collider.centerY).toBeCloseTo(0.5);

  for (const piece of collider.pieces) expect(polygon2.isConvex(piece, piece.length / 2)).toBe(true);
});

it('cuts a concave letter into convex pieces of the same area', () => {
  // An L.
  const collider = buildCollider(
    [
      contour([
        [0, 0],
        [0.6, 0],
        [0.6, -0.2],
        [0.2, -0.2],
        [0.2, -1],
        [0, -1],
      ]),
    ],
    0.02,
  );
  const area = collider.pieces.reduce((sum, piece) => sum + polygon2.area(piece, piece.length / 2), 0);

  expect(collider.pieces.length).toBeGreaterThan(1);
  expect(area).toBeCloseTo(0.6 * 0.2 + 0.2 * 0.8);

  for (const piece of collider.pieces) expect(polygon2.isConvex(piece, piece.length / 2)).toBe(true);
});
