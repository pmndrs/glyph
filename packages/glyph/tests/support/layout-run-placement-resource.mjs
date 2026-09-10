import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import tgpu, { d } from 'typegpu';

import { compileNodeMaterialBackends } from './node-material-shaders.mjs';

export const WEB_GPU_MIN_BIND_GROUPS = 4;
export const sliceMapEncodings = Object.freeze({
  threeXTen: Object.freeze({ id: 'three-x-ten', bits: 10, indicesPerWord: 3, maxSliceCount: 1 << 10 }),
  twoXSixteen: Object.freeze({ id: 'two-x-sixteen', bits: 16, indicesPerWord: 2, maxSliceCount: 1 << 16 }),
  u32: Object.freeze({ id: 'u32', bits: 32, indicesPerWord: 1, maxSliceCount: 0x1_0000_0000 }),
});

export function selectSliceMapEncoding(sliceCount) {
  assertNonNegativeCapacity(sliceCount, 'slice count');
  if (sliceCount === 0) return undefined;
  if (sliceCount <= sliceMapEncodings.threeXTen.maxSliceCount) return sliceMapEncodings.threeXTen;
  if (sliceCount <= sliceMapEncodings.twoXSixteen.maxSliceCount) return sliceMapEncodings.twoXSixteen;
  if (sliceCount <= sliceMapEncodings.u32.maxSliceCount) return sliceMapEncodings.u32;
  throw new RangeError('slice count exceeds u32 addressing');
}

export function packSliceIndices(indices, encoding = sliceMapEncodings.u32) {
  const words = new Uint32Array(Math.ceil(indices.length / encoding.indicesPerWord));
  for (let index = 0; index < indices.length; index += 1) {
    const sliceIndex = indices[index];
    if (!Number.isSafeInteger(sliceIndex) || sliceIndex < 0 || sliceIndex >= encoding.maxSliceCount) {
      throw new RangeError(`slice index ${String(sliceIndex)} exceeds ${encoding.id}`);
    }
    const wordIndex = Math.floor(index / encoding.indicesPerWord);
    const shift = (index % encoding.indicesPerWord) * encoding.bits;
    words[wordIndex] = (words[wordIndex] | ((sliceIndex << shift) >>> 0)) >>> 0;
  }
  return words;
}

export function unpackSliceIndex(words, logicalInstance, encoding = sliceMapEncodings.u32) {
  if (!Number.isSafeInteger(logicalInstance) || logicalInstance < 0) {
    throw new RangeError('logical instance must be a non-negative safe integer');
  }
  const wordIndex = Math.floor(logicalInstance / encoding.indicesPerWord);
  if (wordIndex >= words.length) throw new RangeError('logical instance exceeds the packed slice map');
  if (encoding === sliceMapEncodings.u32) return words[wordIndex];
  const shift = (logicalInstance % encoding.indicesPerWord) * encoding.bits;
  return (words[wordIndex] >>> shift) & (encoding.maxSliceCount - 1);
}

export function placementCapacity(logicalCapacity, sliceCapacity, encoding) {
  assertNonNegativeCapacity(logicalCapacity, 'logical capacity');
  assertNonNegativeCapacity(sliceCapacity, 'slice capacity');
  if (logicalCapacity === 0 && sliceCapacity === 0) {
    return Object.freeze({
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
  }
  assertPositiveCapacity(logicalCapacity, 'logical capacity');
  assertPositiveCapacity(sliceCapacity, 'slice capacity');
  if (sliceCapacity > encoding.maxSliceCount) throw new RangeError(`slice capacity exceeds ${encoding.id}`);
  const mapWords = Math.ceil(logicalCapacity / encoding.indicesPerWord);
  const mapBytes = mapWords * Uint32Array.BYTES_PER_ELEMENT;
  const placementBytes = sliceCapacity * 2 * Float32Array.BYTES_PER_ELEMENT;
  const webGlMapBytes = pboByteLength(mapWords, 1, Uint32Array.BYTES_PER_ELEMENT);
  const webGlPlacementBytes = pboByteLength(sliceCapacity, 2, Float32Array.BYTES_PER_ELEMENT);
  return Object.freeze({
    logicalCapacity,
    sliceCapacity,
    encoding: encoding.id,
    mapWords,
    mapBytes,
    placementBytes,
    totalBytes: mapBytes + placementBytes,
    webGlMapBytes,
    webGlPlacementBytes,
    webGlTotalBytes: webGlMapBytes + webGlPlacementBytes,
  });
}

export function compileThreePlacementProof(sliceIndices, placements, encoding = sliceMapEncodings.threeXTen) {
  if (sliceIndices.length === 0) throw new RangeError('placement proof requires logical instances');
  if (placements.length % 2 !== 0) throw new RangeError('placements must contain vec2 records');
  if (placements.length === 0) throw new RangeError('placement proof requires slice placements');
  const mapAttribute = new THREE.StorageInstancedBufferAttribute(packSliceIndices(sliceIndices, encoding), 1);
  const placementAttribute = new THREE.StorageInstancedBufferAttribute(new Float32Array(placements), 2);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute('_layoutRunSliceMap', mapAttribute);
  geometry.setAttribute('_layoutRunPlacements', placementAttribute);
  geometry.instanceCount = sliceIndices.length;

  const logicalInstance = TSL.instanceIndex;
  const wordIndex = logicalInstance.div(encoding.indicesPerWord);
  const packed = TSL.storage(mapAttribute, 'uint', mapAttribute.count).setPBO(true).element(wordIndex);
  const sliceIndex =
    encoding === sliceMapEncodings.u32
      ? packed
      : packed
          .shiftRight(logicalInstance.mod(encoding.indicesPerWord).mul(encoding.bits))
          .bitAnd(encoding.maxSliceCount - 1);
  const placement = TSL.storage(placementAttribute, 'vec2', placementAttribute.count).setPBO(true).element(sliceIndex);
  const material = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  material.positionNode = TSL.vec3(TSL.positionLocal.xy.add(placement), TSL.positionLocal.z);
  material.colorNode = TSL.vec3(1);
  const mesh = new THREE.Mesh(geometry, material);
  const shaders = compileNodeMaterialBackends(mesh);
  return {
    mesh,
    shaders,
    mapAttribute,
    placementAttribute,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function resolveTypeGpuPlacementProof(encoding = sliceMapEncodings.threeXTen) {
  const sceneLayout = tgpu
    .bindGroupLayout({ viewport: { uniform: d.vec2f, visibility: ['vertex'] } })
    .$idx(0)
    .$name('scene');
  const rasterLayout = tgpu
    .bindGroupLayout({ page: { texture: d.texture2dArray(d.f32), visibility: ['fragment'] } })
    .$idx(1)
    .$name('raster');
  const placementLayout = tgpu
    .bindGroupLayout({
      sliceMap: { storage: d.arrayOf(d.u32), visibility: ['vertex'] },
      placements: { storage: d.arrayOf(d.vec2f), visibility: ['vertex'] },
    })
    .$idx(2)
    .$name('layoutRunPlacement');
  const sliceExpression =
    encoding === sliceMapEncodings.u32
      ? 'placement.sliceMap[in.logicalInstance]'
      : `(placement.sliceMap[in.logicalInstance / ${encoding.indicesPerWord}u] >> ((in.logicalInstance % ${encoding.indicesPerWord}u) * ${encoding.bits}u)) & ${encoding.maxSliceCount - 1}u`;
  const vertex = tgpu
    .vertexFn({
      in: { logicalInstance: d.builtin.instanceIndex },
      out: { position: d.builtin.position },
    })(`{
      let sliceIndex = ${sliceExpression};
      let offset = placement.placements[sliceIndex];
      return Out(vec4f(offset + scene.viewport * 0f, 0f, 1f));
    }`)
    .$uses({ placement: placementLayout.$, scene: sceneLayout.$ })
    .$name('layoutRunPlacementVertex');
  const fragment = tgpu
    .fragmentFn({ out: d.vec4f })(`{
      let dimensions = textureDimensions(raster.page);
      return vec4f(f32(dimensions.x) * 0f, 0f, 0f, 1f);
    }`)
    .$uses({ raster: rasterLayout.$ })
    .$name('layoutRunPlacementFragment');
  const resolved = tgpu.resolveWithContext([vertex, fragment]);
  return Object.freeze({
    sceneLayout,
    rasterLayout,
    placementLayout,
    vertex,
    fragment,
    wgsl: resolved.code,
    bindGroupCount: resolved.usedBindGroupLayouts.length,
  });
}

function pboByteLength(recordCount, itemSize, scalarBytes) {
  const width = 2 ** Math.ceil(Math.log2(Math.sqrt(recordCount)));
  const height = Math.ceil(recordCount / width);
  return width * height * itemSize * scalarBytes;
}

function assertPositiveCapacity(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${label} must be a positive safe integer`);
}

function assertNonNegativeCapacity(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer`);
}
