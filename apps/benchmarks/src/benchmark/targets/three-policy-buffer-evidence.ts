import type { BufferAttribute, BufferGeometry, InterleavedBufferAttribute } from 'three/webgpu';
import type { CodecBufferId } from '@pmndrs/glyph';

/** Convert one Codec-buffer identity to Three's geometry attribute key. */
export function codecAttributeName(id: CodecBufferId): string {
  return `_pmndrsGlyph_${id}`;
}

/** Read one realized Codec buffer by its exact identity. */
export function codecAttribute(
  geometry: BufferGeometry,
  name: string,
): BufferAttribute | InterleavedBufferAttribute | undefined {
  return geometry.getAttribute(name);
}

/** Require one realized Codec buffer by its exact identity. */
export function requiredCodecAttribute(
  geometry: BufferGeometry,
  name: string,
  label: string,
): BufferAttribute | InterleavedBufferAttribute {
  const attribute = codecAttribute(geometry, name);
  if (attribute === undefined) throw new Error(`${label} is missing Codec attribute "${name}"`);
  return attribute;
}
