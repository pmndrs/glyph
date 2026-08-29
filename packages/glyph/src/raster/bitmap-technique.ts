import { KHR_DF_CHANNEL_RGBSDA_RED, VK_FORMAT_R8_UNORM } from 'ktx-parse';

import type { RasterDecodeFont } from '../font.js';
import {
  BITMAP_EXTENSION,
  BITMAP_FORMAT_VERSION,
  BITMAP_KIND,
  bitmapDescriptorRasterKey,
  canonicalizeBitmapDescriptor,
  normalizeBitmapOptions,
  type BitmapDescriptor,
} from '../internal/bitmap-contract.js';
import { nearestBitmapStrikeIndex } from '../internal/bitmap-strike.js';
import {
  DENSE_GLYPH_RECORD_STRIDE,
  decodeEmbeddedLosslessAtlasPage,
  jsonArray,
  jsonObject,
  nonnegativeSafeInteger,
  positiveSafeInteger,
  validateDenseGlyphRecords,
  type RasterAtlasPage,
} from '../internal/raster-atlas.js';
import { decodeRasterCoverage } from '../internal/raster-coverage-artifact.js';
import type { RasterCoverage } from '../raster-coverage.js';
import type { RasterDecodeArtifact } from '../raster.js';
import {
  defineRasterResourceId,
  defineRasterTechnique,
  type RasterResourceId,
  type RasterTechnique,
  type RasterTechniqueId,
} from '../raster-technique.js';

export {
  BITMAP_EXTENSION,
  BITMAP_FORMAT_VERSION,
  BITMAP_GENERATOR_VERSION,
  BITMAP_KIND,
  MAX_BITMAP_PPEM,
  bitmapDescriptor,
  bitmapDescriptorRasterKey,
  bitmapRasterKey,
  canonicalizeBitmapDescriptor,
  type BitmapDescriptor,
  type BitmapOptions,
} from '../internal/bitmap-contract.js';

const RECORD_STRIDE = DENSE_GLYPH_RECORD_STRIDE;
const MAX_RUNTIME_TEXTURE_BYTES = 256 * 1024 * 1024;

export interface BitmapTechniqueOptions {
  readonly strikes: readonly [number, ...number[]];
  readonly coverage?: RasterCoverage;
}

export interface BitmapPageData extends RasterAtlasPage {
  readonly format: 'r8unorm';
  readonly resource: RasterResourceId;
}

export interface BitmapStrikeData {
  readonly ppem: number;
  readonly planeUnitsPerEm: number;
  readonly records: Uint8Array;
  readonly pages: readonly BitmapPageData[];
}

export interface BitmapData {
  readonly strikes: readonly BitmapStrikeData[];
  readonly coverage?: Uint8Array;
}

/**
 * Reports the physical strike this technique selects for a logical CSS size and raster pixel ratio. Applications that
 * display or assert density behaviour must read the selection from here rather than reimplementing it, so a reported
 * strike can never diverge from the strike actually rendered.
 */
export function selectBitmapStrikePpem(
  strikes: readonly { readonly ppem: number }[],
  cssFontSize: number,
  rasterPixelRatio: number,
): number {
  return strikes[nearestBitmapStrikeIndex(strikes, cssFontSize, rasterPixelRatio)]!.ppem;
}

/** Renderer-neutral Bitmap identity, decoding, and ownership. */
export const bitmap: RasterTechnique<
  RasterTechniqueId & 'pmndrs.bitmap',
  typeof BITMAP_KIND,
  BitmapTechniqueOptions,
  BitmapDescriptor,
  BitmapData
> = defineRasterTechnique({
  id: 'pmndrs.bitmap',
  kind: BITMAP_KIND,
  extension: BITMAP_EXTENSION,
  version: BITMAP_FORMAT_VERSION,
  textEffects: [],
  runtimeBaker: () => import('../runtime-bakers/bitmap.js'),
  descriptor(options: BitmapTechniqueOptions): BitmapDescriptor {
    const normalized = normalizeBitmapOptions(options);
    return canonicalizeBitmapDescriptor(normalized.strikes, normalized.coverage);
  },
  async decode(font, raster, signal): Promise<BitmapData> {
    signal?.throwIfAborted();
    const data = await decodeBitmapData(font, raster);
    signal?.throwIfAborted();
    return data;
  },
  dispose() {},
});

async function decodeBitmapData(font: RasterDecodeFont, raster: RasterDecodeArtifact): Promise<BitmapData> {
  if (
    raster.kind !== BITMAP_KIND ||
    raster.extension !== BITMAP_EXTENSION ||
    raster.version !== BITMAP_FORMAT_VERSION
  ) {
    throw new TypeError('bitmap raster is not bound to the supplied font');
  }
  const extension = jsonObject(raster.extensionData, 'bitmap extension');
  if (
    extension.version !== BITMAP_FORMAT_VERSION ||
    extension.rasterKey !== raster.rasterKey ||
    extension.shapingHash !== font.shapingHash ||
    extension.glyphCount !== font.glyphCount ||
    extension.glyphIdWidth !== 16
  ) {
    throw new TypeError('bitmap extension identity does not match its registered font and raster');
  }
  const coverage = decodeRasterCoverage(extension, font.glyphCount, (view) => raster.view(view), 'bitmap');
  const strikeValues = jsonArray(extension.strikes, 'bitmap strikes');
  if (strikeValues.length === 0) throw new TypeError('bitmap raster must contain at least one strike');
  const strikesPpem = strikeValues.map((value, index) => {
    const strike = jsonObject(value, `bitmap strike ${index}`);
    const ppem = positiveSafeInteger(strike.ppemX, `bitmap strike ${index} ppemX`);
    if (strike.ppemY !== ppem) throw new TypeError('bitmap runtime requires square strikes');
    return ppem;
  });
  if (
    raster.rasterKey !==
    (await bitmapDescriptorRasterKey(canonicalizeBitmapDescriptor(strikesPpem, coverage?.descriptor)))
  ) {
    throw new TypeError('bitmap raster key does not match its generation policy');
  }
  const strikes: BitmapStrikeData[] = [];
  let retainedBytes = 0;
  for (let strikeIndex = 0; strikeIndex < strikeValues.length; strikeIndex += 1) {
    const strikeValue = jsonObject(strikeValues[strikeIndex], `bitmap strike ${strikeIndex}`);
    const ppem = positiveSafeInteger(strikeValue.ppemX, `bitmap strike ${strikeIndex} ppemX`);
    if (strikeValue.ppemY !== ppem) throw new TypeError('bitmap runtime requires square strikes');
    const planeUnitsPerEm = positiveSafeInteger(
      strikeValue.planeUnitsPerEm,
      `bitmap strike ${strikeIndex} planeUnitsPerEm`,
    );
    if (strikeValue.recordStride !== RECORD_STRIDE) {
      throw new TypeError(`bitmap records must use ${RECORD_STRIDE}-byte stride`);
    }
    const records = raster.view(
      nonnegativeSafeInteger(strikeValue.recordBufferView, `bitmap strike ${strikeIndex} recordBufferView`),
    );
    if (records.byteLength !== font.glyphCount * RECORD_STRIDE) {
      throw new TypeError('bitmap record table does not match the registered glyph count');
    }
    const pages = jsonArray(strikeValue.pages, `bitmap strike ${strikeIndex} pages`).map(
      (pageValue, pageIndex): BitmapPageData => {
        const decoded = decodeEmbeddedLosslessAtlasPage(
          raster,
          pageValue,
          `bitmap strike ${strikeIndex} page ${pageIndex}`,
          {
            gpuFormat: 'r8unorm',
            vkFormat: VK_FORMAT_R8_UNORM,
            blockWidth: 1,
            blockHeight: 1,
            bytesPerBlock: 1,
            uncompressedChannelTypes: [KHR_DF_CHANNEL_RGBSDA_RED],
          },
        );
        retainedBytes += decoded.bytes.byteLength;
        if (!Number.isSafeInteger(retainedBytes) || retainedBytes > MAX_RUNTIME_TEXTURE_BYTES) {
          throw new RangeError('bitmap pages exceed the runtime texture-memory limit');
        }
        return {
          ...decoded,
          format: 'r8unorm',
          resource: defineRasterResourceId(
            `pmndrs.bitmap/${font.shapingHash}/${raster.rasterKey}/${strikeIndex}/${pageIndex}`,
          ),
        };
      },
    );
    validateDenseGlyphRecords(records, pages, 'bitmap');
    strikes.push({ ppem, planeUnitsPerEm, records, pages });
  }
  return { strikes, ...(coverage === undefined ? {} : { coverage: coverage.bits }) };
}

import { f32, techniqueProgram, type PolicyBufferId, type RasterPlanProgram, id } from '../core.js';
import { registerGlyphRasterPlanProgram } from '../core/raster-plan-program.js';
import { defineTechniqueSchema, type TechniqueSchema } from '../core/technique-schema.js';

const BITMAP_ORIGIN_BUFFER_ID: PolicyBufferId = id.buffer('pmndrs.bitmap/origin');
const BITMAP_SIZE_BUFFER_ID: PolicyBufferId = id.buffer('pmndrs.bitmap/size');
const BITMAP_UV_ORIGIN_BUFFER_ID: PolicyBufferId = id.buffer('pmndrs.bitmap/uv-origin');
const BITMAP_UV_SIZE_BUFFER_ID: PolicyBufferId = id.buffer('pmndrs.bitmap/uv-size');
const BITMAP_COLOR_BUFFER_ID: PolicyBufferId = id.buffer('pmndrs.bitmap/color');
const BITMAP_PAGE_BUFFER_ID: PolicyBufferId = id.buffer('pmndrs.bitmap/page');

/**
 * The authoritative physical shape of the Bitmap technique: binding field order matches
 * the strike tables the binding compiler emits; buffer ids and lanes are the contract
 * every policy program and shader realization derives from.
 */
export const bitmapSchema: TechniqueSchema<
  {
    readonly origin: {
      readonly id: typeof BITMAP_ORIGIN_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['inlineOrigin', 'blockOrigin'];
    };
    readonly size: {
      readonly id: typeof BITMAP_SIZE_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['width', 'height'];
    };
    readonly uvOrigin: {
      readonly id: typeof BITMAP_UV_ORIGIN_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['u', 'v'];
    };
    readonly uvSize: {
      readonly id: typeof BITMAP_UV_SIZE_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['uSpan', 'vSpan'];
    };
    readonly color: {
      readonly id: typeof BITMAP_COLOR_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['red', 'green', 'blue', 'alpha'];
    };
    readonly page: {
      readonly id: typeof BITMAP_PAGE_BUFFER_ID;
      readonly scalar: 'u32';
      readonly lanes: readonly ['page'];
    };
  },
  {
    readonly f32: readonly ['bearingX', 'bearingY', 'width', 'height', 'uvOriginX', 'uvOriginY', 'uvSizeX', 'uvSizeY'];
    readonly u32: readonly ['page'];
  },
  {
    readonly atlas: {
      readonly kind: 'texture-array';
      readonly format: 'r8unorm';
      readonly cardinality: 'many';
    };
  },
  typeof bitmap.id
> = defineTechniqueSchema({
  technique: bitmap.id,
  scope: 'strike',
  glyphOrigin: { buffer: 'origin' },
  binding: {
    f32: ['bearingX', 'bearingY', 'width', 'height', 'uvOriginX', 'uvOriginY', 'uvSizeX', 'uvSizeY'],
    u32: ['page'],
  },
  buffers: {
    origin: { id: BITMAP_ORIGIN_BUFFER_ID, scalar: 'f32', lanes: ['inlineOrigin', 'blockOrigin'] },
    size: { id: BITMAP_SIZE_BUFFER_ID, scalar: 'f32', lanes: ['width', 'height'] },
    uvOrigin: { id: BITMAP_UV_ORIGIN_BUFFER_ID, scalar: 'f32', lanes: ['u', 'v'] },
    uvSize: { id: BITMAP_UV_SIZE_BUFFER_ID, scalar: 'f32', lanes: ['uSpan', 'vSpan'] },
    color: { id: BITMAP_COLOR_BUFFER_ID, scalar: 'f32', lanes: ['red', 'green', 'blue', 'alpha'] },
    page: { id: BITMAP_PAGE_BUFFER_ID, scalar: 'u32', lanes: ['page'] },
  },
  resources: { atlas: { kind: 'texture-array', format: 'r8unorm', cardinality: 'many' } },
  render: { resource: 'atlas', geometry: { kind: 'synthetic-quad' } },
});

export const bitmapPlanProgram: RasterPlanProgram<typeof bitmap, typeof bitmapSchema> = registerGlyphRasterPlanProgram({
  technique: bitmap,
  schema: bitmapSchema,
  policyBody(system) {
    const p = techniqueProgram(bitmapSchema, { system });
    const { inlineOrigin, blockOrigin, fontSize, color } = p.semantics;
    const { bearingX, bearingY, width, height, uvOriginX, uvOriginY, uvSizeX, uvSizeY, page } = p.binding;
    return p.compile({
      origin: [f32.add(inlineOrigin, f32.mul(bearingX, fontSize)), f32.sub(blockOrigin, f32.mul(bearingY, fontSize))],
      size: [f32.mul(width, fontSize), f32.mul(height, fontSize)],
      uvOrigin: [uvOriginX, uvOriginY],
      uvSize: [uvSizeX, uvSizeY],
      color: [color.red, color.green, color.blue, color.alpha],
      page: [page],
    });
  },
  compileFont(compiler) {
    const data = compiler.font.data;
    const glyphCount = compiler.font.glyphCount;
    const views = data.strikes.map((strike) => new DataView(strike.records.buffer, strike.records.byteOffset));
    const dimensions = data.strikes.map((strike, strikeIndex) => {
      const key = strike.pages[0]?.resource;
      if (key === undefined) throw new TypeError(`bitmap strike ${strikeIndex} needs at least one atlas page`);
      const atlas = bitmapAtlas(strike, strikeIndex);
      compiler.retain('atlas', key, atlas);
      return { key, width: atlas.width, height: atlas.height };
    });
    const strikeRecord = (row: number) => {
      const strike = Math.floor(row / glyphCount);
      return { view: views[strike]!, record: (row % glyphCount) * RECORD_STRIDE, strike };
    };
    const atlas = (row: number, offset: number, dimension: 'width' | 'height') => {
      const selected = strikeRecord(row);
      return selected.view.getUint16(selected.record + 16, true) === 0xffff
        ? 0
        : selected.view.getUint16(selected.record + offset, true) / dimensions[selected.strike]![dimension];
    };
    const span = (row: number, start: number, end: number, dimension: 'width' | 'height') => {
      const selected = strikeRecord(row);
      return selected.view.getUint16(selected.record + 16, true) === 0xffff
        ? 0
        : (selected.view.getUint16(selected.record + end, true) -
            selected.view.getUint16(selected.record + start, true)) /
            dimensions[selected.strike]![dimension];
    };
    return compiler.compile({
      strikes: data.strikes.map((strike) => strike.ppem) as [number, ...number[]],
      resource(glyph, strike) {
        const record = glyph * RECORD_STRIDE;
        return views[strike]!.getUint16(record + 16, true) === 0xffff ? undefined : dimensions[strike]!.key;
      },
      f32: {
        bearingX: (row) => {
          const selected = strikeRecord(row);
          return selected.view.getInt16(selected.record, true) / data.strikes[selected.strike]!.planeUnitsPerEm;
        },
        bearingY: (row) => {
          const selected = strikeRecord(row);
          return selected.view.getInt16(selected.record + 6, true) / data.strikes[selected.strike]!.planeUnitsPerEm;
        },
        width: (row) => {
          const selected = strikeRecord(row);
          return (
            (selected.view.getInt16(selected.record + 4, true) - selected.view.getInt16(selected.record, true)) /
            data.strikes[selected.strike]!.planeUnitsPerEm
          );
        },
        height: (row) => {
          const selected = strikeRecord(row);
          return (
            (selected.view.getInt16(selected.record + 6, true) - selected.view.getInt16(selected.record + 2, true)) /
            data.strikes[selected.strike]!.planeUnitsPerEm
          );
        },
        uvOriginX: (row) => atlas(row, 8, 'width'),
        uvOriginY: (row) => atlas(row, 10, 'height'),
        uvSizeX: (row) => span(row, 8, 12, 'width'),
        uvSizeY: (row) => span(row, 10, 14, 'height'),
      },
      u32: {
        page: (row) => {
          const selected = strikeRecord(row);
          return selected.view.getUint16(selected.record + 16, true);
        },
      },
    });
  },
});

function bitmapAtlas(strike: BitmapStrikeData, strikeIndex: number) {
  const width = Math.max(...strike.pages.map((page) => page.width));
  const height = Math.max(...strike.pages.map((page) => page.height));
  const byteLength = width * height * strike.pages.length;
  if (!Number.isSafeInteger(byteLength) || byteLength > MAX_RUNTIME_TEXTURE_BYTES) {
    throw new RangeError(`bitmap strike ${strikeIndex} padded atlas exceeds the runtime texture-memory limit`);
  }
  const bytes = new Uint8Array(byteLength);
  for (let layer = 0; layer < strike.pages.length; layer += 1) {
    const page = strike.pages[layer]!;
    for (let row = 0; row < page.height; row += 1) {
      bytes.set(page.bytes.subarray(row * page.width, (row + 1) * page.width), (layer * height + row) * width);
    }
  }
  return {
    kind: 'texture-array' as const,
    format: 'r8unorm' as const,
    width,
    height,
    layers: strike.pages.length,
    bytes,
  };
}
