import * as THREE from 'three/webgpu';

import type { PortableGeometryPayload } from '../config/resources.js';
import type { GlyphKey, GlyphPlacement, GlyphPlacements } from '../glyph-placement.js';
import type { GlyphLayoutColumns, LayoutPoint } from '../layout.js';

export type GlyphAnchorAxis = 'min' | 'center' | 'max';

export interface GlyphAnchor {
  readonly x: GlyphAnchorAxis;
  readonly y: GlyphAnchorAxis;
  readonly z?: GlyphAnchorAxis;
}

/** The coordinate system used by a retained renderer geometry source. */
export type ThreeGlyphGeometryCoordinates = 'glyph-local' | 'unit-square' | 'em';

/** `metric-quad` is glyph-local (+X right, +Y up), relative to the pen origin; `supplied` uses the declared source coordinates. Neither defines a collision body. */
export interface ThreeGlyphGeometrySource {
  readonly kind: 'metric-quad' | 'supplied';
  readonly geometryKind?: 'quad' | 'hull' | 'custom';
  readonly coordinates: ThreeGlyphGeometryCoordinates;
  readonly positions: readonly THREE.Vector3[];
  readonly indices: readonly number[];
  readonly bounds: THREE.Box3;
}

/** A desired Text query or original detached snapshot; owner-local fields use native Three axes and include the anchor. */
export interface ThreeGlyphMeasurement {
  readonly key: GlyphKey;
  /** Index in the returned measurement array; dense drawable index for a detached `Glyphs` object. */
  readonly index: number;
  /** Shaped pen origin in owner-local Three coordinates (+X right, +Y up), anchor included. */
  readonly shapedOrigin: THREE.Vector3;
  /** Drawn pen origin in owner-local Three coordinates (+X right, +Y up), anchor included. */
  readonly drawnOrigin: THREE.Vector3;
  /** Maps glyph-pen-local Three coordinates (+X right, +Y up) into owner-local coordinates, anchor included. This original snapshot does not follow instance writes. */
  readonly originalMatrix: THREE.Matrix4;
  /** Original owner-local Three quad (+X right, +Y up), anchor included. */
  readonly localQuad: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
  /** Original ink bounds in owner-local Three coordinates (+X right, +Y up), anchor included. */
  readonly localInkBounds: THREE.Box3;
  /** Original advance bounds in owner-local Three coordinates (+X right, +Y up), anchor included. */
  readonly localAdvanceBounds: THREE.Box3;
  /** Glyph-local metric quad (+X right, +Y up), or supplied geometry in its declared coordinates; not owner-local bounds. */
  readonly geometry: ThreeGlyphGeometrySource;
  /** Resolves a point in original owner-local Three bounds (+X right, +Y up), anchor included. */
  anchorPoint(anchor: GlyphAnchor, bounds?: 'ink' | 'advance'): THREE.Vector3;
}

/** Builds owner-local Three measurements from one desired placement snapshot and its captured anchor. */
export function measureGlyphPlacements(
  placements: GlyphPlacements,
  geometryByIndex: ReadonlyMap<number, ThreeGlyphGeometrySource> = new Map(),
  offset: LayoutPoint = { x: 0, y: 0 },
): readonly ThreeGlyphMeasurement[] {
  const translation = offset.x === 0 && offset.y === 0 ? undefined : new THREE.Vector3(offset.x, -offset.y, 0);
  const measurements = placements.glyphs.map((placement) =>
    measureGlyph(placement, geometryByIndex.get(placement.index), offset, translation),
  );
  return Object.freeze(measurements);
}

/**
 * Builds the same measurements as {@link measureGlyphPlacements} straight from inspection columns and drawn origins,
 * without the placement, word and line objects a caret or selection query needs.
 */
export function measureGlyphLayout(
  layout: GlyphLayoutColumns,
  drawnX: Float32Array,
  drawnY: Float32Array,
  geometryByIndex: ReadonlyMap<number, ThreeGlyphGeometrySource>,
  offset: LayoutPoint,
): readonly ThreeGlyphMeasurement[] {
  const glyphCount = layout.glyphCount;
  const translation = offset.x === 0 && offset.y === 0 ? undefined : new THREE.Vector3(offset.x, -offset.y, 0);
  const lineOfGlyph = new Uint32Array(glyphCount);
  for (let line = 0; line < layout.lineCount; line += 1) {
    const start = layout.lineGlyphStarts[line]!;
    const end = Math.min(start + layout.lineGlyphCounts[line]!, glyphCount);
    for (let index = start; index < end; index += 1) lineOfGlyph[index] = line;
  }
  // A key counts earlier glyphs with the same font, glyph id and cluster; chaining glyphs by cluster finds them
  // without a string per glyph.
  const lastOfCluster = new Map<number, number>();
  const previousOfCluster = new Int32Array(glyphCount);
  const measurements = new Array<ThreeGlyphMeasurement>(glyphCount);
  for (let index = 0; index < glyphCount; index += 1) {
    const fontSlot = layout.glyphFontSlots[index]!;
    const glyphId = layout.glyphIds[index]!;
    const cluster = layout.clusters[index]!;
    const previous = lastOfCluster.get(cluster) ?? -1;
    previousOfCluster[index] = previous;
    lastOfCluster.set(cluster, index);
    let occurrence = 0;
    for (let earlier = previous; earlier !== -1; earlier = previousOfCluster[earlier]!) {
      if (layout.glyphFontSlots[earlier] === fontSlot && layout.glyphIds[earlier] === glyphId) occurrence += 1;
    }
    const metrics = layout.lines[lineOfGlyph[index]!];
    const shapedX = layout.x[index]!;
    const shapedY = layout.y[index]!;
    const x = drawnX[index]!;
    const y = drawnY[index]!;
    measurements[index] = measureGlyphBoxes(
      `${layout.fontHandles[fontSlot]!}:${glyphId}:${cluster}:${occurrence}` as GlyphKey,
      index,
      shapedX,
      shapedY,
      x,
      y,
      // Ink is published around the shaped origin, so a moved glyph carries it by the same delta.
      x + (layout.glyphInkX[index]! - shapedX),
      y + (layout.glyphInkY[index]! - shapedY),
      layout.glyphInkWidths[index]!,
      layout.glyphInkHeights[index]!,
      y - (metrics?.ascent ?? 0),
      layout.glyphAdvances[index]!,
      metrics?.lineHeight ?? 0,
      geometryByIndex.get(index),
      offset,
      translation,
    );
  }
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
  offset: LayoutPoint,
  translation: THREE.Vector3 | undefined,
): ThreeGlyphMeasurement {
  const ink = placement.ink;
  const bounds = placement.bounds;
  return measureGlyphBoxes(
    placement.key,
    placement.index,
    placement.shapedX,
    placement.shapedY,
    placement.x,
    placement.y,
    ink.x,
    ink.y,
    ink.width,
    ink.height,
    bounds.y,
    bounds.width,
    bounds.height,
    suppliedGeometry,
    offset,
    translation,
  );
}

/** One measurement from paragraph-space boxes (+Y down): ink, and an advance box that starts at the drawn x. */
function measureGlyphBoxes(
  key: GlyphKey,
  index: number,
  shapedX: number,
  shapedY: number,
  drawnX: number,
  drawnY: number,
  inkX: number,
  inkY: number,
  inkWidth: number,
  inkHeight: number,
  advanceY: number,
  advanceWidth: number,
  advanceHeight: number,
  suppliedGeometry: ThreeGlyphGeometrySource | undefined,
  offset: LayoutPoint,
  translation: THREE.Vector3 | undefined,
): ThreeGlyphMeasurement {
  const localInkBounds = paragraphBox(inkX, inkY, inkWidth, inkHeight);
  const localAdvanceBounds = paragraphBox(drawnX, advanceY, advanceWidth, advanceHeight);
  if (translation !== undefined) {
    localInkBounds.translate(translation);
    localAdvanceBounds.translate(translation);
  }
  const localQuad = quadFromBox(localInkBounds);
  const shapedOrigin = new THREE.Vector3(shapedX + offset.x, -(shapedY + offset.y), 0);
  const drawnOrigin = new THREE.Vector3(drawnX + offset.x, -(drawnY + offset.y), 0);
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
    key,
    index,
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

function paragraphBox(x: number, y: number, width: number, height: number): THREE.Box3 {
  return new THREE.Box3(new THREE.Vector3(x, -(y + height), 0), new THREE.Vector3(x + width, -y, 0));
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
