import { BufferAttribute, BufferGeometry, Vector3 } from 'three/webgpu';

import type { Path, PathFrame } from './paths';

/**
 * A flat band along a path: two vertices per sample, one on each side of the
 * path along its binormal, so the band lies in the path's tangent–binormal
 * plane and its normal is the frame's normal. Closed by default, so the
 * last segment joins the first. Text placed on the same path with its y
 * along the binormal lies printed on this band.
 */
export function bandGeometry(path: Path, width: number, segments = 480, closed = true): BufferGeometry {
  const frame: PathFrame = {
    position: new Vector3(),
    tangent: new Vector3(),
    normal: new Vector3(),
    binormal: new Vector3(),
  };
  const rows = closed ? segments : segments + 1;
  const positions = new Float32Array(rows * 2 * 3);
  const normals = new Float32Array(rows * 2 * 3);
  const uvs = new Float32Array(rows * 2 * 2);
  const half = width / 2;
  const samples = closed ? segments : segments + 1;
  for (let i = 0; i < samples; i += 1) {
    path.frameAt((i / segments) * path.length, frame);
    for (let side = 0; side < 2; side += 1) {
      const offset = side === 0 ? -half : half;
      const v = (i * 2 + side) * 3;
      positions[v] = frame.position.x + frame.binormal.x * offset;
      positions[v + 1] = frame.position.y + frame.binormal.y * offset;
      positions[v + 2] = frame.position.z + frame.binormal.z * offset;
      normals[v] = frame.normal.x;
      normals[v + 1] = frame.normal.y;
      normals[v + 2] = frame.normal.z;
      uvs[(i * 2 + side) * 2] = i / segments;
      uvs[(i * 2 + side) * 2 + 1] = side;
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < segments; i += 1) {
    const a = i * 2;
    const b = (closed ? (i + 1) % segments : i + 1) * 2;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}
