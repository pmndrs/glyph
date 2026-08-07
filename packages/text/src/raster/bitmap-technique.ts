import { KHR_DF_CHANNEL_RGBSDA_RED, VK_FORMAT_R8_UNORM } from 'ktx-parse';

import type { RegisteredFont } from '../font.js';
import {
  BITMAP_EXTENSION,
  BITMAP_FORMAT_VERSION,
  BITMAP_KIND,
  bitmapDescriptorRasterKey,
  canonicalizeBitmapDescriptor,
  type BitmapDescriptorV0,
} from '../internal/bitmap-contract.js';
import { nearestBitmapStrikeIndex } from '../internal/bitmap-strike.js';
import {
  ABSENT_GLYPH_PAGE,
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
import type { GlyphPaint, ResolvedPaint } from '../paint.js';
import { RasterCoverageError, type RasterCoverage } from '../raster-coverage.js';
import type { RegisteredRaster } from '../raster.js';
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
  BITMAP_EXTENSION,
  BITMAP_FORMAT_VERSION,
  BITMAP_GENERATOR_VERSION,
  BITMAP_KIND,
  MAX_BITMAP_PPEM,
  bitmapDescriptor,
  bitmapDescriptorRasterKey,
  bitmapRasterKey,
  canonicalizeBitmapDescriptor,
  type BitmapDescriptorV0,
  type BitmapOptions,
} from '../internal/bitmap-contract.js';

const RECORD_STRIDE = DENSE_GLYPH_RECORD_STRIDE;
const ABSENT_PAGE = ABSENT_GLYPH_PAGE;
const MAX_RUNTIME_TEXTURE_BYTES = 256 * 1024 * 1024;

export interface BitmapTechniqueOptions {
  readonly strikes: readonly [number, ...number[]];
  readonly coverage?: RasterCoverage;
}

export interface BitmapPageData extends RasterAtlasPage {
  readonly format: 'r8unorm';
  readonly resource: RasterResourceId;
}

export interface BitmapBinding {
  readonly strike: number;
  readonly page: number;
  readonly ppem: number;
  readonly width: number;
  readonly height: number;
}

export interface BitmapStrikeData {
  readonly ppem: number;
  readonly planeUnitsPerEm: number;
  readonly records: Uint8Array;
  readonly pages: readonly BitmapPageData[];
  readonly bindings: readonly BitmapBinding[];
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

export interface BitmapGlyphBatchStorage {
  readonly origins: Float32Array;
  readonly sizes: Float32Array;
  readonly uvOrigins: Float32Array;
  readonly uvSizes: Float32Array;
  readonly colors: Float32Array;
}

/** Renderer-neutral Bitmap decoding, strike/page selection, and canonical instance packing. */
export const bitmap: RasterTechnique<
  RasterTechniqueId & 'pmndrs.bitmap',
  typeof BITMAP_KIND,
  BitmapTechniqueOptions,
  BitmapDescriptorV0,
  BitmapData,
  BitmapBinding,
  BitmapGlyphBatchStorage
> = defineRasterTechnique({
  id: 'pmndrs.bitmap',
  kind: BITMAP_KIND,
  extension: BITMAP_EXTENSION,
  version: BITMAP_FORMAT_VERSION,
  runtimeBaker: () => import('../runtime-bakers/bitmap.js'),
  descriptor(options: BitmapTechniqueOptions): BitmapDescriptorV0 {
    return canonicalizeBitmapDescriptor(options.strikes, options.coverage);
  },
  async decode(font, raster, signal): Promise<BitmapData> {
    signal?.throwIfAborted();
    const data = await decodeBitmapData(font, raster);
    signal?.throwIfAborted();
    return data;
  },
  select(input: RasterGlyphInput<BitmapData>) {
    const { data, glyphId } = input;
    assertGlyphId(data, glyphId);
    assertCoverage(data, glyphId);
    if (!Number.isFinite(input.fontSize) || input.fontSize <= 0) {
      throw new TypeError('bitmap glyph font sizes must be positive finite values');
    }
    if (!Number.isFinite(input.rasterPixelRatio) || input.rasterPixelRatio <= 0) {
      throw new TypeError('bitmap rasterPixelRatio must be a positive finite value');
    }
    const strikeIndex = nearestBitmapStrikeIndex(data.strikes, input.fontSize, input.rasterPixelRatio);
    const strike = data.strikes[strikeIndex]!;
    const pageIndex = recordView(strike).getUint16(glyphId * RECORD_STRIDE + 16, true);
    if (pageIndex === ABSENT_PAGE) return undefined;
    const page = strike.pages[pageIndex];
    const binding = strike.bindings[pageIndex];
    if (page === undefined || binding === undefined) throw new TypeError('bitmap glyph references a missing page');
    return { resource: page.resource, pipelineVariant: 0, binding };
  },
  createStorage(capacity: number): BitmapGlyphBatchStorage {
    assertCapacity(capacity);
    return {
      origins: new Float32Array(capacity * 2),
      sizes: new Float32Array(capacity * 2),
      uvOrigins: new Float32Array(capacity * 2),
      uvSizes: new Float32Array(capacity * 2),
      colors: new Float32Array(capacity * 4),
    };
  },
  writeStorage(
    storage: BitmapGlyphBatchStorage,
    range: GlyphRange,
    input: RasterGlyphWriteInput<BitmapData, BitmapBinding>,
  ): void {
    writeBitmapStorage(storage, range, input);
  },
  validatePaint: assertBitmapPaint,
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
    const bindings = pages.map((page, pageIndex) =>
      Object.freeze({ strike: strikeIndex, page: pageIndex, ppem, width: page.width, height: page.height }),
    );
    strikes.push({ ppem, planeUnitsPerEm, records, pages, bindings });
  }
  return { strikes, ...(coverage === undefined ? {} : { coverage: coverage.bits }) };
}

function writeBitmapStorage(
  storage: BitmapGlyphBatchStorage,
  range: GlyphRange,
  input: RasterGlyphWriteInput<BitmapData, BitmapBinding>,
): void {
  assertWriteRange(storage, range, input.glyphs.length);
  const strike = input.data.strikes[input.binding.strike];
  if (strike?.bindings[input.binding.page] !== input.binding) {
    throw new TypeError('bitmap write binding does not belong to its data');
  }
  const records = recordView(strike);
  for (let index = 0; index < input.glyphs.length; index += 1) {
    const glyph = input.glyphs[index]!;
    assertGlyphId(input.data, glyph.glyphId);
    assertCoverage(input.data, glyph.glyphId);
    if (!Number.isFinite(glyph.fontSize) || glyph.fontSize <= 0) {
      throw new TypeError('bitmap glyph font sizes must be positive finite values');
    }
    if (!Number.isFinite(glyph.originX) || !Number.isFinite(glyph.originY)) {
      throw new TypeError('bitmap glyph origins must be finite values');
    }
    assertResolvedPaint(glyph.paint);
    const record = glyph.glyphId * RECORD_STRIDE;
    const pageIndex = records.getUint16(record + 16, true);
    if (pageIndex !== input.binding.page) throw new TypeError('bitmap glyph does not belong to the selected page');
    const scale = glyph.fontSize / strike.planeUnitsPerEm;
    const planeLeft = records.getInt16(record, true);
    const planeBottom = records.getInt16(record + 2, true);
    const planeRight = records.getInt16(record + 4, true);
    const planeTop = records.getInt16(record + 6, true);
    const atlasLeft = records.getUint16(record + 8, true);
    const atlasTop = records.getUint16(record + 10, true);
    const atlasRight = records.getUint16(record + 12, true);
    const atlasBottom = records.getUint16(record + 14, true);
    const instance = range.start + index;
    const vectorOffset = instance * 2;
    storage.origins[vectorOffset] = glyph.originX + planeLeft * scale;
    storage.origins[vectorOffset + 1] = glyph.originY - planeTop * scale;
    storage.sizes[vectorOffset] = (planeRight - planeLeft) * scale;
    storage.sizes[vectorOffset + 1] = (planeTop - planeBottom) * scale;
    storage.uvOrigins[vectorOffset] = atlasLeft / input.binding.width;
    storage.uvOrigins[vectorOffset + 1] = atlasTop / input.binding.height;
    storage.uvSizes[vectorOffset] = (atlasRight - atlasLeft) / input.binding.width;
    storage.uvSizes[vectorOffset + 1] = (atlasBottom - atlasTop) / input.binding.height;
    storage.colors.set(glyph.paint.color, instance * 4);
  }
}

function recordView(strike: BitmapStrikeData): DataView {
  return new DataView(strike.records.buffer, strike.records.byteOffset, strike.records.byteLength);
}

function assertGlyphId(data: BitmapData, glyphId: number): void {
  const recordCount = data.strikes[0]!.records.byteLength / RECORD_STRIDE;
  if (!Number.isSafeInteger(glyphId) || glyphId < 0 || glyphId >= recordCount) {
    throw new TypeError('bitmap glyph is outside the registered font');
  }
}

function assertCoverage(data: BitmapData, glyphId: number): void {
  if (data.coverage !== undefined && (data.coverage[glyphId >> 3]! & (1 << (glyphId & 7))) === 0) {
    throw new RasterCoverageError(BITMAP_KIND, [glyphId]);
  }
}

function assertBitmapPaint(paint: GlyphPaint): void {
  for (const entry of paint.palette) assertResolvedPaint(entry);
}

function assertResolvedPaint(paint: ResolvedPaint): void {
  if (paint.outline !== undefined || paint.shadow !== undefined) {
    throw new TypeError('bitmap raster does not support outline or shadow paint');
  }
  if (paint.color.length !== 4 || paint.color.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new TypeError('bitmap color must contain four finite linear values in [0, 1]');
  }
}

function assertWriteRange(storage: BitmapGlyphBatchStorage, range: GlyphRange, glyphCount: number): void {
  const capacity = storage.colors.length / 4;
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.count) ||
    range.start < 0 ||
    range.count < 0 ||
    range.count !== glyphCount ||
    range.start > capacity - range.count
  ) {
    throw new RangeError('bitmap storage write range is outside its capacity');
  }
}

function assertCapacity(capacity: number): void {
  if (!Number.isSafeInteger(capacity) || capacity < 0) {
    throw new RangeError('bitmap storage capacity must be a non-negative safe integer');
  }
}
