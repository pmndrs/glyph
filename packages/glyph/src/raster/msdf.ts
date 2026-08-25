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
  type MsdfDescriptor,
  type MsdfOptions,
} from '../internal/msdf-contract.js';
import {
  DENSE_GLYPH_RECORD_STRIDE,
  decodeEmbeddedLosslessAtlasPage,
  jsonArray,
  jsonObject,
  nonnegativeSafeInteger,
  validateDenseGlyphRecords,
  type RasterAtlasPage,
} from '../internal/raster-atlas.js';
import { decodeRasterCoverage } from '../internal/raster-coverage-artifact.js';
import type { JsonValue, RegisteredRaster } from '../raster.js';
import {
  defineRasterResourceId,
  defineRasterTechnique,
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
  type MsdfDescriptor,
  type MsdfOptions,
} from '../internal/msdf-contract.js';
export { DENSE_GLYPH_RECORD_STRIDE as MSDF_GLYPH_RECORD_STRIDE } from '../internal/raster-atlas.js';

const RECORD_STRIDE = DENSE_GLYPH_RECORD_STRIDE;
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

/** Renderer-neutral MSDF identity, decoding, and ownership. */
export const msdf: RasterTechnique<
  RasterTechniqueId & 'pmndrs.msdf',
  typeof MSDF_KIND,
  MsdfOptions | undefined,
  MsdfDescriptor,
  MsdfData
> = defineRasterTechnique({
  id: 'pmndrs.msdf',
  kind: MSDF_KIND,
  extension: MSDF_EXTENSION,
  version: MSDF_FORMAT_VERSION,
  runtimeBaker: () => import('../runtime-bakers/msdf.js'),
  descriptor(options: MsdfOptions | undefined): MsdfDescriptor {
    return msdfDescriptor(options);
  },
  async decode(font, raster, signal): Promise<MsdfData> {
    signal?.throwIfAborted();
    const data = await decodeMsdfData(font, raster);
    signal?.throwIfAborted();
    return data;
  },
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

import { defineTechniqueSchema, type TechniqueSchema } from '../core/technique-schema.js';

/**
 * The authoritative physical shape of the MSDF technique.
 */
export const msdfSchema: TechniqueSchema<
  {
    readonly rect: {
      readonly id: 1;
      readonly scalar: 'f32';
      readonly lanes: readonly ['left', 'top', 'width', 'height'];
    };
    readonly uvRect: {
      readonly id: 2;
      readonly scalar: 'f32';
      readonly lanes: readonly ['u0', 'v0', 'uSpan', 'vSpan'];
    };
    readonly uvBounds: {
      readonly id: 3;
      readonly scalar: 'f32';
      readonly lanes: readonly ['u0', 'v0', 'uMax', 'vMax'];
    };
    readonly color: {
      readonly id: 4;
      readonly scalar: 'f32';
      readonly lanes: readonly ['red', 'green', 'blue', 'alpha'];
    };
    readonly effectA: { readonly id: 5; readonly scalar: 'f32'; readonly lanes: readonly ['x', 'y', 'z', 'w'] };
    readonly effectB: { readonly id: 6; readonly scalar: 'f32'; readonly lanes: readonly ['x', 'y', 'z', 'w'] };
    readonly page: { readonly id: 7; readonly scalar: 'f32'; readonly lanes: readonly ['x', 'y', 'z', 'page'] };
  },
  {
    readonly f32: readonly [
      'bearingX',
      'bearingY',
      'width',
      'height',
      'uvOriginX',
      'uvOriginY',
      'uvSizeX',
      'uvSizeY',
      'uvMaxX',
      'uvMaxY',
    ];
    readonly u32: readonly ['page'];
  },
  { readonly atlas: { readonly kind: 'texture-array'; readonly format: 'rgba8unorm' } },
  'pmndrs.msdf'
> = defineTechniqueSchema({
  technique: 'pmndrs.msdf',
  scope: 'glyph',
  glyphOrigin: { buffer: 'rect' },
  binding: {
    f32: [
      'bearingX',
      'bearingY',
      'width',
      'height',
      'uvOriginX',
      'uvOriginY',
      'uvSizeX',
      'uvSizeY',
      'uvMaxX',
      'uvMaxY',
    ],
    u32: ['page'],
  },
  buffers: {
    rect: { id: 1, scalar: 'f32', lanes: ['left', 'top', 'width', 'height'] },
    uvRect: { id: 2, scalar: 'f32', lanes: ['u0', 'v0', 'uSpan', 'vSpan'] },
    uvBounds: { id: 3, scalar: 'f32', lanes: ['u0', 'v0', 'uMax', 'vMax'] },
    color: { id: 4, scalar: 'f32', lanes: ['red', 'green', 'blue', 'alpha'] },
    effectA: { id: 5, scalar: 'f32', lanes: ['x', 'y', 'z', 'w'] },
    effectB: { id: 6, scalar: 'f32', lanes: ['x', 'y', 'z', 'w'] },
    page: { id: 7, scalar: 'f32', lanes: ['x', 'y', 'z', 'page'] },
  },
  resources: { atlas: { kind: 'texture-array', format: 'rgba8unorm' } },
});
