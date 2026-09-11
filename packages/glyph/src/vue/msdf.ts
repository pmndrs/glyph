import type { FontFaceSource } from '../font-face.js';
import { msdf, type MsdfOptions } from '../raster/msdf.js';
import { clearFont, preloadFont, useFont, type UseFontResult } from '../vue.js';

/** Load one MSDF font through the shared Vue font resource. */
export function useMsdf(input: FontFaceSource, options?: MsdfOptions): UseFontResult<typeof msdf> {
  return useFont(input, { format: options === undefined ? msdf : msdf(options) });
}

/** Start the same cached MSDF load before a component requests it. */
export function preloadMsdf(input: FontFaceSource, options?: MsdfOptions): Promise<void> {
  return preloadFont(input, { format: options === undefined ? msdf : msdf(options) });
}

/** Release the cached MSDF lease without invalidating mounted consumers. */
export function clearMsdf(input: FontFaceSource, options?: MsdfOptions): void {
  clearFont(input, { format: options === undefined ? msdf : msdf(options) });
}
