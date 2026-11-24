import { attribute, float, smoothstep, uniform, uv, vec3 } from 'three/tsl';
import { AdditiveBlending, DoubleSide, MeshBasicNodeMaterial, type Node } from 'three/webgpu';
import { retained } from '../utils';

export const diveUniforms = retained('dive', () => ({
  /** 0..1: how much of each contour has been drawn. */
  uDrawn: uniform(0),
  /** 0..1: how far the control points and their handles have come up. */
  uPoints: uniform(0),
}));

const { uDrawn, uPoints } = diveUniforms;

/**
 * The outline as light. Every quad carries `stroke`: where along its contour it lies, and what it is (0 a piece
 * of curve, 1 a handle between an on-curve point and its control, 2 an on-curve point, 3 a control point).
 */
export function createOutlineMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  const stroke = attribute('stroke', 'vec2') as Node<'vec2'>;
  const kind = stroke.y;
  const across = uv().y.sub(0.5).abs().mul(2);
  const round = uv().sub(0.5).length().mul(2);
  const curve = float(1)
    .sub(across.pow(2))
    .mul(float(1).sub(smoothstep(uDrawn.sub(0.02), uDrawn, stroke.x)));
  const handle = float(1).sub(across).mul(uPoints).mul(0.55);
  const on = float(1)
    .sub(smoothstep(0.7, 0.95, round))
    .mul(uPoints);
  // A control point is a ring: it is not on the curve.
  const off = smoothstep(0.45, 0.6, round)
    .mul(float(1).sub(smoothstep(0.8, 0.98, round)))
    .mul(uPoints);
  const isCurve = float(1).sub(smoothstep(0.4, 0.6, kind));
  const isHandle = smoothstep(0.4, 0.6, kind).mul(float(1).sub(smoothstep(1.4, 1.6, kind)));
  const isOn = smoothstep(1.4, 1.6, kind).mul(float(1).sub(smoothstep(2.4, 2.6, kind)));
  const isOff = smoothstep(2.4, 2.6, kind);
  const light = curve.mul(isCurve).add(handle.mul(isHandle)).add(on.mul(isOn)).add(off.mul(isOff));
  material.colorNode = vec3(1, 0.86, 0.62)
    .mul(isCurve.add(isHandle))
    .add(vec3(0.62, 0.8, 1).mul(isOn.add(isOff)))
    .mul(light)
    .mul(1.25);
  material.toneMapped = false;

  return material;
}
