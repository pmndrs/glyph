import { fwidth, mix, smoothstep, uniform, uv } from 'three/tsl';
import { Color, MeshBasicNodeMaterial, Vector2 } from 'three/webgpu';

export type PillControlState = 'hovered' | 'idle' | 'pressed';

export type PillControlVisual = Readonly<{
  fillColor: string;
  fillOpacity: number;
  outlineColor: string;
  textColor: string;
}>;

export type PillControlMaterial = Readonly<{
  material: MeshBasicNodeMaterial;
  setOpacity(opacity: number): void;
  setSize(width: number, height: number): void;
  setState(state: PillControlState, accent: string, restFillOpacity: number): void;
}>;

const IDLE_COLOR = '#f8fafc';
const HOVER_COLOR = '#ffffff';
const REST_FILL_COLOR = '#05070b';
const REST_FILL_OPACITY = 0.95;

/** Build one pixel-authored pill with uniform-only interaction updates. */
export function createPillControlMaterial(width: number, height: number): PillControlMaterial {
  const size = uniform(new Vector2(width, height));
  const opacity = uniform(0);
  const fillOpacity = uniform(0);
  const fillTint = uniform(new Color(REST_FILL_COLOR));
  const outlineTint = uniform(new Color(IDLE_COLOR));
  const outlineWidth = uniform(1.25);
  const radius = size.y.mul(0.5);
  const halfSize = size.mul(0.5);
  const local = uv().sub(0.5).mul(size).abs().sub(halfSize.sub(radius));
  const distance = local.max(0).length().add(local.x.max(local.y).min(0)).sub(radius);
  const feather = fwidth(distance).max(0.75);
  const outerCoverage = smoothstep(feather.negate(), feather, distance).oneMinus();
  const innerCoverage = smoothstep(feather.negate(), feather, distance.add(outlineWidth)).oneMinus();
  const outlineCoverage = outerCoverage.sub(innerCoverage).max(0);
  const fillCoverage = innerCoverage.mul(fillOpacity);
  const coverage = outlineCoverage.add(fillCoverage);
  const material = new MeshBasicNodeMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    transparent: true,
  });
  material.colorNode = mix(fillTint, outlineTint, outlineCoverage.div(coverage.max(0.0001)));
  material.opacityNode = coverage.mul(opacity);
  return Object.freeze({
    material,
    setOpacity(nextOpacity) {
      opacity.value = nextOpacity;
    },
    setSize(nextWidth, nextHeight) {
      size.value.set(nextWidth, nextHeight);
    },
    setState(state, accent, restFillOpacity) {
      const visual = pillControlVisual(state, accent, restFillOpacity);
      fillOpacity.value = visual.fillOpacity;
      fillTint.value.set(visual.fillColor);
      outlineTint.value.set(visual.outlineColor);
    },
  });
}

export function pillControlVisual(
  state: PillControlState,
  accent: string,
  restFillOpacity = REST_FILL_OPACITY,
): PillControlVisual {
  if (state === 'pressed') {
    return Object.freeze({
      fillColor: REST_FILL_COLOR,
      fillOpacity: restFillOpacity,
      outlineColor: IDLE_COLOR,
      textColor: accent,
    });
  }
  if (state === 'hovered') {
    return Object.freeze({
      fillColor: HOVER_COLOR,
      fillOpacity: 1,
      outlineColor: HOVER_COLOR,
      textColor: REST_FILL_COLOR,
    });
  }
  return Object.freeze({
    fillColor: REST_FILL_COLOR,
    fillOpacity: restFillOpacity,
    outlineColor: IDLE_COLOR,
    textColor: IDLE_COLOR,
  });
}
