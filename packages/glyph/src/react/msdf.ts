import type { Font } from '../font.js';
import type { LoadFontInput } from '../loader.js';
import { useFont } from '../react.js';
import { msdf, type MsdfOptions } from '../three/msdf.js';

/** MSDF convenience hook over the shared R3F `useFont` cache. */
export interface UseMsdf {
  (input: LoadFontInput, options?: MsdfOptions): Font<typeof msdf>;
  /** Start the same cached MSDF load before a component requests it. */
  preload(input: LoadFontInput, options?: MsdfOptions): Promise<void>;
  /** Release the cached MSDF lease without invalidating mounted consumers. */
  clear(input: LoadFontInput, options?: MsdfOptions): void;
}

/** Load one MSDF font through the shared R3F cache. */
export const useMsdf = ((input: LoadFontInput, options?: MsdfOptions): Font<typeof msdf> =>
  useFont(input, { format: options === undefined ? msdf : { technique: msdf, options } })) as UseMsdf;
useMsdf.preload = (input, options) =>
  useFont.preload(input, { format: options === undefined ? msdf : { technique: msdf, options } });
useMsdf.clear = (input, options) =>
  useFont.clear(input, { format: options === undefined ? msdf : { technique: msdf, options } });
