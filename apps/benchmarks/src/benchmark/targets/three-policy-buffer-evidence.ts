import type { BufferAttribute, BufferGeometry, InterleavedBufferAttribute } from 'three/webgpu';
import type { PolicyBufferId } from '@pmndrs/glyph';

/** Convert one policy-buffer identity to Three's geometry attribute key. */
export function policyAttributeName(id: PolicyBufferId): string {
  return `_pmndrsGlyph_${id}`;
}

/** Read one realized policy buffer by its exact identity. */
export function policyAttribute(
  geometry: BufferGeometry,
  name: string,
): BufferAttribute | InterleavedBufferAttribute | undefined {
  return geometry.getAttribute(name);
}

/** Require one realized policy buffer by its exact identity. */
export function requiredPolicyAttribute(
  geometry: BufferGeometry,
  name: string,
  label: string,
): BufferAttribute | InterleavedBufferAttribute {
  const attribute = policyAttribute(geometry, name);
  if (attribute === undefined) throw new Error(`${label} is missing policy attribute "${name}"`);
  return attribute;
}
