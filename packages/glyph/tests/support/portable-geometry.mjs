/**
 * Canonical GLB-like fixtures for portable-resource contract tests: an indexed
 * triangle-list unit quad plus an instance-rate variant carrying one element per
 * drawn instance alongside its four vertices.
 */

export function indexedQuadGeometry() {
  const bytes = new Uint8Array(76);
  bytes.set(new Uint8Array(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]).buffer), 0);
  bytes.set(new Uint8Array(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]).buffer), 32);
  bytes.set(new Uint8Array(new Uint16Array([0, 1, 2, 0, 2, 3]).buffer), 64);
  return {
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
  };
}

export function instancedQuadGeometry() {
  const geometry = indexedQuadGeometry();
  const seeds = new Uint32Array([7, 11, 13, 17, 19]);
  const bytes = new Uint8Array(geometry.bytes.length + seeds.byteLength);
  bytes.set(geometry.bytes, 0);
  bytes.set(new Uint8Array(seeds.buffer), geometry.bytes.length);
  return {
    ...geometry,
    bytes,
    views: [...geometry.views, { offset: geometry.bytes.length, length: seeds.byteLength }],
    accessors: [...geometry.accessors, { componentType: 'u32', components: 1, view: 2, offset: 0, count: 5 }],
    attributes: [...geometry.attributes, { semantic: 'seed', accessor: 3, rate: 'instance' }],
  };
}
