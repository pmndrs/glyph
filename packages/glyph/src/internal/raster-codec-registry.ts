import type { RasterDataOf, RasterFormatMetadata } from '../config/raster-format.js';
import type { CompiledRasterFont, RasterCodec } from '../config/raster.js';
import { isTechniqueSchema, type TechniqueSchemaMetadata } from '../config/schema.js';
import { isRasterFormat } from './raster-format-registry.js';
import {
  installRasterFormatCompiler,
  type RasterFontCompileInput,
  type RasterFormatCompilerWitness,
} from './raster-format-compiler.js';

/** The uniform metadata operations needed after a concrete codec has been registered. */
export interface RegisteredRasterCodec {
  readonly raster: RasterFormatMetadata;
  readonly schema: TechniqueSchemaMetadata;
  readonly programVariant: number;
}

const codecs = new Map<string, RegisteredRasterCodec>();
const registeredSources = new WeakSet<object>();
type RasterCodecFontCompiler = <Format extends RasterFormatMetadata, Schema extends TechniqueSchemaMetadata>(
  codec: RasterCodec<Format, Schema>,
  input: RasterFontCompileInput,
  data: RasterDataOf<Format>,
) => CompiledRasterFont;
let compileRasterCodecFont: RasterCodecFontCompiler | undefined;

/** @internal Installs the generic compiler implementation without exposing it from the public config leaf. */
export function installRasterCodecFontCompiler(compile: RasterCodecFontCompiler): void {
  if (compileRasterCodecFont !== undefined && compileRasterCodecFont !== compile) {
    throw new Error('raster Codec font compiler is already installed');
  }
  compileRasterCodecFont = compile;
}

export function registerRasterCodecInternal<
  const Format extends RasterFormatMetadata,
  const Schema extends TechniqueSchemaMetadata,
>(
  codec: RasterCodec<Format, Schema> & {
    readonly raster: Format & RasterFormatCompilerWitness<RasterDataOf<Format>>;
  },
  glyphOwned: boolean,
): RasterCodec<Format, Schema> {
  if (typeof codec !== 'object' || codec === null) {
    throw new TypeError('raster codecs need a format with id, kind, extension, and nonnegative version');
  }
  const format = codec.raster;
  if (!isRasterFormat(format)) {
    throw new TypeError('raster codecs need a format with id, kind, extension, and nonnegative version');
  }
  const formatId = format.id;
  if (!glyphOwned && formatId.startsWith('pmndrs.')) {
    throw new TypeError(`raster codec id "${formatId}" is reserved for Glyph-owned formats`);
  }
  const schema = codec.schema;
  const programVariant = codec.programVariant ?? 0;
  if (!isTechniqueSchema(schema)) {
    throw new TypeError(`raster codec "${formatId}" needs a schema from defineTechniqueSchema`);
  }
  if (schema.technique !== formatId) {
    throw new TypeError(`raster codec "${formatId}" schema names technique "${schema.technique}"`);
  }
  if (Object.keys(schema.resources).length === 0) {
    throw new TypeError(`raster codec "${formatId}" needs at least one declared resource`);
  }
  if (schema.render.resource === undefined) {
    throw new TypeError(`raster codec "${formatId}" needs a declared render resource`);
  }
  if (!Number.isSafeInteger(programVariant) || programVariant < 0 || programVariant > 0xffff) {
    throw new RangeError(`raster codec "${formatId}" needs a u16 program variant`);
  }
  if (typeof codec.codecBody !== 'function' || typeof codec.compileFont !== 'function') {
    throw new TypeError(`raster codec "${formatId}" needs codecBody and compileFont callbacks`);
  }
  if (registeredSources.has(codec)) return codec;
  if (codecs.has(formatId)) {
    throw new TypeError(`a different raster codec is already registered for "${formatId}"`);
  }

  const registered = Object.freeze(codec);
  format[installRasterFormatCompiler]((input, data) => {
    const compile = compileRasterCodecFont;
    if (compile === undefined) throw new Error('raster Codec font compiler is not installed');
    return compile(registered, input, data);
  });
  codecs.set(
    formatId,
    Object.freeze({
      raster: format,
      schema,
      programVariant,
    }),
  );
  registeredSources.add(codec);
  return registered;
}

export function registerGlyphRasterCodec<
  const Format extends RasterFormatMetadata,
  const Schema extends TechniqueSchemaMetadata,
>(
  codec: RasterCodec<Format, Schema> & {
    readonly raster: Format & RasterFormatCompilerWitness<RasterDataOf<Format>>;
  },
): RasterCodec<Format, Schema> {
  return registerRasterCodecInternal(codec, true);
}

export function resolveRasterCodecInternal(id: string): RegisteredRasterCodec | undefined {
  return codecs.get(id);
}

export function isRegisteredRasterCodec(codec: unknown): boolean {
  return typeof codec === 'object' && codec !== null && registeredSources.has(codec);
}
