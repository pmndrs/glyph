import { type Curve, Matrix4, Quaternion, Vector3 } from 'three/webgpu';

/** A path sampled by arc length, with a moving frame at every point. */
export interface Path {
  readonly length: number;
  frameAt(s: number, out: PathFrame): PathFrame;
}

export interface PathFrame {
  readonly position: Vector3;
  readonly tangent: Vector3;
  readonly normal: Vector3;
  readonly binormal: Vector3;
}

/**
 * A torus knot with the parametrisation three's `TorusKnotGeometry(major,
 * tube, …, p, q)` uses — minor radius `major / 2` — so a path built here sits
 * exactly on that geometry's core.
 */
export function torusKnot(p: number, q: number, major: number, minor: number, samples = 1024): Path {
  const point = (t: number, out: Vector3): Vector3 => {
    const ring = major + minor * Math.cos(q * t);
    return out.set(ring * Math.cos(p * t), ring * Math.sin(p * t), minor * Math.sin(q * t));
  };
  const arc = new Float32Array(samples + 1);
  const a = new Vector3();
  const b = new Vector3();
  point(0, a);
  for (let i = 1; i <= samples; i += 1) {
    point((i / samples) * Math.PI * 2, b);
    arc[i] = (arc[i - 1] ?? 0) + a.distanceTo(b);
    a.copy(b);
  }
  const length = arc[samples] ?? 0;
  const tAt = (s: number): number => {
    const target = ((s % length) + length) % length;
    let lo = 0;
    let hi = samples;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((arc[mid] ?? 0) <= target) lo = mid;
      else hi = mid;
    }
    const span = (arc[hi] ?? 0) - (arc[lo] ?? 0);
    const f = span > 0 ? (target - (arc[lo] ?? 0)) / span : 0;
    return ((lo + f) / samples) * Math.PI * 2;
  };
  const ahead = new Vector3();
  const behind = new Vector3();
  const up = new Vector3(0, 0, 1);
  return {
    length,
    frameAt(s, out) {
      const t = tAt(s);
      point(t, out.position);
      point(t + 1e-3, ahead);
      point(t - 1e-3, behind);
      out.tangent.copy(ahead).sub(behind).normalize();
      out.binormal.copy(up).cross(out.tangent).normalize();
      out.normal.copy(out.tangent).cross(out.binormal).normalize();
      return out;
    },
  };
}

/**
 * Any three.js curve as a path: sampled by arc length through the curve's own
 * `getPointAt`, with a frame whose normal is `up`, so type placed on a tube
 * built from the same curve stands on the tube's top and stays upright.
 */
export function curvePath(curve: Curve<Vector3>, up = new Vector3(0, 1, 0)): Path {
  const length = curve.getLength();
  return {
    length,
    frameAt(s, out) {
      const u = (((s % length) + length) % length) / length;
      curve.getPointAt(u, out.position);
      curve.getTangentAt(u, out.tangent);
      // Type stands on world up wherever the curve goes, the way it does on a circle; the letters never turn over.
      out.normal.copy(up);
      out.binormal.copy(out.tangent).cross(up).normalize();
      return out;
    },
  };
}

/** A circle in the XZ plane whose normal is world up, so type stands on it facing outward. */
export function circle(radius: number): Path {
  const up = new Vector3(0, 1, 0);
  return {
    length: Math.PI * 2 * radius,
    frameAt(s, out) {
      const t = s / radius;
      out.position.set(Math.cos(t) * radius, 0, -Math.sin(t) * radius);
      out.tangent.set(-Math.sin(t), 0, -Math.cos(t));
      out.normal.copy(up);
      out.binormal.copy(out.tangent).cross(up).normalize();
      return out;
    },
  };
}

const frame: PathFrame = {
  position: new Vector3(),
  tangent: new Vector3(),
  normal: new Vector3(),
  binormal: new Vector3(),
};
const radial = new Vector3();
const facing = new Vector3();
const at = new Vector3();
const basis = new Matrix4();
const home = new Vector3();
const q = new Quaternion();
const scale = new Vector3();

/**
 * Places one glyph on a path: `s` is its arc position, `angle` its place
 * around the path's frame (0 is the normal), `height` how far its baseline
 * sits from the path, and `originalMatrix` its committed transform, whose
 * scale is kept. The glyph's x runs along the tangent and its y along the
 * chosen radial, so the text reads along the path standing on it.
 */
export function placeOnPath(
  path: Path,
  s: number,
  angle: number,
  height: number,
  originalMatrix: Matrix4,
  out: Matrix4,
): Matrix4 {
  path.frameAt(s, frame);
  radial.copy(frame.normal).multiplyScalar(Math.cos(angle)).addScaledVector(frame.binormal, Math.sin(angle));
  facing.copy(frame.tangent).cross(radial).normalize();
  originalMatrix.decompose(home, q, scale);
  at.copy(frame.position).addScaledVector(radial, height);
  basis.makeBasis(frame.tangent, radial, facing).setPosition(at);
  return out.copy(basis).scale(scale);
}
