import * as THREE from 'three/webgpu';

import type { PortableResourceGroupPayload, PortableTextureArrayPayload } from '../../config/resources.js';
import { MSDF_GLYPH_TABLE_LAYER_STEP, MSDF_GLYPH_TABLE_STRIDE } from '../../raster/msdf.js';
import { atlasTextureArray, f32BufferMember, f32x3BufferMember, textureArrayMember } from './portable-resource.js';
import type { RetainedMsdfAtlas } from './renderer-resources.js';

export type { RetainedMsdfAtlas } from './renderer-resources.js';

/** Texels per row of the glyph table texture; a font's rows wrap at this width. */
const GLYPH_TABLE_WIDTH = 1024;
/** Edge of one resident atlas layer in texels, unless a single baked cell is larger. */
const RESIDENT_PAGE_SIZE = 256;
const TEXEL_BYTES = 4;

/**
 * Realizes one MSDF font resource group as a resident atlas that starts empty.
 *
 * The baked pages stay on the CPU. A glyph's cell is copied into a resident layer the first time an instance of it
 * is published, and its table row is pointed there; GPU memory follows the glyphs drawn, not the glyphs baked. Cells
 * are shelf-packed in arrival order and never move or leave, so a row written once stays valid.
 */
export function createMsdfAtlas(group: PortableResourceGroupPayload): RetainedMsdfAtlas {
  const baked = textureArrayMember(group, 'texture', 'rgba8unorm', 'MSDF');
  const pixelRange = f32BufferMember(group, 'pixelRange', 'MSDF');
  const effectScale = f32x3BufferMember(group, 'effectScale', 'MSDF');
  const cells = bakedCells(group.members.glyphs);
  const rows = cells.length / MSDF_GLYPH_TABLE_STRIDE;
  const page = residentPageSize(cells, baked);

  const tableWidth = Math.min(GLYPH_TABLE_WIDTH, Math.max(1, rows));
  const tableHeight = Math.max(1, Math.ceil(rows / tableWidth));
  const table = new Float32Array(tableWidth * tableHeight * MSDF_GLYPH_TABLE_STRIDE);
  const glyphs = new THREE.DataTexture(table, tableWidth, tableHeight, THREE.RGBAFormat, THREE.FloatType);
  glyphs.colorSpace = THREE.NoColorSpace;
  glyphs.flipY = false;
  glyphs.generateMipmaps = false;
  glyphs.minFilter = THREE.NearestFilter;
  glyphs.magFilter = THREE.NearestFilter;
  glyphs.needsUpdate = true;

  const layerBytes = page * page * TEXEL_BYTES;
  let texels = new Uint8Array(layerBytes);
  const texture = atlasTextureArray(texels, page, page, 1, THREE.RGBAFormat);
  const resident = new Uint8Array(rows);
  // The open shelf: the next cell goes at (penX, shelfTop) on `layer`; the shelf is as tall as its tallest cell.
  let layer = 0;
  let penX = 0;
  let shelfTop = 0;
  let shelfHeight = 0;

  const addLayer = (): void => {
    layer += 1;
    penX = 0;
    shelfTop = 0;
    shelfHeight = 0;
    const grown = new Uint8Array((layer + 1) * layerBytes);
    grown.set(texels);
    texels = grown;
    // A layered texture cannot gain a layer in place: release the GPU copy and let the next frame rebuild it.
    texture.dispose();
    texture.image = { data: texels, width: page, height: page, depth: layer + 1 };
    // Three uploads only the layers marked since its last upload, so the rebuilt texture needs every one of them.
    for (let index = 0; index <= layer; index += 1) texture.addLayerUpdate(index);
    texture.needsUpdate = true;
  };

  const admit = (row: number): void => {
    resident[row] = 1;
    const source = row * MSDF_GLYPH_TABLE_STRIDE;
    const width = cells[source + 2]!;
    const packedHeight = cells[source + 3]!;
    const sourceLayer = Math.floor(packedHeight / MSDF_GLYPH_TABLE_LAYER_STEP);
    const height = packedHeight - sourceLayer * MSDF_GLYPH_TABLE_LAYER_STEP;
    if (width === 0 || height === 0) return;
    if (penX + width > page) {
      penX = 0;
      shelfTop += shelfHeight;
      shelfHeight = 0;
    }
    if (shelfTop + height > page) addLayer();
    const sourceLeft = cells[source]!;
    const sourceTop = cells[source + 1]!;
    for (let line = 0; line < height; line += 1) {
      const from = ((sourceLayer * baked.height + sourceTop + line) * baked.width + sourceLeft) * TEXEL_BYTES;
      const to = ((layer * page + shelfTop + line) * page + penX) * TEXEL_BYTES;
      texels.set(baked.bytes.subarray(from, from + width * TEXEL_BYTES), to);
    }
    table[source] = penX;
    table[source + 1] = shelfTop;
    table[source + 2] = width;
    table[source + 3] = height + layer * MSDF_GLYPH_TABLE_LAYER_STEP;
    penX += width;
    shelfHeight = Math.max(shelfHeight, height);
    texture.addLayerUpdate(layer);
    texture.needsUpdate = true;
    glyphs.needsUpdate = true;
  };

  return {
    texture,
    glyphs,
    glyphsWidth: tableWidth,
    metrics: new THREE.Vector4(page, page, pixelRange, effectScale[2]),
    get byteLength() {
      return texels.byteLength + table.byteLength;
    },
    use(lane, start, end, stride) {
      for (let offset = start * stride + stride - 1; offset < end * stride; offset += stride) {
        const row = lane[offset]!;
        if (row < rows && resident[row] === 0) admit(row);
      }
    },
    dispose() {
      texture.dispose();
      glyphs.dispose();
    },
  };
}

/** The baked table: where each glyph's cell sits in the baked pages. */
function bakedCells(payload: PortableResourceGroupPayload['members'][string] | undefined): Float32Array {
  if (payload?.kind !== 'buffer' || payload.stride !== MSDF_GLYPH_TABLE_STRIDE * 4) {
    throw new TypeError('MSDF resource group needs a glyph table buffer member "glyphs"');
  }
  const copy = payload.bytes.slice();
  return new Float32Array(copy.buffer, 0, copy.byteLength / 4);
}

/** A resident layer must hold the largest baked cell; fonts baked at a large em size get larger layers. */
function residentPageSize(cells: Float32Array, baked: PortableTextureArrayPayload): number {
  let largest = 0;
  for (let source = 0; source < cells.length; source += MSDF_GLYPH_TABLE_STRIDE) {
    largest = Math.max(largest, cells[source + 2]!, cells[source + 3]! % MSDF_GLYPH_TABLE_LAYER_STEP);
  }
  let page = RESIDENT_PAGE_SIZE;
  while (page < largest) page *= 2;
  return Math.min(page, Math.max(baked.width, baked.height));
}
