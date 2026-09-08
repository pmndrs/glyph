/**
 * Adapted from three-flatland Slug at 866f77f9 (MIT), before the
 * experimental eac7d015 naive-solver trade-off (MIT). See RESEARCH.md.
 */
import { d, std } from 'typegpu';

/**
 * Two real roots of `a*t^2 - 2*b*t + c = 0`, ordered to match
 * `calcRootCode`'s winding convention.
 */
export function stableRoots(a: number, b: number, c: number): d.v2f {
  'use gpu';

  const discriminant = b * b - a * c;
  let t1 = d.f32(0); // polynomial root #1
  let t2 = d.f32(0); // polynomial root #2
  const linearAxis = std.abs(a) < 1 / 65_536;

  if (linearAxis) {
    const twiceB = b * 2;
    const linearRoot = c / twiceB;
    t1 = linearRoot;
    t2 = linearRoot;
  } else if (discriminant <= 0) {
    const extremum = b / a;
    t1 = extremum;
    t2 = extremum;
  } else {
    const distance = std.sqrt(discriminant);
    const sign = std.select(d.f32(-1), d.f32(1), b >= 0);
    const signedDistance = sign * distance;
    const q = b + signedDistance;
    const rootA = q / a;
    const rootB = c / q;
    t1 = std.select(rootA, rootB, b >= 0);
    t2 = std.select(rootB, rootA, b >= 0);
  }

  return d.vec2f(t1, t2);
}

/** Solve a quadratic curve's intersections with a horizontal ray at y=0. */
export function solveHorizontalPolynomial(p0: d.v2f, p1: d.v2f, p2: d.v2f): d.v2f {
  'use gpu';

  const roots = stableRoots(p0.y - p1.y * 2 + p2.y, p0.y - p1.y, p0.y);
  const a = p0.x - p1.x * 2 + p2.x;
  const b = p0.x - p1.x;

  return d.vec2f((a * roots.x - b * 2) * roots.x + p0.x, (a * roots.y - b * 2) * roots.y + p0.x);
}

/**
 * Solve a quadratic curve's intersections with a vertical ray at x=0.
 *
 * A vertical ray is the horizontal solve in the transposed frame, so the
 * transpose is the whole difference; both axes share one solver.
 */
export function solveVerticalPolynomial(p0: d.v2f, p1: d.v2f, p2: d.v2f): d.v2f {
  'use gpu';

  return solveHorizontalPolynomial(p0.yx, p1.yx, p2.yx);
}
