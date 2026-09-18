import { color, hash, instanceIndex, positionLocal, sin, vec3 } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

import { uTime } from '../uniforms';

const COUNT = 180;

/**
 * Tiny HDR motes scattered through the depth of the scene. Out of focus, the depth of field opens each one into a
 * bokeh disc; slow per-mote drift keeps the field alive. Placement is hashed from the instance index, so it is the
 * same on every run.
 */
const material = new MeshBasicNodeMaterial();
const seed = instanceIndex.toFloat();
const home = vec3(
  hash(seed).sub(0.5).mul(34),
  hash(seed.add(101)).sub(0.5).mul(18),
  hash(seed.add(211)).mul(-26).add(4),
);
const drift = vec3(
  sin(uTime.mul(0.23).add(seed.mul(1.7))).mul(0.35),
  sin(uTime.mul(0.17).add(seed.mul(2.3))).mul(0.45),
  0,
);
material.positionNode = positionLocal.add(home).add(drift);
// Bright enough in HDR that a mote spread into a wide bokeh disc still reads.
material.colorNode = color('#cfe4ff').mul(hash(seed.add(307)).mul(14).add(6));

export function Dust() {
  return (
    <instancedMesh args={[undefined, material, COUNT]} frustumCulled={false}>
      <icosahedronGeometry args={[0.05, 1]} />
    </instancedMesh>
  );
}
