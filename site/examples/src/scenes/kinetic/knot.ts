import { Matrix4, Quaternion, Vector3 } from 'three/webgpu';

/**
 * A torus knot as a path with a moving frame, sampled by arc length so text
 * flows along it at a constant speed. p and q are the winding numbers; the
 * tube radius is where the text sits around the core.
 */
export interface Knot {
  readonly length: number;
  frameAt(s: number, out: KnotFrame): KnotFrame;
}

export interface KnotFrame {
  readonly position: Vector3;
  readonly tangent: Vector3;
  readonly normal: Vector3;
  readonly binormal: Vector3;
}

export function torusKnot(p: number, q: number, major: number, minor: number, samples = 1024): Knot {
  const point = (t: number, out: Vector3): Vector3 => {
    const ring = major + minor * Math.cos(q * t);
    return out.set(ring * Math.cos(p * t), ring * Math.sin(p * t), minor * Math.sin(q * t));
  };
  // Arc-length table over one full turn.
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
      // A stable frame: the binormal leans on the world up, the normal completes it.
      out.binormal.copy(up).cross(out.tangent).normalize();
      out.normal.copy(out.tangent).cross(out.binormal).normalize();
      return out;
    },
  };
}

const frame: KnotFrame = {
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
 * Places one glyph on the knot: `s` is its arc position, `angle` its place
 * around the tube, `height` how far its baseline sits from the core, and
 * `originalMatrix` its committed transform, whose scale is kept. The glyph's
 * x runs along the tangent and its y points away from the core, so the text
 * reads along the tube with its baseline on the surface.
 */
export function placeOnKnot(
  knot: Knot,
  s: number,
  angle: number,
  height: number,
  originalMatrix: Matrix4,
  out: Matrix4,
): Matrix4 {
  knot.frameAt(s, frame);
  radial.copy(frame.normal).multiplyScalar(Math.cos(angle)).addScaledVector(frame.binormal, Math.sin(angle));
  facing.copy(frame.tangent).cross(radial).normalize();
  originalMatrix.decompose(home, q, scale);
  at.copy(frame.position).addScaledVector(radial, height);
  basis.makeBasis(frame.tangent, radial, facing).setPosition(at);
  return out.copy(basis).scale(scale);
}
