import type { BufferAttribute, BufferGeometry, InterleavedBufferAttribute } from 'three/webgpu';

/** Resolve one realized policy buffer by its declared physical shape without depending on renderer-owned IDs. */
export function requiredPolicyAttribute(
  geometry: BufferGeometry,
  scalar: 'f32' | 'u32',
  vectorWidth: number,
  label: string,
): BufferAttribute | InterleavedBufferAttribute {
  const ArrayType = scalar === 'f32' ? Float32Array : Uint32Array;
  const matches = Object.entries(geometry.attributes).filter(
    ([name, attribute]) =>
      name !== '_pmndrsGlyphTransforms' && attribute.itemSize === vectorWidth && attribute.array instanceof ArrayType,
  );
  if (matches.length !== 1) {
    throw new Error(
      `${label} needs exactly one realized ${scalar}x${vectorWidth} policy buffer, found ${matches.length}`,
    );
  }
  return matches[0]![1];
}
