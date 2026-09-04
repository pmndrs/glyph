import type { Font } from '../font.js';
import type { FontFaceSource } from '../font-face.js';
import { useFont } from '../react.js';
import { msdf, type MsdfOptions } from '../raster/msdf.js';

/** MSDF convenience hook over the shared `useFont` Suspense resource. */
export interface UseMsdf {
  (input: FontFaceSource, options?: MsdfOptions): Font<typeof msdf>;
  /** Start the same cached MSDF load before a component requests it. */
  preload(input: FontFaceSource, options?: MsdfOptions): Promise<void>;
  /** Release the cached MSDF lease without invalidating mounted consumers. */
  clear(input: FontFaceSource, options?: MsdfOptions): void;
}

/** Load one MSDF font through the shared React Suspense resource. */
export const useMsdf: UseMsdf = Object.assign(
  function useMsdf(input: FontFaceSource, options?: MsdfOptions): Font<typeof msdf> {
    return useFont(input, { format: options === undefined ? msdf : msdf(options) });
  },
  {
    preload: (input: FontFaceSource, options?: MsdfOptions) =>
      useFont.preload(input, { format: options === undefined ? msdf : msdf(options) }),
    clear: (input: FontFaceSource, options?: MsdfOptions) =>
      useFont.clear(input, { format: options === undefined ? msdf : msdf(options) }),
  },
);
