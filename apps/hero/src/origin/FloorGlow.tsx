import { positionLocal, vec3 } from 'three/tsl';
import { AdditiveBlending, MeshBasicNodeMaterial } from 'three/webgpu';

/**
 * A faint pool of light on the ground beneath the word. Without it the reflector runs straight into black at the
 * edges of frame and the room has no floor, only an absence. Radial, additive, and weak enough that it reads as
 * bounce rather than as a lamp.
 */
const RADIUS = 11;
const STRENGTH = 0.035;

const material = new MeshBasicNodeMaterial({
  blending: AdditiveBlending,
  depthWrite: false,
  transparent: true,
});
// Distance from the plane's own centre, squared off so the middle stays flat and the falloff lives at the rim.
const spread = positionLocal.xy.length().div(RADIUS).clamp(0, 1).oneMinus();
material.colorNode = vec3(0.42, 0.3, 0.22);
material.opacityNode = spread.mul(spread).mul(STRENGTH);

export function FloorGlow() {
  return (
    <mesh material={material} position={[-1.2, -0.94, 0]} rotation-x={-Math.PI / 2}>
      <planeGeometry args={[RADIUS * 2, RADIUS * 2]} />
    </mesh>
  );
}
