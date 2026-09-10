import { fwidth, smoothstep, uniform, uv, vec3 } from 'three/tsl';
import { MeshBasicNodeMaterial, Vector2 } from 'three/webgpu';

export type RoundedPanelMaterial = Readonly<{
  material: MeshBasicNodeMaterial;
  setOpacity(opacity: number): void;
  setSize(width: number, height: number): void;
}>;

/** Build one antialiased, pixel-authored rounded rectangle node material. */
export function createRoundedPanelMaterial(width: number, height: number): RoundedPanelMaterial {
  const panelSize = uniform(new Vector2(width, height));
  const opacity = uniform(0);
  const radius = uniform(16);
  const halfSize = panelSize.mul(0.5);
  const local = uv().sub(0.5).mul(panelSize).abs().sub(halfSize.sub(radius));
  const distance = local.max(0).length().add(local.x.max(local.y).min(0)).sub(radius);
  const feather = fwidth(distance).max(0.75);
  const coverage = smoothstep(feather.negate(), feather, distance).oneMinus();
  const material = new MeshBasicNodeMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    transparent: true,
  });
  material.colorNode = vec3(0);
  material.opacityNode = coverage.mul(0.95).mul(opacity);
  return Object.freeze({
    material,
    setOpacity(nextOpacity) {
      opacity.value = nextOpacity;
    },
    setSize(nextWidth, nextHeight) {
      panelSize.value.set(nextWidth, nextHeight);
    },
  });
}
