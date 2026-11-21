import * as THREE from 'three/webgpu';

import type { PortableBufferPayload, PortableResourceGroupPayload } from '../../config/resources.js';
import { MSDF_GLYPH_TABLE_STRIDE } from '../../raster/msdf.js';
import { atlasTextureArray, f32BufferMember, f32x3BufferMember, textureArrayMember } from './portable-resource.js';
import type { RetainedMsdfAtlas } from './renderer-resources.js';

export type { RetainedMsdfAtlas } from './renderer-resources.js';

/** Texels per row of the glyph table texture; a font's rows wrap at this width. */
const GLYPH_TABLE_WIDTH = 1024;

/** Realizes one MSDF font resource group as its atlas texture and glyph table. */
export function createMsdfAtlas(group: PortableResourceGroupPayload): RetainedMsdfAtlas {
  const data = textureArrayMember(group, 'texture', 'rgba8unorm', 'MSDF');
  const pixelRange = f32BufferMember(group, 'pixelRange', 'MSDF');
  const effectScale = f32x3BufferMember(group, 'effectScale', 'MSDF');
  const table = glyphTable(group.members.glyphs);
  const texture = atlasTextureArray(data.bytes, data.width, data.height, data.layers, THREE.RGBAFormat);
  const glyphs = new THREE.DataTexture(table.texels, table.width, table.height, THREE.RGBAFormat, THREE.FloatType);
  glyphs.colorSpace = THREE.NoColorSpace;
  glyphs.flipY = false;
  glyphs.generateMipmaps = false;
  glyphs.minFilter = THREE.NearestFilter;
  glyphs.magFilter = THREE.NearestFilter;
  glyphs.needsUpdate = true;
  return {
    texture,
    glyphs,
    glyphsWidth: table.width,
    metrics: new THREE.Vector4(data.width, data.height, pixelRange, effectScale[2]),
    byteLength: data.bytes.byteLength + table.texels.byteLength,
    dispose() {
      texture.dispose();
      glyphs.dispose();
    },
  };
}

function glyphTable(payload: PortableResourceGroupPayload['members'][string] | undefined): {
  readonly texels: Float32Array;
  readonly width: number;
  readonly height: number;
} {
  if (payload?.kind !== 'buffer' || payload.stride !== MSDF_GLYPH_TABLE_STRIDE * 4) {
    throw new TypeError('MSDF resource group needs a glyph table buffer member "glyphs"');
  }
  const rows = payload.bytes.byteLength / payload.stride;
  const width = Math.min(GLYPH_TABLE_WIDTH, Math.max(1, rows));
  const height = Math.max(1, Math.ceil(rows / width));
  const texels = new Float32Array(width * height * MSDF_GLYPH_TABLE_STRIDE);
  texels.set(tableValues(payload));
  return { texels, width, height };
}

function tableValues(payload: PortableBufferPayload): Float32Array {
  const copy = payload.bytes.slice();
  return new Float32Array(copy.buffer, 0, copy.byteLength / 4);
}
