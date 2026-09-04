import { KHR_DF_CHANNEL_RGBSDA_RED, VK_FORMAT_R8_UNORM } from 'ktx-parse';

import type { RasterDecodeFont } from '../../font.js';
import {
  BITMAP_EXTENSION,
  BITMAP_FORMAT_VERSION,
  BITMAP_KIND,
  bitmapDescriptorRasterKey,
  canonicalizeBitmapDescriptor,
} from '../../internal/bitmap-contract.js';
import {
  DENSE_GLYPH_RECORD_STRIDE,
  decodeEmbeddedLosslessAtlasPage,
  jsonArray,
  jsonObject,
  nonnegativeSafeInteger,
  positiveSafeInteger,
} from '../../internal/raster-atlas.js';
import { decodeRasterCoverage } from '../../internal/raster-coverage-artifact.js';
import type { RasterDecodeArtifact } from '../../raster.js';
import { defineRasterResourceId } from '../../config/raster-format.js';
import type { BitmapData, BitmapPageData, BitmapStrikeData } from '../bitmap.js';
import { compatibilityFingerprint } from '../../internal/raster-identity.js';

const RECORD_STRIDE = DENSE_GLYPH_RECORD_STRIDE;
const MAX_RUNTIME_TEXTURE_BYTES = 256 * 1024 * 1024;

export async function decodeBitmapData(font: RasterDecodeFont, raster: RasterDecodeArtifact): Promise<BitmapData> {
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
    extension.fingerprint !==
      compatibilityFingerprint({
        glyphCount: font.glyphCount,
        glyphIdWidth: 16,
        kind: 'bitmap',
        rasterKey: raster.rasterKey,
        shaping: font.shapingFingerprint,
        source: font.sourceFingerprint,
        version: BITMAP_FORMAT_VERSION,
      })
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
    throw new TypeError('bitmap raster key does not match its generation descriptor');
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
            `pmndrs.bitmap/${font.shapingFingerprint}/${raster.rasterKey}/${strikeIndex}/${pageIndex}`,
          ),
        };
      },
    );
    strikes.push({ ppem, planeUnitsPerEm, records, pages });
  }
  return { strikes, ...(coverage === undefined ? {} : { coverage: coverage.bits }) };
}
