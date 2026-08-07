/**
 * Adapted from three-flatland Slug at 866f77f9 (MIT), before the
 * experimental eac7d015 naive-solver trade-off (MIT). See RESEARCH.md.
 */
import type { Node } from 'three/webgpu';
import { add, mul, sub, vec2 } from 'three/tsl';
import { d, std } from 'typegpu';
import * as t3 from '@typegpu/three';

/**
 * Two real roots of `a*t^2 - 2*b*t + c = 0`, ordered to match
 * `calcRootCode`'s winding convention.
 */
function stableRoots(a: number, b: number, c: number): d.v2f {
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
export function solveHorizontalPolynomial(p0: Node<'vec2'>, p1: Node<'vec2'>, p2: Node<'vec2'>): Node<'vec2'> {
  const twiceP1Y: Node<'float'> = mul(p1.y, 2);
  const p0MinusTwiceP1Y: Node<'float'> = sub(p0.y, twiceP1Y);
  const a: Node<'float'> = add(p0MinusTwiceP1Y, p2.y);
  const b: Node<'float'> = sub(p0.y, p1.y);

  const roots = t3.toTSL(() => {
    'use gpu';
    return stableRoots(
      t3.fromTSL(a, d.f32).$, // a
      t3.fromTSL(b, d.f32).$, // b
      t3.fromTSL(p0.y, d.f32).$, // c
    );
  }) as Node<'vec2'>;

  const twiceP1X: Node<'float'> = mul(p1.x, 2);
  const p0MinusTwiceP1X: Node<'float'> = sub(p0.x, twiceP1X);
  const ax: Node<'float'> = add(p0MinusTwiceP1X, p2.x);
  const bx: Node<'float'> = sub(p0.x, p1.x);
  const twiceBx: Node<'float'> = mul(bx, 2);
  const axT1: Node<'float'> = mul(ax, roots.x);
  const axT2: Node<'float'> = mul(ax, roots.y);
  const x1Body: Node<'float'> = mul(sub(axT1, twiceBx), roots.x);
  const x2Body: Node<'float'> = mul(sub(axT2, twiceBx), roots.y);
  const x1: Node<'float'> = add(x1Body, p0.x);
  const x2: Node<'float'> = add(x2Body, p0.x);

  return vec2(x1, x2);
}

/** Solve a quadratic curve's intersections with a vertical ray at x=0. */
export function solveVerticalPolynomial(p0: Node<'vec2'>, p1: Node<'vec2'>, p2: Node<'vec2'>): Node<'vec2'> {
  const twiceP1X: Node<'float'> = mul(p1.x, 2);
  const p0MinusTwiceP1X: Node<'float'> = sub(p0.x, twiceP1X);
  const a: Node<'float'> = add(p0MinusTwiceP1X, p2.x);
  const b: Node<'float'> = sub(p0.x, p1.x);

  const roots = t3.toTSL(() => {
    'use gpu';
    return stableRoots(
      t3.fromTSL(a, d.f32).$, // a
      t3.fromTSL(b, d.f32).$, // b
      t3.fromTSL(p0.x, d.f32).$, // c
    );
  }) as Node<'vec2'>;

  const twiceP1Y: Node<'float'> = mul(p1.y, 2);
  const p0MinusTwiceP1Y: Node<'float'> = sub(p0.y, twiceP1Y);
  const ay: Node<'float'> = add(p0MinusTwiceP1Y, p2.y);
  const by: Node<'float'> = sub(p0.y, p1.y);
  const twiceBy: Node<'float'> = mul(by, 2);
  const ayT1: Node<'float'> = mul(ay, roots.x);
  const ayT2: Node<'float'> = mul(ay, roots.y);
  const y1Body: Node<'float'> = mul(sub(ayT1, twiceBy), roots.x);
  const y2Body: Node<'float'> = mul(sub(ayT2, twiceBy), roots.y);
  const y1: Node<'float'> = add(y1Body, p0.y);
  const y2: Node<'float'> = add(y2Body, p0.y);

  return vec2(y1, y2);
}
