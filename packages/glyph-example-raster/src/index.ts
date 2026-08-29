import './register.js';

export {
  GLYPH_EXAMPLE_EXTENSION,
  GLYPH_EXAMPLE_FORMAT_VERSION,
  GLYPH_EXAMPLE_GENERATOR_VERSION,
  GLYPH_EXAMPLE_KIND,
  glyphExampleDescriptor,
  type GlyphExampleDescriptor,
  type GlyphExampleOptions,
} from './contract.js';
export { glyphExample, type GlyphExampleData } from './raster.js';
export { glyphExampleIndexedQuadGeometry, glyphExampleSuppliedGeometryDeclaration } from './geometry-fixture.js';
export { glyphExamplePlanProgram } from './register.js';
export { glyphExampleSchema } from './portable.js';
export {
  glyphExampleShaderContract,
  type GlyphExampleShaderBuffer,
  type GlyphExampleShaderContract,
  type GlyphExampleShaderVariant,
} from './shader-contract.js';
