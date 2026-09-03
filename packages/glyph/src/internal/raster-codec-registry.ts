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
type RasterCodecFontCompiler = <Technique extends RasterFormatMetadata, Schema extends TechniqueSchemaMetadata>(
  codec: RasterCodec<Technique, Schema>,
  input: RasterFontCompileInput,
  data: RasterDataOf<Technique>,
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
  const Technique extends RasterFormatMetadata,
  const Schema extends TechniqueSchemaMetadata,
>(
  codec: RasterCodec<Technique, Schema> & {
    readonly raster: Technique & RasterFormatCompilerWitness<RasterDataOf<Technique>>;
  },
  glyphOwned: boolean,
): RasterCodec<Technique, Schema> {
  if (typeof codec !== 'object' || codec === null) {
    throw new TypeError('raster codecs need a technique with id, kind, extension, and nonnegative version');
  }
  const technique = codec.raster;
  if (!isRasterFormat(technique)) {
    throw new TypeError('raster codecs need a technique with id, kind, extension, and nonnegative version');
  }
  const techniqueId = technique.id;
  if (!glyphOwned && techniqueId.startsWith('pmndrs.')) {
    throw new TypeError(`raster codec id "${techniqueId}" is reserved for Glyph-owned formats`);
  }
  const schema = codec.schema;
  const programVariant = codec.programVariant ?? 0;
  if (!isTechniqueSchema(schema)) {
    throw new TypeError(`raster codec "${techniqueId}" needs a schema from defineTechniqueSchema`);
  }
  if (schema.technique !== techniqueId) {
    throw new TypeError(`raster codec "${techniqueId}" schema names technique "${schema.technique}"`);
  }
  if (Object.keys(schema.resources).length === 0) {
    throw new TypeError(`raster codec "${techniqueId}" needs at least one declared resource`);
  }
  if (schema.render.resource === undefined) {
    throw new TypeError(`raster codec "${techniqueId}" needs a declared render resource`);
  }
  if (!Number.isSafeInteger(programVariant) || programVariant < 0 || programVariant > 0xffff) {
    throw new RangeError(`raster codec "${techniqueId}" needs a u16 program variant`);
  }
  if (typeof codec.codecBody !== 'function' || typeof codec.compileFont !== 'function') {
    throw new TypeError(`raster codec "${techniqueId}" needs codecBody and compileFont callbacks`);
  }
  if (registeredSources.has(codec)) return codec;
  if (codecs.has(techniqueId)) {
    throw new TypeError(`a different raster codec is already registered for "${techniqueId}"`);
  }

  const registered = Object.freeze(codec);
  technique[installRasterFormatCompiler]((input, data) => {
    const compile = compileRasterCodecFont;
    if (compile === undefined) throw new Error('raster Codec font compiler is not installed');
    return compile(registered, input, data);
  });
  codecs.set(
    techniqueId,
    Object.freeze({
      raster: technique,
      schema,
      programVariant,
    }),
  );
  registeredSources.add(codec);
  return registered;
}

export function registerGlyphRasterCodec<
  const Technique extends RasterFormatMetadata,
  const Schema extends TechniqueSchemaMetadata,
>(
  codec: RasterCodec<Technique, Schema> & {
    readonly raster: Technique & RasterFormatCompilerWitness<RasterDataOf<Technique>>;
  },
): RasterCodec<Technique, Schema> {
  return registerRasterCodecInternal(codec, true);
}

export function resolveRasterCodecInternal(id: string): RegisteredRasterCodec | undefined {
  return codecs.get(id);
}

export function isRegisteredRasterCodec(codec: unknown): boolean {
  return typeof codec === 'object' && codec !== null && registeredSources.has(codec);
}
