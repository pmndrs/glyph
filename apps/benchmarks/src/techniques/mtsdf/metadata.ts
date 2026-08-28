import type { MsdfData } from '@pmndrs/glyph/raster/msdf';

export interface MtsdfRasterConfiguration {
  readonly emSize: number;
  readonly pixelRange: number;
}

/** Reads MTSDF allocation metadata reconstructed from its compiled portable font contract. */
export function mtsdfDataConfiguration(data: MsdfData): MtsdfRasterConfiguration {
  return { emSize: data.emSize, pixelRange: data.pixelRange };
}
