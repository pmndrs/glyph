import {
  assertPortableResource,
  type PortableGeometryPayload,
  type TechniqueGeometryDeclaration,
} from '@pmndrs/glyph/core';

/** A small indexed GLB-like payload used by the external-engine geometry proof. */
const bytes = new Uint8Array(76);
bytes.set(new Uint8Array(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]).buffer), 0);
bytes.set(new Uint8Array(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]).buffer), 32);
bytes.set(new Uint8Array(new Uint16Array([0, 1, 2, 0, 2, 3]).buffer), 64);

export const glyphExampleSuppliedGeometryDeclaration: TechniqueGeometryDeclaration = Object.freeze({
  kind: 'quad',
  resource: 'glyphGeometry',
  coordinates: 'unit-square',
});

const glyphExampleGeometry: PortableGeometryPayload = {
  kind: 'geometry',
  topology: 'triangle-list',
  bytes,
  views: [
    { offset: 0, length: 64 },
    { offset: 64, length: 12 },
  ],
  accessors: [
    { componentType: 'f32', components: 2, view: 0, offset: 0, count: 4 },
    { componentType: 'f32', components: 2, view: 0, offset: 32, count: 4 },
    { componentType: 'u16', components: 1, view: 1, offset: 0, count: 6 },
  ],
  attributes: [
    { semantic: 'position', accessor: 0 },
    { semantic: 'uv', accessor: 1 },
  ],
  indices: { accessor: 2 },
  drawRange: { start: 0, count: 6 },
  instances: { source: 'records' },
};

const ownedGeometry: PortableGeometryPayload = {
  ...glyphExampleGeometry,
  bytes: new Uint8Array(glyphExampleGeometry.bytes),
  views: Object.freeze(glyphExampleGeometry.views.map((view) => Object.freeze({ ...view }))),
  accessors: Object.freeze(glyphExampleGeometry.accessors.map((accessor) => Object.freeze({ ...accessor }))),
  attributes: Object.freeze(glyphExampleGeometry.attributes.map((attribute) => Object.freeze({ ...attribute }))),
  ...(glyphExampleGeometry.indices === undefined
    ? {}
    : { indices: Object.freeze({ ...glyphExampleGeometry.indices }) }),
  ...(glyphExampleGeometry.drawRange === undefined
    ? {}
    : { drawRange: Object.freeze({ ...glyphExampleGeometry.drawRange }) }),
  ...(glyphExampleGeometry.instances === undefined
    ? {}
    : { instances: Object.freeze({ ...glyphExampleGeometry.instances }) }),
};
assertPortableResource('geometry', 'glyphGeometry', ownedGeometry);
export const glyphExampleIndexedQuadGeometry: PortableGeometryPayload = Object.freeze(ownedGeometry);
