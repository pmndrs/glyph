import { type JsonValue, type RegisteredFont } from '@pmndrs/text';
import { bitmapRasterKey } from '@pmndrs/text/raster/bitmap/v0';

import type { BitmapFixtureDensity } from '../../workloads/font-assets';

const CONFORMANCE_BITMAP_STRIKES = [16] as const;
const LIVE_BITMAP_STRIKES = [16, 32] as const;

export interface BitmapAtlasPageStats {
  readonly strikePpem: number;
  readonly pageIndex: number;
  readonly width: number;
  readonly height: number;
  readonly gpuBytes: number;
}

/** Reads the baked Bitmap atlas topology without assigning renderer ownership. */
export async function registeredBitmapAtlas(
  font: RegisteredFont,
  density: BitmapFixtureDensity = 'conformance',
): Promise<{
  readonly gpuBytes: number;
  readonly pages: readonly BitmapAtlasPageStats[];
  readonly strikes: readonly { readonly ppem: number }[];
}> {
  const rasterKey =
    density === 'live'
      ? await bitmapRasterKey({ strikes: LIVE_BITMAP_STRIKES })
      : await bitmapRasterKey({ strikes: CONFORMANCE_BITMAP_STRIKES });
  const raster =
    font.getRaster(rasterKey) ??
    (await font.loadRaster({
      kind: 'bitmap',
      rasterKey,
    }));
  const extension = jsonObject(raster.extensionData, 'bitmap extension');
  const strikes = jsonArray(extension.strikes, 'bitmap strikes');
  let bytes = 0;
  const pages: BitmapAtlasPageStats[] = [];
  const registeredStrikes: Array<{ readonly ppem: number }> = [];
  for (const [strikeIndex, strikeValue] of strikes.entries()) {
    const strike = jsonObject(strikeValue, `bitmap strike ${strikeIndex}`);
    const strikePpem = jsonPositiveInteger(strike.ppemX, `bitmap strike ${strikeIndex} ppemX`);
    if (strike.ppemY !== strikePpem) {
      throw new TypeError(`bitmap strike ${strikeIndex} must be square`);
    }
    registeredStrikes.push({ ppem: strikePpem });
    for (const [pageIndex, pageValue] of jsonArray(strike.pages, `bitmap strike ${strikeIndex} pages`).entries()) {
      const page = jsonObject(pageValue, `bitmap strike ${strikeIndex} page ${pageIndex}`);
      const width = jsonPositiveInteger(page.width, 'bitmap page width');
      const height = jsonPositiveInteger(page.height, 'bitmap page height');
      const gpuBytes = width * height;
      bytes += gpuBytes;
      pages.push({ strikePpem, pageIndex, width, height, gpuBytes });
    }
  }
  return { gpuBytes: bytes, pages, strikes: registeredStrikes };
}

function jsonObject(value: JsonValue | undefined, name: string): Readonly<Record<string, JsonValue>> {
  if (!isJsonObject(value)) throw new TypeError(`${name} must be an object`);
  return value;
}

function isJsonObject(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonArray(value: JsonValue | undefined, name: string): readonly JsonValue[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}

function jsonPositiveInteger(value: JsonValue | undefined, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}
