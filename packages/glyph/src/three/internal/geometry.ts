import * as THREE from 'three/webgpu';

import type { PortableGeometryPayload } from '../../core.js';
import { createSuppliedGlyphGeometrySource, type ThreeGlyphGeometrySource } from '../glyph-measurement.js';
import type { ThreeHostResource } from './render-state.js';

export type DrawGeometry =
  | Readonly<{ kind: 'synthetic-quad'; key: 'synthetic-quad' }>
  | Readonly<{
      kind: 'supplied';
      key: string;
      geometryKind: 'quad' | 'hull' | 'custom';
      coordinates: 'unit-square' | 'em';
      resourceName: string;
      payload: PortableGeometryPayload;
    }>;

const syntheticQuadGeometry: DrawGeometry = Object.freeze({ kind: 'synthetic-quad', key: 'synthetic-quad' });

export function resolveDrawGeometry(resource: ThreeHostResource | undefined): DrawGeometry {
  const declaration =
    resource?.program !== undefined
      ? (resource.program.schema.render?.geometry ?? { kind: 'synthetic-quad' as const })
      : { kind: 'synthetic-quad' as const };
  if (declaration.kind === 'synthetic-quad') return syntheticQuadGeometry;
  if (resource === undefined || !('resources' in resource) || declaration.resource === undefined) {
    throw new Error(`supplied Three geometry "${declaration.kind}" has no named portable resource`);
  }
  const payload = resource.resources.get(declaration.resource);
  if (payload?.kind !== 'geometry') {
    throw new Error(`Three draw omits supplied geometry resource "${declaration.resource}"`);
  }
  const range = geometryDrawRange(payload);
  const indexCount = payload.indices === undefined ? 0 : payload.accessors[payload.indices.accessor]!.count;
  return {
    kind: 'supplied',
    geometryKind: declaration.kind,
    coordinates: declaration.coordinates,
    resourceName: declaration.resource,
    payload,
    key: [
      'supplied',
      declaration.kind,
      declaration.coordinates,
      payload.topology,
      indexCount,
      range.start,
      range.count,
    ].join(':'),
  };
}

export function createGeometrySource(drawGeometry: DrawGeometry): ThreeGlyphGeometrySource | undefined {
  if (drawGeometry.kind === 'synthetic-quad') return undefined;
  return createSuppliedGlyphGeometrySource(drawGeometry.payload, drawGeometry.geometryKind, drawGeometry.coordinates);
}

export function realizeGeometry(drawGeometry: DrawGeometry, recordCount: number): THREE.BufferGeometry {
  if (drawGeometry.kind === 'synthetic-quad') {
    const geometry = unitQuad();
    geometry.instanceCount = recordCount;
    return geometry;
  }
  const geometry = createGeometry(drawGeometry.payload);
  updateGeometryInstances(geometry, recordCount);
  return geometry;
}

export function updateGeometryInstances(geometry: THREE.BufferGeometry, recordCount: number): void {
  if (!(geometry instanceof THREE.InstancedBufferGeometry)) {
    throw new TypeError('instanced text draw lost its instanced geometry');
  }
  geometry.instanceCount = recordCount;
}

function createGeometry(payload: PortableGeometryPayload): THREE.BufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  for (const attribute of payload.attributes) {
    const accessor = payload.accessors[attribute.accessor];
    if (accessor === undefined) throw new Error(`geometry attribute "${attribute.semantic}" has no accessor`);
    const view = payload.views[accessor.view];
    if (view === undefined) throw new Error(`geometry accessor ${attribute.accessor} has no buffer view`);
    geometry.setAttribute(attribute.semantic, new THREE.BufferAttribute(typedGeometryArray(payload, accessor, view), accessor.components));
  }
  let indices: Uint16Array | Uint32Array | undefined;
  if (payload.indices !== undefined) {
    const accessor = payload.accessors[payload.indices.accessor];
    if (accessor === undefined) throw new Error('geometry index accessor is missing');
    const view = payload.views[accessor.view];
    if (view === undefined) throw new Error('geometry index buffer view is missing');
    const array = typedGeometryArray(payload, accessor, view);
    if (!(array instanceof Uint16Array) && !(array instanceof Uint32Array)) {
      throw new TypeError('geometry indices require u16 or u32 storage');
    }
    indices = array;
  }
  const positionAttribute = payload.attributes.find((attribute) => attribute.semantic === 'position');
  if (positionAttribute === undefined) throw new TypeError('portable geometry is missing its position attribute');
  const positionAccessor = payload.accessors[positionAttribute.accessor];
  if (positionAccessor === undefined) throw new Error('portable geometry position accessor is missing');
  const range = geometryDrawRange(payload);
  if (payload.topology === 'triangle-strip') {
    geometry.setIndex(new THREE.BufferAttribute(triangleStripIndices(indices, positionAccessor.count, range), 1));
  } else if (indices !== undefined) {
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  }
  geometry.setDrawRange(payload.topology === 'triangle-strip' ? 0 : range.start, geometryDrawCount(payload));
  return geometry;
}

function geometryDrawRange(payload: PortableGeometryPayload): Readonly<{ start: number; count: number }> {
  if (payload.drawRange !== undefined) return payload.drawRange;
  const position = payload.attributes.find((attribute) => attribute.semantic === 'position');
  if (position === undefined) throw new TypeError('portable geometry is missing its position attribute');
  const count =
    payload.indices === undefined
      ? payload.accessors[position.accessor]!.count
      : payload.accessors[payload.indices.accessor]!.count;
  return { start: 0, count };
}

function geometryDrawCount(payload: PortableGeometryPayload): number {
  const count = geometryDrawRange(payload).count;
  return payload.topology === 'triangle-strip' ? (count - 2) * 3 : count;
}

function triangleStripIndices(
  source: Uint16Array | Uint32Array | undefined,
  vertexCount: number,
  range: Readonly<{ start: number; count: number }>,
): Uint16Array | Uint32Array {
  const triangles = new Array<number>((range.count - 2) * 3);
  let maximum = 0;
  for (let triangle = 0; triangle < range.count - 2; triangle += 1) {
    const first = source?.[range.start + triangle] ?? range.start + triangle;
    const second = source?.[range.start + triangle + 1] ?? range.start + triangle + 1;
    const third = source?.[range.start + triangle + 2] ?? range.start + triangle + 2;
    const offset = triangle * 3;
    triangles[offset] = triangle % 2 === 0 ? first : second;
    triangles[offset + 1] = triangle % 2 === 0 ? second : first;
    triangles[offset + 2] = third;
    maximum = Math.max(maximum, first, second, third);
  }
  return maximum < 0x1_0000 && vertexCount < 0x1_0000 ? new Uint16Array(triangles) : new Uint32Array(triangles);
}

function typedGeometryArray(
  payload: PortableGeometryPayload,
  accessor: PortableGeometryPayload['accessors'][number],
  view: PortableGeometryPayload['views'][number],
): Float32Array | Uint32Array | Uint16Array | Int16Array | Uint8Array {
  const offset = payload.bytes.byteOffset + view.offset + (accessor.offset ?? 0);
  const length = accessor.count * accessor.components;
  if (accessor.componentType === 'f32') return new Float32Array(payload.bytes.buffer, offset, length);
  if (accessor.componentType === 'u32') return new Uint32Array(payload.bytes.buffer, offset, length);
  if (accessor.componentType === 'u16') return new Uint16Array(payload.bytes.buffer, offset, length);
  if (accessor.componentType === 'i16') return new Int16Array(payload.bytes.buffer, offset, length);
  return new Uint8Array(payload.bytes.buffer, offset, length);
}

function unitQuad(): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0], 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
  return geometry;
}
