/**
 * Adapted from three-flatland Slug at 866f77f9 (MIT), before the
 * experimental eac7d015 naive-solver trade-off (MIT). See RESEARCH.md.
 */
import type { Node } from 'three/webgpu'
import {
  If,
  abs,
  add,
  div,
  float,
  greaterThanEqual,
  lessThan,
  lessThanEqual,
  mul,
  select,
  sqrt,
  sub,
  vec2,
} from 'three/tsl'

/**
 * Two real roots of `a*t^2 - 2*b*t + c = 0`, ordered to match
 * `calcRootCode`'s winding convention.
 */
function stableRoots(
  a: Node<'float'>,
  b: Node<'float'>,
  c: Node<'float'>,
  namePrefix: 'slugHorizontal' | 'slugVertical',
): Node<'vec2'> {
  const bSquared: Node<'float'> = mul(b, b)
  const aTimesC: Node<'float'> = mul(a, c)
  const discriminant: Node<'float'> = sub(bSquared, aTimesC).toVar(`${namePrefix}Discriminant`)
  const t1: Node<'float'> = float(0).toVar(`${namePrefix}PolynomialRoot1`)
  const t2: Node<'float'> = float(0).toVar(`${namePrefix}PolynomialRoot2`)
  const absoluteA: Node<'float'> = abs(a)
  const linearAxis: Node<'bool'> = lessThan(absoluteA, 1 / 65_536)

  If(linearAxis, () => {
    const twiceB: Node<'float'> = mul(b, 2)
    const linearRoot: Node<'float'> = div(c, twiceB)
    t1.assign(linearRoot)
    t2.assign(linearRoot)
  })
    .ElseIf(lessThanEqual(discriminant, 0), () => {
      const extremum = div(b, a)
      t1.assign(extremum)
      t2.assign(extremum)
    })
    .Else(() => {
      // These variables are intentional code-generation hoists. `select` evaluates
      // both operands, so leaving the expressions inline duplicates sqrt/div work.
      const distance: Node<'float'> = sqrt(discriminant).toVar(`${namePrefix}RootDistance`)
      const bPositive: Node<'bool'> = greaterThanEqual(b, 0).toVar(`${namePrefix}BPositive`)
      const sign: Node<'float'> = select(bPositive, float(1), float(-1))
      const signedDistance: Node<'float'> = mul(sign, distance)
      const q: Node<'float'> = add(b, signedDistance).toVar(`${namePrefix}Q`)
      const rootA: Node<'float'> = div(q, a).toVar(`${namePrefix}RootA`)
      const rootB: Node<'float'> = div(c, q).toVar(`${namePrefix}RootB`)
      t1.assign(select(bPositive, rootB, rootA))
      t2.assign(select(bPositive, rootA, rootB))
    })

  return vec2(t1, t2)
}

/** Solve a quadratic curve's intersections with a horizontal ray at y=0. */
export function solveHorizontalPolynomial(
  p0: Node<'vec2'>,
  p1: Node<'vec2'>,
  p2: Node<'vec2'>,
): Node<'vec2'> {
  const twiceP1Y: Node<'float'> = mul(p1.y, 2)
  const p0MinusTwiceP1Y: Node<'float'> = sub(p0.y, twiceP1Y)
  const a: Node<'float'> = add(p0MinusTwiceP1Y, p2.y)
  const b: Node<'float'> = sub(p0.y, p1.y)
  const roots = stableRoots(a, b, p0.y, 'slugHorizontal')
  const twiceP1X: Node<'float'> = mul(p1.x, 2)
  const p0MinusTwiceP1X: Node<'float'> = sub(p0.x, twiceP1X)
  const ax: Node<'float'> = add(p0MinusTwiceP1X, p2.x)
  const bx: Node<'float'> = sub(p0.x, p1.x)
  const twiceBx: Node<'float'> = mul(bx, 2)
  const axT1: Node<'float'> = mul(ax, roots.x)
  const axT2: Node<'float'> = mul(ax, roots.y)
  const x1Body: Node<'float'> = mul(sub(axT1, twiceBx), roots.x)
  const x2Body: Node<'float'> = mul(sub(axT2, twiceBx), roots.y)
  const x1: Node<'float'> = add(x1Body, p0.x)
  const x2: Node<'float'> = add(x2Body, p0.x)

  return vec2(x1, x2)
}

/** Solve a quadratic curve's intersections with a vertical ray at x=0. */
export function solveVerticalPolynomial(
  p0: Node<'vec2'>,
  p1: Node<'vec2'>,
  p2: Node<'vec2'>,
): Node<'vec2'> {
  const twiceP1X: Node<'float'> = mul(p1.x, 2)
  const p0MinusTwiceP1X: Node<'float'> = sub(p0.x, twiceP1X)
  const a: Node<'float'> = add(p0MinusTwiceP1X, p2.x)
  const b: Node<'float'> = sub(p0.x, p1.x)
  const roots = stableRoots(a, b, p0.x, 'slugVertical')
  const twiceP1Y: Node<'float'> = mul(p1.y, 2)
  const p0MinusTwiceP1Y: Node<'float'> = sub(p0.y, twiceP1Y)
  const ay: Node<'float'> = add(p0MinusTwiceP1Y, p2.y)
  const by: Node<'float'> = sub(p0.y, p1.y)
  const twiceBy: Node<'float'> = mul(by, 2)
  const ayT1: Node<'float'> = mul(ay, roots.x)
  const ayT2: Node<'float'> = mul(ay, roots.y)
  const y1Body: Node<'float'> = mul(sub(ayT1, twiceBy), roots.x)
  const y2Body: Node<'float'> = mul(sub(ayT2, twiceBy), roots.y)
  const y1: Node<'float'> = add(y1Body, p0.y)
  const y2: Node<'float'> = add(y2Body, p0.y)

  return vec2(y1, y2)
}
