import { glyphExample } from './raster.js';
import { glyphExampleSchema } from './portable.js';

export interface GlyphExampleShaderBuffer {
  readonly id: number;
  readonly scalar: 'f32';
  readonly vectorWidth: number;
}

export interface GlyphExampleShaderContract {
  readonly techniqueId: typeof glyphExample.id;
  readonly geometry: 'synthetic-quad';
  readonly buffers: Readonly<{
    readonly origin: GlyphExampleShaderBuffer;
    readonly size: GlyphExampleShaderBuffer;
    readonly color: GlyphExampleShaderBuffer;
  }>;
  readonly resource: string;
}

function shaderBuffer(name: keyof typeof glyphExampleSchema.buffers): GlyphExampleShaderBuffer {
  const buffer = glyphExampleSchema.buffers[name];
  return Object.freeze({ id: buffer.id, scalar: buffer.scalar, vectorWidth: buffer.lanes.length });
}

const geometry = syntheticQuadGeometry();

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
  resource: resourceNames[0]!,
});

function syntheticQuadGeometry(): 'synthetic-quad' {
  const geometry = glyphExampleSchema.render?.geometry.kind;
  if (geometry !== 'synthetic-quad')
    throw new TypeError('glyph-example shader contract requires synthetic-quad geometry');
  return 'synthetic-quad';
}

export interface GlyphExampleShaderVariant {
  readonly language: 'typegpu' | 'tsl';
  readonly techniqueId: GlyphExampleShaderContract['techniqueId'];
  readonly geometry: typeof glyphExampleShaderContract.geometry;
  readonly buffers: typeof glyphExampleShaderContract.buffers;
  readonly resource: typeof glyphExampleShaderContract.resource;
}
