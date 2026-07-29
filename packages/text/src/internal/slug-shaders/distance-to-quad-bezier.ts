/**
 * Copied from three-flatland Slug at 2935a89f (MIT), then adapted to the
 * repository's public Three 0.185.1 TSL boundary and named-node discipline.
 */
import type { Node } from 'three/webgpu'
import { float } from 'three/tsl'
import {
  floatAbs,
  floatAdd,
  floatClamp,
  floatDiv,
  floatLessThan,
  floatLessThanEqual,
  floatMax,
  floatMul,
  floatSelect,
  floatSqrt,
  floatSub,
  vec2Add,
  vec2Dot,
  vec2FromFloats,
  vec2MulFloat,
  vec2Sub,
} from './tsl-compat.js'

function product3(a: Node<'float'>, b: Node<'float'>, c: Node<'float'>): Node<'float'> {
  return floatMul(floatMul(a, b), c)
}

function product4(
  a: Node<'float'>,
  b: Node<'float'>,
  c: Node<'float'>,
  d: Node<'float'>,
): Node<'float'> {
  return floatMul(product3(a, b, c), d)
}

function evaluateDistanceSquared(
  point: Node<'vec2'>,
  p0: Node<'vec2'>,
  p1: Node<'vec2'>,
  p2: Node<'vec2'>,
  t: Node<'float'>,
): Node<'float'> {
  const complement = floatSub(float(1), t)
  const x = floatAdd(
    floatAdd(product3(complement, complement, p0.x), product4(float(2), complement, t, p1.x)),
    product3(t, t, p2.x),
  )
  const y = floatAdd(
    floatAdd(product3(complement, complement, p0.y), product4(float(2), complement, t, p1.y)),
    product3(t, t, p2.y),
  )
  const offsetX = floatSub(x, point.x)
  const offsetY = floatSub(y, point.y)
  return floatAdd(floatMul(offsetX, offsetX), floatMul(offsetY, offsetY))
}

/**
 * Analytic closest-distance candidate for one quadratic Bézier.
 *
 * This retains the legacy performance experiment: one midpoint Newton seed,
 * three refinements, and both endpoints. The independent CPU authority keeps
 * three seeds so browser evidence can expose any missed stationary point.
 */
export function distanceToQuadBezier(
  point: Node<'vec2'>,
  p0: Node<'vec2'>,
  p1: Node<'vec2'>,
  p2: Node<'vec2'>,
  namePrefix: string,
): Node<'vec2'> {
  const secondDifference = vec2Add(vec2Sub(p2, vec2MulFloat(p1, float(2))), p0).toVar(
    `${namePrefix}SecondDifference`,
  )
  const initialTangent = vec2Sub(p1, p0).toVar(`${namePrefix}InitialTangent`)
  const originOffset = vec2Sub(p0, point).toVar(`${namePrefix}OriginOffset`)
  const cubic = vec2Dot(secondDifference, secondDifference).toVar(`${namePrefix}Cubic`)
  const quadratic = floatMul(float(3), vec2Dot(secondDifference, initialTangent)).toVar(
    `${namePrefix}Quadratic`,
  )
  const linear = floatAdd(
    floatMul(float(2), vec2Dot(initialTangent, initialTangent)),
    vec2Dot(originOffset, secondDifference),
  ).toVar(`${namePrefix}Linear`)
  const constant = vec2Dot(originOffset, initialTangent).toVar(`${namePrefix}Constant`)

  const evaluate = (t: Node<'float'>): Node<'float'> =>
    floatAdd(
      floatAdd(floatAdd(product4(cubic, t, t, t), product3(quadratic, t, t)), floatMul(linear, t)),
      constant,
    )
  const derivative = (t: Node<'float'>): Node<'float'> =>
    floatAdd(floatAdd(product4(float(3), cubic, t, t), product3(float(2), quadratic, t)), linear)
  const refine = (t: Node<'float'>, slopeName: string): Node<'float'> => {
    const slope = derivative(t).toVar(slopeName)
    const safeMagnitude = floatMax(floatAbs(slope), float(1 / (1 << 20)))
    const safeSlope = floatSelect(
      floatLessThan(slope, float(0)),
      floatMul(float(-1), safeMagnitude),
      safeMagnitude,
    )
    return floatClamp(floatSub(t, floatDiv(evaluate(t), safeSlope)), float(0), float(1))
  }

  const midpoint = refine(float(0.5), `${namePrefix}NewtonSlope0`).toVar(`${namePrefix}ClosestT`)
  midpoint.assign(refine(midpoint, `${namePrefix}NewtonSlope1`))
  midpoint.assign(refine(midpoint, `${namePrefix}NewtonSlope2`))
  const distance0 = evaluateDistanceSquared(point, p0, p1, p2, float(0))
  const distance1 = evaluateDistanceSquared(point, p0, p1, p2, float(1))
  const distanceMidpoint = evaluateDistanceSquared(point, p0, p1, p2, midpoint)
  const midpointWins0 = floatLessThanEqual(distanceMidpoint, distance0)
  const bestT0 = floatSelect(midpointWins0, midpoint, float(0))
  const bestDistance0 = floatSelect(midpointWins0, distanceMidpoint, distance0)
  const best0Wins1 = floatLessThanEqual(bestDistance0, distance1)
  const bestT = floatSelect(best0Wins1, bestT0, float(1))
  const bestDistance = floatSelect(best0Wins1, bestDistance0, distance1)
  return vec2FromFloats(floatSqrt(bestDistance), bestT)
}
