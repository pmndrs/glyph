import {
  KHR_DF_CHANNEL_RGBSDA_ALPHA,
  KHR_DF_CHANNEL_RGBSDA_BLUE,
  KHR_DF_CHANNEL_RGBSDA_GREEN,
  KHR_DF_CHANNEL_RGBSDA_RED,
  VK_FORMAT_R8G8B8A8_UNORM,
} from 'ktx-parse';

import type { RegisteredFont } from '../font.js';
import {
  MSDF_EXTENSION,
  MSDF_FORMAT_VERSION,
  MSDF_KIND,
  MSDF_MAX_EM_SIZE,
  MSDF_MAX_PIXEL_RANGE,
  msdfDescriptor,
  msdfRasterKey,
  type MsdfDescriptorV0,
  type MsdfOptions,
} from '../internal/msdf-contract.js';
import {
  ABSENT_GLYPH_PAGE,
  DENSE_GLYPH_RECORD_STRIDE,
  decodeEmbeddedLosslessAtlasPage,
  jsonArray,
  jsonObject,
  nonnegativeSafeInteger,
  validateDenseGlyphRecords,
  type RasterAtlasPage,
} from '../internal/raster-atlas.js';
import { decodeRasterCoverage } from '../internal/raster-coverage-artifact.js';
import type { GlyphPaint, LinearRgba, ResolvedPaint } from '../paint.js';
import { RasterCoverageError } from '../raster-coverage.js';
import type { JsonValue, RegisteredRaster } from '../raster.js';
import {
  defineRasterResourceId,
  defineRasterTechnique,
  type GlyphRange,
  type RasterGlyphInput,
  type RasterGlyphWriteInput,
  type RasterResourceId,
  type RasterTechnique,
  type RasterTechniqueId,
} from '../raster-technique.js';

export {
  MSDF_EXTENSION,
  MSDF_FORMAT_VERSION,
  MSDF_GENERATOR_VERSION,
  MSDF_KIND,
  MSDF_EM_SIZE,
  MSDF_MAX_EM_SIZE,
  MSDF_MAX_OUTLINE_ATLAS_PIXELS,
  MSDF_MAX_PIXEL_RANGE,
  MSDF_PIXEL_RANGE,
  MSDF_PLANE_UNITS_PER_EM,
  msdfDescriptor,
  msdfDescriptorRasterKey,
  msdfRasterKey,
  type MsdfConfiguration,
  type MsdfDescriptorV0,
  type MsdfOptions,
} from '../internal/msdf-contract.js';
export { DENSE_GLYPH_RECORD_STRIDE as MSDF_GLYPH_RECORD_STRIDE } from '../internal/raster-atlas.js';

const RECORD_STRIDE = DENSE_GLYPH_RECORD_STRIDE;
const ABSENT_PAGE = ABSENT_GLYPH_PAGE;
const MAX_RUNTIME_TEXTURE_BYTES = 256 * 1024 * 1024;

export interface MsdfPageData extends RasterAtlasPage {
  readonly format: 'rgba8unorm';
}

export interface MsdfBinding {
  readonly width: number;
  readonly height: number;
  readonly layers: number;
}

export interface MsdfData {
  readonly resource: RasterResourceId;
  readonly binding: MsdfBinding;
  readonly emSize: number;
  readonly pixelRange: number;
  readonly planeUnitsPerEm: number;
  readonly records: Uint8Array;
  readonly coverage?: Uint8Array;
  readonly pages: readonly MsdfPageData[];
}

export interface MsdfGlyphBatchStorage {
  readonly origins: Float32Array;
  readonly sizes: Float32Array;
  readonly uvOrigins: Float32Array;
  readonly uvSizes: Float32Array;
  readonly uvBounds: Float32Array;
  readonly shadowOffsets: Float32Array;
  readonly fillColors: Float32Array;
  readonly outlineColors: Float32Array;
  readonly outlineWidths: Float32Array;
  readonly shadowColors: Float32Array;
  readonly pageIndices: Uint16Array;
}

/** Renderer-neutral MSDF decoding, physical selection, and canonical instance packing. */
export const msdf: RasterTechnique<
  RasterTechniqueId & 'pmndrs.msdf',
  typeof MSDF_KIND,
  MsdfOptions | undefined,
  MsdfDescriptorV0,
  MsdfData,
  MsdfBinding,
  MsdfGlyphBatchStorage
> = defineRasterTechnique({
  id: 'pmndrs.msdf',
  kind: MSDF_KIND,
  extension: MSDF_EXTENSION,
  version: MSDF_FORMAT_VERSION,
  runtimeBaker: () => import('../runtime-bakers/msdf.js'),
  descriptor(options: MsdfOptions | undefined): MsdfDescriptorV0 {
    return msdfDescriptor(options);
  },
  async decode(font, raster, signal): Promise<MsdfData> {
    signal?.throwIfAborted();
    const data = await decodeMsdfData(font, raster);
    signal?.throwIfAborted();
    return data;
  },
  select(input: RasterGlyphInput<MsdfData>) {
    const { data, glyphId } = input;
    assertGlyphId(data, glyphId);
    assertCoverage(data, glyphId);
    const pageIndex = recordView(data).getUint16(glyphId * RECORD_STRIDE + 16, true);
    if (pageIndex === ABSENT_PAGE) return undefined;
    if (data.pages[pageIndex] === undefined) throw new TypeError('MSDF glyph references a missing page');
    return { resource: data.resource, pipelineVariant: 0, binding: data.binding };
  },
  createStorage(capacity: number): MsdfGlyphBatchStorage {
    assertCapacity(capacity);
    return {
      origins: new Float32Array(capacity * 2),
      sizes: new Float32Array(capacity * 2),
      uvOrigins: new Float32Array(capacity * 2),
      uvSizes: new Float32Array(capacity * 2),
      uvBounds: new Float32Array(capacity * 4),
      shadowOffsets: new Float32Array(capacity * 2),
      fillColors: new Float32Array(capacity * 4),
      outlineColors: new Float32Array(capacity * 4),
      outlineWidths: new Float32Array(capacity),
      shadowColors: new Float32Array(capacity * 4),
      pageIndices: new Uint16Array(capacity),
    };
  },
  writeStorage(
    storage: MsdfGlyphBatchStorage,
    range: GlyphRange,
    input: RasterGlyphWriteInput<MsdfData, MsdfBinding>,
  ): void {
    writeMsdfStorage(storage, range, input);
  },
  validatePaint: assertMsdfPaint,
  dispose() {},
});

async function decodeMsdfData(font: RegisteredFont, raster: RegisteredRaster): Promise<MsdfData> {
  if (
    raster.font !== font.handle ||
    raster.kind !== MSDF_KIND ||
    raster.extension !== MSDF_EXTENSION ||
    raster.version !== MSDF_FORMAT_VERSION
  ) {
    throw new TypeError('MSDF raster is not bound to the supplied font');
  }
  const extension = jsonObject(raster.extensionData, 'MSDF extension');
  if (
    extension.version !== MSDF_FORMAT_VERSION ||
    extension.rasterKey !== raster.rasterKey ||
    extension.shapingHash !== font.shapingHash ||
    extension.glyphCount !== font.glyphCount ||
    extension.glyphIdWidth !== 16 ||
    extension.encoding !== 'mtsdf' ||
    extension.recordStride !== RECORD_STRIDE
  ) {
    throw new TypeError('MSDF extension does not match the runtime contract');
  }
  const emSize = configuredInteger(extension.emSize, 'MSDF emSize', MSDF_MAX_EM_SIZE);
  const pixelRange = configuredInteger(extension.pixelRange, 'MSDF pixelRange', MSDF_MAX_PIXEL_RANGE);
  const planeUnitsPerEm = configuredInteger(extension.planeUnitsPerEm, 'MSDF planeUnitsPerEm', MSDF_MAX_EM_SIZE);
  if (planeUnitsPerEm !== emSize) throw new TypeError('MSDF planeUnitsPerEm must equal emSize');
  const coverage = decodeRasterCoverage(extension, font.glyphCount, (view) => raster.view(view), 'MSDF');
  if (
    raster.rasterKey !==
    (await msdfRasterKey({
      emSize,
      pixelRange,
      ...(coverage === undefined ? {} : { coverage: coverage.descriptor }),
    }))
  ) {
    throw new TypeError('MSDF raster key does not match its generation policy');
  }
  const records = raster.view(nonnegativeSafeInteger(extension.recordBufferView, 'MSDF recordBufferView'));
  if (records.byteLength !== font.glyphCount * RECORD_STRIDE) {
    throw new TypeError('MSDF record table does not match the registered glyph count');
  }
  const pageValues = jsonArray(extension.pages, 'MSDF pages');
  if (pageValues.length === 0) throw new TypeError('MSDF raster must contain at least one page');
  if (pageValues.length > 65_535) throw new RangeError('MSDF raster contains too many pages');
  const pages: MsdfPageData[] = [];
  for (let pageIndex = 0; pageIndex < pageValues.length; pageIndex += 1) {
    validateMsdfPageDirectory(pageValues[pageIndex]!, pageIndex);
    const page = decodeEmbeddedLosslessAtlasPage(raster, pageValues[pageIndex]!, `MSDF page ${pageIndex}`, {
      gpuFormat: 'rgba8unorm',
      vkFormat: VK_FORMAT_R8G8B8A8_UNORM,
      blockWidth: 1,
      blockHeight: 1,
      bytesPerBlock: 4,
      uncompressedChannelTypes: [
        KHR_DF_CHANNEL_RGBSDA_RED,
        KHR_DF_CHANNEL_RGBSDA_GREEN,
        KHR_DF_CHANNEL_RGBSDA_BLUE,
        KHR_DF_CHANNEL_RGBSDA_ALPHA,
      ],
    });
    pages.push({ ...page, format: 'rgba8unorm' });
  }
  validateDenseGlyphRecords(records, pages, 'MSDF', true);
  const width = Math.max(...pages.map((page) => page.width));
  const height = Math.max(...pages.map((page) => page.height));
  const paddedBytes = width * height * pages.length * 4;
  if (!Number.isSafeInteger(paddedBytes) || paddedBytes > MAX_RUNTIME_TEXTURE_BYTES) {
    throw new RangeError('MSDF pages exceed the runtime texture-memory limit');
  }
  const binding = Object.freeze({ width, height, layers: pages.length });
  return {
    resource: defineRasterResourceId(`pmndrs.msdf/${font.shapingHash}/${raster.rasterKey}`),
    binding,
    emSize,
    pixelRange,
    planeUnitsPerEm,
    records,
    ...(coverage === undefined ? {} : { coverage: coverage.bits }),
    pages,
  };
}

function writeMsdfStorage(
  storage: MsdfGlyphBatchStorage,
  range: GlyphRange,
  input: RasterGlyphWriteInput<MsdfData, MsdfBinding>,
): void {
  assertWriteRange(storage, range, input.glyphs.length);
  if (input.binding !== input.data.binding) throw new TypeError('MSDF write binding does not belong to its data');
  const records = recordView(input.data);
  for (let index = 0; index < input.glyphs.length; index += 1) {
    writeMsdfGlyph(storage, range.start + index, input.data, records, input.glyphs[index]!);
  }
}

function writeMsdfGlyph(
  storage: MsdfGlyphBatchStorage,
  instance: number,
  data: MsdfData,
  records: DataView,
  glyph: RasterGlyphInput<MsdfData>,
): void {
  assertGlyphId(data, glyph.glyphId);
  assertCoverage(data, glyph.glyphId);
  if (!Number.isFinite(glyph.fontSize) || glyph.fontSize <= 0) {
    throw new TypeError('MSDF glyph font sizes must be positive finite values');
  }
  if (!Number.isFinite(glyph.originX) || !Number.isFinite(glyph.originY)) {
    throw new TypeError('MSDF glyph origins must be finite values');
  }
  assertResolvedPaint(glyph.paint);
  const record = glyph.glyphId * RECORD_STRIDE;
  const planeLeft = records.getInt16(record, true);
  const planeBottom = records.getInt16(record + 2, true);
  const planeRight = records.getInt16(record + 4, true);
  const planeTop = records.getInt16(record + 6, true);
  const atlasLeft = records.getUint16(record + 8, true);
  const atlasTop = records.getUint16(record + 10, true);
  const atlasRight = records.getUint16(record + 12, true);
  const atlasBottom = records.getUint16(record + 14, true);
  const pageIndex = records.getUint16(record + 16, true);
  if (pageIndex === ABSENT_PAGE || data.pages[pageIndex] === undefined) {
    throw new TypeError('MSDF storage write requires a selected renderable glyph');
  }
  const scale = glyph.fontSize / data.planeUnitsPerEm;
  const baseOriginX = glyph.originX + planeLeft * scale;
  const baseOriginY = glyph.originY - planeTop * scale;
  const baseWidth = (planeRight - planeLeft) * scale;
  const baseHeight = (planeTop - planeBottom) * scale;
  const shadowX = glyph.paint.shadow?.offset[0] ?? 0;
  const shadowY = glyph.paint.shadow?.offset[1] ?? 0;
  const originX = baseOriginX + Math.min(0, shadowX);
  const originY = baseOriginY + Math.min(0, shadowY);
  const width = baseWidth + Math.abs(shadowX);
  const height = baseHeight + Math.abs(shadowY);
  const baseUvX = atlasLeft / data.binding.width;
  const baseUvY = atlasTop / data.binding.height;
  const baseUvWidth = (atlasRight - atlasLeft) / data.binding.width;
  const baseUvHeight = (atlasBottom - atlasTop) / data.binding.height;
  const uvPerUnitX = baseUvWidth / baseWidth;
  const uvPerUnitY = baseUvHeight / baseHeight;
  const vectorOffset = instance * 2;
  storage.origins[vectorOffset] = originX;
  storage.origins[vectorOffset + 1] = originY;
  storage.sizes[vectorOffset] = width;
  storage.sizes[vectorOffset + 1] = height;
  storage.uvOrigins[vectorOffset] = baseUvX + (originX - baseOriginX) * uvPerUnitX;
  storage.uvOrigins[vectorOffset + 1] = baseUvY + (originY - baseOriginY) * uvPerUnitY;
  storage.uvSizes[vectorOffset] = width * uvPerUnitX;
  storage.uvSizes[vectorOffset + 1] = height * uvPerUnitY;
  storage.shadowOffsets[vectorOffset] = shadowX * uvPerUnitX;
  storage.shadowOffsets[vectorOffset + 1] = shadowY * uvPerUnitY;
  const boundsOffset = instance * 4;
  storage.uvBounds[boundsOffset] = baseUvX;
  storage.uvBounds[boundsOffset + 1] = baseUvY;
  storage.uvBounds[boundsOffset + 2] = baseUvX + baseUvWidth;
  storage.uvBounds[boundsOffset + 3] = baseUvY + baseUvHeight;
  storage.fillColors.set(glyph.paint.color, boundsOffset);
  storage.outlineColors.set(glyph.paint.outline?.color ?? TRANSPARENT, boundsOffset);
  storage.shadowColors.set(glyph.paint.shadow?.color ?? TRANSPARENT, boundsOffset);
  storage.outlineWidths[instance] = resolveOutlineDistance(data, glyph.fontSize, glyph.paint.outline?.width ?? 0);
  storage.pageIndices[instance] = pageIndex;
}

function recordView(data: MsdfData): DataView {
  return new DataView(data.records.buffer, data.records.byteOffset, data.records.byteLength);
}

function assertGlyphId(data: MsdfData, glyphId: number): void {
  if (!Number.isSafeInteger(glyphId) || glyphId < 0 || glyphId >= data.records.byteLength / RECORD_STRIDE) {
    throw new TypeError('MSDF glyph is outside the registered font');
  }
}

function assertCoverage(data: MsdfData, glyphId: number): void {
  if (data.coverage !== undefined && (data.coverage[glyphId >> 3]! & (1 << (glyphId & 7))) === 0) {
    throw new RasterCoverageError(MSDF_KIND, [glyphId]);
  }
}

function resolveOutlineDistance(data: MsdfData, fontSize: number, outlineWidth: number): number {
  const atlasPixels = outlineWidth / (fontSize / data.planeUnitsPerEm);
  const maximum = data.pixelRange / 2;
  if (atlasPixels > maximum) {
    throw new RangeError(`MSDF outline width exceeds the ${maximum}-atlas-pixel field limit`);
  }
  return atlasPixels / data.pixelRange;
}

function assertWriteRange(storage: MsdfGlyphBatchStorage, range: GlyphRange, glyphCount: number): void {
  const capacity = storage.pageIndices.length;
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.count) ||
    range.start < 0 ||
    range.count < 0 ||
    range.count !== glyphCount ||
    range.start > capacity - range.count
  ) {
    throw new RangeError('MSDF storage write range is outside its capacity');
  }
}

function assertCapacity(capacity: number): void {
  if (!Number.isSafeInteger(capacity) || capacity < 0) {
    throw new RangeError('MSDF storage capacity must be a non-negative safe integer');
  }
}

function configuredInteger(value: unknown, label: string, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${label} must be an integer in 1..=${maximum}`);
  }
  return value;
}

function validateMsdfPageDirectory(value: JsonValue, pageIndex: number): void {
  const page = jsonObject(value, `MSDF page ${pageIndex}`);
  const variants = jsonArray(page.variants, `MSDF page ${pageIndex} variants`);
  if (variants.length !== 1) throw new TypeError('MSDF V0 pages must contain exactly one lossless RGBA8 variant');
  const variant = jsonObject(variants[0], `MSDF page ${pageIndex} variant`);
  if (variant.gpuFormat !== 'rgba8unorm') {
    throw new TypeError('MSDF V0 pages accept only the lossless rgba8unorm baseline');
  }
}

function assertMsdfPaint(paint: GlyphPaint): void {
  for (const entry of paint.palette) assertResolvedPaint(entry);
}

function assertResolvedPaint(paint: ResolvedPaint): void {
  assertLinearColor(paint.color, 'MSDF fill');
  if (paint.outline !== undefined) {
    assertLinearColor(paint.outline.color, 'MSDF outline');
    if (!Number.isFinite(paint.outline.width) || paint.outline.width < 0) {
      throw new TypeError('MSDF outline width must be a non-negative finite value');
    }
  }
  if (paint.shadow !== undefined) {
    assertLinearColor(paint.shadow.color, 'MSDF shadow');
    if (paint.shadow.offset.some((value) => !Number.isFinite(value))) {
      throw new TypeError('MSDF shadow offsets must be finite values');
    }
  }
}

function assertLinearColor(color: readonly number[], label: string): void {
  if (color.length !== 4 || color.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new TypeError(`${label} color must contain four finite linear values in [0, 1]`);
  }
}

const TRANSPARENT: LinearRgba = [0, 0, 0, 0];
