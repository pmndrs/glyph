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

// Slug coverage reaches zero half a pixel past a straight edge, so a quad that stops short of that line clips the
// fringe. These quads are wide and short because a half-diagonal step gives the short axis the least margin.
const VIEWPORT = [1280, 720];
const HALF_PIXEL = 0.5;
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
  return {
    row0: [(2 * cos) / VIEWPORT[0], (-2 * sin) / VIEWPORT[0], 0, 0],
    row1: [(2 * sin) / VIEWPORT[1], (2 * cos) / VIEWPORT[1], 0, 0],
    row3: [0, 0, 0, 1],
  };
}

function toPixels([x, y], { row0, row1 }) {
  return [((row0[0] * x + row0[1] * y) * VIEWPORT[0]) / 2, ((row1[0] * x + row1[1] * y) * VIEWPORT[1]) / 2];
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

test('every corner moves exactly half a pixel past both adjacent edges, whatever the quad aspect', () => {
  for (const [implementation, dilate] of Object.entries(implementations)) {
    for (const angle of [0, Math.PI / 6]) {
      const rows = orthographicRows(angle);
      for (const box of INK_BOXES) {
        for (const pixelsPerEm of PIXELS_PER_EM) {
          const width = box.width * pixelsPerEm;
          const height = box.height * pixelsPerEm;
          for (const corner of CORNERS) {
            const position = [corner[0] * width, corner[1] * height];
            const dilated = dilate(position, cornerNormal(corner, width, height), [0, 0], 1, rows);
            // The quad's own axes, in pixels: displacement along each is the margin past the edge it crosses.
            const offset = toPixels([dilated.position[0] - position[0], dilated.position[1] - position[1]], rows);
            const xAxis = toPixels([1, 0], rows).map((value) => value / Math.hypot(...toPixels([1, 0], rows)));
            const yAxis = toPixels([0, 1], rows).map((value) => value / Math.hypot(...toPixels([0, 1], rows)));
            const margins = [
              (offset[0] * xAxis[0] + offset[1] * xAxis[1]) * (corner[0] === 0 ? -1 : 1),
              (offset[0] * yAxis[0] + offset[1] * yAxis[1]) * (corner[1] === 0 ? -1 : 1),
            ];
            const label = `${implementation}, ${box.name} at ${pixelsPerEm} px/em, corner ${corner}, angle ${angle}`;
            assert.ok(Math.abs(margins[0] - HALF_PIXEL) < TOLERANCE, `${label}: x margin ${margins[0]} px`);
            assert.ok(Math.abs(margins[1] - HALF_PIXEL) < TOLERANCE, `${label}: y margin ${margins[1]} px`);
          }
        }
      }
    }
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

/** Coverage of one pixel centre, in em, for a glyph that is exactly its ink box, evaluated by the package core. */
function boxCoverage(width, height, renderCoordinate, pixelsPerEm) {
  const corners = [d.vec2f(0, 0), d.vec2f(width, 0), d.vec2f(width, height), d.vec2f(0, height)];
  const sample = d.vec2f(...renderCoordinate);
  let horizontal = { coverage: 0, weight: 0 };
  let vertical = { coverage: 0, weight: 0 };
  for (let index = 0; index < 4; index += 1) {
    const start = corners[index];
    const end = corners[(index + 1) % 4];
    const middle = d.vec2f((start.x + end.x) / 2, (start.y + end.y) / 2);
    const across = slugHorizontalCurveContribution(start, middle, end, sample, pixelsPerEm, 1);
    const along = slugVerticalCurveContribution(start, middle, end, sample, pixelsPerEm, 1);
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
    pixelsPerEm,
  );
}

test('no pixel the core covers falls outside the dilated quad of a wide, short glyph', () => {
  const rows = orthographicRows(0);
  const { width, height } = INK_BOXES[0];
  for (const pixelsPerEm of PIXELS_PER_EM) {
    const ink = [width * pixelsPerEm, height * pixelsPerEm];
    const dilated = CORNERS.map(
      (corner) =>
        implementations['TypeGPU slugDilate'](
          [corner[0] * ink[0], corner[1] * ink[1]],
          cornerNormal(corner, ink[0], ink[1]),
          [0, 0],
          1,
          rows,
        ).position,
    );
    const minimum = [Math.min(...dilated.map((point) => point[0])), Math.min(...dilated.map((point) => point[1]))];
    const maximum = [Math.max(...dilated.map((point) => point[0])), Math.max(...dilated.map((point) => point[1]))];
    // Pixel centres stepping out of each edge's midpoint, through the antialiasing fringe and past it. A centre on the
    // half-pixel line itself is a rasterization tie with float-rounded coverage, so the steps avoid it.
    for (const distance of [0.0625, 0.125, 0.25, 0.375, 0.4375, 0.5625, 0.625]) {
      const samples = [
        [ink[0] / 2, ink[1] + distance],
        [ink[0] / 2, -distance],
        [ink[0] + distance, ink[1] / 2],
        [-distance, ink[1] / 2],
      ];
      for (const sample of samples) {
        const coverage = boxCoverage(width, height, [sample[0] / pixelsPerEm, sample[1] / pixelsPerEm], pixelsPerEm);
        const rasterized =
          sample[0] >= minimum[0] && sample[0] <= maximum[0] && sample[1] >= minimum[1] && sample[1] <= maximum[1];
        const label = `${pixelsPerEm} px/em, centre ${distance} px outside at (${sample})`;
        // Negative control: the fringe is real, and it ends at half a pixel.
        if (distance < HALF_PIXEL) assert.ok(coverage > 0, `${label}: expected fringe coverage`);
        else assert.equal(coverage, 0, `${label}: expected no coverage`);
        if (coverage > 0) assert.ok(rasterized, `${label}: coverage ${coverage} is clipped by the quad`);
      }
    }
  }
});
