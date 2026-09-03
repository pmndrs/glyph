import { isRasterFormat } from './raster-format-registry.js';
import type { AnyRasterFormat } from '../config/raster-format.js';
import type { RasterPlanProgram } from '../config/raster.js';
import { isTechniqueSchema, type AnyTechniqueSchema } from '../config/schema.js';

type ErasedProgram = RasterPlanProgram<AnyRasterFormat, AnyTechniqueSchema>;

const programs = new Map<string, ErasedProgram>();
const registeredSources = new WeakMap<object, ErasedProgram>();

export function registerRasterPlanProgramInternal<
  const Technique extends AnyRasterFormat,
  const Schema extends AnyTechniqueSchema,
>(program: RasterPlanProgram<Technique, Schema>, glyphOwned: boolean): RasterPlanProgram<Technique, Schema> {
  if (typeof program !== 'object' || program === null) {
    throw new TypeError('raster plan programs need a technique with id, kind, extension, and nonnegative version');
  }
  const source = program as unknown as Record<string, unknown>;
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
    throw new TypeError('raster plan programs need a technique with id, kind, extension, and nonnegative version');
  }
  if (!glyphOwned && techniqueId.startsWith('pmndrs.')) {
    throw new TypeError(`raster plan program id "${techniqueId}" is reserved for Glyph-owned techniques`);
  }
  const schema = source.schema;
  const programVariant = source.programVariant ?? 0;
  const codecBody = source.codecBody;
  const compileFontCallback = source.compileFont;
  if (!isTechniqueSchema(schema)) {
    throw new TypeError(`raster plan program "${techniqueId}" needs a schema from defineTechniqueSchema`);
  }
  if (schema.technique !== techniqueId) {
    throw new TypeError(`raster plan program "${techniqueId}" schema names technique "${schema.technique}"`);
  }
  if (Object.keys(schema.resources).length === 0) {
    throw new TypeError(`raster plan program "${techniqueId}" needs at least one declared resource`);
  }
  if (schema.render.resource === undefined) {
    throw new TypeError(`raster plan program "${techniqueId}" needs a declared render resource`);
  }
  if (!Number.isSafeInteger(programVariant) || (programVariant as number) < 0 || (programVariant as number) > 0xffff) {
    throw new RangeError(`raster plan program "${techniqueId}" needs a u16 program variant`);
  }
  if (typeof codecBody !== 'function' || typeof compileFontCallback !== 'function') {
    throw new TypeError(`raster plan program "${techniqueId}" needs codecBody and compileFont callbacks`);
  }
  const registered = registeredSources.get(program as unknown as object);
  if (registered !== undefined) {
    if (registered.raster.id !== techniqueId) {
      throw new TypeError(
        `raster plan program source changed raster id from "${registered.raster.id}" to "${techniqueId}"`,
      );
    }
    return registered as unknown as RasterPlanProgram<Technique, Schema>;
  }
  const existing = programs.get(techniqueId);
  if (existing !== undefined) {
    throw new TypeError(`a different raster plan program is already registered for "${techniqueId}"`);
  }
  const snapshot = Object.freeze({
    raster: technique,
    schema,
    programVariant,
    codecBody,
    compileFont: compileFontCallback,
  }) as unknown as ErasedProgram;
  programs.set(techniqueId, snapshot);
  registeredSources.set(source, snapshot);
  registeredSources.set(snapshot, snapshot);
  return snapshot as unknown as RasterPlanProgram<Technique, Schema>;
}

export function registerGlyphRasterPlanProgram<
  const Technique extends AnyRasterFormat,
  const Schema extends AnyTechniqueSchema,
>(program: RasterPlanProgram<Technique, Schema>): RasterPlanProgram<Technique, Schema> {
  return registerRasterPlanProgramInternal(program, true);
}

export function resolveRasterPlanProgramInternal(id: string): ErasedProgram | undefined {
  return programs.get(id);
}

export function isRegisteredRasterPlanProgram(program: unknown): program is ErasedProgram {
  if (typeof program !== 'object' || program === null) return false;
  const raster = (program as { readonly raster?: unknown }).raster;
  return isRasterFormat(raster) && programs.get(raster.id) === program;
}
