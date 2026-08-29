import {
  KHR_DF_CHANNEL_RGBSDA_ALPHA,
  KHR_DF_CHANNEL_RGBSDA_BLUE,
  KHR_DF_CHANNEL_RGBSDA_GREEN,
  KHR_DF_CHANNEL_RGBSDA_RED,
  VK_FORMAT_R8G8B8A8_UNORM,
} from 'ktx-parse';

import type { RasterDecodeFont } from '../font.js';
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
import type { JsonValue, RasterDecodeArtifact } from '../raster.js';
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
  textEffects: ['outline', 'shadow'],
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

async function decodeMsdfData(font: RasterDecodeFont, raster: RasterDecodeArtifact): Promise<MsdfData> {
  if (raster.kind !== MSDF_KIND || raster.extension !== MSDF_EXTENSION || raster.version !== MSDF_FORMAT_VERSION) {
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

import { f32, techniqueProgram, u32, type PolicyBufferId, type RasterPlanProgram, id } from '../core.js';
import { registerGlyphRasterPlanProgram } from '../core/raster-plan-program.js';
import { defineTechniqueSchema, type TechniqueSchema } from '../core/technique-schema.js';

const MSDF_RECT_BUFFER_ID: PolicyBufferId = id.buffer('pmndrs.msdf/rect');
const MSDF_UV_RECT_BUFFER_ID: PolicyBufferId = id.buffer('pmndrs.msdf/uv-rect');
const MSDF_UV_BOUNDS_BUFFER_ID: PolicyBufferId = id.buffer('pmndrs.msdf/uv-bounds');
const MSDF_COLOR_BUFFER_ID: PolicyBufferId = id.buffer('pmndrs.msdf/color');
const MSDF_EFFECT_COLOR_BUFFER_ID: PolicyBufferId = id.buffer('pmndrs.msdf/effect-color');
const MSDF_PAGE_BUFFER_ID: PolicyBufferId = id.buffer('pmndrs.msdf/page');

/**
 * The authoritative physical shape of the MSDF technique.
 */
export const msdfSchema: TechniqueSchema<
  {
    readonly rect: {
      readonly id: typeof MSDF_RECT_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['left', 'top', 'width', 'height'];
    };
    readonly uvRect: {
      readonly id: typeof MSDF_UV_RECT_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['u0', 'v0', 'uSpan', 'vSpan'];
    };
    readonly uvBounds: {
      readonly id: typeof MSDF_UV_BOUNDS_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['u0', 'v0', 'uMax', 'vMax'];
    };
    readonly color: {
      readonly id: typeof MSDF_COLOR_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['red', 'green', 'blue', 'alpha'];
    };
    readonly effectColor: {
      readonly id: typeof MSDF_EFFECT_COLOR_BUFFER_ID;
      readonly scalar: 'u32';
      readonly lanes: readonly ['outline', 'shadow'];
    };
    readonly page: {
      readonly id: typeof MSDF_PAGE_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['x', 'y', 'z', 'page'];
    };
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
  {
    readonly atlas: {
      readonly kind: 'group';
      readonly members: {
        readonly texture: { readonly kind: 'texture-array'; readonly format: 'rgba8unorm' };
        readonly pixelRange: { readonly kind: 'buffer' };
        readonly effectScale: { readonly kind: 'buffer' };
      };
    };
  },
  typeof msdf.id
> = defineTechniqueSchema({
  technique: msdf.id,
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
    rect: { id: MSDF_RECT_BUFFER_ID, scalar: 'f32', lanes: ['left', 'top', 'width', 'height'] },
    uvRect: { id: MSDF_UV_RECT_BUFFER_ID, scalar: 'f32', lanes: ['u0', 'v0', 'uSpan', 'vSpan'] },
    uvBounds: { id: MSDF_UV_BOUNDS_BUFFER_ID, scalar: 'f32', lanes: ['u0', 'v0', 'uMax', 'vMax'] },
    color: { id: MSDF_COLOR_BUFFER_ID, scalar: 'f32', lanes: ['red', 'green', 'blue', 'alpha'] },
    effectColor: { id: MSDF_EFFECT_COLOR_BUFFER_ID, scalar: 'u32', lanes: ['outline', 'shadow'] },
    page: { id: MSDF_PAGE_BUFFER_ID, scalar: 'f32', lanes: ['x', 'y', 'z', 'page'] },
  },
  resources: {
    atlas: {
      kind: 'group',
      members: {
        texture: { kind: 'texture-array', format: 'rgba8unorm' },
        pixelRange: { kind: 'buffer' },
        effectScale: { kind: 'buffer' },
      },
    },
  },
  render: { resource: 'atlas', geometry: { kind: 'synthetic-quad' } },
});

export const msdfPlanProgram: RasterPlanProgram<typeof msdf, typeof msdfSchema> = registerGlyphRasterPlanProgram({
  technique: msdf,
  schema: msdfSchema,
  policyBody(system) {
    const p = techniqueProgram(msdfSchema, { textEffects: msdf.textEffects, system });
    const { inlineOrigin, blockOrigin, fontSize, color, outline, shadow } = p.semantics;
    if (outline === undefined || shadow === undefined) {
      throw new Error('MSDF text effects are not configured');
    }
    const { bearingX, bearingY, width, height, uvOriginX, uvOriginY, uvSizeX, uvSizeY, uvMaxX, uvMaxY, page } =
      p.binding;
    return p.compile({
      rect: [
        f32.add(inlineOrigin, f32.mul(bearingX, fontSize)),
        f32.sub(blockOrigin, f32.mul(bearingY, fontSize)),
        f32.mul(width, fontSize),
        f32.mul(height, fontSize),
      ],
      uvRect: [uvOriginX, uvOriginY, uvSizeX, uvSizeY],
      uvBounds: [uvOriginX, uvOriginY, uvMaxX, uvMaxY],
      color: [color.red, color.green, color.blue, color.alpha],
      effectColor: [outline.color, shadow.color],
      page: [shadow.offsetXEm, shadow.offsetYEm, outline.widthEm, u32.toF32(page)],
    });
  },
  compileFont(compiler) {
    const data = compiler.font.data;
    const view = new DataView(data.records.buffer, data.records.byteOffset);
    compiler.retain('atlas', data.resource, {
      kind: 'group',
      members: {
        texture: msdfAtlas(data),
        pixelRange: { kind: 'buffer', bytes: portableF32(data.pixelRange), stride: 4 },
        effectScale: {
          kind: 'buffer',
          bytes: portableF32x3(
            data.planeUnitsPerEm / data.binding.width,
            data.planeUnitsPerEm / data.binding.height,
            data.planeUnitsPerEm / data.pixelRange,
          ),
          stride: 12,
        },
      },
    });
    const record = (row: number) => row * RECORD_STRIDE;
    const page = (row: number) => view.getUint16(record(row) + 16, true);
    const atlas = (row: number, offset: number, dimension: 'width' | 'height') =>
      page(row) === 0xffff ? 0 : view.getUint16(record(row) + offset, true) / data.binding[dimension];
    const span = (row: number, start: number, end: number, dimension: 'width' | 'height') =>
      page(row) === 0xffff
        ? 0
        : (view.getUint16(record(row) + end, true) - view.getUint16(record(row) + start, true)) /
          data.binding[dimension];
    return compiler.compile({
      strikes: [0],
      resource: (glyph) => (page(glyph) === 0xffff ? undefined : data.resource),
      f32: {
        bearingX: (row) => view.getInt16(record(row), true) / data.planeUnitsPerEm,
        bearingY: (row) => view.getInt16(record(row) + 6, true) / data.planeUnitsPerEm,
        width: (row) =>
          (view.getInt16(record(row) + 4, true) - view.getInt16(record(row), true)) / data.planeUnitsPerEm,
        height: (row) =>
          (view.getInt16(record(row) + 6, true) - view.getInt16(record(row) + 2, true)) / data.planeUnitsPerEm,
        uvOriginX: (row) => atlas(row, 8, 'width'),
        uvOriginY: (row) => atlas(row, 10, 'height'),
        uvSizeX: (row) => span(row, 8, 12, 'width'),
        uvSizeY: (row) => span(row, 10, 14, 'height'),
        uvMaxX: (row) => atlas(row, 12, 'width'),
        uvMaxY: (row) => atlas(row, 14, 'height'),
      },
      u32: { page },
    });
  },
});

function msdfAtlas(data: MsdfData) {
  const bytes = new Uint8Array(data.binding.width * data.binding.height * data.binding.layers * 4);
  for (let layer = 0; layer < data.pages.length; layer += 1) {
    const page = data.pages[layer]!;
    for (let row = 0; row < page.height; row += 1) {
      const source = row * page.width * 4;
      const target = (layer * data.binding.height + row) * data.binding.width * 4;
      bytes.set(page.bytes.subarray(source, source + page.width * 4), target);
    }
  }
  return {
    kind: 'texture-array' as const,
    format: 'rgba8unorm' as const,
    width: data.binding.width,
    height: data.binding.height,
    layers: data.binding.layers,
    bytes,
  };
}

function portableF32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setFloat32(0, value, true);
  return bytes;
}

function portableF32x3(x: number, y: number, z: number): Uint8Array {
  const bytes = new Uint8Array(12);
  const view = new DataView(bytes.buffer);
  view.setFloat32(0, x, true);
  view.setFloat32(4, y, true);
  view.setFloat32(8, z, true);
  return bytes;
}
