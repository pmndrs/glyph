import assert from 'node:assert/strict';
import test from 'node:test';

import { d } from 'typegpu';
import { slugDilate, slugDilateMatrix } from '../../dist/shaders/typegpu/index.js';
import {
  calcCoverage,
  slugHorizontalCurveContribution,
  slugVerticalCurveContribution,
} from '../../dist/shaders/typegpu/slug/core/index.js';
import { referenceSlugDilate } from '../../dist/shaders/tsl/slug/internal/reference.js';

// Slug coverage takes each em axis's pixel scale from `fwidth`, |∂/∂x| + |∂/∂y|, so it reaches zero
// 0.5 · (|t.x| + |t.y|) / |t| pixels past an edge whose screen direction is `t`: half a pixel for an axis-aligned edge,
// 0.683 px at 30°. A quad that stops short of that line clips the fringe. These quads are wide and short because a
// half-diagonal step gives the short axis the least margin.
const VIEWPORT = [1280, 720];
const TOLERANCE = 1e-4;
// Ink boxes in em: Inter's em dash (aspect 12.3), underscore (5.6), a square, and a tall, narrow `i`.
const INK_BOXES = [
  { name: 'em dash', width: 1.0, height: 0.081 },
  { name: 'underscore', width: 0.6, height: 0.107 },
  { name: 'square', width: 0.5, height: 0.5 },
  { name: 'narrow i', width: 0.08, height: 0.5 },
];
const PIXELS_PER_EM = [12, 32, 128];
const CORNERS = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];

/** Object space is pixels, rotated by `angle` about the quad origin and projected orthographically. */
function orthographicRows(angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return affineRows([
    [cos, -sin],
    [sin, cos],
  ]);
}

/** Object space maps to pixels through the 2×2 `matrix`, projected orthographically. */
function affineRows([[a, b], [c, e]]) {
  return {
    row0: [(2 * a) / VIEWPORT[0], (2 * b) / VIEWPORT[0], 0, 0],
    row1: [(2 * c) / VIEWPORT[1], (2 * e) / VIEWPORT[1], 0, 0],
    row3: [0, 0, 0, 1],
  };
}

/**
 * A plane of pixel units tilted by `angle` about the screen x axis, then turned by `turn` in its own plane, seen by a
 * pinhole camera `distance` pixels away; w grows along both quad axes.
 */
function perspectiveRows(angle, turn, distance) {
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const tilt = Math.cos(angle);
  const depth = Math.sin(angle) / distance;
  return {
    row0: [(2 * cos) / VIEWPORT[0], (-2 * sin) / VIEWPORT[0], 0, 0],
    row1: [(2 * sin * tilt) / VIEWPORT[1], (2 * cos * tilt) / VIEWPORT[1], 0, 0],
    row3: [sin * depth, cos * depth, 0, 1],
  };
}

const TRANSFORMS = [
  { name: 'uniform', rows: orthographicRows(0) },
  { name: 'uniform, rotated 30°', rows: orthographicRows(Math.PI / 6) },
  {
    name: 'stretched 4× along x',
    rows: affineRows([
      [4, 0],
      [0, 1],
    ]),
  },
  {
    name: 'stretched 4× along y and sheared',
    rows: affineRows([
      [1, 0.75],
      [0, 4],
    ]),
  },
  {
    name: 'stretched 4× along x, rotated 30°',
    rows: affineRows([
      [4 * Math.cos(Math.PI / 6), -Math.sin(Math.PI / 6)],
      [4 * Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)],
    ]),
  },
  { name: 'tilted 70°, turned 20°, in perspective', rows: perspectiveRows((7 * Math.PI) / 18, Math.PI / 9, 400) },
];

function toPixels([x, y], { row0, row1, row3 }) {
  const w = row3[0] * x + row3[1] * y + row3[3];
  return [
    ((row0[0] * x + row0[1] * y + row0[3]) * VIEWPORT[0]) / (2 * w),
    ((row1[0] * x + row1[1] * y + row1[3]) * VIEWPORT[1]) / (2 * w),
  ];
}

/**
 * How far coverage reaches past the projected edge through `start` along object-space `direction`, in pixels. The em
 * coordinate across the edge is constant along it, so its screen gradient is perpendicular to the edge everywhere,
 * perspective included, and `fwidth` over the gradient length is the L1 over the L2 norm of the edge direction.
 */
function fringe(start, direction, rows) {
  const [sx, sy] = toPixels(start, rows);
  const [ex, ey] = toPixels([start[0] + direction[0], start[1] + direction[1]], rows);
  return (0.5 * (Math.abs(ex - sx) + Math.abs(ey - sy))) / Math.hypot(ex - sx, ey - sy);
}

/** Screen distance of `point` outside the projected line through `start` along object-space `direction`. */
function distanceOutside(point, start, direction, outward, rows) {
  const [sx, sy] = toPixels(start, rows);
  const [ex, ey] = toPixels([start[0] + direction[0], start[1] + direction[1]], rows);
  const [ox, oy] = toPixels([start[0] + outward[0], start[1] + outward[1]], rows);
  const [px, py] = toPixels(point, rows);
  const cross = (x, y) => (ex - sx) * (y - sy) - (ey - sy) * (x - sx);
  return (Math.sign(cross(ox, oy)) * cross(px, py)) / Math.hypot(ex - sx, ey - sy);
}

/** The normal production callers pass: the corner's offset from the quad centre. */
function cornerNormal([u, v], width, height) {
  return [(u - 0.5) * width, (v - 0.5) * height];
}

const implementations = {
  'TypeGPU slugDilate': (position, normal, coordinate, inverseScale, rows) => {
    const result = slugDilate(
      d.vec2f(...position),
      d.vec2f(...normal),
      d.vec2f(...coordinate),
      inverseScale,
      d.vec4f(...rows.row0),
      d.vec4f(...rows.row1),
      d.vec4f(...rows.row3),
      d.vec2f(...VIEWPORT),
    );
    return { position: [result.x, result.y], textureCoordinate: [result.z, result.w] };
  },
  'TypeGPU slugDilateMatrix': (position, normal, coordinate, inverseScale, rows) => {
    // Column-major: column c holds element c of every row; row 2 (depth) is irrelevant to dilation.
    const { row0, row1, row3 } = rows;
    const matrix = d.mat4x4f(...[0, 1, 2, 3].flatMap((column) => [row0[column], row1[column], 0, row3[column]]));
    const result = slugDilateMatrix(
      d.vec2f(...position),
      d.vec2f(...normal),
      d.vec2f(...coordinate),
      inverseScale,
      matrix,
      d.vec2f(...VIEWPORT),
    );
    return { position: [result.x, result.y], textureCoordinate: [result.z, result.w] };
  },
  'CPU reference mirror': (position, normal, coordinate, inverseScale, rows) =>
    referenceSlugDilate(position, normal, coordinate, inverseScale, rows.row0, rows.row1, rows.row3, VIEWPORT),
};

test('every corner moves exactly to the edge of the antialiasing fringe, whatever the quad aspect or transform', () => {
  for (const [implementation, dilate] of Object.entries(implementations)) {
    for (const { name, rows } of TRANSFORMS) {
      for (const box of INK_BOXES) {
        for (const pixelsPerEm of PIXELS_PER_EM) {
          const width = box.width * pixelsPerEm;
          const height = box.height * pixelsPerEm;
          for (const corner of CORNERS) {
            const position = [corner[0] * width, corner[1] * height];
            const outward = [corner[0] === 0 ? -1 : 1, corner[1] === 0 ? -1 : 1];
            const dilated = dilate(position, cornerNormal(corner, width, height), [0, 0], 1, rows).position;
            // A dilated quad edge is the screen segment between two dilated corners, so it clears the ink edge by at
            // least the smaller of their two distances outside it.
            const margins = [
              distanceOutside(dilated, position, [0, 1], [outward[0], 0], rows),
              distanceOutside(dilated, position, [1, 0], [0, outward[1]], rows),
            ];
            const fringes = [fringe(position, [0, 1], rows), fringe(position, [1, 0], rows)];
            const label = `${implementation}, ${name}, ${box.name} at ${pixelsPerEm} px/em, corner ${corner}`;
            for (const axis of [0, 1]) {
              const message = `${label}: axis ${axis} margin ${margins[axis]} px, fringe ${fringes[axis]} px`;
              assert.ok(Math.abs(margins[axis] - fringes[axis]) < TOLERANCE, message);
            }
          }
        }
      }
    }
  }
});

test('an edge-on plane dilates by a finite amount', () => {
  const rows = affineRows([
    [1, 0],
    [0, 0],
  ]);
  for (const [implementation, dilate] of Object.entries(implementations)) {
    const { position, textureCoordinate } = dilate([8, 8], [1, 1], [0, 0], 1, rows);
    for (const value of [...position, ...textureCoordinate])
      assert.ok(Number.isFinite(value), `${implementation}: ${value}`);
  }
});

test('the dilated em coordinate follows the dilated position through the inverse scale', () => {
  const rows = orthographicRows(0);
  for (const [implementation, dilate] of Object.entries(implementations)) {
    const dilated = dilate([12, 1], [6, 0.5], [0.25, 0.75], 1 / 12, rows);
    for (const axis of [0, 1]) {
      const expected = [0.25, 0.75][axis] + (dilated.position[axis] - [12, 1][axis]) / 12;
      assert.ok(Math.abs(dilated.textureCoordinate[axis] - expected) < 1e-6, `${implementation} axis ${axis}`);
    }
  }
});

/**
 * Coverage of one pixel centre, in em, for a glyph that is exactly its ink box, evaluated by the package core with the
 * per-axis pixel scales the fragment shader takes from `fwidth`.
 */
function boxCoverage(width, height, renderCoordinate, [pixelsPerEmX, pixelsPerEmY]) {
  const corners = [d.vec2f(0, 0), d.vec2f(width, 0), d.vec2f(width, height), d.vec2f(0, height)];
  const sample = d.vec2f(...renderCoordinate);
  let horizontal = { coverage: 0, weight: 0 };
  let vertical = { coverage: 0, weight: 0 };
  for (let index = 0; index < 4; index += 1) {
    const start = corners[index];
    const end = corners[(index + 1) % 4];
    const middle = d.vec2f((start.x + end.x) / 2, (start.y + end.y) / 2);
    const across = slugHorizontalCurveContribution(start, middle, end, sample, pixelsPerEmX, 1);
    const along = slugVerticalCurveContribution(start, middle, end, sample, pixelsPerEmY, 1);
    horizontal = { coverage: horizontal.coverage + across.x, weight: Math.max(horizontal.weight, across.y) };
    vertical = { coverage: vertical.coverage + along.x, weight: Math.max(vertical.weight, along.y) };
  }
  return calcCoverage(
    horizontal.coverage,
    horizontal.weight,
    vertical.coverage,
    vertical.weight,
    false,
    false,
    0,
    (pixelsPerEmX + pixelsPerEmY) / 2,
  );
}

/** Whether `point` lies inside the convex screen quad `corners`, listed in order around it. */
function insideQuad(point, corners) {
  const sides = corners.map((start, index) => {
    const end = corners[(index + 1) % corners.length];
    return Math.sign((end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0]));
  });
  return sides.every((side) => side >= 0) || sides.every((side) => side <= 0);
}

const AFFINE_TRANSFORMS = TRANSFORMS.filter(({ rows }) => rows.row3[0] === 0 && rows.row3[1] === 0);

test('no pixel the core covers falls outside the dilated quad, whatever the affine transform', () => {
  for (const { name, rows } of AFFINE_TRANSFORMS) {
    // Object space is pixels at one em = `pixelsPerEm` units; `screen` maps it to pixels and `object` maps back.
    const screen = (point) => toPixels(point, rows);
    const [[a, c], [b, e]] = [screen([1, 0]), screen([0, 1])];
    const determinant = a * e - b * c;
    const object = ([x, y]) => [(e * x - b * y) / determinant, (a * y - c * x) / determinant];
    for (const box of [INK_BOXES[0], INK_BOXES[3]]) {
      for (const pixelsPerEm of PIXELS_PER_EM) {
        const ink = [box.width * pixelsPerEm, box.height * pixelsPerEm];
        // `fwidth` of each em coordinate: the L1 norm of its screen gradient, one row of the inverse map.
        const scales = [
          pixelsPerEm / (Math.abs(e / determinant) + Math.abs(b / determinant)),
          pixelsPerEm / (Math.abs(c / determinant) + Math.abs(a / determinant)),
        ];
        const quad = [CORNERS[0], CORNERS[1], CORNERS[3], CORNERS[2]].map((corner) =>
          screen(
            implementations['TypeGPU slugDilate'](
              [corner[0] * ink[0], corner[1] * ink[1]],
              cornerNormal(corner, ink[0], ink[1]),
              [0, 0],
              1,
              rows,
            ).position,
          ),
        );
        const edges = [
          { midpoint: [ink[0] / 2, ink[1]], direction: [1, 0], outward: [0, 1] },
          { midpoint: [ink[0] / 2, 0], direction: [1, 0], outward: [0, -1] },
          { midpoint: [ink[0], ink[1] / 2], direction: [0, 1], outward: [1, 0] },
          { midpoint: [0, ink[1] / 2], direction: [0, 1], outward: [-1, 0] },
        ];
        for (const { midpoint, direction, outward } of edges) {
          const reach = fringe(midpoint, direction, rows);
          const centre = screen(midpoint);
          const along = screen([midpoint[0] + direction[0], midpoint[1] + direction[1]]);
          const tangent = [along[0] - centre[0], along[1] - centre[1]];
          const length = Math.hypot(...tangent);
          let normal = [-tangent[1] / length, tangent[0] / length];
          const away = screen([midpoint[0] + outward[0], midpoint[1] + outward[1]]);
          if (normal[0] * (away[0] - centre[0]) + normal[1] * (away[1] - centre[1]) < 0)
            normal = [-normal[0], -normal[1]];
          // Pixel centres stepping out of the edge's midpoint through the fringe and past it, avoiding the tie at its end.
          for (const fraction of [0.125, 0.25, 0.5, 0.75, 0.875, 1.125, 1.25]) {
            const sample = [centre[0] + normal[0] * reach * fraction, centre[1] + normal[1] * reach * fraction];
            const [x, y] = object(sample);
            const coverage = boxCoverage(box.width, box.height, [x / pixelsPerEm, y / pixelsPerEm], scales);
            const label = `${name}, ${box.name} at ${pixelsPerEm} px/em, ${fraction} of a ${reach} px fringe`;
            // Negative control: the fringe is real, and it ends where `fringe` says.
            if (fraction < 1) assert.ok(coverage > 0, `${label}: expected fringe coverage`);
            else assert.equal(coverage, 0, `${label}: expected no coverage`);
            if (coverage > 0)
              assert.ok(insideQuad(sample, quad), `${label}: coverage ${coverage} is clipped by the quad`);
          }
        }
      }
    }
  }
});
