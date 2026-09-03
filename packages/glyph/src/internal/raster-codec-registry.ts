import { isRasterFormat } from './raster-format-registry.js';
import type { AnyRasterFormat } from '../config/raster-format.js';
import type { RasterCodec } from '../config/raster.js';
import { isTechniqueSchema, type AnyTechniqueSchema } from '../config/schema.js';

type ErasedCodec = RasterCodec<AnyRasterFormat, AnyTechniqueSchema>;

const codecs = new Map<string, ErasedCodec>();
const registeredSources = new WeakMap<object, ErasedCodec>();

export function registerRasterCodecInternal<
  const Technique extends AnyRasterFormat,
  const Schema extends AnyTechniqueSchema,
>(codec: RasterCodec<Technique, Schema>, glyphOwned: boolean): RasterCodec<Technique, Schema> {
  if (typeof codec !== 'object' || codec === null) {
    throw new TypeError('raster codecs need a technique with id, kind, extension, and nonnegative version');
  }
  const source = codec as unknown as Record<string, unknown>;
  const technique = source.raster;
  const techniqueId = isRasterFormat(technique) ? technique.id : undefined;
  const techniqueRecord = technique as {
    id?: unknown;
    kind?: unknown;
    extension?: unknown;
    version?: unknown;
  };
  if (
    typeof techniqueId !== 'string' ||
    techniqueId.length === 0 ||
    typeof techniqueRecord.kind !== 'string' ||
    techniqueRecord.kind.length === 0 ||
    typeof techniqueRecord.extension !== 'string' ||
    techniqueRecord.extension.length === 0 ||
    typeof techniqueRecord.version !== 'number' ||
    !Number.isSafeInteger(techniqueRecord.version) ||
    techniqueRecord.version < 0
  ) {
    throw new TypeError('raster codecs need a technique with id, kind, extension, and nonnegative version');
  }
  if (!glyphOwned && techniqueId.startsWith('pmndrs.')) {
    throw new TypeError(`raster codec id "${techniqueId}" is reserved for Glyph-owned formats`);
  }
  const schema = source.schema;
  const programVariant = source.programVariant ?? 0;
  const codecBody = source.codecBody;
  const compileFontCallback = source.compileFont;
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
  if (!Number.isSafeInteger(programVariant) || (programVariant as number) < 0 || (programVariant as number) > 0xffff) {
    throw new RangeError(`raster codec "${techniqueId}" needs a u16 program variant`);
  }
  if (typeof codecBody !== 'function' || typeof compileFontCallback !== 'function') {
    throw new TypeError(`raster codec "${techniqueId}" needs codecBody and compileFont callbacks`);
  }
  const registered = registeredSources.get(codec as unknown as object);
  if (registered !== undefined) {
    if (registered.raster.id !== techniqueId) {
      throw new TypeError(`raster codec source changed raster id from "${registered.raster.id}" to "${techniqueId}"`);
    }
    return registered as unknown as RasterCodec<Technique, Schema>;
  }
  const existing = codecs.get(techniqueId);
  if (existing !== undefined) {
    throw new TypeError(`a different raster codec is already registered for "${techniqueId}"`);
  }
  const snapshot = Object.freeze({
    raster: technique,
    schema,
    programVariant,
    codecBody,
    compileFont: compileFontCallback,
  }) as unknown as ErasedCodec;
  codecs.set(techniqueId, snapshot);
  registeredSources.set(source, snapshot);
  registeredSources.set(snapshot, snapshot);
  return snapshot as unknown as RasterCodec<Technique, Schema>;
}

export function registerGlyphRasterCodec<
  const Technique extends AnyRasterFormat,
  const Schema extends AnyTechniqueSchema,
>(codec: RasterCodec<Technique, Schema>): RasterCodec<Technique, Schema> {
  return registerRasterCodecInternal(codec, true);
}

export function resolveRasterCodecInternal(id: string): ErasedCodec | undefined {
  return codecs.get(id);
}

export function isRegisteredRasterCodec(codec: unknown): codec is ErasedCodec {
  if (typeof codec !== 'object' || codec === null) return false;
  const raster = (codec as { readonly raster?: unknown }).raster;
  return isRasterFormat(raster) && codecs.get(raster.id) === codec;
}
