import { color, float, smoothstep, uv, vec2, vec3 } from 'three/tsl';
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu';

const WIDTH = 150;
const HEIGHT = 84;

/** One soft circle of coloured light, round on the plane despite its aspect ratio. */
function light(x: number, y: number, radius: number, tint: string, strength: number): Node<'vec3'> {
  const distance = uv()
    .sub(vec2(x, y))
    .mul(vec2(1, HEIGHT / WIDTH))
    .length();
  return color(tint).mul(smoothstep(float(radius), float(0), distance).pow(2).mul(strength));
}

/**
 * Several coloured lights composited additively over near-black, far behind every word. Opaque on purpose: three's
 * transmission only refracts what the opaque pass drew, so this is the light the glass title bends and splits.
 */
const material = new MeshBasicNodeMaterial();
material.colorNode = vec3(0.006, 0.008, 0.02)
  .add(light(0.36, 0.58, 0.16, '#1d4dff', 0.3))
  .add(light(0.62, 0.52, 0.14, '#7a2cff', 0.24))
  .add(light(0.5, 0.4, 0.12, '#00c2a8', 0.16))
  .add(light(0.72, 0.66, 0.08, '#ff7a3d', 0.14));

export function Backdrop() {
  return (
    <mesh material={material} position={[0, 1.2, -50]}>
      <planeGeometry args={[WIDTH, HEIGHT]} />
    </mesh>
  );
}
