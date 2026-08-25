import { definePortableVertexSemantic, type PortableGeometryPayload } from '../../dist/core.js';

const geometry = {
  kind: 'geometry',
  topology: 'triangle-list',
  bytes: new Uint8Array(12),
  views: [{ offset: 0, length: 12 }],
  accessors: [{ componentType: 'f32', components: 3, view: 0, count: 1 }],
} as const;

const suppliedGeometry: PortableGeometryPayload = {
  ...geometry,
  attributes: [{ semantic: 'position', accessor: 0 }],
};
void suppliedGeometry;

const instanceMetadata = {
  ...geometry,
  attributes: [{ semantic: 'position', accessor: 0 }],
  instances: { source: 'records' },
} as const;

// @ts-expect-error The plan record span is the sole instance-count authority.
const impossibleInstances: PortableGeometryPayload = instanceMetadata;
void impossibleInstances;

const instanceAttribute = {
  ...geometry,
  attributes: [
    { semantic: 'position', accessor: 0 },
    { semantic: 'seed', accessor: 0, rate: 'instance' },
  ],
} as const;

// @ts-expect-error Per-record data belongs in named policy buffers, not finite geometry streams.
const impossibleAttribute: PortableGeometryPayload = instanceAttribute;
void impossibleAttribute;

const unsafeSemantic = {
  ...geometry,
  attributes: [{ semantic: '__proto__', accessor: 0 }],
} as const;
// @ts-expect-error Unvalidated strings cannot become renderer attribute keys.
const impossibleSemantic: PortableGeometryPayload = unsafeSemantic;
void impossibleSemantic;

const customSemantic = definePortableVertexSemantic('curveIndex');
const customGeometry: PortableGeometryPayload = {
  ...geometry,
  attributes: [
    { semantic: 'position', accessor: 0 },
    { semantic: customSemantic, accessor: 0 },
  ],
};
void customGeometry;

const oversizedComponents = {
  ...geometry,
  accessors: [{ componentType: 'f32', components: 9, view: 0, count: 1 }],
  attributes: [{ semantic: 'position', accessor: 0 }],
} as const;
// @ts-expect-error Geometry accessors have one to four scalar components.
const impossibleComponents: PortableGeometryPayload = oversizedComponents;
void impossibleComponents;
