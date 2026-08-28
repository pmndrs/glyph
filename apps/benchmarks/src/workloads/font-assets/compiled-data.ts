import type { Font } from '@pmndrs/glyph';
import type { bitmap, BitmapData, BitmapStrikeData } from '@pmndrs/glyph/raster/bitmap';
import { MSDF_EM_SIZE, type msdf, type MsdfData } from '@pmndrs/glyph/raster/msdf';
import {
  SLUG_GLYPH_RECORD_STRIDE,
  SLUG_PLANE_UNITS_PER_EM,
  type slug,
  type SlugData,
  type SlugPageData,
} from '@pmndrs/glyph/raster/slug';
import {
  compileRasterFont,
  readCompiledRasterFont,
  RenderWireIdentityRegistry,
  resolveRasterPlanProgram,
  type CompiledRasterFontResource,
  type CompiledRasterFontView,
  type PortableResourceGroupPayload,
  type PortableTextureArrayPayload,
  type PortableTexturePayload,
} from '@pmndrs/glyph/core';

const DENSE_GLYPH_RECORD_STRIDE = 20;
const RECONSTRUCTED_PLANE_UNITS_PER_EM = 2_048;
const ABSENT_PAGE = 0xffff;

/** Reconstruct the benchmark Bitmap oracle from the exact portable program consumed by renderers. */
export function compiledBitmapData(font: Font<typeof bitmap>): BitmapData {
  const view = compiledView(font);
  if (view.scope !== 'strike') throw new TypeError('Bitmap compiled binding must use strike scope');
  const resourceIndex = new Map(view.resources.map((resource, index) => [resource.key, index]));
  const strikes: BitmapStrikeData[] = view.strikes.map((ppem, strikeIndex) => {
    const resource = view.resource(0, strikeIndex);
    if (resource === undefined) throw new TypeError(`Bitmap strike ${strikeIndex} has no atlas resource`);
    const atlas = textureArray(resource, 'Bitmap atlas');
    assertTextureArrayFormat(atlas, 'r8unorm', 'Bitmap atlas');
    const records = new Uint8Array(view.glyphCount * DENSE_GLYPH_RECORD_STRIDE);
    const output = new DataView(records.buffer);
    for (let glyph = 0; glyph < view.glyphCount; glyph += 1) {
      const row = strikeIndex * view.glyphCount + glyph;
      const record = glyph * DENSE_GLYPH_RECORD_STRIDE;
      const selected = view.resource(glyph, strikeIndex);
      if (selected === undefined) {
        output.setUint16(record + 16, ABSENT_PAGE, true);
        continue;
      }
      if (resourceIndex.get(selected.key) !== resourceIndex.get(resource.key)) {
        throw new TypeError(`Bitmap strike ${strikeIndex} selected a foreign atlas resource`);
      }
      writeDenseRecord(output, record, view, row, atlas.width, atlas.height, ppem);
    }
    return {
      ppem,
      planeUnitsPerEm: ppem,
      records,
      pages: textureArrayPages(resource, atlas),
    };
  });
  return { strikes };
}

/** Reconstruct the benchmark MTSDF oracle from the exact portable program consumed by renderers. */
export function compiledMsdfData(font: Font<typeof msdf>): MsdfData {
  const view = compiledView(font);
  if (view.scope !== 'glyph' || view.strikes.length !== 1) {
    throw new TypeError('MTSDF compiled binding must use one glyph-scoped strike');
  }
  const resource = view.resources.find(({ payload }) => payload.kind === 'group');
  if (resource === undefined) throw new TypeError('MTSDF compiled binding has no atlas group');
  const group = resourceGroup(resource, 'MTSDF atlas');
  const atlas = groupTextureArray(group, 'texture', 'MTSDF atlas texture');
  assertTextureArrayFormat(atlas, 'rgba8unorm', 'MTSDF atlas texture');
  const pixelRangeBuffer = group.members.pixelRange;
  if (pixelRangeBuffer?.kind !== 'buffer' || pixelRangeBuffer.bytes.byteLength !== 4) {
    throw new TypeError('MTSDF atlas pixelRange must be one f32 value');
  }
  const pixelRange = new DataView(
    pixelRangeBuffer.bytes.buffer,
    pixelRangeBuffer.bytes.byteOffset,
    pixelRangeBuffer.bytes.byteLength,
  ).getFloat32(0, true);
  const records = new Uint8Array(view.glyphCount * DENSE_GLYPH_RECORD_STRIDE);
  const output = new DataView(records.buffer);
  for (let glyph = 0; glyph < view.glyphCount; glyph += 1) {
    const record = glyph * DENSE_GLYPH_RECORD_STRIDE;
    if (view.resource(glyph, 0) === undefined) {
      output.setUint16(record + 16, ABSENT_PAGE, true);
      continue;
    }
    writeDenseRecord(output, record, view, glyph, atlas.width, atlas.height, RECONSTRUCTED_PLANE_UNITS_PER_EM);
  }
  return {
    resource: resource.key,
    binding: { width: atlas.width, height: atlas.height, layers: atlas.layers },
    emSize: MSDF_EM_SIZE,
    pixelRange,
    planeUnitsPerEm: RECONSTRUCTED_PLANE_UNITS_PER_EM,
    records,
    pages: textureArrayPages(resource, atlas),
  };
}

/** Reconstruct the benchmark Slug oracle from the exact portable program consumed by renderers. */
export function compiledSlugData(font: Font<typeof slug>): SlugData {
  const view = compiledView(font);
  if (view.scope !== 'glyph' || view.strikes.length !== 1) {
    throw new TypeError('Slug compiled binding must use one glyph-scoped strike');
  }
  const pages = view.resources.map((resource) => slugPage(resource));
  const pageIndex = new Map(view.resources.map((resource, index) => [resource.key, index]));
  const records = new Uint8Array(view.glyphCount * SLUG_GLYPH_RECORD_STRIDE);
  const output = new DataView(records.buffer);
  for (let glyph = 0; glyph < view.glyphCount; glyph += 1) {
    const record = glyph * SLUG_GLYPH_RECORD_STRIDE;
    const resource = view.resource(glyph, 0);
    if (resource === undefined) {
      output.setUint16(record + 8, ABSENT_PAGE, true);
      continue;
    }
    const selectedPage = pageIndex.get(resource.key);
    if (selectedPage === undefined) throw new TypeError('Slug binding selected an unknown page');
    const left = view.f32('bearingX', glyph);
    const top = view.f32('bearingY', glyph);
    const right = left + view.f32('width', glyph);
    const bottom = top - view.f32('height', glyph);
    output.setInt16(record, planeValue(left, SLUG_PLANE_UNITS_PER_EM, 'Slug left'), true);
    output.setInt16(record + 2, planeValue(bottom, SLUG_PLANE_UNITS_PER_EM, 'Slug bottom'), true);
    output.setInt16(record + 4, planeValue(right, SLUG_PLANE_UNITS_PER_EM, 'Slug right'), true);
    output.setInt16(record + 6, planeValue(top, SLUG_PLANE_UNITS_PER_EM, 'Slug top'), true);
    output.setUint16(record + 8, selectedPage, true);
    output.setUint16(record + 10, u16(view.u32('horizontalBands', glyph), 'Slug horizontal bands'), true);
    output.setUint16(record + 12, u16(view.u32('verticalBands', glyph), 'Slug vertical bands'), true);
    output.setUint32(record + 16, view.u32('curveStart', glyph), true);
    output.setUint32(record + 24, view.u32('headerStart', glyph), true);
    output.setUint32(record + 28, view.u32('referenceStart', glyph), true);
    output.setUint32(record + 32, view.u32('bandStart', glyph), true);
  }
  return { planeUnitsPerEm: SLUG_PLANE_UNITS_PER_EM, records, pages };
}

function compiledView(font: Font<typeof bitmap | typeof msdf | typeof slug>): CompiledRasterFontView {
  const identities = new RenderWireIdentityRegistry();
  const compiled = compileRasterFont(font, identities);
  if (compiled === undefined) throw new TypeError(`no portable program is registered for "${font.technique.id}"`);
  const program = resolveRasterPlanProgram(font.technique.id);
  if (program === undefined) throw new TypeError(`no portable program is registered for "${font.technique.id}"`);
  return readCompiledRasterFont(compiled, program, identities);
}

function writeDenseRecord(
  output: DataView,
  record: number,
  view: CompiledRasterFontView,
  row: number,
  atlasWidth: number,
  atlasHeight: number,
  planeUnitsPerEm: number,
): void {
  const left = view.f32('bearingX', row);
  const top = view.f32('bearingY', row);
  output.setInt16(record, planeValue(left, planeUnitsPerEm, 'raster left'), true);
  output.setInt16(record + 2, planeValue(top - view.f32('height', row), planeUnitsPerEm, 'raster bottom'), true);
  output.setInt16(record + 4, planeValue(left + view.f32('width', row), planeUnitsPerEm, 'raster right'), true);
  output.setInt16(record + 6, planeValue(top, planeUnitsPerEm, 'raster top'), true);
  const atlasLeft = texelValue(view.f32('uvOriginX', row), atlasWidth, 'atlas left');
  const atlasTop = texelValue(view.f32('uvOriginY', row), atlasHeight, 'atlas top');
  output.setUint16(record + 8, atlasLeft, true);
  output.setUint16(record + 10, atlasTop, true);
  output.setUint16(record + 12, texelValue(view.f32('uvSizeX', row), atlasWidth, 'atlas width') + atlasLeft, true);
  output.setUint16(record + 14, texelValue(view.f32('uvSizeY', row), atlasHeight, 'atlas height') + atlasTop, true);
  output.setUint16(record + 16, u16(view.u32('page', row), 'atlas page'), true);
}

function textureArray(resource: CompiledRasterFontResource, label: string): PortableTextureArrayPayload {
  if (resource.payload.kind !== 'texture-array') throw new TypeError(`${label} must be a texture array`);
  return resource.payload;
}

function textureArrayPages<const Format extends PortableTextureArrayPayload['format']>(
  resource: CompiledRasterFontResource,
  atlas: PortableTextureArrayPayload & { readonly format: Format },
) {
  const layerBytes = atlas.width * atlas.height * (atlas.format === 'rgba8unorm' ? 4 : 1);
  return Object.freeze(
    Array.from({ length: atlas.layers }, (_, layer) => ({
      width: atlas.width,
      height: atlas.height,
      format: atlas.format,
      resource: resource.key,
      bytes: atlas.bytes.subarray(layer * layerBytes, (layer + 1) * layerBytes),
    })),
  );
}

function assertTextureArrayFormat<const Format extends PortableTextureArrayPayload['format']>(
  atlas: PortableTextureArrayPayload,
  format: Format,
  label: string,
): asserts atlas is PortableTextureArrayPayload & { readonly format: Format } {
  if (atlas.format !== format) throw new TypeError(`${label} must use ${format}`);
}

function resourceGroup(resource: CompiledRasterFontResource, label: string): PortableResourceGroupPayload {
  if (resource.payload.kind !== 'group') throw new TypeError(`${label} must be a resource group`);
  return resource.payload;
}

function groupTextureArray(
  group: PortableResourceGroupPayload,
  name: string,
  label: string,
): PortableTextureArrayPayload {
  const member = group.members[name];
  if (member?.kind !== 'texture-array') throw new TypeError(`${label} must be a texture array`);
  return member;
}

function groupTexture(group: PortableResourceGroupPayload, name: string, label: string): PortableTexturePayload {
  const member = group.members[name];
  if (member?.kind !== 'texture') throw new TypeError(`${label} must be a texture`);
  return member;
}

function slugPage(resource: CompiledRasterFontResource): SlugPageData {
  const group = resourceGroup(resource, 'Slug page');
  const curves = groupTexture(group, 'curves', 'Slug curves');
  const headers = groupTexture(group, 'headers', 'Slug headers');
  const packedReferences = groupTexture(group, 'references', 'Slug references');
  const packed = new Uint32Array(
    packedReferences.bytes.buffer,
    packedReferences.bytes.byteOffset,
    packedReferences.bytes.byteLength / 4,
  );
  const references = new Uint16Array(packed.length * 2);
  for (let index = 0; index < packed.length; index += 1) {
    references[index * 2] = packed[index]! & 0xffff;
    references[index * 2 + 1] = packed[index]! >>> 16;
  }
  return {
    resource: resource.key,
    curveWidth: curves.width,
    curveHeight: curves.height,
    curveBytes: curves.bytes,
    headerCount: headers.width * headers.height,
    headerWidth: headers.width,
    headerHeight: headers.height,
    headerBytes: headers.bytes,
    referenceCount: references.length,
    referenceWidth: packedReferences.width * 2,
    referenceHeight: packedReferences.height,
    referenceBytes: new Uint8Array(references.buffer),
  };
}

function planeValue(value: number, planeUnitsPerEm: number, label: string): number {
  const scaled = Math.round(value * planeUnitsPerEm);
  if (scaled < -0x8000 || scaled > 0x7fff) throw new RangeError(`${label} exceeds reconstructed i16 plane bounds`);
  return scaled;
}

function texelValue(value: number, dimension: number, label: string): number {
  return u16(Math.round(value * dimension), label);
}

function u16(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) throw new RangeError(`${label} must be a u16`);
  return value;
}
