import * as THREE from 'three/webgpu';

import {
  normalizeTextFlow,
  type TextFlowBounds,
  type TextFlowExclusion,
  type TextFlowPoint,
} from '../text-properties.js';

const projectionRegionKey = 'pmndrs-glyph-projection-region';

/** Inputs for projecting one conservative object-local bound into paragraph flow coordinates. */
export interface ProjectTextFlowBoundsOptions {
  /** Stable exclusion key; repeated projections retain the same core identity. */
  readonly key: string;
  /** Camera whose current projection defines camera-to-text-plane occlusion. */
  readonly camera: THREE.Camera;
  /** Text object whose local z=0 plane and x/-y axes define inline/block coordinates. */
  readonly text: THREE.Object3D;
  /** Object that owns the local bound. */
  readonly object: THREE.Object3D;
  /** Conservative object-local bound to project. */
  readonly bounds: THREE.Box3;
  /** Authored paragraph-flow clipping rectangle. */
  readonly flowBounds: TextFlowBounds;
  /** Conservative layout-space inflation for projection/simplification error. */
  readonly projectionError?: number;
  readonly wrapSide?: TextFlowExclusion['wrapSide'];
  readonly marginInline?: number;
  readonly marginBlock?: number;
}

/**
 * Projects a conservative Three object bound onto a text plane. The result describes camera-to-plane occlusion only;
 * it does not inspect depth, material coverage, or GPU pixels. `undefined` means the clipped bound cannot occlude flow.
 */
export function projectTextFlowBounds(options: ProjectTextFlowBoundsOptions): TextFlowExclusion | undefined {
  const flowBounds = normalizedFlowBounds(options.flowBounds);
  const projectionError = normalizedProjectionError(options.projectionError);
  assertFiniteBox(options.bounds);
  const cameraTag = options.camera as THREE.Camera & {
    readonly isPerspectiveCamera?: boolean;
    readonly isOrthographicCamera?: boolean;
  };
  if (!cameraTag.isPerspectiveCamera && !cameraTag.isOrthographicCamera) {
    throw new TypeError('camera must be a PerspectiveCamera or OrthographicCamera');
  }
  options.camera.updateWorldMatrix(true, false);
  options.text.updateWorldMatrix(true, false);
  options.object.updateWorldMatrix(true, false);
  assertFiniteMatrix(options.camera.matrixWorld, 'camera matrixWorld');
  assertFiniteMatrix(options.camera.projectionMatrix, 'camera projectionMatrix');
  assertFiniteMatrix(options.text.matrixWorld, 'text matrixWorld');
  assertFiniteMatrix(options.object.matrixWorld, 'object matrixWorld');
  const objectDeterminant = options.object.matrixWorld.determinant();
  if (!Number.isFinite(objectDeterminant) || objectDeterminant === 0) {
    throw new RangeError('object matrixWorld must be finite and invertible');
  }

  const textToWorld = options.text.matrixWorld;
  const determinant = textToWorld.determinant();
  if (!Number.isFinite(determinant) || determinant === 0) {
    throw new RangeError('text matrixWorld must be finite and invertible');
  }
  const worldToText = textToWorld.clone().invert();
  const textOrigin = new THREE.Vector3().setFromMatrixPosition(textToWorld);
  const inline = new THREE.Vector3(1, 0, 0).applyMatrix4(textToWorld).sub(textOrigin);
  const block = new THREE.Vector3(0, 1, 0).applyMatrix4(textToWorld).sub(textOrigin);
  const textNormal = inline.cross(block);
  if (!isFiniteVector(textNormal) || textNormal.lengthSq() === 0) {
    throw new RangeError('text matrixWorld must describe a nondegenerate plane');
  }
  textNormal.normalize();
  const cameraPosition = new THREE.Vector3().setFromMatrixPosition(options.camera.matrixWorld);
  const cameraDistance = textNormal.dot(cameraPosition.clone().sub(textOrigin));
  if (!Number.isFinite(cameraDistance) || cameraDistance === 0) {
    throw new RangeError('camera must not lie on the text plane');
  }
  if (cameraDistance < 0) textNormal.negate();
  const textPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(textNormal, textOrigin);

  const projectionView = new THREE.Matrix4().multiplyMatrices(
    options.camera.projectionMatrix,
    options.camera.matrixWorldInverse,
  );
  assertFlowPlaneProjection(flowBounds, textToWorld, projectionView);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    projectionView,
    options.camera.coordinateSystem,
    options.camera.reversedDepth,
  );
  if (
    frustum.planes.some(
      (plane) => !isFiniteVector(plane.normal) || !Number.isFinite(plane.constant) || plane.normal.lengthSq() === 0,
    )
  ) {
    throw new RangeError('camera projection must describe a finite nondegenerate frustum');
  }
  const planes = [...boxPlanes(options.bounds, options.object.matrixWorld), textPlane, ...frustum.planes];
  const worldPoints = intersectHalfspaces(planes);
  if (worldPoints.length === 0) return undefined;

  const raycaster = new THREE.Raycaster();
  const planePoint = new THREE.Vector3();
  const projected: TextFlowPoint[] = [];
  for (const worldPoint of worldPoints) {
    const ndc = worldPoint.clone().project(options.camera);
    if (!isFiniteVector(ndc)) continue;
    raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), options.camera);
    const intersection = raycaster.ray.intersectPlane(textPlane, planePoint);
    if (intersection === null || !isFiniteVector(intersection)) continue;
    const local = intersection.clone().applyMatrix4(worldToText);
    if (!isFiniteVector(local)) continue;
    projected.push([local.x, -local.y]);
  }
  let polygon = convexHull(projected);
  if (polygon.length < 3) return undefined;
  if (projectionError !== 0) {
    const inflated: TextFlowPoint[] = [];
    for (const point of polygon) {
      inflated.push(
        [point[0] - projectionError, point[1] - projectionError],
        [point[0] + projectionError, point[1] - projectionError],
        [point[0] + projectionError, point[1] + projectionError],
        [point[0] - projectionError, point[1] + projectionError],
      );
    }
    polygon = convexHull(inflated);
  }
  polygon = clipToBounds(polygon, flowBounds);
  polygon = convexHull(
    polygon.map((point) => [normalizeZero(Math.fround(point[0])), normalizeZero(Math.fround(point[1]))] as const),
  );
  if (polygon.length < 3 || signedArea(polygon) === 0) return undefined;

  const normalized = normalizeTextFlow({
    regions: [
      {
        key: projectionRegionKey,
        shape: { kind: 'rectangle', bounds: flowBounds },
        exclusions: [
          {
            key: options.key,
            shape: { kind: 'polygon', vertices: polygon },
            ...(options.wrapSide === undefined ? {} : { wrapSide: options.wrapSide }),
            ...(options.marginInline === undefined ? {} : { marginInline: options.marginInline }),
            ...(options.marginBlock === undefined ? {} : { marginBlock: options.marginBlock }),
          },
        ],
      },
    ],
  });
  return normalized.regions[0]!.exclusions![0]!;
}

function normalizedFlowBounds(bounds: TextFlowBounds): TextFlowBounds {
  const normalized = normalizeTextFlow({
    regions: [{ key: projectionRegionKey, shape: { kind: 'rectangle', bounds } }],
  });
  const shape = normalized.regions[0]!.shape;
  if (shape.kind !== 'rectangle') throw new TypeError('projected flow bounds must be rectangular');
  return shape.bounds;
}

function normalizedProjectionError(value: number | undefined): number {
  if (value === undefined) return 0;
  const normalized = Math.fround(value);
  if (!Number.isFinite(value) || !Number.isFinite(normalized) || normalized < 0) {
    throw new RangeError('projectionError must be a nonnegative finite f32 value');
  }
  return normalizeZero(normalized);
}

function assertFlowPlaneProjection(
  bounds: TextFlowBounds,
  textToWorld: THREE.Matrix4,
  projectionView: THREE.Matrix4,
): void {
  const projected = [
    new THREE.Vector4(bounds[0], -bounds[1], 0, 1),
    new THREE.Vector4(bounds[2], -bounds[1], 0, 1),
    new THREE.Vector4(bounds[2], -bounds[3], 0, 1),
    new THREE.Vector4(bounds[0], -bounds[3], 0, 1),
  ].map((point) => point.applyMatrix4(textToWorld).applyMatrix4(projectionView));
  if (projected.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.w <= 0)) {
    throw new RangeError('text flow plane must project finitely in front of the camera');
  }
  const ndc = projected.map((point) => [point.x / point.w, point.y / point.w] as const);
  const area = Math.abs(signedArea(ndc));
  const scale = Math.max(1, ...ndc.flatMap((point) => [Math.abs(point[0]), Math.abs(point[1])]));
  if (!Number.isFinite(area) || area <= Number.EPSILON * 256 * scale * scale) {
    throw new RangeError('text flow plane projection must not be edge-on or degenerate');
  }
}

function assertFiniteBox(bounds: THREE.Box3): void {
  if (
    bounds.isEmpty() ||
    !isFiniteVector(bounds.min) ||
    !isFiniteVector(bounds.max) ||
    bounds.min.x >= bounds.max.x ||
    bounds.min.y >= bounds.max.y ||
    bounds.min.z >= bounds.max.z
  ) {
    throw new RangeError('bounds must be a finite nonempty Box3');
  }
}

function assertFiniteMatrix(matrix: THREE.Matrix4, label: string): void {
  if (matrix.elements.some((value) => !Number.isFinite(value))) {
    throw new RangeError(`${label} must contain only finite values`);
  }
}

function isFiniteVector(vector: THREE.Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

function boxPlanes(bounds: THREE.Box3, matrixWorld: THREE.Matrix4): readonly THREE.Plane[] {
  const { min, max } = bounds;
  return [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -min.x),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), max.x),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -min.y),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), max.y),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -min.z),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), max.z),
  ].map((plane) => plane.applyMatrix4(matrixWorld));
}

function intersectHalfspaces(planes: readonly THREE.Plane[]): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (let first = 0; first < planes.length - 2; first += 1) {
    for (let second = first + 1; second < planes.length - 1; second += 1) {
      for (let third = second + 1; third < planes.length; third += 1) {
        const point = intersectPlanes(planes[first]!, planes[second]!, planes[third]!);
        if (point === undefined) continue;
        const tolerance = Number.EPSILON * 256 * Math.max(1, point.length());
        if (planes.every((plane) => plane.distanceToPoint(point) >= -tolerance)) points.push(point);
      }
    }
  }
  return points;
}

function intersectPlanes(first: THREE.Plane, second: THREE.Plane, third: THREE.Plane): THREE.Vector3 | undefined {
  const secondThird = new THREE.Vector3().crossVectors(second.normal, third.normal);
  const denominator = first.normal.dot(secondThird);
  if (!Number.isFinite(denominator) || Math.abs(denominator) <= Number.EPSILON) return undefined;
  const thirdFirst = new THREE.Vector3().crossVectors(third.normal, first.normal);
  const firstSecond = new THREE.Vector3().crossVectors(first.normal, second.normal);
  const point = secondThird
    .multiplyScalar(-first.constant)
    .addScaledVector(thirdFirst, -second.constant)
    .addScaledVector(firstSecond, -third.constant)
    .multiplyScalar(1 / denominator);
  return isFiniteVector(point) ? point : undefined;
}

function convexHull(points: readonly TextFlowPoint[]): TextFlowPoint[] {
  const sorted = points
    .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
    .map((point) => [point[0], point[1]] as const)
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const unique = sorted.filter(
    (point, index) => index === 0 || point[0] !== sorted[index - 1]![0] || point[1] !== sorted[index - 1]![1],
  );
  if (unique.length < 3) return unique;
  const lower: TextFlowPoint[] = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: TextFlowPoint[] = [];
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index]!;
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function cross(origin: TextFlowPoint, first: TextFlowPoint, second: TextFlowPoint): number {
  return (first[0] - origin[0]) * (second[1] - origin[1]) - (first[1] - origin[1]) * (second[0] - origin[0]);
}

function clipToBounds(points: readonly TextFlowPoint[], bounds: TextFlowBounds): TextFlowPoint[] {
  let clipped = [...points];
  clipped = clip2d(
    clipped,
    (point) => point[0] >= bounds[0],
    (left, right) => intersectAxis(left, right, 0, bounds[0]),
  );
  clipped = clip2d(
    clipped,
    (point) => point[0] <= bounds[2],
    (left, right) => intersectAxis(left, right, 0, bounds[2]),
  );
  clipped = clip2d(
    clipped,
    (point) => point[1] >= bounds[1],
    (left, right) => intersectAxis(left, right, 1, bounds[1]),
  );
  return clip2d(
    clipped,
    (point) => point[1] <= bounds[3],
    (left, right) => intersectAxis(left, right, 1, bounds[3]),
  );
}

function clip2d(
  points: readonly TextFlowPoint[],
  inside: (point: TextFlowPoint) => boolean,
  intersect: (first: TextFlowPoint, second: TextFlowPoint) => TextFlowPoint,
): TextFlowPoint[] {
  if (points.length === 0) return [];
  const clipped: TextFlowPoint[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const previous = points[(index + points.length - 1) % points.length]!;
    const currentInside = inside(current);
    const previousInside = inside(previous);
    if (currentInside !== previousInside) clipped.push(intersect(previous, current));
    if (currentInside) clipped.push(current);
  }
  return clipped;
}

function intersectAxis(first: TextFlowPoint, second: TextFlowPoint, axis: 0 | 1, value: number): TextFlowPoint {
  const denominator = second[axis] - first[axis];
  const amount = denominator === 0 ? 0 : (value - first[axis]) / denominator;
  return axis === 0
    ? [value, first[1] + (second[1] - first[1]) * amount]
    : [first[0] + (second[0] - first[0]) * amount, value];
}

function signedArea(points: readonly TextFlowPoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area;
}

function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}
