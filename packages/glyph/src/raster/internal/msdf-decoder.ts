import {
  KHR_DF_CHANNEL_RGBSDA_ALPHA,
  KHR_DF_CHANNEL_RGBSDA_BLUE,
  KHR_DF_CHANNEL_RGBSDA_GREEN,
  KHR_DF_CHANNEL_RGBSDA_RED,
  VK_FORMAT_R8G8B8A8_UNORM,
} from 'ktx-parse';

import type { RasterDecodeFont } from '../../font.js';
import {
  MSDF_EXTENSION,
  MSDF_FORMAT_VERSION,
  MSDF_KIND,
  MSDF_MAX_EM_SIZE,
  MSDF_MAX_PIXEL_RANGE,
  msdfRasterKey,
} from '../../internal/msdf-contract.js';
import {
  DENSE_GLYPH_RECORD_STRIDE,
  decodeEmbeddedLosslessAtlasPage,
  jsonArray,
  jsonObject,
  nonnegativeSafeInteger,
  validateDenseGlyphRecords,
} from '../../internal/raster-atlas.js';
import { decodeRasterCoverage } from '../../internal/raster-coverage-artifact.js';
import type { JsonValue, RasterDecodeArtifact } from '../../raster.js';
import { defineRasterResourceId } from '../../config/raster-format.js';
import type { MsdfData, MsdfPageData } from '../msdf.js';
import { compatibilityFingerprint } from '../../internal/raster-identity.js';

const RECORD_STRIDE = DENSE_GLYPH_RECORD_STRIDE;
const MAX_RUNTIME_TEXTURE_BYTES = 256 * 1024 * 1024;

export async function decodeMsdfData(font: RasterDecodeFont, raster: RasterDecodeArtifact): Promise<MsdfData> {
  if (raster.kind !== MSDF_KIND || raster.extension !== MSDF_EXTENSION || raster.version !== MSDF_FORMAT_VERSION) {
    throw new TypeError('MSDF raster is not bound to the supplied font');
  }
  const extension = jsonObject(raster.extensionData, 'MSDF extension');
  if (
    extension.version !== MSDF_FORMAT_VERSION ||
    extension.rasterKey !== raster.rasterKey ||
    extension.fingerprint !==
      compatibilityFingerprint({
        glyphCount: font.glyphCount,
        glyphIdWidth: 16,
        kind: 'msdf',
        rasterKey: raster.rasterKey,
        shaping: font.shapingFingerprint,
        version: MSDF_FORMAT_VERSION,
      }) ||
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
    msdfRasterKey({
      emSize,
      pixelRange,
      ...(coverage === undefined ? {} : { coverage: coverage.descriptor }),
    })
  ) {
    throw new TypeError('MSDF raster key does not match its generation descriptor');
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
    resource: defineRasterResourceId(`pmndrs.msdf/${font.shapingFingerprint}/${raster.rasterKey}`),
    binding,
    emSize,
    pixelRange,
    planeUnitsPerEm,
    records,
    ...(coverage === undefined ? {} : { coverage: coverage.bits }),
    pages,
  };
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
