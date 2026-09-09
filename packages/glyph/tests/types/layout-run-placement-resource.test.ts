import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import tgpu, { d } from 'typegpu';

const map = new THREE.StorageInstancedBufferAttribute(new Uint32Array(4), 1);
const placements = new THREE.StorageInstancedBufferAttribute(new Float32Array(8), 2);
const logical = TSL.instanceIndex;
const word = TSL.div(logical, TSL.uint(3));
const lane = TSL.mod(logical, TSL.uint(3));
const packed = TSL.storage(map, 'uint', map.count).setPBO(true).element(word);
const slice = TSL.bitAnd(TSL.shiftRight(packed, TSL.mul(lane, TSL.uint(10))), TSL.uint(1023));
const offset: THREE.Node<'vec2'> = TSL.storage(placements, 'vec2', placements.count).setPBO(true).element(slice);

const material = new THREE.MeshBasicNodeMaterial();
material.positionNode = TSL.vec3(TSL.add(TSL.positionLocal.xy, offset), TSL.positionLocal.z);

const layout = tgpu.bindGroupLayout({
  sliceMap: { storage: d.arrayOf(d.u32), visibility: ['vertex'] },
  placements: { storage: d.arrayOf(d.vec2f), visibility: ['vertex'] },
});
const vertex = tgpu.vertexFn({
  in: { logicalInstance: d.builtin.instanceIndex },
  out: { position: d.builtin.position },
})`{
    let packedWord = placement.sliceMap[in.logicalInstance / 3u];
    let sliceIndex = (packedWord >> ((in.logicalInstance % 3u) * 10u)) & 1023u;
    return Out(vec4f(placement.placements[sliceIndex], 0f, 1f));
  }`.$uses({ placement: layout.$ });

tgpu.resolve([vertex]);
