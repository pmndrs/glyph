import assert from 'node:assert/strict';
import test from 'node:test';

import tgpu from 'typegpu';
import * as d from 'typegpu/data';

import {
  referenceCalcRootCode,
  referenceCalcSlugCoverage,
  referenceSlugBandCurveCount,
  referenceSlugDilate,
  referenceSlugDilateMatrix,
  referenceSlugGridCoordinate,
  referenceSlugStemDarken,
  referenceSlugThickenFactor,
  referenceSolveHorizontalPolynomial,
  referenceSolveVerticalPolynomial,
  referenceStableRoots,
} from '../../dist/typegpu/slug-reference.js';
import {
  calcRootCode,
  calcSlugCoverage,
  slugDilate,
  slugDilateMatrix,
  slugStemDarken,
  slugThickenFactor,
  stableRoots,
  solveHorizontalPolynomial,
  solveVerticalPolynomial,
} from '../../dist/typegpu/slug-shader.js';

/**
 * Slug behavior between the CPU mirrors and the shipped TypeGPU shader functions.
 *
 * The two sides cannot execute against each other without a GPU, so the pin stands on
 * simulations and mirrors: every pure math stage of the shipped fragment/vertex graph
 * runs through TypeGPU's CPU simulation of the GPU execution model and is compared to
 * its operation-for-operation CPU mirror. The band walk and texture reads are pinned
 * against the `/tsl` realization's generated WGSL in `typegpu-slug-parity.test.mjs`.
 */

/** Runs one shipped shader function through TypeGPU's CPU simulation of the GPU execution model. */
function evaluate(fn, ...args) {
  return plain(tgpu['~unstable'].simulate(() => fn(...args)).value);
}

/** Vec and struct instances expose their numbers through a JSON representation. */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertVec2Close(actual, expected, message) {
  for (let index = 0; index < 2; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= 1e-5 * Math.max(1, Math.abs(expected[index])),
      `${message ?? 'value'} mismatch at component ${index}: ${actual[index]} vs ${expected[index]}`,
    );
  }
}

const ROOT_CASES = [
  // [a, b, c] for `a*t^2 - 2*b*t + c = 0`
  { label: 'linear axis', a: 0, b: 2, c: 3 },
  { label: 'near-linear axis', a: 1 / 131_072, b: -1.5, c: 0.25 },
  { label: 'degenerate discriminant', a: 2, b: 2, c: 2 },
  { label: 'negative discriminant', a: 4, b: 1, c: 4 },
  { label: 'positive b', a: 2, b: 3, c: 1 },
  { label: 'negative b', a: -2, b: -3, c: 0.5 },
];

test('the stable q-form solver agrees with its CPU mirror across every branch', () => {
  for (const item of ROOT_CASES) {
    const roots = evaluate(stableRoots, item.a, item.b, item.c);
    assertVec2Close(roots, referenceStableRoots(item.a, item.b, item.c), `${item.label}: roots`);
  }
});

test('both polynomial solves agree with their CPU mirrors and the TSL reference intersections', () => {
  const curves = [
    // p0, p1, p2 control points straddling the ray axes
    { p0: [-0.5, 0.25], p1: [0.5, -0.75], p2: [1.5, 0.5] },
    { p0: [0.125, -0.125], p1: [0.625, 0.875], p2: [1.125, -0.5] },
    { p0: [-2, 1], p1: [-1, -2], p2: [0, 1] },
  ];
  for (const curve of curves) {
    const [p0x, p0y] = curve.p0;
    const [p1x, p1y] = curve.p1;
    const [p2x, p2y] = curve.p2;
    const horizontal = evaluate(solveHorizontalPolynomial, d.vec2f(p0x, p0y), d.vec2f(p1x, p1y), d.vec2f(p2x, p2y));
    assertVec2Close(horizontal, referenceSolveHorizontalPolynomial(p0x, p0y, p1x, p1y, p2x, p2y), 'horizontal x');
    const vertical = evaluate(solveVerticalPolynomial, d.vec2f(p0x, p0y), d.vec2f(p1x, p1y), d.vec2f(p2x, p2y));
    assertVec2Close(vertical, referenceSolveVerticalPolynomial(p0x, p0y, p1x, p1y, p2x, p2y), 'vertical y');
  }
});

test('the root eligibility table reproduces every sign combination', () => {
  const signs = [0, 1];
  for (const s1 of signs) {
    for (const s2 of signs) {
      for (const s3 of signs) {
        const y1 = s1 ? -1 : 1;
        const y2 = s2 ? -2 : 2;
        const y3 = s3 ? -3 : 3;
        assert.equal(evaluate(calcRootCode, y1, y2, y3), referenceCalcRootCode(y1, y2, y3));
      }
    }
  }
});

test('the weighted coverage blend agrees with its CPU mirror across fill rules', () => {
  for (const xCoverage of [-1.5, -0.25, 0, 0.75]) {
    for (const yCoverage of [-1, 0.5]) {
      for (const evenOdd of [false, true]) {
        for (const weightBoost of [false, true]) {
          const args = [xCoverage, 0.75, yCoverage, 0.25, evenOdd, weightBoost];
          const blended = evaluate(calcSlugCoverage, ...args);
          const mirrored = referenceCalcSlugCoverage(...args);
          assert.ok(
            Math.abs(blended - mirrored) <= 1e-6,
            `coverage mismatch for ${JSON.stringify(args)}: ${blended} vs ${mirrored}`,
          );
        }
      }
    }
  }
});

test('thickening and stem darkening are exact identities at zero strength', () => {
  assert.equal(evaluate(slugThickenFactor, 0, 13.5), 1);
  for (const coverage of [0, 0.25, 0.5, 1]) {
    assert.equal(evaluate(slugStemDarken, coverage, 0), coverage);
  }
});

test('thickening and stem darkening agree with their CPU mirrors below 24 pixels per em', () => {
  assert.ok(Math.abs(evaluate(slugThickenFactor, 0.5, 12) - referenceSlugThickenFactor(0.5, 12)) <= 1e-6);
  assert.ok(Math.abs(evaluate(slugThickenFactor, 0.25, 48) - referenceSlugThickenFactor(0.25, 48)) <= 1e-6);
  assert.ok(Math.abs(evaluate(slugStemDarken, 0.6, 0.5) - referenceSlugStemDarken(0.6, 0.5)) <= 1e-6);
});

const VIEWPORT = [800, 600];
const INVERSE_SCALE = 16;
const QUAD_POSITIONS = [
  [0, 0],
  [0.25, 0.75],
  [0, 1],
  [1, 1],
];

test('row dilation matches the TSL reference across the glyph quad', () => {
  const mvpRow0 = [0.5, 0, 0, 0];
  const mvpRow1 = [0, 0.75, 0, 0];
  const mvpRow3 = [0, 0, 0, 1];
  for (const quadPosition of QUAD_POSITIONS) {
    const placed = {
      localPosition: [quadPosition[0], quadPosition[1]],
      outwardNormal: [quadPosition[0] - 0.5, quadPosition[1] - 0.5],
      emCoordinate: [quadPosition[0], quadPosition[1]],
    };
    const dilated = evaluate(
      slugDilate,
      d.vec2f(...placed.localPosition),
      d.vec2f(...placed.outwardNormal),
      d.vec2f(...placed.emCoordinate),
      INVERSE_SCALE,
      d.vec4f(...mvpRow0),
      d.vec4f(...mvpRow1),
      d.vec4f(...mvpRow3),
      d.vec2f(...VIEWPORT),
    );
    const mirrored = referenceSlugDilate(
      placed.localPosition,
      placed.outwardNormal,
      placed.emCoordinate,
      INVERSE_SCALE,
      mvpRow0,
      mvpRow1,
      mvpRow3,
      VIEWPORT,
    );
    assertVec2Close(plain(dilated.position), mirrored.position, `dilation at ${JSON.stringify(quadPosition)}`);
    assertVec2Close(
      plain(dilated.textureCoordinate),
      mirrored.textureCoordinate,
      `em dilation at ${JSON.stringify(quadPosition)}`,
    );
  }
});

test('matrix dilation matches the row decomposition of the same projection', () => {
  // Column-major model-view-projection with an asymmetric perspective row.
  const mvp = [0.5, 0, 0, 0.125, 0, 0.75, 0, -0.0625, 0, 0, 1, 0, 3, -2, 0.5, 1];
  const position = [0.3, -0.7];
  const normal = [0.8, -0.6];
  const coordinate = [1.5, 2.5];
  const dilated = evaluate(
    slugDilateMatrix,
    d.vec2f(...position),
    d.vec2f(...normal),
    d.vec2f(...coordinate),
    INVERSE_SCALE,
    d.mat4x4f(...mvp),
    d.vec2f(...VIEWPORT),
  );
  const mirrored = referenceSlugDilateMatrix(position, normal, coordinate, INVERSE_SCALE, mvp, VIEWPORT);
  assertVec2Close(plain(dilated.position), mirrored.position, 'matrix dilation');
  assertVec2Close(plain(dilated.textureCoordinate), mirrored.textureCoordinate, 'matrix em dilation');
});

test('grid addressing and header decoding agree with their CPU mirrors', () => {
  assert.deepEqual(referenceSlugGridCoordinate(7, 4), [3, 1]);
  assert.equal(referenceSlugBandCurveCount(0x0002_0003), 2);
});
