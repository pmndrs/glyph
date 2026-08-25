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
});

function geometryDeclaration(): typeof glyphExampleSchema.render.geometry {
  const geometry = glyphExampleSchema.render?.geometry;
  if (geometry?.kind !== 'quad' || geometry.resource !== 'glyphGeometry') {
    throw new TypeError('glyph-example shader contract requires its supplied quad geometry');
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
}
