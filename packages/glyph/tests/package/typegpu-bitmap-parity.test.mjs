import assert from 'node:assert/strict';
import test from 'node:test';

import * as d from 'typegpu/data';
import tgpu from 'typegpu';

import { extractBitmapTslShader } from '../support/extract-bitmap-tsl-shader.mjs';
import {
  bitmapAtlasUv,
  bitmapFragment,
  bitmapPaint,
  bitmapQuadPosition,
  bitmapVertex,
  bitmapVertexSnapped,
  projectClipPosition,
  snapClipAxis,
  TypeGpuBitmapFragmentInput,
  TypeGpuBitmapInstance,
  TypeGpuBitmapVertexInput,
} from '../../dist/typegpu/bitmap-shader.js';
import {
  referenceBitmapAtlasUv,
  referenceBitmapPaint,
  referenceBitmapQuadPosition,
  referenceProjectClipPosition,
  referenceSnapClipAxis,
} from '../../dist/typegpu/bitmap-reference.js';

/**
 * Bitmap authority across the `/tsl` adapter and `/typegpu` implementation.
 *
 * The two sides cannot execute against each other without a GPU, so the pin stands on
 * extractions and mirrors instead of prose:
 *
 * 1. The device-free TSL extraction compiles the canonical `/tsl` graph to the WGSL a
 *    WebGPU run executes, and the shipped TypeGPU stages resolve to WGSL through the
 *    metadata the build embeds. Each source is extracted here, at test time, from built
 *    artifacts. The TSL program must call the same TypeGPU helpers as the direct
 *    stages rather than carrying a second native implementation.
 * 2. Every CPU-callable shader function is compared against its CPU reference mirror,
 *    so the mirrors cannot silently drift from what ships.
 */

/** Collapse shader text so formulas can be matched whitespace-insensitively. */
function flatten(source) {
  return source.replace(/\s+/g, '');
}

/** Vec and struct instances expose their numbers through a JSON representation. */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const tsl = {
  plain: extractBitmapTslShader({ pixelSnapping: false }),
  snapped: extractBitmapTslShader({ pixelSnapping: true }),
};

const gpu = {
  vertex: tgpu.resolve([bitmapVertex]),
  snapped: tgpu.resolve([bitmapVertexSnapped]),
  fragment: tgpu.resolve([bitmapFragment]),
};

test('atlas addressing matches the TSL realization', () => {
  const tslFlat = flatten(tsl.plain.fragment);
  assert.match(tslFlat, /fnbitmapAtlasUv\(/);
  assert.match(tslFlat, /returnbitmapAtlasUv\(/);

  const gpuFlat = flatten(gpu.vertex);
  assert.match(gpuFlat, /\(uvOrigin\.x\+\(quadUv\.x\*uvSize\.x\)\)/);
  assert.match(gpuFlat, /\(uvOrigin\.y\+\(quadUv\.y\*uvSize\.y\)\)/);
});

test('quad placement matches the TSL realization, including the y flip', () => {
  const tslFlat = flatten(tsl.plain.vertex);
  assert.match(tslFlat, /fnbitmapQuadPosition\(/);
  assert.match(tslFlat, /-\(\(origin\.y\+\(quadPosition\.y\*size\.y\)\)\),0f\)/);

  const gpuFlat = flatten(gpu.vertex);
  assert.match(gpuFlat, /\(origin\.x\+\(quadPosition\.x\*size\.x\)\)/);
  assert.match(gpuFlat, /-\(\(origin\.y\+\(quadPosition\.y\*size\.y\)\)\),0f\)/);
});

test('coverage is an exact clamped texel fetch on both sides', () => {
  const tslFetch = flatten(tsl.plain.fragment);
  assert.match(tslFetch, /fnbitmapPageTexelCoordinate\(/);
  assert.match(tslFetch, /textureDimensions\(/);
  assert.match(tslFetch, /floor\(/);
  assert.match(tslFetch, /clamp\(flooredCoord/);
  assert.match(tslFetch, /textureLoad\(/);

  const gpuFetch = flatten(gpu.fragment);
  assert.match(gpuFetch, /textureDimensions\(page,0\)/);
  assert.match(gpuFetch, /floor\(/);
  assert.match(
    gpuFetch,
    /textureLoad\(page,vec2u\(u32\(texelCoordinate\.x\),u32\(texelCoordinate\.y\)\),pageLayer,0\)\.x/,
  );
});

test('paint composition scales alpha by coverage identically', () => {
  const tslPaint = flatten(tsl.plain.fragment);
  assert.match(tslPaint, /fnbitmapPaint\(/);
  assert.match(tslPaint, /\(color\.a\*coverage\)/);
  assert.match(flatten(gpu.fragment), /\(color\.a\*coverage\)/);
});

test('pixel snapping rounds projected axes onto whole physical pixels identically', () => {
  const tslSnap = flatten(tsl.snapped.vertex);
  assert.match(tslSnap, /fnsnapClipAxis\(/);
  assert.match(tslSnap, /round\(/);
  assert.match(tslSnap, /\(clipAxis\*\(1f\/clipW\)\)/);
  assert.match(tslSnap, /\(round\(physicalPosition\)\*\(1f\/physicalSize\)\)/);

  // The TypeGPU helper computes the identical chain, reciprocals included.
  const gpuSnap = flatten(gpu.snapped);
  assert.match(gpuSnap, /\(clipAxis\*\(1f\/clipW\)\)/);
  assert.match(gpuSnap, /\(\(\(round\(physicalPosition\)\*\(1f\/physicalSize\)\)\*2f\)-1f\)\*clipW\)/);
});

test('shader functions agree with their CPU reference mirrors', () => {
  const values = {
    origin: [13.5, -7.25],
    size: [21, 34],
    uvOrigin: [0.125, 0.375],
    uvSize: [0.0625, 0.1875],
    color: [0.9, 0.8, 0.7, 0.6],
    pageIndex: 3,
  };
  const quadPosition = [0.25, 0.75];
  const quadUv = [0.25, 0.5];
  const screenSize = [96, 64];
  const mvpEntries = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, -2, 0.5, 1];

  const position = bitmapQuadPosition(d.vec2f(...values.origin), d.vec2f(...values.size), d.vec2f(...quadPosition));
  assert.deepEqual(plain(position), referenceBitmapQuadPosition(values.origin, values.size, quadPosition));
  const atlasUv = bitmapAtlasUv(d.vec2f(...values.uvOrigin), d.vec2f(...values.uvSize), d.vec2f(...quadUv));
  assert.deepEqual(plain(atlasUv), referenceBitmapAtlasUv(values.uvOrigin, values.uvSize, quadUv));

  const mvp = d.mat4x4f(...mvpEntries);
  const clip = projectClipPosition(mvp, position);
  assert.deepEqual(plain(clip), referenceProjectClipPosition(mvpEntries, plain(position)));

  assert.equal(snapClipAxis(clip[0], clip[3], screenSize[0]), referenceSnapClipAxis(clip[0], clip[3], screenSize[0]));
  assert.equal(snapClipAxis(clip[1], clip[3], screenSize[1]), referenceSnapClipAxis(clip[1], clip[3], screenSize[1]));

  const input = TypeGpuBitmapVertexInput({
    quadPosition: d.vec2f(...quadPosition),
    quadUv: d.vec2f(...quadUv),
    instance: TypeGpuBitmapInstance({
      ...values,
      origin: d.vec2f(...values.origin),
      size: d.vec2f(...values.size),
      uvOrigin: d.vec2f(...values.uvOrigin),
      uvSize: d.vec2f(...values.uvSize),
      color: d.vec4f(...values.color),
      pageIndex: d.u32(values.pageIndex),
    }),
    modelViewProjection: mvp,
    screenSize: d.vec2f(...screenSize),
  });
  const projected = bitmapVertex(input);
  assert.deepEqual(plain(projected.clipPosition), plain(clip));
  const snapped = bitmapVertexSnapped(input);
  assert.deepEqual(plain(snapped.clipPosition), [
    referenceSnapClipAxis(clip[0], clip[3], screenSize[0]),
    referenceSnapClipAxis(clip[1], clip[3], screenSize[1]),
    clip[2],
    clip[3],
  ]);
  assert.deepEqual(plain(snapped.atlasUv), referenceBitmapAtlasUv(values.uvOrigin, values.uvSize, quadUv));

  const painted = bitmapPaint(0.42, d.vec4f(...values.color));
  const mirroredPaint = referenceBitmapPaint(0.42, values.color);
  // Shader execution rounds every value to f32; the mirror computes in doubles.
  assert.equal(painted.coverage, Math.fround(mirroredPaint.coverage));
  assert.deepEqual(plain(painted.color), mirroredPaint.color.map(Math.fround));
  // One f32 rounding step separates the simulated GPU product from the f64 reference.
  assert.ok(Math.abs(painted.opacity - values.color[3] * 0.42) <= 1e-6);
});

test('the fragment input contract carries exactly the vertex varyings the fragment needs', () => {
  assert.deepEqual(Object.keys(TypeGpuBitmapFragmentInput.propTypes).sort(), ['atlasUv', 'color', 'pageLayer']);
});
