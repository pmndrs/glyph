import type { MsdfData } from '@pmndrs/glyph/raster/msdf';

export interface MtsdfRasterConfiguration {
  readonly emSize: number;
  readonly pixelRange: number;
}

/** Reads MTSDF allocation metadata captured by the benchmark-owned technique wrapper. */
export function mtsdfDataConfiguration(data: MsdfData): MtsdfRasterConfiguration {
  return { emSize: data.emSize, pixelRange: data.pixelRange };
}
