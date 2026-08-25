/** Canonical indexed triangle-list unit quad for portable-resource contract tests. */

export function indexedQuadGeometry() {
  const bytes = new Uint8Array(92);
  bytes.set(new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]).buffer), 0);
  bytes.set(new Uint8Array(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]).buffer), 48);
  bytes.set(new Uint8Array(new Uint16Array([0, 1, 2, 0, 2, 3]).buffer), 80);
  return {
    kind: 'geometry',
    topology: 'triangle-list',
    bytes,
    views: [
      { offset: 0, length: 80 },
      { offset: 80, length: 12 },
    ],
    accessors: [
      { componentType: 'f32', components: 3, view: 0, offset: 0, count: 4 },
      { componentType: 'f32', components: 2, view: 0, offset: 48, count: 4 },
      { componentType: 'u16', components: 1, view: 1, offset: 0, count: 6 },
    ],
    attributes: [
      { semantic: 'position', accessor: 0 },
      { semantic: 'uv', accessor: 1 },
    ],
    indices: { accessor: 2 },
  };
}
