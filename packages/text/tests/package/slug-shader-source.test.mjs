import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three/webgpu';
import { slug } from '../../dist/raster/slug.js';
import { compileNodeMaterialBackends } from '../support/node-material-shaders.mjs';

const SLUG_GLYPH_RECORD_STRIDE = 40;
const PLANE_UNITS_PER_EM = 2048;

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

/** Every shader variable a core boundary materializes into, per stage. */
const CORE_BOUNDARIES = {
  vertex: ['slugDilated'],
  fragment: [
    'slugFragmentScale',
    'slugCoverageThicken',
    'slugHorizontalBandIndex',
    'slugVerticalBandIndex',
    'slugHorizontalReferenceOffset',
    'slugVerticalReferenceOffset',
    'slugHorizontalCurveCount',
    'slugVerticalCurveCount',
    'slugHorizontalReference',
    'slugVerticalReference',
    'slugHorizontalContribution',
    'slugVerticalContribution',
    'slugFillCoverage',
  ],
};

/**
 * WGSL builtins with no GLSL equivalent. A core function reaching for one compiles on
 * WebGPU and fails to link on WebGL2, so the portable core must not emit them.
 */
const WGSL_ONLY_BUILTINS = ['saturate', 'countLeadingZeros', 'countTrailingZeros', 'extractBits', 'insertBits'];

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
      assert.equal((stages.fragment.match(/Contribution\.z < -0\.5/g) ?? []).length, 2);
    }
  });
});

test('each core boundary resolves into its own statement instead of nesting inside another', () => {
  withSlugFillMesh((fillMesh) => {
    // TypeGPU resolution is a single stack, so a core result reaching another core
    // call's arguments would corrupt it. Every boundary is assigned to its own named
    // shader variable, which is what keeps the boundaries independent.
    for (const [backend, stages] of Object.entries(compileNodeMaterialBackends(fillMesh))) {
      for (const [stageName, source] of Object.entries(stages)) {
        for (const name of CORE_BOUNDARIES[stageName]) {
          assert.match(
            source,
            new RegExp(`\\b${name} = \\w+\\(\\);`),
            `${backend} ${stageName} must emit "${name}" as its own statement`,
          );
        }
      }
    }
  });
});

test('no core boundary variable shadows a core function in the shared shader namespace', () => {
  withSlugFillMesh((fillMesh) => {
    for (const [backend, stages] of Object.entries(compileNodeMaterialBackends(fillMesh))) {
      for (const [stageName, source] of Object.entries(stages)) {
        for (const name of CORE_BOUNDARIES[stageName]) {
          assert.equal(
            declarationCount(source, name, backend),
            0,
            `${backend} ${stageName} declares "${name}" as both a variable and a function`,
          );
        }
      }
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
  const resource = syntheticResource();
  const stage = slug.stageBatch(undefined, layout(), resource, 0, paint(), 1);
  stage.commit();
  try {
    const fillMesh = stage.batch.object.children[0];
    assert.ok(fillMesh instanceof THREE.Mesh, 'the staged Slug batch must expose one fill mesh');
    body(fillMesh);
  } finally {
    stage.batch.dispose();
    slug.dispose(resource);
  }
}

function declarationCount(source, name, backend) {
  const declaration = backend === 'webgpu' ? `^fn ${name}\\(` : `^\\w+ ${name}\\(`;
  return (source.match(new RegExp(declaration, 'gm')) ?? []).length;
}

function layout() {
  return {
    glyphIds: Uint16Array.from([0, 1]),
    glyphFontSlots: new Uint16Array(2),
    glyphFontSizes: Float32Array.from([16, 16]),
    x: Float32Array.from([0, 8]),
    y: Float32Array.from([0, 0]),
  };
}

function paint() {
  return { paintIndices: new Uint16Array(2), palette: [{ color: [1, 1, 1, 1] }] };
}

function syntheticResource() {
  const records = new Uint8Array(2 * SLUG_GLYPH_RECORD_STRIDE);
  writeRecord(records, 0, { right: 1024, top: 1536, horizontalBands: 1, verticalBands: 2, referenceBase: 3 });
  writeRecord(records, 1, { right: 1792, top: 1920, horizontalBands: 3, verticalBands: 4, referenceBase: 8 });
  return { planeUnitsPerEm: PLANE_UNITS_PER_EM, records, pages: [slugPage()], gpuBytes: 0 };
}

function slugPage() {
  return {
    curveWidth: 4,
    curveHeight: 4,
    curveTexture: dataTexture(new Uint16Array(4 * 4 * 4), THREE.RGBAFormat, THREE.HalfFloatType),
    headerCount: 16,
    headerWidth: 4,
    headerHeight: 4,
    headerTexture: dataTexture(new Uint32Array(16), THREE.RedIntegerFormat, THREE.UnsignedIntType),
    referenceCount: 16,
    referenceWidth: 4,
    referenceHeight: 4,
    referenceTexture: dataTexture(new Uint32Array(16), THREE.RedIntegerFormat, THREE.UnsignedIntType),
    gpuBytes: 0,
  };
}

function dataTexture(data, format, type) {
  return new THREE.DataTexture(data, 4, 4, format, type);
}

function writeRecord(records, glyph, values) {
  const view = new DataView(records.buffer, records.byteOffset, records.byteLength);
  const offset = glyph * SLUG_GLYPH_RECORD_STRIDE;
  view.setInt16(offset, 0, true);
  view.setInt16(offset + 2, 0, true);
  view.setInt16(offset + 4, values.right, true);
  view.setInt16(offset + 6, values.top, true);
  view.setUint16(offset + 8, 0, true);
  view.setUint16(offset + 10, values.horizontalBands, true);
  view.setUint16(offset + 12, values.verticalBands, true);
  view.setUint16(offset + 14, 0, true);
  view.setUint32(offset + 16, 0, true);
  view.setUint32(offset + 20, 1, true);
  view.setUint32(offset + 24, 1, true);
  view.setUint32(offset + 28, 2, true);
  view.setUint32(offset + 32, values.referenceBase, true);
  view.setUint32(offset + 36, 1, true);
}
