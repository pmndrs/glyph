import { glyphExampleShaderContract, type GlyphExampleShaderVariant } from '@pmndrs/glyph-example-raster';
import { glyphExampleTslVariant } from '@pmndrs/glyph-example-raster/tsl';
import { glyphExampleTypeGpuVariant } from '@pmndrs/glyph-example-raster/typegpu';

function representativeVariant<const Language extends string>(language: Language): GlyphExampleShaderVariant<Language> {
  return Object.freeze({
    language,
    techniqueId: glyphExampleShaderContract.techniqueId,
    geometry: glyphExampleShaderContract.geometry,
    buffers: glyphExampleShaderContract.buffers,
    resources: glyphExampleShaderContract.resources,
    outputs: glyphExampleShaderContract.outputs,
    resource: glyphExampleShaderContract.resource,
    geometryResource: glyphExampleShaderContract.geometryResource,
  });
}

export const glyphExampleWgslVariant: GlyphExampleShaderVariant<'wgsl'> = representativeVariant('wgsl');
export const glyphExampleGlslVariant: GlyphExampleShaderVariant<'glsl'> = representativeVariant('glsl');

export const glyphExampleRendererLanguageFixtures: readonly GlyphExampleShaderVariant[] = Object.freeze([
  glyphExampleTypeGpuVariant,
  glyphExampleTslVariant,
  glyphExampleWgslVariant,
  glyphExampleGlslVariant,
] as const);
