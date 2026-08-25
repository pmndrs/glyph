import { KHR_DF_CHANNEL_RGBSDA_RED, VK_FORMAT_R8_UNORM } from 'ktx-parse';

import type { RegisteredFont } from '../font.js';
import {
  BITMAP_EXTENSION,
  BITMAP_FORMAT_VERSION,
  BITMAP_KIND,
  bitmapDescriptorRasterKey,
  canonicalizeBitmapDescriptor,
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
import type { RegisteredRaster } from '../raster.js';
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
  runtimeBaker: () => import('../runtime-bakers/bitmap.js'),
  descriptor(options: BitmapTechniqueOptions): BitmapDescriptor {
    return canonicalizeBitmapDescriptor(options.strikes, options.coverage);
  },
  async decode(font, raster, signal): Promise<BitmapData> {
    signal?.throwIfAborted();
    const data = await decodeBitmapData(font, raster);
    signal?.throwIfAborted();
    return data;
  },
  dispose() {},
});

async function decodeBitmapData(font: RegisteredFont, raster: RegisteredRaster): Promise<BitmapData> {
  if (
    raster.font !== font.handle ||
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

import { defineTechniqueSchema, type TechniqueSchema } from '../core/technique-schema.js';

/**
 * The authoritative physical shape of the Bitmap technique: binding field order matches
 * the strike tables the binding compiler emits; buffer ids and lanes are the contract
 * every policy program and shader realization derives from.
 */
export const bitmapSchema: TechniqueSchema<
  {
    readonly origin: {
      readonly id: 1;
      readonly scalar: 'f32';
      readonly lanes: readonly ['inlineOrigin', 'blockOrigin'];
    };
    readonly size: { readonly id: 2; readonly scalar: 'f32'; readonly lanes: readonly ['width', 'height'] };
    readonly uvOrigin: { readonly id: 3; readonly scalar: 'f32'; readonly lanes: readonly ['u', 'v'] };
    readonly uvSize: { readonly id: 4; readonly scalar: 'f32'; readonly lanes: readonly ['uSpan', 'vSpan'] };
    readonly color: {
      readonly id: 5;
      readonly scalar: 'f32';
      readonly lanes: readonly ['red', 'green', 'blue', 'alpha'];
    };
    readonly page: { readonly id: 6; readonly scalar: 'u32'; readonly lanes: readonly ['page'] };
  },
  {
    readonly f32: readonly ['bearingX', 'bearingY', 'width', 'height', 'uvOriginX', 'uvOriginY', 'uvSizeX', 'uvSizeY'];
    readonly u32: readonly ['page'];
  },
  { readonly atlas: { readonly kind: 'texture-array'; readonly format: 'r8unorm' } },
  'pmndrs.bitmap'
> = defineTechniqueSchema({
  technique: 'pmndrs.bitmap',
  scope: 'strike',
  glyphOrigin: { buffer: 'origin' },
  binding: {
    f32: ['bearingX', 'bearingY', 'width', 'height', 'uvOriginX', 'uvOriginY', 'uvSizeX', 'uvSizeY'],
    u32: ['page'],
  },
  buffers: {
    origin: { id: 1, scalar: 'f32', lanes: ['inlineOrigin', 'blockOrigin'] },
    size: { id: 2, scalar: 'f32', lanes: ['width', 'height'] },
    uvOrigin: { id: 3, scalar: 'f32', lanes: ['u', 'v'] },
    uvSize: { id: 4, scalar: 'f32', lanes: ['uSpan', 'vSpan'] },
    color: { id: 5, scalar: 'f32', lanes: ['red', 'green', 'blue', 'alpha'] },
    page: { id: 6, scalar: 'u32', lanes: ['page'] },
  },
  resources: { atlas: { kind: 'texture-array', format: 'r8unorm' } },
});
