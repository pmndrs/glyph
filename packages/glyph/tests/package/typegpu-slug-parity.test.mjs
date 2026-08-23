import assert from 'node:assert/strict';
import test from 'node:test';

import { extractSlugTslShader } from '../support/extract-slug-tsl-shader.mjs';
import tgpu from 'typegpu';

import { slugFragment, slugVertex, slugVertexMatrix } from '../../dist/typegpu/slug-shader.js';

/**
 * Slug parity between the `/tsl` and `/typegpu` realizations of the technique.
 *
 * The two sides cannot execute against each other without a GPU, so the pin stands on
 * extractions: the device-free TSL extraction compiles the canonical `/tsl` graph to
 * the WGSL a WebGPU run executes, and the shipped TypeGPU stages resolve to WGSL
 * through the metadata the build embeds. Each source is extracted here, at test time,
 * from built artifacts, and each must carry the same per-step operation chains: the
 * band-index clamp, the capped curve count, the packed-reference unpack, the root
 * eligibility table, the q-form solver, the sorted-reference terminator, the winding
 * contributions with their antialiasing weights, Lengyel's weighted blend, and the
 * analytic half-pixel dilation in both projection forms.
 */

/** Collapse shader text so formulas can be matched whitespace-insensitively. */
function flatten(source) {
  return source.replace(/\s+/g, '');
}

const tsl = extractSlugTslShader({ projection: 'rows' });
const tslMatrix = extractSlugTslShader({ projection: 'matrix' });

const gpu = {
  vertex: flatten(tgpu.resolve([slugVertex])),
  matrix: flatten(tgpu.resolve([slugVertexMatrix])),
  fragment: flatten(tgpu.resolve([slugFragment])),
};

test('the fragment scale is an exact reciprocal of the clamped derivative footprint', () => {
  // TSL emits `(1.0/max(emsPerPixel.x, 0.0000152587890625))`; TypeGPU's abstract-float
  // printer spells the same f32 value `1.52587890625e-5f`.
  const tslScale = /\(1\.0\/max\([A-Za-z0-9_]+\.x,0\.0000152587890625\)\)/;
  const gpuScale = /\(1f\/max\([A-Za-z0-9_]+\.x,1\.52587890625e-5f\)\)/;
  assert.match(flatten(tsl.fragment), tslScale);
  assert.match(gpu.fragment, gpuScale);
  assert.match(flatten(tsl.fragment), /fwidth\(/);
  assert.match(gpu.fragment, /fwidth\(/);
});

test('the band index clamps the transformed coordinate onto the declared grid', () => {
  const tslIndex =
    /clamp\(\(\([A-Za-z0-9_]+\.y\*[A-Za-z0-9_]+\.y\)\+[A-Za-z0-9_]+\.w\),0\.0,\(f32\([A-Za-z0-9_]+\)-1\.0\)\)/;
  const gpuIndex = /clamp\(transformedCoordinate,0f,maximumBandIndex\)/;
  const gpuMaximum = /\(f32\(glyph\.horizontalBandCount\)-1f\)/;
  assert.match(flatten(tsl.fragment), tslIndex);
  assert.match(gpu.fragment, gpuIndex);
  assert.match(gpu.fragment, gpuMaximum);

  const tslIndexVertical =
    /clamp\(\(\([A-Za-z0-9_]+\.x\*[A-Za-z0-9_]+\.x\)\+[A-Za-z0-9_]+\.z\),0\.0,\(f32\([A-Za-z0-9_]+\)-1\.0\)\)/;
  assert.match(flatten(tsl.fragment), tslIndexVertical);
  assert.match(gpu.fragment, /\(f32\(glyph\.verticalBandCount\)-1f\)/);
});

test('the curve count cap bounds every hostile header identically', () => {
  // The V0 header's high half passes through f32 before the 512-curve clamp and the
  // unsigned conversion — one shared chain on both sides.
  const cap = /u32\(min\(f32\(\([A-Za-z0-9_]+>>16u\)\),512(?:\.0)?f?\)\)/;
  const flatTsl = flatten(tsl.fragment);
  assert.equal((flatTsl.match(new RegExp(cap, 'g')) ?? []).length >= 4, true, 'TSL must emit the capped count chain');
  assert.match(gpu.fragment, cap);
});

test('the packed reference unpack shifts the pair by the odd-index bit offset', () => {
  const tslUnpack = /\(\([A-Za-z0-9_]+\.x>>\(\([A-Za-z0-9_]+&1u\)\*16u\)\)&65535u/;
  assert.match(flatten(tsl.fragment), tslUnpack);
  assert.match(gpu.fragment, /&65535u/);
  assert.match(gpu.fragment, /\(index&1u\)\*16u/);
  assert.match(gpu.fragment, /index>>1u/);
  assert.match(flatten(tsl.fragment), />>1u/);
});

test('the root eligibility table is the same 0x2e74 shift-and-mask', () => {
  for (const source of [flatten(tsl.fragment), gpu.fragment]) {
    assert.match(source, /11892u>>/);
    assert.match(source, /&257u/);
    assert.match(source, /<<1u/);
    assert.match(source, /<<2u/);
  }
});

test('the quadratic solver keeps the q-form branch order and reciprocals', () => {
  const tslFlat = flatten(tsl.fragment);
  // Linear axis: c/(b*2) under |a| < 2^-16.
  assert.match(tslFlat, /abs\([A-Za-z0-9_]+\)<0\.0000152587890625/);
  assert.match(tslFlat, /[A-Za-z0-9_.]+\/\([A-Za-z0-9_]+\*2\.0\)/);
  // Extremum fallback under a non-positive discriminant, then the q-form pair.
  assert.match(tslFlat, /[A-Za-z0-9_]+\/[A-Za-z0-9_]+\)/);
  assert.match(tslFlat, /=\([A-Za-z0-9_]+\+\([A-Za-z0-9_]+\*[A-Za-z0-9_]+\)/);
  // x(t) evaluates as ((ax*t - bx*2)*t) + p0.x — never a reciprocal of t.
  assert.match(tslFlat, /\(\(\([A-Za-z0-9_]+\*[A-Za-z0-9_]+\.x\)-[A-Za-z0-9_]+\)\*[A-Za-z0-9_]+\.x\)\+[A-Za-z0-9_.]+/);

  const gpuFlat = gpu.fragment;
  assert.match(gpuFlat, /abs\(a\)<1\.52587890625e-5f/);
  assert.match(gpuFlat, /\(c\/\(b\*2f\)\)/);
  assert.match(gpuFlat, /\(b\/a\)/);
  assert.match(gpuFlat, /\(b\+\(sign_1\*distance_1\)\)/);
  assert.match(gpuFlat, /\(\(axT1\*roots\.x\)\+p0\.x\)/);
  // One shared solver declaration serves both fill axes.
  assert.equal((gpuFlat.match(/fnstableRoots\(/g) ?? []).length, 1);
  assert.equal((gpuFlat.match(/fnsolveHorizontalPolynomial\(/g) ?? []).length, 1);
  assert.equal((gpuFlat.match(/fnsolveVerticalPolynomial\(/g) ?? []).length, 1);
});

test('both band walks keep their bounded loop and sorted-reference early termination', () => {
  const tslFlat = flatten(tsl.fragment);
  assert.equal((tslFlat.match(/while\(/g) ?? []).length, 2);
  assert.equal((tslFlat.match(/<-0\.5/g) ?? []).length, 2);
  assert.equal((gpu.fragment.match(/while\(/g) ?? []).length, 2);
  assert.equal((gpu.fragment.match(/<-0\.5f/g) ?? []).length, 2);
});

test('winding contributions scale roots by the thickening factor and saturate', () => {
  const tslFlat = flatten(tsl.fragment);
  // The canonical no-compensation graph still multiplies by the unit factor.
  assert.match(tslFlat, /clamp\(\(\([A-Za-z0-9_]+\*1\.0\)\+0\.5\),0\.0,1\.0\)/);
  assert.match(tslFlat, /clamp\(\(1\.0-\(abs\([A-Za-z0-9_]+\)\*2\.0\)\),0\.0,1\.0\)/);
  assert.match(tslFlat, /\(slugXCoverage\+\(nodeVar23-nodeVar24\)\)/);
  assert.match(tslFlat, /\(slugYCoverage\+\(nodeVar44-nodeVar45\)\)/);
  assert.match(tslFlat, /max\(slugXWeight,max\(nodeVar25,nodeVar26\)\)/);

  assert.match(gpu.fragment, /saturate\(\(\(firstRoot\*thickenFactor\)\+0\.5f\)\)/);
  assert.match(gpu.fragment, /saturate\(\(1f-\(abs\(firstRoot\)\*2f\)\)\)/);
  assert.match(gpu.fragment, /coverage\+=\(firstContribution-secondContribution\)/);
  assert.match(gpu.fragment, /coverage\+=\(secondContribution-firstContribution\)/);
  assert.match(
    gpu.fragment,
    /weight=max\(weight,max\(select\(0f,firstWeight,hasFirstRoot\),select\(0f,secondWeight,hasSecondRoot\)\)\)/,
  );
});

test("Lengyel's weighted blend guards its denominator and keeps the fallback maximum", () => {
  const tslFlat = flatten(tsl.fragment);
  assert.match(
    tslFlat,
    /abs\(\(\([A-Za-z0-9_]+\*[A-Za-z0-9_]+\)\+\([A-Za-z0-9_]+\*[A-Za-z0-9_]+\)\)\)\/max\(\([A-Za-z0-9_]+\+[A-Za-z0-9_]+\),0\.0000152587890625\)/,
  );
  assert.match(tslFlat, /min\(abs\(slugXCoverage\),abs\(slugYCoverage\)\)/);
  assert.match(tslFlat, /=\(1\.0-abs\(\(1\.0-\(fract\(\(slugRawCoverage\*0\.5\)\)\*2\.0\)\)\)\)/);

  assert.match(gpu.fragment, /weightedNumerator\/max\(\(xWeight\+yWeight\),1\.52587890625e-5f\)/);
  assert.match(gpu.fragment, /min\(abs\(xCoverage\),abs\(yCoverage\)\)/);
  assert.match(gpu.fragment, /=\(1f-abs\(\(1f-\(fract\(\(rawCoverage\*0\.5f\)\)\*2f\)\)\)\)/);
});

test('paint composition scales alpha by coverage identically', () => {
  // Three folds the opacity into its own pipeline: DiffuseColor.w * (color.a * coverage).
  assert.match(flatten(tsl.fragment), /=\([A-Za-z0-9_]+\.w\*\([A-Za-z0-9_]+\.w\*[A-Za-z0-9_]+\)\)/);
  assert.match(gpu.fragment, /\(input\.color\.a\*coverage\)/);
});

test('row dilation decomposes the projection rows with identical dot-product chains', () => {
  for (const source of [flatten(tsl.vertex), gpu.vertex]) {
    assert.match(source, /normalize\(/);
    assert.match(source, /\(dot\([A-Za-z0-9_.]+\.xy,[A-Za-z0-9_]+\)\+[A-Za-z0-9_.]+\.w\)/);
    assert.match(source, /dot\([A-Za-z0-9_.]+\.xy,[A-Za-z0-9_]+\)/);
  }
  const tslFlat = flatten(tsl.vertex);
  const gpuFlat = gpu.vertex;
  // The perspective gradient enters the denominator squared, left-associated.
  assert.match(tslFlat, /-\(\(slugDilateSquaredW\*slugDilateWGradient\)\*slugDilateWGradient\)/);
  assert.match(gpuFlat, /projectedLengthSquared-\(\(squaredW\*wGradient\)\*wGradient\)/);
  // distance = squaredW * (wTimesGradient + sqrt(projectedLengthSquared)) / denominator.
  assert.match(
    tslFlat,
    /slugDilateSquaredW\*\(slugDilateWTimesGradient\+sqrt\(slugDilateProjectedLengthSquared\)\)\)\//,
  );
  assert.match(gpuFlat, /\(\(squaredW\*\(wTimesGradient\+sqrt\(projectedLengthSquared\)\)\)\/denominator\)/);
  // The dilation carries back into em space through the inverse scale.
  assert.match(tslFlat, /\([A-Za-z0-9_]+\.x\+\([A-Za-z0-9_]+\*[A-Za-z0-9_]+\)\)/);
  assert.match(gpuFlat, /\(textureCoordinate\.x\+\(dx\*inverseScale\)\)/);
});

test('matrix dilation projects the normal through the whole model-view-projection', () => {
  for (const source of [flatten(tslMatrix.vertex), gpu.matrix]) {
    assert.match(
      source,
      /\(\([A-Za-z0-9_]+\.w\*[A-Za-z0-9_]+\.x\)-\([A-Za-z0-9_]+\.w\*[A-Za-z0-9_]+\.x\)\)\*[A-Za-z0-9_.]+/,
    );
  }
  // The clip position and clip normal are the projection applied to (position,0,1) and (normal,0,0).
  assert.match(flatten(tslMatrix.vertex), /\*vec4<f32>\([A-Za-z0-9_]+,0\.0,1\.0\)/);
  assert.match(flatten(tslMatrix.vertex), /\*vec4<f32>\([A-Za-z0-9_]+,0\.0,0\.0\)/);
  assert.match(gpu.matrix, /\*vec4f\(position,0f,1f\)/);
  assert.match(gpu.matrix, /\*vec4f\(normal,0f,0f\)/);
});

test('quad placement flips layout y in both realizations', () => {
  const placementFlip = /-\(+[A-Za-z0-9_.]+\.y\+\([A-Za-z0-9_.]+\.y\*[A-Za-z0-9_.]+\.y\)\)+/;
  assert.match(flatten(tsl.vertex), placementFlip);
  assert.match(gpu.vertex, placementFlip);
  // Em coordinates subtract downward y instead of negating the sum.
  const emSubtract = /[A-Za-z0-9_.]+\.y-\([A-Za-z0-9_.]+\.y\*[A-Za-z0-9_.]+\.y\)/;
  assert.match(flatten(tsl.vertex), emSubtract);
  assert.match(gpu.vertex, emSubtract);
});

test('neither realization binds a sampler: every page read is an exact texel load', () => {
  for (const source of [flatten(tsl.fragment), gpu.fragment]) {
    assert.doesNotMatch(source, /textureSample|sampler/);
    assert.match(source, /textureLoad\(/);
  }
});
