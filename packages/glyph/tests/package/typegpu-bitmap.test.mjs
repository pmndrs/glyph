import assert from 'node:assert/strict';
import test from 'node:test';

import tgpu from 'typegpu';
import * as d from 'typegpu/data';

import {
  bitmapFragment,
  bitmapPaint,
  bitmapVertex,
  bitmapVertexSnapped,
  snapClipAxis,
  TypeGpuBitmapInstance,
  TypeGpuBitmapVertexInput,
} from '../../dist/typegpu/bitmap-shader.js';
import {
  referenceBitmapAtlasUv,
  referenceBitmapPaint,
  referenceBitmapQuadPosition,
  referenceProjectClipPosition,
  referenceSnappedClipPosition,
} from '../../dist/typegpu/bitmap-reference.js';

const IDENTITY_COLUMN_MAJOR = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** A non-trivial column-major projection-like matrix with f32-exact entries only. */
const PROJECTION_COLUMN_MAJOR = [0.5, 0, 0, 0, 0, 1, 0, 0, 0, 0, -0.25, -0.125, 3, -2, 5, 8.5];

const QUAD_POSITIONS = [
  [0, 0],
  [0.25, 0.75],
  [0.5, 0.5],
  [1, 1],
];
const SCREEN_SIZES = [
  [800, 600],
  [1280, 720],
  [1024, 1024],
];

/** Builds one instance value with dyadic-rational fields so both sides see identical f32 inputs. */
function instanceAt(origin, size, uvOrigin, uvSize) {
  return TypeGpuBitmapInstance({
    origin: d.vec2f(origin[0], origin[1]),
    size: d.vec2f(size[0], size[1]),
    uvOrigin: d.vec2f(uvOrigin[0], uvOrigin[1]),
    uvSize: d.vec2f(uvSize[0], uvSize[1]),
    color: d.vec4f(0.75, 0.5, 0.25, 0.5),
    pageIndex: d.u32(2),
  });
}

function vertexInputFor(instance, quadPosition, mvpEntries, screenSize) {
  return TypeGpuBitmapVertexInput({
    quadPosition: d.vec2f(quadPosition[0], quadPosition[1]),
    quadUv: d.vec2f(quadPosition[0], quadPosition[1]),
    instance,
    modelViewProjection: d.mat4x4f(...mvpEntries),
    screenSize: d.vec2f(screenSize[0], screenSize[1]),
  });
}

/** Runs one shipped shader function through TypeGPU's CPU simulation of the GPU execution model. */
function evaluate(fn, ...args) {
  return plain(tgpu['~unstable'].simulate(() => fn(...args)).value);
}

/** Vec and struct instances expose their numbers through a JSON representation. */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Component-wise comparison with room for one f32 rounding step in the simulated GPU values. */
function assertClose(actual, expected, message) {
  for (let index = 0; index < expected.length; index += 1) {
    const expectedValue = expected[index];
    assert.ok(
      Math.abs(actual[index] - expectedValue) <= 1e-6 * Math.max(1, Math.abs(expectedValue)),
      `${message ?? 'value'} mismatch at component ${index}: ${actual[index]} vs ${expectedValue}`,
    );
  }
}

test('the default vertex stage realizes the canonical atlas addressing and quad placement', () => {
  const cases = [
    { origin: [10, 20], size: [30, 40], uvOrigin: [0.25, 0.5], uvSize: [0.125, 0.0625] },
    { origin: [0, 0], size: [16, 16], uvOrigin: [0, 0], uvSize: [1, 1] },
    { origin: [-8, 4], size: [12.5, 7.25], uvOrigin: [0.5, 0.125], uvSize: [0.03125, 0.5] },
  ];
  for (const item of cases) {
    const instance = instanceAt(item.origin, item.size, item.uvOrigin, item.uvSize);
    for (const quadPosition of QUAD_POSITIONS) {
      const input = vertexInputFor(instance, quadPosition, IDENTITY_COLUMN_MAJOR, SCREEN_SIZES[0]);
      const output = evaluate(bitmapVertex, input);
      const position = referenceBitmapQuadPosition(item.origin, item.size, quadPosition);

      assert.deepEqual(plain(output.position), plain(position));
      // The identity projection must pass paragraph-space placement straight through.
      assert.deepEqual(plain(output.clipPosition), plain([...position, 1]));
      assert.deepEqual(plain(output.atlasUv), plain(referenceBitmapAtlasUv(item.uvOrigin, item.uvSize, quadPosition)));
      assert.deepEqual(plain(output.color), [0.75, 0.5, 0.25, 0.5]);
      assert.equal(Number(output.pageLayer), 2);
    }
  }
});

test('the default clip placement matches an explicit column-major model-view-projection', () => {
  const instance = instanceAt([6, 9], [24, 18], [0.5, 0.25], [0.25, 0.125]);
  for (const mvp of [IDENTITY_COLUMN_MAJOR, PROJECTION_COLUMN_MAJOR]) {
    for (const quadPosition of QUAD_POSITIONS) {
      const input = vertexInputFor(instance, quadPosition, mvp, SCREEN_SIZES[0]);
      const output = evaluate(bitmapVertex, input);
      const position = referenceBitmapQuadPosition([6, 9], [24, 18], quadPosition);

      assert.deepEqual(
        plain(output.clipPosition),
        plain(referenceProjectClipPosition(mvp, position)),
        `projection mismatch for quad ${JSON.stringify(quadPosition)}`,
      );
    }
  }
});

test('the pixel-snapped variant rounds device-space landing without moving other channels', () => {
  const instance = instanceAt([3.5, 2.25], [17, 11], [0.125, 0.25], [0.0625, 0.5]);
  for (const mvp of [IDENTITY_COLUMN_MAJOR, PROJECTION_COLUMN_MAJOR]) {
    for (const quadPosition of QUAD_POSITIONS) {
      for (const screenSize of SCREEN_SIZES) {
        const input = vertexInputFor(instance, quadPosition, mvp, screenSize);
        const output = evaluate(bitmapVertexSnapped, input);
        const clip = referenceProjectClipPosition(
          mvp,
          referenceBitmapQuadPosition([3.5, 2.25], [17, 11], quadPosition),
        );

        assertClose(
          plain(output.clipPosition),
          referenceSnappedClipPosition(clip, screenSize),
          `snapping mismatch for screen ${JSON.stringify(screenSize)}, quad ${JSON.stringify(quadPosition)}`,
        );
        assert.deepEqual(
          plain(output.atlasUv),
          plain(referenceBitmapAtlasUv([0.125, 0.25], [0.0625, 0.5], quadPosition)),
          'snapping must not disturb atlas addressing',
        );
      }
    }
  }
});

test('snapClipAxis keeps whole-pixel device coordinates fixed', () => {
  for (const physicalSize of [800, 1280]) {
    for (let pixel = 0; pixel <= 16; pixel += 4) {
      const ndc = (pixel / physicalSize) * 2 - 1;
      assert.equal(evaluate(snapClipAxis, ndc, 1, physicalSize), ndc, `pixel ${pixel} must survive snapping`);
    }
  }
});

test('paint composition scales unpremultiplied alpha by coverage and keeps rgb', () => {
  for (const coverage of [0, 0.25, 0.5, 1]) {
    for (const alpha of [0, 0.5, 1]) {
      const color = d.vec4f(0.75, 0.5, 0.25, alpha);
      const output = evaluate(bitmapPaint, coverage, color);
      assert.deepEqual(
        { coverage: output.coverage, color: plain(output.color), opacity: output.opacity },
        referenceBitmapPaint(coverage, [0.75, 0.5, 0.25, alpha]),
      );
    }
  }
});

test('every shipped Bitmap stage resolves to WGSL without consumer-side tooling', () => {
  for (const [name, fn] of Object.entries({ bitmapVertex, bitmapVertexSnapped, bitmapFragment })) {
    const wgsl = tgpu.resolve([fn]);
    assert.match(wgsl, new RegExp(`fn ${name}\\(`), `${name} must resolve as a WGSL function`);
  }
  const fragmentWgsl = tgpu.resolve([bitmapFragment]);
  // Coverage is an exact clamped texel fetch — the read the `/tsl` realization compiles
  // to for data textures — so no sampler is declared and no filtered sample appears.
  assert.match(fragmentWgsl, /fn bitmapPageCoverage\(/);
  assert.match(fragmentWgsl, /textureDimensions\(page, 0\)/);
  assert.match(fragmentWgsl, /textureLoad\(page, boundedCoord, pageLayer, 0\)\.x/);
  assert.doesNotMatch(fragmentWgsl, /textureSample|sampler/);
});
