import type { CodecIdFactory } from '../config/codec.js';
import type { CompiledRasterFont } from '../config/raster.js';

/** Inputs that remain variable after a concrete raster format and its decoded data are bound. */
export interface RasterFontCompileInput {
  readonly cacheKey: object;
  readonly glyphCount: number;
  readonly identities: CodecIdFactory;
}

export type BoundRasterFontCompiler = (input: RasterFontCompileInput) => CompiledRasterFont | undefined;
export type RasterFormatCompiler<Data> = (input: RasterFontCompileInput, data: Data) => CompiledRasterFont;

export const installRasterFormatCompiler: unique symbol = Symbol('pmndrs.glyph.raster-format.install-compiler');
export const bindRasterFormatCompiler: unique symbol = Symbol('pmndrs.glyph.raster-format.bind-compiler');

/** Package-private operations carried only by a concrete RasterFormat, never its metadata view. */
export interface RasterFormatCompilerWitness<Data> {
  readonly [installRasterFormatCompiler]: (compiler: RasterFormatCompiler<Data>) => void;
  readonly [bindRasterFormatCompiler]: (data: Data) => BoundRasterFontCompiler;
}
