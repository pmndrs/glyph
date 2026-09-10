import { color, mix, step, uv } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';

/** A flap plate: two dark halves and the hairline between them. */
export function plateMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ metalness: 0.2, roughness: 0.7 });
  const lower = step(uv().y, 0.5);
  const seam = step(uv().y.sub(0.5).abs(), 0.012);
  material.colorNode = mix(mix(color('#151a26'), color('#10141d'), lower), color('#05060a'), seam);
  return material;
}
