import * as THREE from 'three/webgpu';

import type { PortableGeometryPayload } from '../core.js';
import type { GlyphKey, GlyphPlacement, GlyphPlacements } from '../glyph-placement.js';
import type { LayoutBox } from '../layout.js';

export type GlyphAnchorAxis = 'min' | 'center' | 'max';

export interface GlyphAnchor {
  readonly x: GlyphAnchorAxis;
  readonly y: GlyphAnchorAxis;
  readonly z?: GlyphAnchorAxis;
}

/** The coordinate system used by a retained renderer geometry source. */
export type ThreeGlyphGeometryCoordinates = 'glyph-local' | 'unit-square' | 'em';

/**
 * Geometry data available to a Three adapter when a technique supplies a mesh.
 *
 * `metric-quad` is already in Text-local Three coordinates. `supplied` is the
 * immutable source mesh in the technique's declared coordinates; the technique
 * shader owns how those coordinates are scaled or otherwise transformed. This
 * distinction keeps a physics adapter from mistaking a renderer source mesh for
 * a collision guarantee while still making the exact retained shape available.
 */
export interface ThreeGlyphGeometrySource {
  readonly kind: 'metric-quad' | 'supplied';
  readonly geometryKind?: 'quad' | 'hull' | 'custom';
  readonly coordinates: ThreeGlyphGeometryCoordinates;
  readonly positions: readonly THREE.Vector3[];
  readonly indices: readonly number[];
  readonly bounds: THREE.Box3;
}

export interface ThreeGlyphMeasurement {
  readonly key: GlyphKey;
  /** Dense index in the collection that returned this measurement. */
  readonly index: number;
  /** Original visual-order index in the committed source paragraph. */
  readonly sourceIndex: number;
  readonly shapedOrigin: THREE.Vector3;
  readonly drawnOrigin: THREE.Vector3;
  /** Caller-owned glyph-transform snapshot in the source Text's local space. */
  readonly originalMatrix: THREE.Matrix4;
  readonly localQuad: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
  readonly localInkBounds: THREE.Box3;
  readonly localAdvanceBounds: THREE.Box3;
  /** Exact metric fallback or retained supplied source geometry for this glyph's draw. */
  readonly geometry: ThreeGlyphGeometrySource;
  anchorPoint(anchor: GlyphAnchor, bounds?: 'ink' | 'advance'): THREE.Vector3;
}

/** Builds Three-local measurements from one committed paragraph snapshot. */
export function measureGlyphPlacements(
  placements: GlyphPlacements,
  geometryByIndex: ReadonlyMap<number, ThreeGlyphGeometrySource> = new Map(),
): readonly ThreeGlyphMeasurement[] {
  const measurements = placements.glyphs.map((placement) =>
    measureGlyph(placement, geometryByIndex.get(placement.index)),
  );
  return Object.freeze(measurements);
}

/** Creates the renderer-neutral source view for a retained portable geometry payload. */
export function createSuppliedGlyphGeometrySource(
  payload: PortableGeometryPayload,
  geometryKind: 'quad' | 'hull' | 'custom',
  coordinates: 'unit-square' | 'em',
): ThreeGlyphGeometrySource {
  const positionAttribute = payload.attributes.find((attribute) => attribute.semantic === 'position');
  if (positionAttribute === undefined) throw new TypeError('portable geometry is missing its position attribute');
  const positionAccessor = payload.accessors[positionAttribute.accessor];
  if (positionAccessor === undefined) throw new Error('portable geometry position accessor is missing');
  if (positionAccessor.components !== 3) throw new TypeError('portable geometry positions need three components');
  const positions = new Array<THREE.Vector3>(positionAccessor.count);
  for (let index = 0; index < positionAccessor.count; index += 1) {
    positions[index] = new THREE.Vector3(
      readGeometryScalar(payload, positionAccessor, index, 0),
      readGeometryScalar(payload, positionAccessor, index, 1),
      readGeometryScalar(payload, positionAccessor, index, 2),
    );
  }
  const range = payload.drawRange ?? {
    start: 0,
    count:
      payload.indices === undefined
        ? positionAccessor.count
        : (payload.accessors[payload.indices.accessor]?.count ?? 0),
  };
  const sourceIndices =
    payload.indices === undefined
      ? Array.from({ length: range.count }, (_, offset) => range.start + offset)
      : readGeometryIndices(payload, payload.indices.accessor, range);
  const indices = payload.topology === 'triangle-strip' ? triangleStripIndices(sourceIndices) : sourceIndices;
  const usedPositions = indices
    .map((index) => positions[index])
    .filter((vertex): vertex is THREE.Vector3 => vertex !== undefined);
  const bounds = new THREE.Box3().setFromPoints(usedPositions.length === 0 ? positions : usedPositions);
  return Object.freeze({
    kind: 'supplied',
    geometryKind,
    coordinates,
    positions: Object.freeze(positions),
    indices: Object.freeze(indices),
    bounds,
  });
}

function measureGlyph(
  placement: GlyphPlacement,
  suppliedGeometry: ThreeGlyphGeometrySource | undefined,
): ThreeGlyphMeasurement {
  const localInkBounds = paragraphBox(placement.ink);
  const localAdvanceBounds = paragraphBox(placement.bounds);
  const localQuad = quadFromBox(localInkBounds);
  const shapedOrigin = new THREE.Vector3(placement.shapedX, -placement.shapedY, 0);
  const drawnOrigin = new THREE.Vector3(placement.x, -placement.y, 0);
  const originalMatrix = new THREE.Matrix4().makeTranslation(drawnOrigin.x, drawnOrigin.y, drawnOrigin.z);
  const anchorInkBounds = localInkBounds.clone();
  const anchorAdvanceBounds = localAdvanceBounds.clone();
  const glyphLocalInkBounds = localInkBounds.clone().translate(drawnOrigin.clone().multiplyScalar(-1));
  const geometry =
    suppliedGeometry === undefined
      ? Object.freeze({
          kind: 'metric-quad' as const,
          coordinates: 'glyph-local' as const,
          positions: Object.freeze([...quadFromBox(glyphLocalInkBounds)]),
          indices: Object.freeze([0, 1, 2, 0, 2, 3]),
          bounds: glyphLocalInkBounds,
        })
      : Object.freeze({
          ...suppliedGeometry,
          positions: Object.freeze(suppliedGeometry.positions.map((position) => position.clone())),
          bounds: suppliedGeometry.bounds.clone(),
        });
  const point = (anchor: GlyphAnchor, bounds: 'ink' | 'advance' = 'ink') => {
    const box = bounds === 'ink' ? anchorInkBounds : anchorAdvanceBounds;
    return new THREE.Vector3(
      axisPoint(box.min.x, box.max.x, anchor.x),
      axisPoint(box.min.y, box.max.y, anchor.y),
      axisPoint(box.min.z, box.max.z, anchor.z ?? 'center'),
    );
  };
  return Object.freeze({
    key: placement.key,
    index: placement.index,
    sourceIndex: placement.index,
    shapedOrigin,
    drawnOrigin,
    originalMatrix,
    localQuad,
    localInkBounds,
    localAdvanceBounds,
    geometry,
    anchorPoint: point,
  });
}

function readGeometryScalar(
  payload: PortableGeometryPayload,
  accessor: PortableGeometryPayload['accessors'][number],
  index: number,
  component: number,
): number {
  const view = payload.views[accessor.view];
  if (view === undefined) throw new Error(`portable geometry accessor ${accessor.view} view is missing`);
  const offset = payload.bytes.byteOffset + view.offset + (accessor.offset ?? 0);
  const scalarOffset = offset + (index * accessor.components + component) * componentByteLength(accessor.componentType);
  const data = new DataView(payload.bytes.buffer, scalarOffset, componentByteLength(accessor.componentType));
  if (accessor.componentType === 'f32') return data.getFloat32(0, true);
  if (accessor.componentType === 'u32') return data.getUint32(0, true);
  if (accessor.componentType === 'i16') return data.getInt16(0, true);
  if (accessor.componentType === 'u16') return data.getUint16(0, true);
  return data.getUint8(0);
}

function readGeometryIndices(
  payload: PortableGeometryPayload,
  accessorIndex: number,
  range: Readonly<{ start: number; count: number }>,
): number[] {
  const accessor = payload.accessors[accessorIndex];
  if (accessor === undefined) throw new Error('portable geometry index accessor is missing');
  const indices = new Array<number>(range.count);
  for (let index = 0; index < range.count; index += 1)
    indices[index] = readGeometryScalar(payload, accessor, range.start + index, 0);
  return indices;
}

function triangleStripIndices(source: readonly number[]): number[] {
  const indices: number[] = [];
  for (let index = 0; index < source.length - 2; index += 1) {
    const first = source[index]!;
    const second = source[index + 1]!;
    const third = source[index + 2]!;
    if (index % 2 === 0) indices.push(first, second, third);
    else indices.push(second, first, third);
  }
  return indices;
}

function componentByteLength(componentType: PortableGeometryPayload['accessors'][number]['componentType']): number {
  if (componentType === 'f32' || componentType === 'u32') return 4;
  if (componentType === 'i16' || componentType === 'u16') return 2;
  return 1;
}

function paragraphBox(box: LayoutBox): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(box.x, -(box.y + box.height), 0),
    new THREE.Vector3(box.x + box.width, -box.y, 0),
  );
}

function quadFromBox(box: THREE.Box3): readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] {
  return [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
  ];
}

function axisPoint(min: number, max: number, axis: GlyphAnchorAxis): number {
  if (axis === 'min') return min;
  if (axis === 'max') return max;
  return (min + max) / 2;
}
