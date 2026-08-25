import { glyphExample } from './raster.js';
import { glyphExampleSchema } from './portable.js';

export interface GlyphExampleShaderBuffer<Id extends number = number, VectorWidth extends number = number> {
  readonly id: Id;
  readonly scalar: 'f32';
  readonly vectorWidth: VectorWidth;
}

export interface GlyphExampleShaderContract {
  readonly techniqueId: typeof glyphExample.id;
  readonly geometry: typeof glyphExampleSchema.render.geometry;
  readonly buffers: Readonly<{
    readonly origin: GlyphExampleShaderBuffer<
      typeof glyphExampleSchema.buffers.origin.id,
      typeof glyphExampleSchema.buffers.origin.lanes.length
    >;
    readonly size: GlyphExampleShaderBuffer<
      typeof glyphExampleSchema.buffers.size.id,
      typeof glyphExampleSchema.buffers.size.lanes.length
    >;
    readonly color: GlyphExampleShaderBuffer<
      typeof glyphExampleSchema.buffers.color.id,
      typeof glyphExampleSchema.buffers.color.lanes.length
    >;
  }>;
  readonly resources: NonNullable<typeof glyphExampleSchema.resources>;
  readonly outputs: Readonly<{ readonly position: 'vec3'; readonly color: 'vec3'; readonly opacity: 'float' }>;
  readonly resource: string;
  readonly geometryResource: string | undefined;
}

function shaderBuffer<Name extends keyof typeof glyphExampleSchema.buffers>(
  name: Name,
): GlyphExampleShaderBuffer<
  (typeof glyphExampleSchema.buffers)[Name]['id'],
  (typeof glyphExampleSchema.buffers)[Name]['lanes']['length']
> {
  const buffer = glyphExampleSchema.buffers[name];
  return Object.freeze({
    id: buffer.id,
    scalar: buffer.scalar,
    vectorWidth: buffer.lanes.length,
  }) as GlyphExampleShaderBuffer<
    (typeof glyphExampleSchema.buffers)[Name]['id'],
    (typeof glyphExampleSchema.buffers)[Name]['lanes']['length']
  >;
}

const geometry = geometryDeclaration();

const resourceNames = Object.keys(glyphExampleSchema.resources ?? {});
if (resourceNames.length !== 1) throw new TypeError('glyph-example shader contract requires one declared resource');

export const glyphExampleShaderContract: GlyphExampleShaderContract = Object.freeze({
  techniqueId: glyphExample.id,
  geometry,
  buffers: Object.freeze({
    origin: shaderBuffer('origin'),
    size: shaderBuffer('size'),
    color: shaderBuffer('color'),
  }),
  resources: glyphExampleSchema.resources!,
  outputs: Object.freeze({ position: 'vec3', color: 'vec3', opacity: 'float' }),
  resource: resourceNames[0]!,
  geometryResource: geometry.resource,
});

function geometryDeclaration(): typeof glyphExampleSchema.render.geometry {
  const geometry = glyphExampleSchema.render?.geometry;
  if (geometry?.kind !== 'synthetic-quad') {
    throw new TypeError('glyph-example shader contract requires synthetic-quad geometry');
  }
  return geometry;
}

export interface GlyphExampleShaderVariant<Language extends string = string> {
  readonly language: Language;
  readonly techniqueId: GlyphExampleShaderContract['techniqueId'];
  readonly geometry: typeof glyphExampleShaderContract.geometry;
  readonly buffers: typeof glyphExampleShaderContract.buffers;
  readonly resources: typeof glyphExampleShaderContract.resources;
  readonly outputs: typeof glyphExampleShaderContract.outputs;
  readonly resource: typeof glyphExampleShaderContract.resource;
  readonly geometryResource: typeof glyphExampleShaderContract.geometryResource;
}
