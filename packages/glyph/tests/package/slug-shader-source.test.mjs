import assert from 'node:assert/strict';
import test from 'node:test';

import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';
import { slugShader } from '../../dist/tsl.js';
import { compileNodeMaterialBackends } from '../support/node-material-shaders.mjs';

/** Every host-agnostic core function the Three.js host is expected to call, per stage. */
const CORE_FUNCTIONS = {
  vertex: ['slugDilate'],
  fragment: [
    'slugPixelsPerEm',
    'slugThickenFactor',
    'slugBandIndex',
    'slugBandReferenceOffset',
    'slugBandCurveCount',
    'slugReferenceFromPair',
    'calcRootCode',
    'stableRoots',
    'solveHorizontalPolynomial',
    'curveContribution',
    'slugHorizontalCurveContribution',
    'slugVerticalCurveContribution',
    'calcCoverage',
  ],
};

/**
 * WGSL builtins with no GLSL equivalent. A core function reaching for one compiles on
 * WebGPU and fails to link on WebGL2, so the portable core must not emit them.
 */
const WGSL_ONLY_BUILTINS = ['countLeadingZeros', 'countTrailingZeros', 'extractBits', 'insertBits'];

test('the Slug material compiles on both backends and calls the portable core once per algorithm step', () => {
  withSlugFillMesh((fillMesh) => {
    for (const [backend, stages] of Object.entries(compileNodeMaterialBackends(fillMesh))) {
      for (const [stageName, source] of Object.entries(stages)) {
        for (const name of CORE_FUNCTIONS[stageName]) {
          assert.equal(
            declarationCount(source, name, backend),
            1,
            `${backend} ${stageName} must declare core function "${name}" exactly once`,
          );
        }
      }
      // A vertical band is the transposed horizontal band, so both axes reach the same
      // solver rather than each emitting a specialization of it.
      assert.equal(declarationCount(stages.fragment, 'solveVerticalPolynomial', backend), 0);
      // Both fill bands keep their sorted-reference early terminator and bounded loop.
      assert.equal((stages.fragment.match(/while \(/g) ?? []).length, 2, `${backend} must emit both band loops`);
      assert.equal((stages.fragment.match(/contribution\.z\s*<\s*-0\.5(?:f)?/gi) ?? []).length, 2);
    }
  });
});

test('the portable core emits no WGSL-only builtin into the WebGL2 shader', () => {
  withSlugFillMesh((fillMesh) => {
    const { webgl2 } = compileNodeMaterialBackends(fillMesh);
    for (const [stageName, source] of Object.entries(webgl2)) {
      const body = source.replaceAll(/^\w+ \w+\(.*$/gm, '');
      for (const builtin of WGSL_ONLY_BUILTINS) {
        assert.doesNotMatch(
          body,
          new RegExp(`(?<![\\w.])${builtin}\\(`),
          `WebGL2 ${stageName} calls "${builtin}", which GLSL does not define`,
        );
      }
    }
  });
});

function withSlugFillMesh(body) {
  const curveTexture = dataTexture(new Uint16Array(4 * 4 * 4), THREE.RGBAFormat, THREE.HalfFloatType);
  const headerTexture = dataTexture(new Uint32Array(16), THREE.RedIntegerFormat, THREE.UnsignedIntType);
  const referenceTexture = dataTexture(new Uint32Array(16), THREE.RedIntegerFormat, THREE.UnsignedIntType);
  const output = slugShader(
    {
      origin: TSL.vec2(0),
      size: TSL.vec2(16),
      emOrigin: TSL.vec2(0),
      emSize: TSL.vec2(1),
      inverseScale: TSL.float(1 / 16),
      color: TSL.vec4(1),
      bandTransform: TSL.vec4(0, 0, 1, 1),
      curveBaseTexel: TSL.uint(0),
      horizontalHeaderBase: TSL.uint(0),
      verticalHeaderBase: TSL.uint(0),
      referenceBase: TSL.uint(0),
      horizontalBandCount: TSL.uint(1),
      verticalBandCount: TSL.uint(1),
    },
    {
      page: {
        curveTexture,
        curveWidth: 4,
        headerTexture,
        headerWidth: 4,
        referenceTexture,
        referenceWidth: 4,
      },
      viewport: TSL.vec2(64),
      modelViewProjectionRow0: TSL.vec4(1, 0, 0, 0),
      modelViewProjectionRow1: TSL.vec4(0, 1, 0, 0),
      modelViewProjectionRow3: TSL.vec4(0, 0, 0, 1),
    },
  );
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true });
  material.positionNode = output.position;
  material.colorNode = output.color;
  material.opacityNode = output.opacity;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const fillMesh = new THREE.Mesh(geometry, material);
  try {
    body(fillMesh);
  } finally {
    geometry.dispose();
    material.dispose();
    curveTexture.dispose();
    headerTexture.dispose();
    referenceTexture.dispose();
  }
}

function declarationCount(source, name, backend) {
  const declaration = backend === 'webgpu' ? `^fn ${name}\\(` : `^\\w+ ${name}\\(`;
  return (source.match(new RegExp(declaration, 'gm')) ?? []).length;
}

function dataTexture(data, format, type) {
  return new THREE.DataTexture(data, 4, 4, format, type);
}
