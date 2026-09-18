import { color, dFdx, dFdy, float, mix, mx_noise_float, normalize, positionLocal, vec3 } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';

import { uPaperDrift } from '../uniforms';

const WIDTH = 160;
const HEIGHT = 90;
/** Fibre scale, and how hard the grain tilts the surface for the light to catch. Relief stays small: a strong tilt
 * randomises the normal per pixel and the sheet reads as static rather than paper. */
const FIBRE = 2.4;
const RELIEF = 0.9;

/**
 * The paper the whole scene sits on. Its grain is a procedural height field: the normals come from the height's own
 * screen-space derivatives, so the key light grazes the fibres and the sheet shades unevenly instead of reading as
 * flat fill.
 */
const material = new MeshStandardNodeMaterial({ roughness: 0.94, metalness: 0 });
// Octaves stay well above pixel scale; a fine one aliases into speckle.
// Sampled at a drifting offset so the sheet travels with the icon field above it.
const sample = positionLocal.add(vec3(uPaperDrift.x, uPaperDrift.y, 0));
const grain = mx_noise_float(sample.mul(FIBRE))
  .mul(0.6)
  .add(mx_noise_float(sample.mul(FIBRE * 2.7)).mul(0.3))
  .add(mx_noise_float(sample.mul(FIBRE * 6.1)).mul(0.1));
// Normal from the height field's own gradient: a cross product of position derivatives is near constant on a plane,
// so the light had nothing to catch.
material.normalNode = normalize(vec3(dFdx(grain).mul(-RELIEF), dFdy(grain).mul(-RELIEF), 1));
material.colorNode = mix(color('#efebe1'), color('#f8f6f1'), grain.mul(0.5).add(0.5));
material.roughnessNode = mix(float(0.88), float(1), grain.mul(0.5).add(0.5));

export function Paper() {
  return (
    <mesh material={material} position={[0, 0, -14]}>
      <planeGeometry args={[WIDTH, HEIGHT]} />
    </mesh>
  );
}
