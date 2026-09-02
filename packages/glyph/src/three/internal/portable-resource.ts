import * as THREE from 'three/webgpu';

import type { PortableResourceGroupPayload, PortableTextureArrayPayload, PortableTexturePayload } from '../../index.js';
import type { ThreeHostResource } from './render-state.js';

export function textureArrayResource(
  resource: ThreeHostResource,
  name: string,
  format: PortableTextureArrayPayload['format'],
  label: string,
): PortableTextureArrayPayload {
  const payload = resource.resources.get(name);
  if (payload?.kind !== 'texture-array' || payload.format !== format) {
    throw new TypeError(`${label} draw needs ${format} texture-array resource "${name}"`);
  }
  return payload;
}

export function resourceGroup(resource: ThreeHostResource, name: string, label: string): PortableResourceGroupPayload {
  const payload = resource.resources.get(name);
  if (payload?.kind !== 'group') throw new TypeError(`${label} draw needs resource group "${name}"`);
  return payload;
}

export function textureMember(
  group: PortableResourceGroupPayload,
  name: string,
  format: PortableTexturePayload['format'],
  label: string,
): PortableTexturePayload {
  const payload = group.members[name];
  if (payload?.kind !== 'texture' || payload.format !== format) {
    throw new TypeError(`${label} resource group needs ${format} texture member "${name}"`);
  }
  return payload;
}

export function textureArrayMember(
  group: PortableResourceGroupPayload,
  name: string,
  format: PortableTextureArrayPayload['format'],
  label: string,
): PortableTextureArrayPayload {
  const payload = group.members[name];
  if (payload?.kind !== 'texture-array' || payload.format !== format) {
    throw new TypeError(`${label} resource group needs ${format} texture-array member "${name}"`);
  }
  return payload;
}

export function f32BufferMember(group: PortableResourceGroupPayload, name: string, label: string): number {
  const payload = group.members[name];
  if (payload?.kind !== 'buffer' || payload.stride !== 4 || payload.bytes.byteLength !== 4) {
    throw new TypeError(`${label} resource group needs one f32 buffer member "${name}"`);
  }
  const value = new DataView(payload.bytes.buffer, payload.bytes.byteOffset, 4).getFloat32(0, true);
  if (!Number.isFinite(value)) throw new TypeError(`${label} resource group member "${name}" needs a finite f32`);
  return value;
}

export function f32x3BufferMember(
  group: PortableResourceGroupPayload,
  name: string,
  label: string,
): readonly [number, number, number] {
  const payload = group.members[name];
  if (payload?.kind !== 'buffer' || payload.stride !== 12 || payload.bytes.byteLength !== 12) {
    throw new TypeError(`${label} resource group needs one f32x3 buffer member "${name}"`);
  }
  const view = new DataView(payload.bytes.buffer, payload.bytes.byteOffset, 12);
  const value = [view.getFloat32(0, true), view.getFloat32(4, true), view.getFloat32(8, true)] as const;
  if (!value.every(Number.isFinite)) throw new TypeError(`${label} resource group member "${name}" needs finite f32s`);
  return value;
}

export function dataTexture(
  data: Uint16Array | Uint32Array,
  width: number,
  height: number,
  format: THREE.PixelFormat,
  type: THREE.TextureDataType,
): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, width, height, format, type);
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

export function ownedUint16(bytes: Uint8Array): Uint16Array {
  const copy = bytes.slice();
  return new Uint16Array(copy.buffer, copy.byteOffset, copy.byteLength / 2);
}

export function ownedUint32(bytes: Uint8Array): Uint32Array {
  const copy = bytes.slice();
  return new Uint32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}
