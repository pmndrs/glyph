import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decodeSlugHeader,
  referenceCoverage,
  referenceDistanceToQuadratic,
  referenceHorizontalIntersections,
  referenceRootCode,
  referenceSlugBandTraversal,
  referenceSlugDilate,
  referenceSlugStrokeBandRange,
  referenceSlugStrokeCoverage,
  referenceVerticalIntersections,
  resolveSlugCurveTexel,
  slugGridCoordinate,
} from '../../dist/internal/slug-shaders/reference.js'

test('V0 header decoding preserves exact unsigned count and glyph-local offset', () => {
  assert.deepEqual(decodeSlugHeader(0xabcd_fffe), {
    curveCount: 0xabcd,
    glyphRelativeReferenceOffset: 0xfffe,
  })
  assert.deepEqual(decodeSlugHeader(-1), {
    curveCount: 0xffff,
    glyphRelativeReferenceOffset: 0xffff,
  })
})

test('V0 logical indices cross declared grid rows without packing assumptions', () => {
  assert.deepEqual(slugGridCoordinate(4095, 4096), [4095, 0])
  assert.deepEqual(slugGridCoordinate(4096, 4096), [0, 1])
  assert.deepEqual(slugGridCoordinate(797 * 63 + 796, 797), [796, 63])
  assert.throws(() => slugGridCoordinate(-1, 4096), /nonnegative safe integer/)
  assert.throws(() => slugGridCoordinate(0, 0), /positive safe integer/)
})

test('V0 u16 references remain glyph-local before resolving a curve texel', () => {
  assert.equal(resolveSlugCurveTexel(70_000, 0xffff), 135_535)
  assert.throws(() => resolveSlugCurveTexel(0, 0x1_0000), /unsigned 16-bit integer/)
})

test('fill band traversal stops at its sorted terminal and retains the 512-curve cap', () => {
  assert.deepEqual(referenceSlugBandTraversal([0.25, -0.51, 10]), [0, 1])
  assert.deepEqual(referenceSlugBandTraversal([0.25, 0, -0.5]), [0, 1, 2])
  assert.deepEqual(referenceSlugBandTraversal([-1, 10]), [0])
  assert.deepEqual(referenceSlugBandTraversal([], 0), [])
  assert.equal(referenceSlugBandTraversal(Array(600).fill(0)).length, 512)
  assert.throws(() => referenceSlugBandTraversal([Number.NaN]), /maxima/)
  assert.throws(() => referenceSlugBandTraversal([], -1), /curve count/)
})

test('root eligibility is confined to the two ordered-root bits', () => {
  for (const y1 of [-1, 1]) {
    for (const y2 of [-1, 1]) {
      for (const y3 of [-1, 1]) assert.equal(referenceRootCode(y1, y2, y3) & ~0x0101, 0)
    }
  }
  assert.equal(referenceRootCode(1, 1, 1), 0)
  assert.equal(referenceRootCode(-1, -1, -1), 0)
  assert.equal(referenceRootCode(1, -1, -1) & 1, 1)
})

test('stable q-form retains separated roots for the documented grazing regression', () => {
  const a = 2 ** -16
  const [x1, x2] = referenceHorizontalIntersections(
    -0.5,
    (3 * a) / 16,
    0,
    (-5 * a) / 16,
    0.5,
    (3 * a) / 16,
  )
  assert.ok(Math.abs(x1 + 0.25) < 1e-6)
  assert.ok(Math.abs(x2 - 0.25) < 1e-6)
  assert.ok(Math.abs(x1 - x2) > 0.4)
})

test('horizontal and vertical solvers return finite intersections', () => {
  const horizontal = referenceHorizontalIntersections(0, 1, 0.3, -1, 1, 0.5)
  const vertical = referenceVerticalIntersections(-1, 0, 0.5, 0.5, -1, 1)
  assert.ok(horizontal.every(Number.isFinite))
  assert.ok(vertical.every(Number.isFinite))
})

test('coverage preserves nonzero, even-odd, boost, and stem-darkening behavior', () => {
  assert.equal(referenceCoverage(1, 1, 1, 1), 1)
  assert.equal(referenceCoverage(0, 0, 0, 0), 0)
  assert.equal(referenceCoverage(0.7, 0, 0.3, 0), 0.3)
  assert.equal(referenceCoverage(2, 1, 2, 1, true), 0)
  assert.equal(referenceCoverage(0.25, 1, 0.25, 1, false, true), 0.5)
  assert.ok(referenceCoverage(0.5, 1, 0.5, 1, false, false, 0.4, 8) > 0.5)
})

test('quadratic distance authority covers body, endpoints, lines, and points', () => {
  const line = { p0: [0, 0], p1: [0.5, 0], p2: [1, 0] }
  assert.deepEqual(referenceDistanceToQuadratic([0.5, 0], line), { distance: 0, t: 0.5 })
  assert.deepEqual(referenceDistanceToQuadratic([-1, 0], line), { distance: 1, t: 0 })
  assert.deepEqual(referenceDistanceToQuadratic([2, 0], line), { distance: 1, t: 1 })
  assert.deepEqual(referenceDistanceToQuadratic([4, 6], { p0: [1, 2], p1: [1, 2], p2: [1, 2] }), {
    distance: 5,
    t: 0,
  })
})

test('stroke authority preserves its nominal edge and one-pixel hairline gate', () => {
  const line = [{ p0: [0, 0], p1: [0.5, 0], p2: [1, 0] }]
  assert.equal(referenceSlugStrokeCoverage(line, [0.5, 0], 0.05, 0.001), 1)
  assert.ok(Math.abs(referenceSlugStrokeCoverage(line, [0.5, 0.05], 0.05, 0.02) - 0.5) < 1e-9)
  assert.ok(referenceSlugStrokeCoverage(line, [0.5, 0.005], 0.002, 0.02) > 0)
  assert.equal(referenceSlugStrokeCoverage(line, [0.5, 0.5], 0.05, 0.02), 0)
})

test('stroke band search crosses boundaries and clamps its half-open interval', () => {
  assert.deepEqual(referenceSlugStrokeBandRange(0.061, 0.005, 16, 0, 16), [0, 2])
  assert.deepEqual(referenceSlugStrokeBandRange(0.5, 0.08, 16, 0, 16), [6, 10])
  assert.deepEqual(referenceSlugStrokeBandRange(-1, 0.25, 16, 0, 16), [0, 1])
  assert.deepEqual(referenceSlugStrokeBandRange(2, 0.25, 16, 0, 16), [15, 16])
  assert.throws(() => referenceSlugStrokeBandRange(0, -1, 16, 0, 16), /radius and scale/)
})

test('dilation expands in object space and scales the em-space adjustment', () => {
  const result = referenceSlugDilate(
    [0, 0],
    [1, 0],
    [0.5, 0.5],
    2,
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 0, 1],
    [800, 600],
  )
  assert.ok(result.position[0] > 0)
  assert.ok(Math.abs(result.textureCoordinate[0] - 0.5 - result.position[0] * 2) < 1e-9)

  const zero = referenceSlugDilate(
    [0, 0],
    [0, 0],
    [0.5, 0.5],
    1,
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 0, 1],
    [800, 600],
  )
  assert.deepEqual(zero.position, [0, 0])
})
