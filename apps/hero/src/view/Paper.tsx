import { color, dFdx, dFdy, float, mix, mx_noise_float, normalize, positionLocal, uniform, vec3 } from 'three/tsl';
import { MeshStandardNodeMaterial, Vector2 } from 'three/webgpu';

/** Paper grain follows the icon field in the paper's own plane units. */
const uPaperDrift = uniform(new Vector2());

export function updatePaper(elapsed: number, angle: number): void {
  const drift = 3.2 * (30 / 22) * elapsed;
  uPaperDrift.value.set(Math.cos(angle) * drift, Math.sin(angle) * drift);
}

/** Procedural paper grain. Screen derivatives of the height field tilt the surface normal. */
const material = new MeshStandardNodeMaterial({ roughness: 0.94, metalness: 0 });
// Keep grain above pixel scale and scroll it with the icon field.
const sample = positionLocal.add(vec3(uPaperDrift.x, uPaperDrift.y, 0));
const grain = mx_noise_float(sample.mul(2.4))
  .mul(0.6)
  .add(mx_noise_float(sample.mul(2.4 * 2.7)).mul(0.3))
  .add(mx_noise_float(sample.mul(2.4 * 6.1)).mul(0.1));
// Height derivatives tilt the flat plane's normal so light reveals the grain.
material.normalNode = normalize(vec3(dFdx(grain).mul(-0.9), dFdy(grain).mul(-0.9), 1));
material.colorNode = mix(color('#efebe1'), color('#f8f6f1'), grain.mul(0.5).add(0.5));
material.roughnessNode = mix(float(0.88), float(1), grain.mul(0.5).add(0.5));

export function Paper() {
  return (
    <mesh material={material} position={[0, 0, -14]}>
      <planeGeometry args={[160, 90]} />
    </mesh>
  );
}
