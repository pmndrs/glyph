import type { BitmapData } from '@pmndrs/glyph/raster/bitmap';

export interface BitmapAtlasPageStats {
  readonly strikePpem: number;
  readonly pageIndex: number;
  readonly width: number;
  readonly height: number;
  readonly gpuBytes: number;
}

/** Reads Bitmap allocation topology reconstructed from its compiled portable font contract. */
export function bitmapAtlasConfiguration(data: BitmapData): {
  readonly gpuBytes: number;
  readonly pages: readonly BitmapAtlasPageStats[];
  readonly strikes: readonly { readonly ppem: number }[];
} {
  let bytes = 0;
  const pages: BitmapAtlasPageStats[] = [];
  const registeredStrikes: Array<{ readonly ppem: number }> = [];
  for (const strike of data.strikes) {
    const strikePpem = strike.ppem;
    registeredStrikes.push({ ppem: strikePpem });
    for (const [pageIndex, page] of strike.pages.entries()) {
      const { width, height } = page;
      const gpuBytes = width * height;
      bytes += gpuBytes;
      pages.push({ strikePpem, pageIndex, width, height, gpuBytes });
    }
  }
  return { gpuBytes: bytes, pages, strikes: registeredStrikes };
}
