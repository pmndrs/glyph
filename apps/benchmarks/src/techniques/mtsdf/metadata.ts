import { type RegisteredFont } from '@pmndrs/glyph';
import {
  MSDF_KIND as MTSDF_KIND,
  msdfDescriptorRasterKey as mtsdfDescriptorRasterKey,
} from '@pmndrs/glyph/raster/msdf';

export interface MtsdfRasterConfiguration {
  readonly emSize: number;
  readonly pixelRange: number;
}

/** Reads MTSDF raster metadata without coupling it to the retained renderer. */
export async function registeredMtsdfConfiguration(
  font: RegisteredFont,
  signal?: AbortSignal,
): Promise<MtsdfRasterConfiguration> {
  const rasterKey = await mtsdfDescriptorRasterKey();
  const raster =
    font.getRaster(rasterKey) ??
    (await font.loadRaster({ kind: MTSDF_KIND, rasterKey }, signal === undefined ? undefined : { signal }));
  const extension = raster.extensionData;
  if (typeof extension !== 'object' || extension === null || Array.isArray(extension)) {
    throw new TypeError('MTSDF extension must be an object');
  }
  if (!('emSize' in extension) || !('pixelRange' in extension)) {
    throw new TypeError('MTSDF extension must declare emSize and pixelRange');
  }
  const emSize = extension.emSize;
  const pixelRange = extension.pixelRange;
  if (typeof emSize !== 'number' || !Number.isSafeInteger(emSize) || emSize <= 0) {
    throw new TypeError('MTSDF emSize must be a positive safe integer');
  }
  if (typeof pixelRange !== 'number' || !Number.isFinite(pixelRange) || pixelRange <= 0) {
    throw new TypeError('MTSDF pixelRange must be positive and finite');
  }
  return { emSize, pixelRange };
}
