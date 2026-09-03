import type { Font } from '@pmndrs/glyph';
import { bitmap, bitmapCodec, type BitmapData, type BitmapStrikeData } from '@pmndrs/glyph/raster/bitmap';
import { msdf, msdfCodec, type MsdfConfiguration, type MsdfData } from '@pmndrs/glyph/raster/msdf';
import { SLUG_PLANE_UNITS_PER_EM, slug, slugCodec, type SlugPageData } from '@pmndrs/glyph/raster/slug';
import {
  type CompiledRasterFont,
  type CompiledRasterFontResource,
  type CompiledRasterFontView,
  type PortableResourceGroupPayload,
  type PortableTextureArrayPayload,
  type PortableTexturePayload,
} from '@pmndrs/glyph';
import {
  compileRasterFont,
  readCompiledRasterFont,
  type RasterCodec,
} from '@pmndrs/glyph/config/raster';
import type { AnyRasterFormat } from '@pmndrs/glyph/config/raster-format';
import type { AnyTechniqueSchema } from '@pmndrs/glyph/config/schema';

import type { SlugCpuReferenceData } from '../../benchmark/low-level/raster/slug-cpu-reference';

const DENSE_GLYPH_RECORD_STRIDE = 20;
const ABSENT_PAGE = 0xffff;

/** Reconstruct the benchmark Bitmap oracle from the exact portable Codec consumed by renderers. */
export function compiledBitmapData(font: Font<typeof bitmap>): BitmapData {
  const { compiled, view } = compiledView(font, bitmapCodec);
  if (view.scope !== 'strike') throw new TypeError('Bitmap compiled binding must use strike scope');
  const resourceIndex = new Map(view.resources.map((resource, index) => [resource.key, index]));
  const strikes: BitmapStrikeData[] = view.strikes.map((ppem, strikeIndex) => {
    const resource = declaredResource(compiled, view, 'atlas', strikeIndex, `Bitmap strike ${strikeIndex}`);
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

/** Reconstruct the benchmark MTSDF oracle from the exact RasterCodec consumed by renderers. */
export function compiledMsdfData(font: Font<typeof msdf>, configuration: MsdfConfiguration): MsdfData {
  const { view } = compiledView(font, msdfCodec);
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
  if (pixelRange !== configuration.pixelRange) {
    throw new TypeError('MTSDF compiled binding pixelRange does not match its authenticated configuration');
  }
  const planeUnitsPerEm = positivePlaneUnits(configuration.emSize, 'MTSDF emSize');
  if (configuration.planeUnitsPerEm !== planeUnitsPerEm) {
    throw new TypeError('MTSDF planeUnitsPerEm must equal its authenticated emSize');
  }
  const records = new Uint8Array(view.glyphCount * DENSE_GLYPH_RECORD_STRIDE);
  const output = new DataView(records.buffer);
  for (let glyph = 0; glyph < view.glyphCount; glyph += 1) {
    const record = glyph * DENSE_GLYPH_RECORD_STRIDE;
    if (view.resource(glyph, 0) === undefined) {
      output.setUint16(record + 16, ABSENT_PAGE, true);
      continue;
    }
    writeDenseRecord(output, record, view, glyph, atlas.width, atlas.height, planeUnitsPerEm);
  }
  return {
    resource: resource.key,
    binding: { width: atlas.width, height: atlas.height, layers: atlas.layers },
    emSize: planeUnitsPerEm,
    pixelRange,
    planeUnitsPerEm,
    records,
    pages: textureArrayPages(resource, atlas),
  };
}

/** Reconstruct the benchmark Slug oracle from the exact RasterCodec consumed by renderers. */
export function compiledSlugData(font: Font<typeof slug>): SlugCpuReferenceData {
  const { view } = compiledView(font, slugCodec);
  if (view.scope !== 'glyph' || view.strikes.length !== 1) {
    throw new TypeError('Slug compiled binding must use one glyph-scoped strike');
  }
  const pages = view.resources.map((resource) => slugPage(resource));
  const pageIndex = new Map(view.resources.map((resource, index) => [resource.key, index]));
  const glyphs = {
    planeLeft: new Int16Array(view.glyphCount),
    planeBottom: new Int16Array(view.glyphCount),
    planeRight: new Int16Array(view.glyphCount),
    planeTop: new Int16Array(view.glyphCount),
    page: new Uint16Array(view.glyphCount),
    horizontalBands: new Uint16Array(view.glyphCount),
    verticalBands: new Uint16Array(view.glyphCount),
    curveBase: new Uint32Array(view.glyphCount),
    horizontalHeaderBase: new Uint32Array(view.glyphCount),
    verticalHeaderBase: new Uint32Array(view.glyphCount),
    referenceBase: new Uint32Array(view.glyphCount),
  };
  for (let glyph = 0; glyph < view.glyphCount; glyph += 1) {
    const resource = view.resource(glyph, 0);
    if (resource === undefined) {
      glyphs.page[glyph] = ABSENT_PAGE;
      continue;
    }
    const selectedPage = pageIndex.get(resource.key);
    if (selectedPage === undefined) throw new TypeError('Slug binding selected an unknown page');
    const left = view.f32('bearingX', glyph);
    const top = view.f32('bearingY', glyph);
    const right = left + view.f32('width', glyph);
    const bottom = top - view.f32('height', glyph);
    glyphs.planeLeft[glyph] = planeValue(left, SLUG_PLANE_UNITS_PER_EM, 'Slug left');
    glyphs.planeBottom[glyph] = planeValue(bottom, SLUG_PLANE_UNITS_PER_EM, 'Slug bottom');
    glyphs.planeRight[glyph] = planeValue(right, SLUG_PLANE_UNITS_PER_EM, 'Slug right');
    glyphs.planeTop[glyph] = planeValue(top, SLUG_PLANE_UNITS_PER_EM, 'Slug top');
    glyphs.page[glyph] = u16(selectedPage, 'Slug page index');
    glyphs.horizontalBands[glyph] = u16(view.u32('horizontalBands', glyph), 'Slug horizontal bands');
    glyphs.verticalBands[glyph] = u16(view.u32('verticalBands', glyph), 'Slug vertical bands');
    glyphs.curveBase[glyph] = view.u32('curveBase', glyph);
    glyphs.horizontalHeaderBase[glyph] = view.u32('horizontalHeaderBase', glyph);
    glyphs.verticalHeaderBase[glyph] = view.u32('verticalHeaderBase', glyph);
    glyphs.referenceBase[glyph] = view.u32('referenceBase', glyph);
  }
  return { planeUnitsPerEm: SLUG_PLANE_UNITS_PER_EM, glyphs, pages };
}

function compiledView<Technique extends AnyRasterFormat, Schema extends AnyTechniqueSchema>(
  font: Font<Technique>,
  codec: RasterCodec<Technique, Schema>,
): {
  readonly compiled: CompiledRasterFont;
  readonly view: CompiledRasterFontView<Schema>;
} {
  const compiled = compileRasterFont(font);
  if (compiled === undefined) throw new TypeError(`no RasterCodec is registered for "${font.raster.id}"`);
  return { compiled, view: readCompiledRasterFont(compiled, codec) };
}

function declaredResource(
  compiled: CompiledRasterFont,
  view: CompiledRasterFontView,
  role: string,
  index: number,
  label: string,
): CompiledRasterFontResource {
  const key = compiled.declaredResources.get(role)?.[index];
  const resource = key === undefined ? undefined : view.resources.find((candidate) => candidate.key === key);
  if (resource === undefined) throw new TypeError(`${label} has no declared ${role} resource`);
  return resource;
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

function positivePlaneUnits(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 0x7fff) {
    throw new RangeError(`${label} must be a positive i16-compatible integer`);
  }
  return value;
}

function texelValue(value: number, dimension: number, label: string): number {
  return u16(Math.round(value * dimension), label);
}

function u16(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) throw new RangeError(`${label} must be a u16`);
  return value;
}
