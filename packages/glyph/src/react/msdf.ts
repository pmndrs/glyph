import type { Font } from '../font.js';
import type { FontLibrary, LoadFontInput } from '../loader.js';
import { useFont } from '../react.js';
import { msdf, type MsdfOptions } from '../three/msdf.js';

/** MSDF convenience hook over the shared provider-scoped `useFont` cache. */
export interface UseMSDF {
  (input: LoadFontInput, options?: MsdfOptions): Font<typeof msdf>;
  preload(library: FontLibrary, input: LoadFontInput, options?: MsdfOptions): Promise<void>;
  clear(library: FontLibrary, input: LoadFontInput, options?: MsdfOptions): void;
}

/** Loads one MSDF font through the nearest GlyphProvider using the shared React font cache. */
export const useMSDF = ((input: LoadFontInput, options?: MsdfOptions): Font<typeof msdf> =>
  useFont(msdfRequest(input, options))) as UseMSDF;
useMSDF.preload = (library, input, options) => useFont.preload(library, msdfRequest(input, options));
useMSDF.clear = (library, input, options) => useFont.clear(library, msdfRequest(input, options));

function msdfRequest(input: LoadFontInput, options?: MsdfOptions) {
  return {
    input,
    raster: options === undefined ? { technique: msdf } : { technique: msdf, options },
  } as const;
}
