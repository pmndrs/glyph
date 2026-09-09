import assert from 'node:assert/strict';
import test from 'node:test';

import { id } from '../../dist/config/codec.js';
import { slug } from '../../dist/raster/slug.js';
import { codecDescriptor } from '../../dist/typegpu/internal/codec.js';
import {
  WEB_GPU_MIN_BIND_GROUPS,
  compileThreePlacementProof,
  packSliceIndices,
  placementCapacity,
  resolveTypeGpuPlacementProof,
  selectSliceMapEncoding,
  sliceMapEncodings,
  unpackSliceIndex,
} from '../support/layout-run-placement-resource.mjs';

test('slice maps specialize without imposing the 3x10 candidate as a production ceiling', () => {
  for (const encoding of Object.values(sliceMapEncodings)) {
    const upper = encoding.maxSliceCount - 1;
    const indices = [0, 1, upper, Math.floor(upper / 2), 7];
    const words = packSliceIndices(indices, encoding);
    assert.equal(words.length, Math.ceil(indices.length / encoding.indicesPerWord));
    assert.deepEqual(
      indices.map((_, logicalInstance) => unpackSliceIndex(words, logicalInstance, encoding)),
      indices,
    );
    assert.throws(() => packSliceIndices([encoding.maxSliceCount], encoding), new RegExp(`exceeds ${encoding.id}`));
  }
  assert.equal(selectSliceMapEncoding(1_024), sliceMapEncodings.threeXTen);
  assert.equal(selectSliceMapEncoding(1_025), sliceMapEncodings.twoXSixteen);
  assert.equal(selectSliceMapEncoding(65_537), sliceMapEncodings.u32);
  assert.equal(selectSliceMapEncoding(0), undefined);
  assert.deepEqual(placementCapacity(0, 0, sliceMapEncodings.u32), {
    logicalCapacity: 0,
    sliceCapacity: 0,
    encoding: 'none',
    mapWords: 0,
    mapBytes: 0,
    placementBytes: 0,
    totalBytes: 0,
    webGlMapBytes: 0,
    webGlPlacementBytes: 0,
    webGlTotalBytes: 0,
  });
  assert.throws(() => compileThreePlacementProof([], []), /requires logical instances/);
  const fallback = resolveTypeGpuPlacementProof(sliceMapEncodings.u32);
  assert.match(fallback.wgsl, /sliceMap\[logicalInstance\]/);
  assert.doesNotMatch(fallback.wgsl, />>|1023u|65535u/);
});

test('a separate placement bind group does not consume a ninth TypeGPU Codec vertex buffer', () => {
  const descriptor = codecDescriptor(id);
  const slugProgram = descriptor.programs.find((program) => program.techniqueId === id.technique(slug.id));
  assert.ok(slugProgram);
  assert.equal(slugProgram.buffers.length, 8);
  assert.equal(descriptor.capabilitySets[0].maxBuffersPerDraw, 8);

  const proof = resolveTypeGpuPlacementProof();
  assert.deepEqual(Object.keys(proof.placementLayout.entries), ['sliceMap', 'placements']);
  assert.equal(slugProgram.buffers.length, 8);
  assert.equal(proof.bindGroupCount, 3);
  assert.ok(proof.bindGroupCount < WEB_GPU_MIN_BIND_GROUPS);
  assert.match(proof.wgsl, /@builtin\(instance_index\) logicalInstance: u32/);
  assert.match(proof.wgsl, /@group\(2\) @binding\(0\) var<storage, read> sliceMap: array<u32>/);
  assert.match(proof.wgsl, /@group\(2\) @binding\(1\) var<storage, read> placements: array<vec2f>/);
  assert.match(proof.wgsl, /sliceMap\[logicalInstance \/ 3u\]/);
  assert.match(proof.wgsl, /placements\[sliceIndex\]/);
  assert.match(proof.wgsl, />> \(\(logicalInstance % 3u\) \* 10u\)\) & 1023u/);
  assert.doesNotMatch(proof.wgsl, /\b(if|for|loop|while)\b/);
});

test('Three compiles each nested lookup specialization into one instanced-mesh candidate', (t) => {
  const logicalSlices = [0, 0, 1, 1, 2, 2];
  for (const encoding of Object.values(sliceMapEncodings)) {
    const proof = compileThreePlacementProof(logicalSlices, [12, 8, 40, 16, 72, 24], encoding);
    t.after(() => proof.dispose());
    assert.equal(proof.mesh.geometry.instanceCount, logicalSlices.length);
    assert.equal(proof.mesh.children.length, 0);

    const wgsl = proof.shaders.webgpu.vertex.replace(/\s+/g, '');
    assert.match(wgsl, /@builtin\(instance_index\)/);
    assert.match(wgsl, /var<storage,read>/);

    const glsl = proof.shaders.webgl2.vertex.replace(/\s+/g, '');
    assert.match(glsl, /gl_InstanceID/);
    assert.match(glsl, /uniformhighpusampler2D/);
    assert.match(glsl, /uniformhighpsampler2D/);
    assert.equal((glsl.match(/texelFetch\(/g) ?? []).length, 2);

    if (encoding === sliceMapEncodings.u32) {
      assert.doesNotMatch(wgsl, /%1u|&4294967295u/);
      assert.doesNotMatch(glsl, /%1u|&4294967295u/);
    } else {
      for (const shader of [wgsl, glsl]) {
        assert.match(shader, new RegExp(`/${encoding.indicesPerWord}u`));
        assert.match(shader, new RegExp(`%${encoding.indicesPerWord}u`));
        assert.match(shader, />>/);
        assert.match(shader, new RegExp(`&${encoding.maxSliceCount - 1}u`));
      }
    }
  }
});

test('capacity evidence exposes compact and full-u32 address candidates explicitly', (t) => {
  const capacities = Object.fromEntries(
    Object.values(sliceMapEncodings).map((encoding) => [encoding.id, placementCapacity(22_016, 1_024, encoding)]),
  );
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(capacities).map(([encoding, value]) => [encoding, [value.mapBytes, value.webGlTotalBytes]]),
    ),
    {
      'three-x-ten': [29_356, 37_888],
      'two-x-sixteen': [44_032, 52_224],
      u32: [88_064, 96_256],
    },
  );
  const bitmapOriginUploadBytes = 22_016 * 2 * Float32Array.BYTES_PER_ELEMENT;
  assert.ok(capacities['three-x-ten'].webGlTotalBytes < bitmapOriginUploadBytes / 4);
  assert.ok(capacities.u32.webGlTotalBytes > bitmapOriginUploadBytes / 2);

  const proof = compileThreePlacementProof(Array(22_016).fill(0), Array(2_048).fill(0));
  t.after(() => proof.dispose());
  assert.equal(proof.mapAttribute.array.byteLength, capacities['three-x-ten'].webGlMapBytes);
  assert.equal(proof.placementAttribute.array.byteLength, capacities['three-x-ten'].webGlPlacementBytes);
});
